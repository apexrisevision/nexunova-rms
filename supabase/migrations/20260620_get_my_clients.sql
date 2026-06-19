-- ════════════════════════════════════════════════════════════════════════
-- Sale-person "My Clients" — every client the agent has sold to (full book),
-- aggregated: sales count + total value + total remaining. Session-gated.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_clients(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_agent uuid; v_rows jsonb; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT agent_id INTO v_agent FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_agent IS NULL THEN RETURN jsonb_build_object('success',true,'clients','[]'::jsonb,'count',0,'no_agent',true); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'client_id', t.client_id, 'name', t.full_name, 'phone', t.phone_primary,
           'sales_count', t.sales_count, 'total_net', t.total_net, 'total_remaining', t.total_remaining,
           'units', t.units
         ) ORDER BY t.full_name), '[]'::jsonb), count(*)
    INTO v_rows, v_n
  FROM (
    SELECT c.id AS client_id, c.full_name, c.phone_primary,
           count(*) AS sales_count,
           COALESCE(sum(s.net_amount),0) AS total_net,
           COALESCE(sum(s.remaining_amount),0) AS total_remaining,
           string_agg(u.unit_no, ', ' ORDER BY u.unit_no) AS units
    FROM public.sales s
    JOIN public.clients c ON c.id=s.client_id
    LEFT JOIN public.units u ON u.id=s.unit_id
    WHERE s.agent_id=v_agent AND s.company_id=v_ses.company_id AND COALESCE(s.is_active,true)=true
    GROUP BY c.id, c.full_name, c.phone_primary
  ) t;

  RETURN jsonb_build_object('success',true,'clients',v_rows,'count',COALESCE(v_n,0));
END; $function$;
