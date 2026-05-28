-- ================================================================
-- NEXUNOVA RMS — AUTH CHAPTER: OTP + FORGOT PASSWORD + SUB-USER RESET
-- Migration: 20260528_auth_otp.sql  |  2026-05-28
-- ================================================================
-- Table:  email_otps  (bcrypt-hashed OTPs — plain text never in DB)
-- RPCs:
--   1. check_company_email          — pre-signup email uniqueness check
--   2. send_signup_otp              — signup email verification
--   3. verify_signup_otp            — verify signup OTP
--   4. send_admin_reset_otp         — admin/owner forgot password
--   5. verify_admin_reset_otp       — verify OTP + reset password + revoke sessions
--   6. notify_admin_subuser_reset   — sub-user forgot → notify admin
--   7. admin_reset_subuser_password — admin resets sub-user with temp password
-- Email delivery: pg_net → send-otp-email Edge Function → Supabase SMTP
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ── email_otps ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_otps (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  UUID        NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  otp_hash    TEXT        NOT NULL,
  purpose     TEXT        NOT NULL CHECK (purpose IN ('signup','admin_forgot','subuser_reset_notify')),
  channel     TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp')),
  attempts    INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  used_at     TIMESTAMPTZ NULL,
  ip_address  TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_otps' AND policyname = 'deny_all_email_otps'
  ) THEN
    CREATE POLICY "deny_all_email_otps"
      ON public.email_otps AS RESTRICTIVE FOR ALL
      TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup
  ON public.email_otps (email, purpose, used_at, expires_at);

