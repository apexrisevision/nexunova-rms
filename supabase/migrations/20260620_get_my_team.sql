-- ════════════════════════════════════════════════════════════════════════
-- Manager interface — "My Team" roster: the manager's direct sub-agents
-- (parent_sales_user_id = caller) each with leads/pipeline/sales/recovery
-- aggregates + team totals. Session-gated.  (Director ≠ Manager — separate.)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_team(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_rows jsonb; v_n int;
        v_sales_val numeric; v_outstanding numeric; v_pipeline int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;

  WITH team AS (
    SELECT su.id, su.full_name, su.role, su.phone, su.agent_id
    FROM public.sales_users su
    WHERE su.parent_sales_user_id = v_uid AND su.company_id = v_co AND su.status='active'
  ), agg AS (
    SELECT t.*,
      (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=t.id) AS leads_total,
      (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=t.id AND l.status NOT IN ('won','lost')) AS pipeline,
      (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=t.id AND l.status='won') AS won,
      (SELECT count(*) FROM public.sales s WHERE s.agent_id=t.agent_id AND s.company_id=v_co AND COALESCE(s.is_active,true)) AS sales_count,
      (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE s.agent_id=t.agent_id AND s.company_id=v_co AND COALESCE(s.is_active,true)) AS sales_value,
      (SELECT COALESCE(sum(s.remaining_amount),0) FROM public.sales s WHERE s.agent_id=t.agent_id AND s.company_id=v_co AND COALESCE(s.is_active,true)) AS outstanding
    FROM team t
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.full_name, 'role', a.role, 'phone', a.phone,
           'leads_total', a.leads_total, 'pipeline', a.pipeline, 'won', a.won,
           'sales_count', a.sales_count, 'sales_value', a.sales_value, 'outstanding', a.outstanding,
           'conversion', CASE WHEN a.leads_total>0 THEN round(a.won::numeric*100/a.leads_total,1) ELSE 0 END
         ) ORDER BY a.sales_value DESC, a.full_name), '[]'::jsonb),
         count(*), COALESCE(sum(a.sales_value),0), COALESCE(sum(a.outstanding),0), COALESCE(sum(a.pipeline),0)
    INTO v_rows, v_n, v_sales_val, v_outstanding, v_pipeline
  FROM agg a;

  RETURN jsonb_build_object('success',true,'team',v_rows,'count',COALESCE(v_n,0),
    'totals', jsonb_build_object('sales_value',v_sales_val,'outstanding',v_outstanding,'pipeline',v_pipeline,'agents',COALESCE(v_n,0)));
END; $function$;
