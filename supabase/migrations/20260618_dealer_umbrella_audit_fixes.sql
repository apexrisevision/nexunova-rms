-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — deep-audit fixes (2026-06-18).
-- 1) sales_register: the signature-bearing 12-arg overload was granted to
--    authenticated only — but signup is ANONYMOUS (portal uses the anon key), so
--    live signup was denied. Grant anon, and DROP the stale 11-arg overload (it had
--    no signature and bypassed the agreement). [grant/drop applied live]
-- 2) cancel_reservation / cancel_my_submission filtered by v_ses.company_id, which
--    blocked an umbrella dealer from cancelling their own CROSS-company reservation/
--    submission. Now scoped by reserved_by / submitted_by only (uniquely the dealer).
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.sales_register(text,text,text,text,text,text,text,text,text,text,text);
GRANT EXECUTE ON FUNCTION public.sales_register(text,text,text,text,text,text,text,text,text,text,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_session_token text, p_reservation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_res public.reservations; v_avail uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id
     AND reserved_by=v_ses.sales_user_id AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_yours'); END IF;
  UPDATE public.reservations SET status='cancelled', cancelled_by=v_ses.sales_user_id, cancelled_at=now(), updated_at=now() WHERE id=p_reservation_id;
  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND is_available AND is_active ORDER BY sort_order LIMIT 1;
  IF v_avail IS NOT NULL THEN
    UPDATE public.units SET status_id=v_avail, updated_at=now() WHERE id=v_res.unit_id AND company_id=v_res.company_id; END IF;
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_my_submission(p_session_token text, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_sub public.sale_submissions; v_resv_status uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_sub FROM public.sale_submissions
   WHERE id=p_id AND submitted_by=v_ses.sales_user_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_pending'); END IF;
  UPDATE public.sale_submissions SET status='withdrawn', updated_at=now() WHERE id=p_id;
  IF EXISTS (SELECT 1 FROM public.reservations WHERE id=v_sub.reservation_id AND status='active') THEN
    SELECT id INTO v_resv_status FROM public.category_unit_statuses
     WHERE company_id=v_sub.company_id AND project_id=v_sub.project_id
       AND (LOWER(status_code)='reserved' OR status_name ILIKE '%reserved%') AND is_active ORDER BY sort_order LIMIT 1;
    IF v_resv_status IS NOT NULL THEN
      UPDATE public.units SET status_id=v_resv_status, updated_at=now() WHERE id=v_sub.unit_id; END IF;
  END IF;
  RETURN jsonb_build_object('success',true);
END; $function$;
