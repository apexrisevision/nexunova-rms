-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — Phase 6 (pipeline views): My Reservations / My Submissions
-- now span all member companies (filter only by reserved_by/submitted_by = the
-- dealer, which uniquely identifies their own items wherever they live) and carry
-- a company_name label. Standalone dealers are unaffected (their items are all in
-- their own company). NOTE: get_sales_leaderboard + get_my_outstanding remain
-- home-company-scoped for now (umbrella aggregation = follow-up polish).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_reservations(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'company_name', co.company_name,
    'area', u.area, 'area_unit', u.area_unit, 'base_price', u.base_price,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.reservations r
  JOIN public.units u ON u.id=r.unit_id
  LEFT JOIN public.projects p ON p.id=r.project_id
  LEFT JOIN public.companies co ON co.id=r.company_id
  WHERE r.reserved_by=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_my_submissions(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'company_name', co.company_name,
    'client_name', s.client_payload->>'full_name',
    'status', s.status, 'reject_reason', s.reject_reason,
    'created_at', s.created_at, 'reservation_id', s.reservation_id
  ) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sale_submissions s
  JOIN public.units u ON u.id=s.unit_id
  LEFT JOIN public.projects p ON p.id=s.project_id
  LEFT JOIN public.companies co ON co.id=s.company_id
  WHERE s.submitted_by=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'submissions',v_rows);
END; $function$;
