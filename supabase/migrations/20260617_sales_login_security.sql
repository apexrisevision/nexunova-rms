-- ════════════════════════════════════════════════════════════════
-- Sales-portal sign-in security (OTP/email-free, Pakistan-friendly):
--   • brute-force lockout: 5 wrong PINs -> 15-minute lock
--   • stronger PIN at registration: exactly 6 digits, common PINs rejected
-- Existing 4-6 digit PINs keep working until the agent changes theirs.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS failed_pin_attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- ── sign-in with lockout ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
        v_max int := 5; v_lock interval := interval '15 minutes'; v_att int;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;

  -- locked out?
  IF v_su.locked_until IS NOT NULL AND v_su.locked_until > now() THEN
    RETURN jsonb_build_object('success',false,'error','locked',
      'message','Too many wrong PIN attempts. Please try again after '||
        CEIL(EXTRACT(EPOCH FROM (v_su.locked_until - now()))/60)::int||' minute(s).'); END IF;

  -- wrong PIN -> count it, lock at threshold
  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    v_att := COALESCE(v_su.failed_pin_attempts,0) + 1;
    IF v_att >= v_max THEN
      UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=now()+v_lock WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','locked',
        'message','Too many wrong PIN attempts. Your sign-in is locked for 15 minutes.');
    ELSE
      UPDATE public.sales_users SET failed_pin_attempts=v_att WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN',
        'attempts_left', v_max - v_att,
        'message','Invalid phone or PIN. '||(v_max - v_att)||' attempt(s) left before a 15-minute lock.');
    END IF;
  END IF;

  IF v_su.status='pending' THEN
    RETURN jsonb_build_object('success',false,'error','pending',
      'message','Your request is still pending your office''s approval. Please wait — you can sign in once approved.'); END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','inactive',
      'message','Your access has been deactivated. Please contact your office to be reactivated.'); END IF;

  -- success: clear any failed-attempt state
  IF COALESCE(v_su.failed_pin_attempts,0) <> 0 OR v_su.locked_until IS NOT NULL THEN
    UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=NULL WHERE id=v_su.id;
  END IF;

  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,'sales_user_name',v_su.full_name,'project_id',v_su.project_id,
    'upload_token',v_co.sales_signup_token);
END; $function$;

-- ── stronger PIN at registration ───────────────────────────────────
-- only the PIN-validation block changes; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.sales_register(p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text, p_profile_photo_url text DEFAULT NULL::text, p_cnic_front_url text DEFAULT NULL::text, p_cnic_back_url text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_father_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_link','message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Please enter your name.'); END IF;
  IF TRIM(COALESCE(p_father_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','father_name_required','message','Please enter your father / husband name.'); END IF;
  v_norm := public._normalize_pk_mobile(p_phone);
  IF v_norm IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_phone','message','Enter a valid mobile number, e.g. 03219694246 or +923219694246.'); END IF;
  v_cnic := TRIM(COALESCE(p_cnic,''));
  IF v_cnic !~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN RETURN jsonb_build_object('success',false,'error','invalid_cnic','message','Enter your CNIC in the format 35201-1234567-1.'); END IF;
  IF TRIM(COALESCE(p_address,''))='' THEN RETURN jsonb_build_object('success',false,'error','address_required','message','Please enter your address.'); END IF;
  -- stronger PIN: exactly 6 digits, no all-same / common patterns
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a 6-digit PIN.'); END IF;
  IF p_pin ~ '^(.)\1{5}$' OR p_pin IN ('123456','654321','123123','121212','112233','786786','098765','456789') THEN
    RETURN jsonb_build_object('success',false,'error','weak_pin','message','This PIN is too easy to guess. Choose a less obvious 6-digit PIN.'); END IF;
  IF NULLIF(TRIM(COALESCE(p_profile_photo_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_front_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_back_url,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','kyc_required',
      'message','Please add your photo and both sides of your CNIC to complete verification.'); END IF;
  SELECT status INTO v_existing FROM public.sales_users WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=v_norm LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered','existing_status',v_existing,
      'message', CASE v_existing
        WHEN 'pending'  THEN 'Your request is already pending your office''s approval. Please wait — you will be able to sign in once approved.'
        WHEN 'active'   THEN 'This mobile number is already registered and active. Please sign in with your PIN.'
        WHEN 'inactive' THEN 'This mobile number was deactivated by your office. Please contact them to be reactivated.'
        ELSE 'This mobile number is already registered.' END);
  END IF;
  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN RETURN jsonb_build_object('success',false,'error','too_many_pending','message','Registrations are temporarily full. Please contact your office.'); END IF;
  INSERT INTO public.sales_users (company_id, project_id, full_name, father_name, phone, cnic, pin_hash, status, is_active,
                                  profile_photo_url, cnic_front_url, cnic_back_url,
                                  email, address, kyc_status)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_father_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false,
          NULLIF(TRIM(p_profile_photo_url),''), NULLIF(TRIM(p_cnic_front_url),''), NULLIF(TRIM(p_cnic_back_url),''),
          NULLIF(TRIM(COALESCE(p_email,'')),''), TRIM(p_address), 'pending');
  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $function$;
