-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — SALES/CRM MEMBER EMAIL VERIFICATION  |  2026-07-04
-- ------------------------------------------------------------------------
-- Member emails were optional at signup and never verified — some missing,
-- the rest unverified & possibly wrong. Forgot-PIN (Email OTP) depends on a
-- trustworthy email, so this adds verification:
--   sales_request_email_verify(token, new_email) → OTP to that address
--   sales_verify_email(token, otp)               → saves + marks verified
-- and gates sales_request_pin_reset on email_verified=true.
-- Reuses public.email_otps + net.http_post → send-otp-email (Resend).
-- Existing emails are left in place but treated as UNVERIFIED until confirmed.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 1) Schema --------------------------------------------------------------
ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS email_verified    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- email_otps: tie sales-portal OTPs to a member + allow the new purpose
ALTER TABLE public.email_otps
  ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE CASCADE;

DO $$ BEGIN
  ALTER TABLE public.email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check;
  ALTER TABLE public.email_otps
    ADD CONSTRAINT email_otps_purpose_check
    CHECK (purpose IN ('signup','admin_forgot','subuser_reset_notify','sales_pin_reset','sales_email_verify'));
END $$;

CREATE INDEX IF NOT EXISTS idx_email_otps_sales_user
  ON public.email_otps (sales_user_id, purpose, used_at);

-- 2) sales_request_email_verify ------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_request_email_verify(
  p_session_token TEXT,
  p_new_email     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_ses   public.sales_sessions;
  v_su    public.sales_users;
  v_email TEXT := LOWER(TRIM(COALESCE(p_new_email,'')));
  v_co    TEXT;
  v_otp   TEXT;
  v_hash  TEXT;
  v_count INT;
  v_at    INT;
  v_mask  TEXT;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_email',
      'message','Please enter a valid email address.');
  END IF;

  -- don't let two members share the same VERIFIED email in one company
  IF EXISTS (SELECT 1 FROM public.sales_users
              WHERE company_id=v_su.company_id AND id<>v_su.id
                AND email_verified IS TRUE AND LOWER(email)=v_email) THEN
    RETURN jsonb_build_object('success',false,'error','email_taken',
      'message','That email is already verified by another member. Please use a different email.');
  END IF;

  -- rate limit: 3 requests per member per hour
  SELECT count(*) INTO v_count FROM public.email_otps
   WHERE sales_user_id=v_su.id AND purpose='sales_email_verify'
     AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 3 THEN
    RETURN jsonb_build_object('success',false,'error','rate_limited',
      'message','Too many requests. Please try again in an hour.');
  END IF;

  UPDATE public.email_otps SET used_at=now()
   WHERE sales_user_id=v_su.id AND purpose='sales_email_verify' AND used_at IS NULL;

  v_otp  := lpad((floor(random()*900000)+100000)::INT::TEXT, 6, '0');
  v_hash := crypt(v_otp, gen_salt('bf', 8));

  INSERT INTO public.email_otps (company_id, sales_user_id, email, otp_hash, purpose, channel, expires_at)
  VALUES (v_su.company_id, v_su.id, v_email, v_hash, 'sales_email_verify', 'email',
          now() + INTERVAL '10 minutes');

  SELECT company_name INTO v_co FROM public.companies WHERE id=v_su.company_id;

  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := jsonb_build_object(
      'email', v_email, 'otp', v_otp,
      'purpose', 'sales_email_verify', 'company_name', v_co,
      'full_name', v_su.full_name
    )
  );

  v_at   := position('@' IN v_email);
  v_mask := left(v_email, least(2, greatest(v_at-1,1))) || '***' || substring(v_email FROM v_at);
  RETURN jsonb_build_object('success',true,'sent',true,'email_hint',v_mask);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sales_request_email_verify(TEXT, TEXT) TO anon, authenticated;

