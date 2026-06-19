-- ════════════════════════════════════════════════════════════════════════
-- Sale-person "My Sales" — the agent's own closed sales (session-gated).
-- Resolves session → sales_user → agent_id → sales (+ unit, client, project).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_sales(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_agent uuid; v_rows jsonb; v_n int; v_tot numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT agent_id INTO v_agent FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('success',true,'sales','[]'::jsonb,'count',0,'total',0,'no_agent',true); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'unit_no', u.unit_no,
    'client_name', c.full_name, 'net_amount', s.net_amount, 'remaining_amount', s.remaining_amount,
    'status', s.status, 'sale_date', s.sale_date, 'project_name', p.project_name
  ) ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC), '[]'::jsonb),
         count(*), COALESCE(sum(s.net_amount),0)
    INTO v_rows, v_n, v_tot
  FROM public.sales s
  LEFT JOIN public.units u ON u.id=s.unit_id
  LEFT JOIN public.clients c ON c.id=s.client_id
  LEFT JOIN public.projects p ON p.id=s.project_id
  WHERE s.agent_id=v_agent AND s.company_id=v_ses.company_id AND COALESCE(s.is_active,true)=true;

  RETURN jsonb_build_object('success',true,'sales',v_rows,'count',COALESCE(v_n,0),'total',COALESCE(v_tot,0));
END; $function$;
