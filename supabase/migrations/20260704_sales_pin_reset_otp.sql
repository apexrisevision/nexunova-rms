-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — SALES-PORTAL "FORGOT PIN" (Email-OTP recovery)  |  2026-07-04
-- ------------------------------------------------------------------------
-- The sub-agent / CRM portal (sales-portal.html) logs in with
-- company_code + phone + PIN, but had NO self-serve recovery path: a member
-- who forgot their PIN or hit the 15-minute lockout was stuck until an admin
-- overwrote pin_hash out of band. This adds an Email-OTP reset:
--
--   sales_request_pin_reset(company_code, phone)         → emails a 6-digit OTP
--   sales_verify_pin_reset(company_code, phone, otp, pin) → sets new PIN + unlocks
--
-- Reuses the existing public.email_otps store + net.http_post → send-otp-email
-- Edge Function (Resend). OTPs are bcrypt-hashed; plain text never in DB.
-- Owner decision: Email-OTP only (no admin fallback in this pass). Members
-- with no email on file are told to contact their office.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 1) Widen email_otps.purpose to accept the sales-portal reset ------------
DO $$ BEGIN
  ALTER TABLE public.email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check;
  ALTER TABLE public.email_otps
    ADD CONSTRAINT email_otps_purpose_check
    CHECK (purpose IN ('signup','admin_forgot','subuser_reset_notify','sales_pin_reset'));
END $$;

-- 2) sales_request_pin_reset ---------------------------------------------
-- Resolves the member by company_code + phone (same normalization as
-- sales_login), then emails a fresh OTP. Returns a masked email hint so the
-- user knows which inbox to check. No-email members get a clear 'no_email'.
CREATE OR REPLACE FUNCTION public.sales_request_pin_reset(
  p_company_code TEXT,
  p_phone        TEXT,
  p_ip           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_co        public.companies;
  v_su        public.sales_users;
  v_email     TEXT;
  v_otp_plain TEXT;
  v_otp_hash  TEXT;
  v_count     INT;
  v_at        INT;
  v_masked    TEXT;
BEGIN
  SELECT * INTO v_co FROM public.companies
   WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found',
      'message','No account found with that company code and mobile number.');
  END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id
     AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found',
      'message','No account found with that company code and mobile number.');
  END IF;

  IF v_su.status='pending' THEN
    RETURN jsonb_build_object('success',false,'error','pending',
      'message','Your account is still awaiting your office''s approval. You can set your PIN once approved.');
  END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','inactive',
      'message','Your access has been deactivated. Please contact your office to be reactivated.');
  END IF;

  v_email := LOWER(NULLIF(TRIM(v_su.email),''));
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_email',
      'message','No email is on file for your account. Please contact your office to reset your PIN.');
  END IF;

  -- rate limit: max 3 requests per member per hour
  SELECT count(*) INTO v_count FROM public.email_otps
   WHERE company_id=v_co.id AND email=v_email AND purpose='sales_pin_reset'
     AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 3 THEN
    RETURN jsonb_build_object('success',false,'error','rate_limited',
      'message','Too many reset requests. Please try again in an hour.');
  END IF;

  -- invalidate any outstanding codes for this member
  UPDATE public.email_otps SET used_at=now()
   WHERE company_id=v_co.id AND email=v_email
     AND purpose='sales_pin_reset' AND used_at IS NULL;

  v_otp_plain := lpad((floor(random()*900000)+100000)::INT::TEXT, 6, '0');
  v_otp_hash  := crypt(v_otp_plain, gen_salt('bf', 8));

  INSERT INTO public.email_otps (company_id, email, otp_hash, purpose, channel, expires_at, ip_address)
  VALUES (v_co.id, v_email, v_otp_hash, 'sales_pin_reset', 'email',
          now() + INTERVAL '10 minutes', p_ip);

  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := jsonb_build_object(
      'email', v_email, 'otp', v_otp_plain,
      'purpose', 'sales_pin_reset', 'company_name', v_co.company_name,
      'full_name', v_su.full_name
    )
  );

  v_at     := position('@' IN v_email);
  v_masked := left(v_email, least(2, greatest(v_at-1,1))) || '***' || substring(v_email FROM v_at);

  RETURN jsonb_build_object('success',true,'sent',true,'email_hint',v_masked);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sales_request_pin_reset(TEXT, TEXT, TEXT) TO anon, authenticated;

-- 3) sales_verify_pin_reset ----------------------------------------------
-- Validates the OTP and sets the new PIN, clearing lockout + failed attempts,
-- and revoking any live sessions (forces a clean re-login).
CREATE OR REPLACE FUNCTION public.sales_verify_pin_reset(
  p_company_code TEXT,
  p_phone        TEXT,
  p_otp          TEXT,
  p_new_pin      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_co    public.companies;
  v_su    public.sales_users;
  v_email TEXT;
  v_row   RECORD;
BEGIN
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('success',false,'error','weak_pin',
      'message','PIN must be exactly 6 digits.');
  END IF;
  IF p_new_pin ~ '^(.)\1{5}$'
     OR p_new_pin IN ('123456','654321','123123','121212','112233','786786','098765','456789') THEN
    RETURN jsonb_build_object('success',false,'error','weak_pin',
      'message','That PIN is too easy to guess. Choose a less obvious 6-digit PIN.');
  END IF;

  SELECT * INTO v_co FROM public.companies
   WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id
     AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_email := LOWER(NULLIF(TRIM(v_su.email),''));
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_email'); END IF;

  SELECT id, otp_hash, expires_at, attempts INTO v_row
  FROM public.email_otps
  WHERE company_id=v_co.id AND email=v_email
    AND purpose='sales_pin_reset' AND used_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found',
      'message','No active code. Please request a new one.');
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.email_otps SET used_at=now() WHERE id=v_row.id;
    RETURN jsonb_build_object('success',false,'error','expired',
      'message','Code expired. Please request a new one.');
  END IF;
  IF v_row.attempts >= 5 THEN
    UPDATE public.email_otps SET used_at=now() WHERE id=v_row.id;
    RETURN jsonb_build_object('success',false,'error','max_attempts',
      'message','Too many attempts. Please request a new code.');
  END IF;

  UPDATE public.email_otps SET attempts=attempts+1 WHERE id=v_row.id;

  IF crypt(p_otp, v_row.otp_hash) <> v_row.otp_hash THEN
    RETURN jsonb_build_object('success',false,'error','invalid_otp',
      'message','Incorrect code.',
      'attempts_left', greatest(0, 5 - (v_row.attempts + 1)));
  END IF;

  -- success: set the new PIN, clear lockout, revoke live sessions
  UPDATE public.sales_users
     SET pin_hash            = crypt(p_new_pin, gen_salt('bf', 8)),
         failed_pin_attempts = 0,
         locked_until        = NULL,
         updated_at          = now()
   WHERE id=v_su.id;

  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  UPDATE public.email_otps SET used_at=now() WHERE id=v_row.id;

  RETURN jsonb_build_object('success',true,'reset',true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sales_verify_pin_reset(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
