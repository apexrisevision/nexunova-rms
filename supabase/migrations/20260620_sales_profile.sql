-- ════════════════════════════════════════════════════════════════════════
-- Sale-person SELF-SERVICE: view profile, edit own details, change PIN.
-- All session-gated (the logged-in sales_user only).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_profile(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_co text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT company_name INTO v_co FROM public.companies WHERE id=v_su.company_id;
  RETURN jsonb_build_object('success',true,'profile', jsonb_build_object(
    'full_name', v_su.full_name, 'father_name', v_su.father_name, 'phone', v_su.phone,
    'email', v_su.email, 'address', v_su.address, 'cnic', v_su.cnic,
    'role', v_su.role, 'kyc_status', v_su.kyc_status,
    'bank_name', v_su.bank_name, 'bank_account_no', v_su.bank_account_no, 'bank_account_title', v_su.bank_account_title,
    'profile_photo_url', v_su.profile_photo_url, 'company_name', v_co,
    'last_login_at', v_su.last_login_at, 'created_at', v_su.created_at));
END; $function$;

-- update_my_profile — edit own editable fields (not phone/CNIC = identity/KYC) --
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
    full_name          = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'full_name','')),''), full_name),
    father_name        = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'father_name','')),''), father_name),
    email              = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), email),
    address            = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'address','')),''), address),
    bank_name          = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'bank_name','')),''), bank_name),
    bank_account_no    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'bank_account_no','')),''), bank_account_no),
    bank_account_title = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'bank_account_title','')),''), bank_account_title),
    profile_photo_url  = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'profile_photo_url','')),''), profile_photo_url),
    updated_at = now()
  WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

-- change_my_pin — verify current PIN, set a new one ---------------------------
CREATE OR REPLACE FUNCTION public.change_my_pin(p_session_token text, p_old_pin text, p_new_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(COALESCE(p_old_pin,''), v_su.pin_hash) THEN
    RETURN jsonb_build_object('success',false,'error','wrong_pin','message','Current PIN is incorrect.'); END IF;
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_pin','message','New PIN must be 4–6 digits.'); END IF;
  UPDATE public.sales_users SET pin_hash=crypt(p_new_pin, gen_salt('bf')), updated_at=now()
   WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
