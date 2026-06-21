-- ════════════════════════════════════════════════════════════════════════════
-- DIRECTORS SEE ALL COMPANY LEADS. 2026-06-21.
-- Owner ask: "agar mai apna role director banaun to muje saari leads auto show
-- ho jayein." Previously list_my_leads scoped EVERY role to the caller's own
-- subtree (self + descendants). With more than one top-level director, a director
-- couldn't see leads owned by a *different* director (e.g. lead_entry leads land
-- in the company's resolved director's pool). Now director/admin/cfo see EVERY
-- lead in their company; marketing_manager/sale_rep keep the subtree scope.
-- (Visibility only — assign_lead still requires ownership to hand a lead down.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'owner_name', ow.full_name, 'owner_sales_user_id', l.owner_sales_user_id,
    'is_mine', (l.owner_sales_user_id=v_uid), 'created_by_me', (l.created_by_sales_user_id = v_uid),
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) ORDER BY l.last_activity_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.leads l
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  WHERE (p_status IS NULL OR l.status=p_status)
    AND ( (v_companywide AND l.company_id=v_ses.company_id)
          OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) );

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM public.leads l
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb));
END
$function$;
