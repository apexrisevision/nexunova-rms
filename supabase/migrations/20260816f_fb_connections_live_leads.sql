-- ════════════════════════════════════════════════════════════════════════════
-- list_fb_connections += per-page `live_leads`
--
-- Directors count a page's leads from list_my_leads (filtered by fb_page_id).
-- Operators are forbidden on that RPC, so the UI fell back to
-- fb_connections.leads_count — a LIFETIME counter that never decrements, so the
-- FMH page read 15 to an operator against 11 real leads (4 since deleted).
--
-- The fix is a count, not access: operators already see leads_count here, and
-- this replaces it with the honest live number. It does NOT hand operators the
-- leads themselves — list_my_leads still rejects lead_entry.
--
-- ADDITIVE: same signature, same role gate, existing keys unchanged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_fb_connections(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb; v_recips jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'page_id',c.page_id,'page_name',c.page_name,
    'has_token',(c.page_access_token IS NOT NULL AND length(c.page_access_token)>0),
    'token_tail', CASE WHEN c.page_access_token IS NOT NULL THEN right(c.page_access_token,6) ELSE NULL END,
    'verify_token',c.verify_token,'project_id',c.project_id,'project_name',p.project_name,
    'recipient_sales_user_id',c.recipient_sales_user_id,'recipient_name',ru.full_name,
    'auto_notify',c.auto_notify,'status',c.status,'last_lead_at',c.last_lead_at,'leads_count',c.leads_count,
    -- live (not-deleted) leads this Page actually produced; leads_count above is
    -- a lifetime counter kept for continuity
    'live_leads', (SELECT count(*) FROM public.leads l
                    WHERE l.deleted_at IS NULL
                      AND l.company_id = c.company_id
                      AND l.fb_page_id = c.page_id)
  ) ORDER BY c.created_at), '[]'::jsonb) INTO v_rows
  FROM public.fb_connections c
  LEFT JOIN public.projects p ON p.id=c.project_id
  LEFT JOIN public.sales_users ru ON ru.id=c.recipient_sales_user_id
  WHERE c.company_id=v_ses.company_id;

  -- who this caller may hand a Page's leads to (empty for operators)
  IF v_role IN ('director','admin') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',su.id,'name',su.full_name,'role',su.role)
             ORDER BY su.full_name), '[]'::jsonb) INTO v_recips
    FROM public.sales_users su
    WHERE su.company_id=v_ses.company_id
      AND su.role IN ('director','admin')
      AND su.status='active';
  ELSE
    v_recips := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object('success',true,'pages',v_rows,'recipients',v_recips,'can_set_recipient',(v_role IN ('director','admin')));
END; $function$;
