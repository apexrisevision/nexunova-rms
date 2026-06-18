-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — Phase 6b: leaderboard + My Recovery made umbrella-aware.
-- get_sales_leaderboard: ranks across ALL member companies and collapses a dealer's
--   per-company agent records into ONE row via dealer_company_agents (key 'D:<dealer>'
--   when an agent maps to a dealer, else 'A:<agent>'). 'my_agent_id' is the caller's
--   key. Standalone companies behave as before (single company, keyed by agent).
-- get_my_outstanding: for a grouped dealer, merges their outstanding across every
--   member company (one _agent_outstanding_core call per dealer_company_agents row)
--   and re-aggregates the totals. Standalone / unmapped dealers unchanged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_sales_leaderboard(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_result jsonb;
  v_ms date := date_trunc('month',CURRENT_DATE)::date;
  v_me date := (date_trunc('month',CURRENT_DATE)+interval '1 month')::date;
  v_group uuid; v_companies uuid[]; v_mykey text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  IF v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
    v_mykey := 'D:'||v_ses.sales_user_id::text;
  ELSE v_companies := ARRAY[v_ses.company_id]; v_mykey := 'A:'||COALESCE(v_su.agent_id::text,'none'); END IF;

  WITH base AS (
    SELECT COALESCE('D:'||dca.sales_user_id::text, 'A:'||s.agent_id::text) AS key,
           COALESCE(dsu.full_name, ag.full_name) AS person_name, ag.agent_code,
           s.sale_date, s.net_amount, u.unit_no, COALESCE(co.company_name,'') company_name,
           pr.project_name, cl.full_name client_name
    FROM public.sales s
    JOIN public.units u ON u.id=s.unit_id AND u.company_id=s.company_id
    LEFT JOIN public.dealer_company_agents dca ON dca.company_id=s.company_id AND dca.agent_id=s.agent_id
    LEFT JOIN public.sales_users dsu ON dsu.id=dca.sales_user_id
    LEFT JOIN public.agents ag ON ag.id=s.agent_id
    LEFT JOIN public.companies co ON co.id=s.company_id
    LEFT JOIN public.projects pr ON pr.id=s.project_id
    LEFT JOIN public.clients cl ON cl.id=s.client_id
    WHERE s.company_id = ANY(v_companies)
      AND s.status<>'cancelled' AND COALESCE(s.is_active,s.status='active') AND s.agent_id IS NOT NULL
  ),
  per AS (
    SELECT key, MIN(person_name) person_name, MIN(agent_code) agent_code,
      COUNT(*) units_all,
      COUNT(*) FILTER (WHERE sale_date>=v_ms AND sale_date<v_me) units_month,
      COALESCE(SUM(net_amount),0) value_all,
      COALESCE(SUM(net_amount) FILTER (WHERE sale_date>=v_ms AND sale_date<v_me),0) value_month,
      MAX(sale_date) last_sale,
      jsonb_agg(jsonb_build_object('unit_no',unit_no,'project_name',project_name,'company_name',company_name,
                                   'client_name',client_name,'sale_date',to_char(sale_date,'YYYY-MM-DD'),
                                   'net_amount',net_amount) ORDER BY sale_date DESC) units
    FROM base GROUP BY key
  )
  SELECT jsonb_build_object(
    'success',true, 'my_agent_id', v_mykey, 'my_name', v_su.full_name,
    'grouped', (v_group IS NOT NULL), 'month_label', to_char(CURRENT_DATE,'Mon YYYY'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'agent_id',key,'agent_name',COALESCE(person_name,'Unnamed'),'agent_code',agent_code,
        'units_all',units_all,'units_month',units_month,'value_all',value_all,'value_month',value_month,
        'last_sale',to_char(last_sale,'YYYY-MM-DD'),'units',units)) FROM per),'[]'::jsonb),
    'totals', jsonb_build_object(
      'sale_persons',(SELECT COUNT(*) FROM per),
      'units_all',(SELECT COALESCE(SUM(units_all),0) FROM per),
      'units_month',(SELECT COALESCE(SUM(units_month),0) FROM per))
  ) INTO v_result;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_outstanding(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_res jsonb; v_group uuid; n_dca int;
        rec record; v_rows jsonb := '[]'::jsonb; v_tot jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT count(*) INTO n_dca FROM public.dealer_company_agents WHERE sales_user_id=v_su.id;

  IF v_group IS NULL OR n_dca=0 THEN
    IF v_su.agent_id IS NULL THEN
      RETURN jsonb_build_object('success',true,'no_agent',true,'rows','[]'::jsonb,'agents','[]'::jsonb,'totals','{}'::jsonb,
        'message','Your sales-agent profile is being set up. Once your admin links it, your recovery book appears here.');
    END IF;
    v_res := public._agent_outstanding_core(v_ses.company_id, NULL, v_su.agent_id, CURRENT_DATE);
    RETURN v_res || jsonb_build_object('success',true,'agent_name',v_su.full_name);
  END IF;

  FOR rec IN SELECT company_id, agent_id FROM public.dealer_company_agents WHERE sales_user_id=v_su.id LOOP
    v_res := public._agent_outstanding_core(rec.company_id, NULL, rec.agent_id, CURRENT_DATE);
    v_rows := v_rows || COALESCE(v_res->'rows','[]'::jsonb);
  END LOOP;
  SELECT jsonb_build_object(
    'overdue',            COALESCE(SUM((e->>'overdue')::numeric),0),
    'total_remaining',    COALESCE(SUM((e->>'total_remaining')::numeric),0),
    'received',           COALESCE(SUM((e->>'received')::numeric),0),
    'clients',            COUNT(*),
    'clients_in_arrears', COUNT(*) FILTER (WHERE (e->>'overdue')::numeric>0.5)
  ) INTO v_tot FROM jsonb_array_elements(v_rows) e;
  RETURN jsonb_build_object('success',true,'rows',v_rows,'agents','[]'::jsonb,'totals',COALESCE(v_tot,'{}'::jsonb),'agent_name',v_su.full_name);
END $function$;