-- ── RPC 1: check_company_email ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_company_email(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.app_users
    WHERE lower(email) = lower(trim(p_email)) LIMIT 1
  ) THEN
    RETURN jsonb_build_object('exists', true);
  END IF;
  RETURN jsonb_build_object('exists', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_company_email(TEXT) TO anon, authenticated;

-- ── RPC 2: send_signup_otp ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_signup_otp(
  p_email TEXT,
  p_ip    TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email     TEXT := lower(trim(p_email));
  v_otp_plain TEXT;
  v_otp_hash  TEXT;
  v_count     INT;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('error', 'invalid_email');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.email_otps
  WHERE email = v_email AND purpose = 'signup'
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count >= 3 THEN
    RETURN jsonb_build_object('error', 'rate_limited',
      'message', 'Too many requests. Try again in an hour.');
  END IF;

  UPDATE public.email_otps SET used_at = now()
  WHERE email = v_email AND purpose = 'signup' AND used_at IS NULL;

  v_otp_plain := lpad((floor(random() * 900000) + 100000)::INT::TEXT, 6, '0');
  v_otp_hash  := crypt(v_otp_plain, gen_salt('bf', 8));

  INSERT INTO public.email_otps (email, otp_hash, purpose, channel, expires_at, ip_address)
  VALUES (v_email, v_otp_hash, 'signup', 'email', now() + INTERVAL '10 minutes', p_ip);

  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('email', v_email, 'otp', v_otp_plain, 'purpose', 'signup')
  );

  RETURN jsonb_build_object('sent', true, 'channel', 'email');
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_signup_otp(TEXT, TEXT) TO anon, authenticated;

-- ── RPC 3: verify_signup_otp ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_signup_otp(
  p_email TEXT,
  p_otp   TEXT
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_row   RECORD;
BEGIN
  SELECT id, otp_hash, expires_at, attempts INTO v_row
  FROM public.email_otps
  WHERE email = v_email AND purpose = 'signup' AND used_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found',
      'message', 'No active code. Please request a new one.');
  END IF;

  IF v_row.expires_at < now() THEN
    UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'expired',
      'message', 'Code expired. Please request a new one.');
  END IF;

  IF v_row.attempts >= 5 THEN
    UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'max_attempts',
      'message', 'Too many attempts. Please request a new code.');
  END IF;

  UPDATE public.email_otps SET attempts = attempts + 1 WHERE id = v_row.id;

  IF crypt(p_otp, v_row.otp_hash) = v_row.otp_hash THEN
    UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('verified', true);
  END IF;

  RETURN jsonb_build_object(
    'error', 'invalid_otp',
    'message', 'Incorrect code.',
    'attempts_left', greatest(0, 5 - (v_row.attempts + 1))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_signup_otp(TEXT, TEXT) TO anon, authenticated;

-- ── RPC 4: send_admin_reset_otp ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_admin_reset_otp(
  p_company_code TEXT,
  p_email        TEXT,
  p_ip           TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email     TEXT := lower(trim(p_email));
  v_company   RECORD;
  v_user      RECORD;
  v_otp_plain TEXT;
  v_otp_hash  TEXT;
  v_count     INT;
  v_channels  JSONB := '["email"]'::JSONB;
BEGIN
  SELECT id, name INTO v_company
  FROM public.companies
  WHERE upper(trim(code)) = upper(trim(p_company_code)) LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT id, full_name, phone INTO v_user
  FROM public.app_users
  WHERE company_id = v_company.id
    AND lower(email) = v_email
    AND role IN ('admin', 'owner')
    AND (status IS NULL OR status = 'active')
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT count(*) INTO v_count
  FROM public.email_otps
  WHERE email = v_email AND purpose = 'admin_forgot'
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count >= 3 THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;

  UPDATE public.email_otps SET used_at = now()
  WHERE email = v_email AND purpose = 'admin_forgot' AND used_at IS NULL;

  v_otp_plain := lpad((floor(random() * 900000) + 100000)::INT::TEXT, 6, '0');
  v_otp_hash  := crypt(v_otp_plain, gen_salt('bf', 8));

  INSERT INTO public.email_otps (company_id, email, otp_hash, purpose, channel, expires_at, ip_address)
  VALUES (v_company.id, v_email, v_otp_hash, 'admin_forgot', 'email',
          now() + INTERVAL '10 minutes', p_ip);

  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'email', v_email, 'otp', v_otp_plain,
      'purpose', 'admin_forgot', 'company_name', v_company.name
    )
  );

  IF v_user.phone IS NOT NULL AND trim(v_user.phone) <> '' THEN
    PERFORM public.enqueue_message(
      v_company.id,
      jsonb_build_object(
        'channel',    'whatsapp',
        'to_address', v_user.phone,
        'body',       format(
          'Nexunova RMS: Password reset code: %s' || E'\n' || 'Valid 10 min. Do not share.',
          v_otp_plain
        ),
        'category', 'admin_reset_otp'
      )
    );
    v_channels := '["email","whatsapp"]'::JSONB;
  END IF;

  RETURN jsonb_build_object('sent', true, 'channels', v_channels);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_admin_reset_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── RPC 5: verify_admin_reset_otp ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_admin_reset_otp(
  p_email        TEXT,
  p_otp          TEXT,
  p_new_password TEXT
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_row   RECORD;
  v_user  RECORD;
BEGIN
  SELECT id, otp_hash, expires_at, attempts, company_id INTO v_row
  FROM public.email_otps
  WHERE email = v_email AND purpose = 'admin_forgot' AND used_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found',
      'message', 'No active code. Please request a new one.');
  END IF;

  IF v_row.expires_at < now() THEN
    UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'expired',
      'message', 'Code expired. Please request a new one.');
  END IF;

  IF v_row.attempts >= 5 THEN
    UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'max_attempts');
  END IF;

  UPDATE public.email_otps SET attempts = attempts + 1 WHERE id = v_row.id;

  IF crypt(p_otp, v_row.otp_hash) <> v_row.otp_hash THEN
    RETURN jsonb_build_object(
      'error', 'invalid_otp',
      'attempts_left', greatest(0, 5 - (v_row.attempts + 1))
    );
  END IF;

  SELECT id, auth_user_id, session_version INTO v_user
  FROM public.app_users
  WHERE company_id = v_row.company_id
    AND lower(email) = v_email
    AND role IN ('admin', 'owner')
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'user_not_found'); END IF;

  IF length(p_new_password) < 8 THEN
    RETURN jsonb_build_object('error', 'policy_violation',
      'message', 'Password must be at least 8 characters.');
  END IF;

  UPDATE public.app_users
  SET password_hash        = crypt(p_new_password, gen_salt('bf', 10)),
      needs_password_reset = false,
      password_changed_at  = now(),
      session_version      = coalesce(session_version, 0) + 1
  WHERE id = v_user.id;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10))
  WHERE id = v_user.auth_user_id;

  UPDATE public.email_otps SET used_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object('reset', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_admin_reset_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── RPC 6: notify_admin_subuser_reset ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_subuser_reset(
  p_company_code TEXT,
  p_email        TEXT
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email    TEXT := lower(trim(p_email));
  v_company  RECORD;
  v_sub_user RECORD;
  v_admin    RECORD;
  v_at       INT;
  v_masked   TEXT;
BEGIN
  SELECT id, name INTO v_company
  FROM public.companies
  WHERE upper(trim(code)) = upper(trim(p_company_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT id, full_name INTO v_sub_user
  FROM public.app_users
  WHERE company_id = v_company.id AND lower(email) = v_email
    AND role NOT IN ('admin', 'owner')
    AND (status IS NULL OR status = 'active')
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT id, full_name, email, phone INTO v_admin
  FROM public.app_users
  WHERE company_id = v_company.id AND role IN ('admin', 'owner')
    AND (status IS NULL OR status = 'active')
  ORDER BY (role = 'owner') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_admin'); END IF;

  IF v_admin.phone IS NOT NULL AND trim(v_admin.phone) <> '' THEN
    PERFORM public.enqueue_message(
      v_company.id,
      jsonb_build_object(
        'channel',    'whatsapp',
        'to_address', v_admin.phone,
        'body',       format(
          'Nexunova RMS: "%s" ne password reset request ki hai. Admin Panel > Users mein Reset karein.',
          v_sub_user.full_name
        ),
        'category', 'subuser_reset_request'
      )
    );
  END IF;

  IF v_admin.email IS NOT NULL AND trim(v_admin.email) <> '' THEN
    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'email',         v_admin.email,
        'purpose',       'subuser_reset_notify',
        'subuser_name',  v_sub_user.full_name,
        'subuser_email', v_email,
        'company_name',  v_company.name
      )
    );
  END IF;

  v_at     := position('@' IN v_admin.email);
  v_masked := left(v_admin.email, least(2, v_at - 1)) || '***'
              || substring(v_admin.email FROM v_at);

  RETURN jsonb_build_object('notified', true, 'admin_email', v_masked);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notify_admin_subuser_reset(TEXT, TEXT) TO anon, authenticated;

-- ── RPC 7: admin_reset_subuser_password ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_subuser_password(
  p_user_id       UUID,
  p_temp_password TEXT
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller   RECORD;
  v_sub_user RECORD;
BEGIN
  SELECT id, company_id, role INTO v_caller
  FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF NOT FOUND OR v_caller.role NOT IN ('admin', 'owner') THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  SELECT id, full_name, email, auth_user_id INTO v_sub_user
  FROM public.app_users
  WHERE id = p_user_id
    AND company_id = v_caller.company_id
    AND role NOT IN ('admin', 'owner')
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  UPDATE public.app_users
  SET password_hash        = crypt(p_temp_password, gen_salt('bf', 10)),
      needs_password_reset = true,
      session_version      = coalesce(session_version, 0) + 1
  WHERE id = v_sub_user.id;

  UPDATE auth.users
  SET encrypted_password = crypt(p_temp_password, gen_salt('bf', 10))
  WHERE id = v_sub_user.auth_user_id;

  IF v_sub_user.email IS NOT NULL AND trim(v_sub_user.email) <> '' THEN
    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'email',         v_sub_user.email,
        'purpose',       'temp_password',
        'temp_password', p_temp_password,
        'full_name',     v_sub_user.full_name
      )
    );
  END IF;

  RETURN jsonb_build_object('reset', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_reset_subuser_password(UUID, TEXT) TO authenticated;