-- 3) sales_verify_email --------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_verify_email(
  p_session_token TEXT,
  p_otp           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_ses public.sales_sessions;
  v_su  public.sales_users;
  v_row RECORD;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT id, otp_hash, expires_at, attempts, email INTO v_row
  FROM public.email_otps
  WHERE sales_user_id=v_su.id AND purpose='sales_email_verify' AND used_at IS NULL
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

  UPDATE public.sales_users
     SET email             = v_row.email,
         email_verified    = true,
         email_verified_at = now(),
         updated_at        = now()
   WHERE id=v_su.id;

  UPDATE public.email_otps SET used_at=now() WHERE id=v_row.id;
  RETURN jsonb_build_object('success',true,'verified',true,'email',v_row.email);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sales_verify_email(TEXT, TEXT) TO anon, authenticated;

-- 4) sales_request_pin_reset — now requires a VERIFIED email --------------
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
  -- PIN recovery is only possible with a VERIFIED email on file
  IF v_email IS NULL OR v_su.email_verified IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','no_email',
      'message','No verified email is on file for your account. Verify your email in the app, or contact your office to reset your PIN.');
  END IF;

  SELECT count(*) INTO v_count FROM public.email_otps
   WHERE company_id=v_co.id AND email=v_email AND purpose='sales_pin_reset'
     AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 3 THEN
    RETURN jsonb_build_object('success',false,'error','rate_limited',
      'message','Too many reset requests. Please try again in an hour.');
  END IF;

  UPDATE public.email_otps SET used_at=now()
   WHERE company_id=v_co.id AND email=v_email
     AND purpose='sales_pin_reset' AND used_at IS NULL;

  v_otp_plain := lpad((floor(random()*900000)+100000)::INT::TEXT, 6, '0');
  v_otp_hash  := crypt(v_otp_plain, gen_salt('bf', 8));

  INSERT INTO public.email_otps (company_id, sales_user_id, email, otp_hash, purpose, channel, expires_at, ip_address)
  VALUES (v_co.id, v_su.id, v_email, v_otp_hash, 'sales_pin_reset', 'email',
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

-- 5) sales_login — surface email + email_verified in the session payload --
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

  IF v_su.locked_until IS NOT NULL AND v_su.locked_until > now() THEN
    RETURN jsonb_build_object('success',false,'error','locked',
      'message','Too many wrong PIN attempts. Please try again after '||
        CEIL(EXTRACT(EPOCH FROM (v_su.locked_until - now()))/60)::int||' minute(s).'); END IF;

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
    'role', v_su.role, 'permissions', v_su.permissions,
    'email', v_su.email, 'email_verified', v_su.email_verified,
    'upload_token',v_co.sales_signup_token);
END; $function$;

-- 6) get_my_profile — include email_verified (+ preserve live fields) -----
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
    'email', v_su.email, 'email_verified', v_su.email_verified, 'email_verified_at', v_su.email_verified_at,
    'address', v_su.address, 'cnic', v_su.cnic,
    'role', v_su.role, 'parent_sales_user_id', v_su.parent_sales_user_id, 'kyc_status', v_su.kyc_status,
    'bank_name', v_su.bank_name, 'bank_account_no', v_su.bank_account_no, 'bank_account_title', v_su.bank_account_title,
    'profile_photo_url', v_su.profile_photo_url, 'company_name', v_co,
    'last_login_at', v_su.last_login_at, 'created_at', v_su.created_at));
END; $function$;

-- 7) list_sales_users_admin — expose email_verified for the admin list ----
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies; v_umb jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'father_name', su.father_name, 'phone', su.phone, 'cnic', su.cnic,
    'email', su.email, 'email_verified', su.email_verified, 'email_verified_at', su.email_verified_at, 'address', su.address,
    'bank_name', su.bank_name, 'bank_account_no', su.bank_account_no, 'bank_account_title', su.bank_account_title,
    'profile_photo_url', su.profile_photo_url, 'cnic_front_url', su.cnic_front_url, 'cnic_back_url', su.cnic_back_url,
    'kyc_status', su.kyc_status,
    'role', su.role, 'parent_sales_user_id', su.parent_sales_user_id,
    'parent_name', (SELECT pp.full_name FROM public.sales_users pp WHERE pp.id=su.parent_sales_user_id),
    'project_id', su.project_id, 'project_name', p.project_name,
    'status', su.status, 'is_active', su.is_active,
    'agent_id', su.agent_id, 'agent_code', ag.agent_code,
    'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY (su.status='pending') DESC, su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su
  LEFT JOIN public.projects p ON p.id=su.project_id
  LEFT JOIN public.agents   ag ON ag.id=su.agent_id
  WHERE su.company_id=p_company_id;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  SELECT CASE WHEN g.id IS NOT NULL THEN jsonb_build_object(
      'group_id', g.id, 'group_name', g.name, 'signup_token', g.signup_token,
      'home_company_id', g.home_company_id, 'is_home', (g.home_company_id=p_company_id),
      'home_company_name', (SELECT company_name FROM public.companies WHERE id=g.home_company_id),
      'members', (SELECT string_agg(company_name, ', ' ORDER BY created_at) FROM public.companies WHERE dealer_group_id=g.id)
    ) ELSE NULL END INTO v_umb
  FROM public.companies c LEFT JOIN public.company_groups g ON g.id=c.dealer_group_id
  WHERE c.id=p_company_id;

  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code,
    'umbrella', v_umb);
END; $function$;
