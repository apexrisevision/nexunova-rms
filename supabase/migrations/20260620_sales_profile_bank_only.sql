-- ════════════════════════════════════════════════════════════════════════
-- LOCK: signup/KYC identity (name, father, CNIC, phone, email, address, photo)
-- is FIXED — the sale-person can only edit BANK details (payouts) + PIN.
-- update_my_profile now touches ONLY the three bank fields.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_my_profile(p_session_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.sales_users SET
    bank_name          = NULLIF(TRIM(COALESCE(p_payload->>'bank_name','')),''),
    bank_account_no    = NULLIF(TRIM(COALESCE(p_payload->>'bank_account_no','')),''),
    bank_account_title = NULLIF(TRIM(COALESCE(p_payload->>'bank_account_title','')),''),
    updated_at = now()
  WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
