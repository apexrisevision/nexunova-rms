-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-03  Forgot-password launch-blocker fix.
--
-- BUG: send_admin_reset_otp() and notify_admin_subuser_reset() looked up the
-- company with  WHERE upper(trim(code)) = upper(trim(p_company_code))  but the
-- companies table has NO "code" column (only "company_code"). Postgres raised
-- 42703 (column "code" does not exist) on EVERY call. plpgsql doesn't validate
-- column names at CREATE, only at execution — so the RPCs deployed fine but
-- threw at runtime. forgot-password.js:79 destructures only { data } and
-- ignores { error }, so adminRes was null → adminRes?.sent falsy → the flow
-- always fell through to the sub-user "request sent to admin" screen, and the
-- RPC died before its INSERT/net.http_post → no admin_forgot OTP, no email.
--
-- A second latent column bug was masked behind the first: the same SELECT used
-- "id, name" but companies has no "name" column either (it is "company_name").
-- FIX: in BOTH functions, company lookup  code → company_code  AND
--      "SELECT id, name" → "SELECT id, company_name AS name" (alias keeps every
--      downstream v_company.name reference working). Nothing else is altered.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_admin_reset_otp(p_company_code text, p_email text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email     TEXT := lower(trim(p_email));
  v_company   RECORD;
  v_user      RECORD;
  v_otp_plain TEXT;
  v_otp_hash  TEXT;
  v_count     INT;
  v_channels  JSONB := '["email"]'::JSONB;
BEGIN
  SELECT id, company_name AS name INTO v_company
  FROM public.companies
  WHERE upper(trim(company_code)) = upper(trim(p_company_code)) LIMIT 1;

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

  v_otp_plain := lpad((100000 + (((( 'x'||encode(extensions.gen_random_bytes(4),'hex') )::bit(32)::bigint) & 4294967295) % 900000))::text, 6, '0');
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
$function$;


CREATE OR REPLACE FUNCTION public.notify_admin_subuser_reset(p_company_code text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email    TEXT := lower(trim(p_email));
  v_company  RECORD;
  v_sub_user RECORD;
  v_admin    RECORD;
  v_at       INT;
  v_masked   TEXT;
BEGIN
  SELECT id, company_name AS name INTO v_company
  FROM public.companies
  WHERE upper(trim(company_code)) = upper(trim(p_company_code)) LIMIT 1;
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
$function$;
