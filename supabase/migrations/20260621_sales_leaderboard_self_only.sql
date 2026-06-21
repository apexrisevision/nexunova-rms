-- Sales "Leaderboard" → SELF-ONLY tally (sales-portal, sale-persons).
-- Owner ask (2026-06-21): har banday ko sirf apna dikhe — kis ne kitni bechi
-- ye ek dusray ko na dikhe. Overall/everyone ranking hata di gayi. Pehle ye RPC
-- HAR agent ke rows (naam, client, units) bhejta tha (peer-visible + network leak);
-- ab sirf CALLER ke apne units/counts lautata hai (all-time + this-month).
--
-- Umbrella-aware (supersedes phase6b's group-wide ranking, keeps the SELF scope):
--   * Grouped dealer (companies.dealer_group_id set AND mapped in
--     dealer_company_agents) → own sales across EVERY member company they map to.
--   * Standalone / unmapped → own sales in the session company (s.agent_id=v_su.agent_id).
-- Same name retained so the portal's two call sites need no rename. Session-token
-- gated. No agent profile linked → no_agent / zero.
CREATE OR REPLACE FUNCTION public.get_sales_leaderboard(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_result jsonb;
  v_ms date := date_trunc('month',CURRENT_DATE)::date;
  v_me date := (date_trunc('month',CURRENT_DATE)+interval '1 month')::date;
  v_group uuid; v_companies uuid[]; n_dca int; v_grouped boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT count(*) INTO n_dca FROM public.dealer_company_agents WHERE sales_user_id=v_su.id;
  v_grouped := (v_group IS NOT NULL AND n_dca>0);
  IF v_grouped THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
  ELSE
    v_companies := ARRAY[v_ses.company_id];
  END IF;

  -- No agent profile linked (standalone) → nothing to tally.
  IF NOT v_grouped AND v_su.agent_id IS NULL THEN
    RETURN jsonb_build_object('success',true,'no_agent',true,'grouped',false,
      'my_agent_id',NULL,'my_name',v_su.full_name,
      'month_label',to_char(CURRENT_DATE,'Mon YYYY'),
      'units_all',0,'units_month',0,'value_all',0,'value_month',0,'units','[]'::jsonb);
  END IF;

  WITH base AS (
    SELECT s.id sale_id, s.sale_date, s.net_amount,
           u.unit_no, COALESCE(fl.name,NULLIF(u.floor_label,''),u.floor_no::text) floor_name,
           pr.project_name, COALESCE(co.company_name,'') company_name, cl.full_name client_name
    FROM public.sales s
    JOIN public.units u ON u.id=s.unit_id AND u.company_id=s.company_id
    LEFT JOIN public.floors fl ON fl.id=u.floor_id
    LEFT JOIN public.companies co ON co.id=s.company_id
    LEFT JOIN public.projects pr ON pr.id=s.project_id
    LEFT JOIN public.clients cl ON cl.id=s.client_id
    WHERE s.status<>'cancelled' AND COALESCE(s.is_active,s.status='active') AND s.agent_id IS NOT NULL
      AND (
        (v_grouped AND s.company_id = ANY(v_companies)
           AND EXISTS (SELECT 1 FROM public.dealer_company_agents dca
                       WHERE dca.sales_user_id=v_su.id AND dca.company_id=s.company_id AND dca.agent_id=s.agent_id))
        OR
        (NOT v_grouped AND s.company_id=v_ses.company_id AND s.agent_id=v_su.agent_id)
      )
  )
  SELECT jsonb_build_object(
    'success',true,
    'no_agent',false,
    'grouped',v_grouped,
    'my_agent_id', v_su.agent_id,
    'my_name', v_su.full_name,
    'month_label', to_char(CURRENT_DATE,'Mon YYYY'),
    'units_all',   (SELECT COUNT(*) FROM base),
    'units_month', (SELECT COUNT(*) FROM base WHERE sale_date>=v_ms AND sale_date<v_me),
    'value_all',   (SELECT COALESCE(SUM(net_amount),0) FROM base),
    'value_month', (SELECT COALESCE(SUM(net_amount) FILTER (WHERE sale_date>=v_ms AND sale_date<v_me),0) FROM base),
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'unit_no',unit_no,'floor_name',floor_name,'project_name',project_name,'company_name',company_name,
        'client_name',client_name,'sale_date',to_char(sale_date,'YYYY-MM-DD'),
        'net_amount',net_amount) ORDER BY sale_date DESC) FROM base),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.get_sales_leaderboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_leaderboard(text) TO anon, authenticated;
