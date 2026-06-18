-- Sales Leaderboard (sales-portal, sale-persons only — no admin view).
-- Owner ask: "ab har unit ka sale person aa gaya hai — sab ko dikhe kis ne kitni
-- aur kaun si units bechi, taake sab motivate hon." Ranking is by UNIT COUNT
-- (not value). Everyone sees everyone. Session-token gated like get_my_outstanding.
-- agent_id IS NULL (Direct/Unassigned) is excluded — leaderboard is people only.
CREATE OR REPLACE FUNCTION public.get_sales_leaderboard(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_result jsonb;
  v_ms date := date_trunc('month',CURRENT_DATE)::date;
  v_me date := (date_trunc('month',CURRENT_DATE)+interval '1 month')::date;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;

  WITH base AS (
    SELECT s.agent_id, s.id sale_id, s.sale_date, s.net_amount,
           u.unit_no, COALESCE(fl.name,NULLIF(u.floor_label,''),u.floor_no::text) floor_name,
           pr.project_name, cl.full_name client_name
    FROM public.sales s
    JOIN public.units u ON u.id=s.unit_id AND u.company_id=s.company_id
    LEFT JOIN public.floors fl ON fl.id=u.floor_id
    LEFT JOIN public.projects pr ON pr.id=s.project_id
    LEFT JOIN public.clients cl ON cl.id=s.client_id
    WHERE s.company_id=v_ses.company_id
      AND s.status<>'cancelled' AND COALESCE(s.is_active,s.status='active')
      AND s.agent_id IS NOT NULL
  ),
  per AS (
    SELECT b.agent_id, ag.full_name agent_name, ag.agent_code,
      COUNT(*) units_all,
      COUNT(*) FILTER (WHERE b.sale_date>=v_ms AND b.sale_date<v_me) units_month,
      COALESCE(SUM(b.net_amount),0) value_all,
      COALESCE(SUM(b.net_amount) FILTER (WHERE b.sale_date>=v_ms AND b.sale_date<v_me),0) value_month,
      MAX(b.sale_date) last_sale,
      jsonb_agg(jsonb_build_object('unit_no',b.unit_no,'floor_name',b.floor_name,'project_name',b.project_name,
                                   'client_name',b.client_name,'sale_date',to_char(b.sale_date,'YYYY-MM-DD'),
                                   'net_amount',b.net_amount) ORDER BY b.sale_date DESC) units
    FROM base b LEFT JOIN public.agents ag ON ag.id=b.agent_id
    GROUP BY b.agent_id, ag.full_name, ag.agent_code
  )
  SELECT jsonb_build_object(
    'success',true,
    'my_agent_id', v_su.agent_id,
    'my_name', v_su.full_name,
    'month_label', to_char(CURRENT_DATE,'Mon YYYY'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'agent_id',agent_id,'agent_name',COALESCE(agent_name,'Unnamed'),'agent_code',agent_code,
        'units_all',units_all,'units_month',units_month,
        'value_all',value_all,'value_month',value_month,
        'last_sale',to_char(last_sale,'YYYY-MM-DD'),'units',units)) FROM per),'[]'::jsonb),
    'totals', jsonb_build_object(
      'sale_persons',(SELECT COUNT(*) FROM per),
      'units_all',(SELECT COALESCE(SUM(units_all),0) FROM per),
      'units_month',(SELECT COALESCE(SUM(units_month),0) FROM per))
  ) INTO v_result;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.get_sales_leaderboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_leaderboard(text) TO anon, authenticated;
