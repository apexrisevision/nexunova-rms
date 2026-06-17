-- ============================================================================
-- NEXUNOVA RMS — get_my_reservations returns the unit's area/base_price so the
-- Mark Sold form prefills area (from inventory) instead of asking the agent to
-- re-enter it. 2026-06-17.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_reservations(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'area', u.area, 'area_unit', u.area_unit, 'base_price', u.base_price,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.reservations r JOIN public.units u ON u.id=r.unit_id LEFT JOIN public.projects p ON p.id=r.project_id
  WHERE r.company_id=v_ses.company_id AND r.reserved_by=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $function$;
