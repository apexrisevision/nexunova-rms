-- ============================================================================
-- MAIN GATE FIXES — 2026-06-12
-- Closes the audit's gate findings (see MAIN_GATE_AUDIT.md), in severity order:
--   1. BLOCKER  — onboarding wizard project_code (server-side fallback + helper)
--   2. MAJOR    — signup email-OTP becomes a server-enforced gate; the GoTrue
--                 activation-link step is collapsed away (OTP is THE proof). New
--                 owners are created email_verified=true, so the existing
--                 app_users->auth.users auto-bridge mints an already-CONFIRMED
--                 identity (email_confirmed_at=now()) and login works with no
--                 second email / link-clicking.
--   3. MAJOR    — create_app_user: admin-chosen username + optional email
--                 (synthetic @users.internal plumbing identity when absent).
--                 admin_reset_subuser_password: on-screen temp password for
--                 users without a real (mailable) email.
--   4. MAJOR    — credential-action audit: app_users already has the generic
--                 audit_trigger_function (actor/target/fields/IP). This adds a
--                 semantic `reason` label via a transaction-local GUC — additive
--                 one-liner in the global trigger, no-op by default.
--
-- Does NOT modify verify_login or any existing account/credential row.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) BLOCKER — project_code fallback
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_project_code(p_company_id uuid, p_base text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_clean text; v_base text; v_code text; v_n int := 1;
BEGIN
  v_clean := btrim(upper(regexp_replace(coalesce(p_base,''), '[^a-zA-Z0-9 ]', '', 'g')));
  IF position(' ' IN v_clean) > 0 THEN
    -- multi-word -> initials, e.g. "Khushal Bagh Heights" -> KBH
    v_base := array_to_string(
      ARRAY(SELECT left(w,1) FROM regexp_split_to_table(v_clean, '\s+') AS w WHERE w <> ''), '');
  ELSE
    v_base := left(v_clean, 4);
  END IF;
  v_base := COALESCE(NULLIF(v_base, ''), 'PRJ');
  v_code := v_base;
  WHILE EXISTS (SELECT 1 FROM public.projects
                WHERE company_id = p_company_id AND upper(project_code) = upper(v_code)) LOOP
    v_n := v_n + 1;
    v_code := v_base || '-' || v_n;
  END LOOP;
  RETURN v_code;
END;
$function$;

-- upsert_project: INSERT now mints a unique project_code when the caller omits it
-- (the onboarding wizard sends only name+location). Everything else is byte-identical
-- to the previous definition.
CREATE OR REPLACE FUNCTION public.upsert_project(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_proj_code text;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  IF p_id IS NULL THEN
    -- project_code resolution:
    --  • omitted/blank         -> mint a unique code from the project name
    --  • auto_code='true'      -> uniquify the suggested code (wizard path; never errors)
    --  • explicit (admin form) -> use as-is (the UNIQUE(company,code) index enforces it)
    v_proj_code := NULLIF(p_data->>'project_code','');
    IF v_proj_code IS NULL THEN
      v_proj_code := public.generate_project_code(p_company_id, p_data->>'project_name');
    ELSIF (p_data->>'auto_code') = 'true' THEN
      v_proj_code := public.generate_project_code(p_company_id, v_proj_code);
    END IF;

    INSERT INTO public.projects (
      company_id, project_code, project_name, description, location, city, country,
      total_area, area_unit, total_units, start_date, expected_completion_date, status,
      cover_image_url, metadata, builder_name, builder_contact, builder_email,
      gps_lat, gps_lng, map_link, construction_progress, amenities,
      noc_number, noc_authority, noc_date, noc_notes, cover_images, delivery_date, created_by
    ) VALUES (
      p_company_id, v_proj_code,
      p_data->>'project_name', NULLIF(p_data->>'description',''),
      NULLIF(p_data->>'location',''), NULLIF(p_data->>'city',''), COALESCE(p_data->>'country','Pakistan'),
      NULLIF(p_data->>'total_area','')::numeric, COALESCE(p_data->>'area_unit','sqft'),
      COALESCE((p_data->>'total_units')::int, 0), NULLIF(p_data->>'start_date','')::date,
      NULLIF(p_data->>'expected_completion_date','')::date, COALESCE(p_data->>'status','active'),
      NULLIF(p_data->>'cover_image_url',''), COALESCE(p_data->'metadata', '{}'::jsonb),
      NULLIF(p_data->>'builder_name',''), NULLIF(p_data->>'builder_contact',''), NULLIF(p_data->>'builder_email',''),
      NULLIF(p_data->>'gps_lat','')::float8, NULLIF(p_data->>'gps_lng','')::float8,
      NULLIF(p_data->>'map_link',''), COALESCE((p_data->>'construction_progress')::int, 0),
      CASE WHEN p_data->'amenities' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'amenities')) END,
      NULLIF(p_data->>'noc_number',''), NULLIF(p_data->>'noc_authority',''),
      NULLIF(p_data->>'noc_date','')::date, NULLIF(p_data->>'noc_notes',''),
      CASE WHEN p_data->'cover_images' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'cover_images')) END,
      NULLIF(p_data->>'delivery_date','')::date, NULLIF(p_data->>'created_by','')::uuid
    ) RETURNING id INTO v_id;
    PERFORM public.seed_default_categories(p_company_id, v_id);
  ELSE
    UPDATE public.projects SET
      project_code = COALESCE(p_data->>'project_code', project_code),
      project_name = COALESCE(p_data->>'project_name', project_name),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      location = COALESCE(NULLIF(p_data->>'location',''), location),
      city = COALESCE(NULLIF(p_data->>'city',''), city),
      country = COALESCE(p_data->>'country', country),
      total_area = COALESCE(NULLIF(p_data->>'total_area','')::numeric, total_area),
      area_unit = COALESCE(p_data->>'area_unit', area_unit),
      total_units = COALESCE((p_data->>'total_units')::int, total_units),
      start_date = COALESCE(NULLIF(p_data->>'start_date','')::date, start_date),
      expected_completion_date = COALESCE(NULLIF(p_data->>'expected_completion_date','')::date, expected_completion_date),
      status = COALESCE(p_data->>'status', status),
      cover_image_url = COALESCE(NULLIF(p_data->>'cover_image_url',''), cover_image_url),
      metadata = COALESCE(p_data->'metadata', metadata),
      builder_name = COALESCE(NULLIF(p_data->>'builder_name',''), builder_name),
      builder_contact = COALESCE(NULLIF(p_data->>'builder_contact',''), builder_contact),
      builder_email = COALESCE(NULLIF(p_data->>'builder_email',''), builder_email),
      gps_lat = COALESCE(NULLIF(p_data->>'gps_lat','')::float8, gps_lat),
      gps_lng = COALESCE(NULLIF(p_data->>'gps_lng','')::float8, gps_lng),
      map_link = COALESCE(NULLIF(p_data->>'map_link',''), map_link),
      construction_progress = COALESCE((p_data->>'construction_progress')::int, construction_progress),
      amenities = COALESCE(
        CASE WHEN p_data->'amenities' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'amenities')) END,
        amenities),
      noc_number = COALESCE(NULLIF(p_data->>'noc_number',''), noc_number),
      noc_authority = COALESCE(NULLIF(p_data->>'noc_authority',''), noc_authority),
      noc_date = COALESCE(NULLIF(p_data->>'noc_date','')::date, noc_date),
      noc_notes = COALESCE(NULLIF(p_data->>'noc_notes',''), noc_notes),
      cover_images = COALESCE(
        CASE WHEN p_data->'cover_images' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'cover_images')) END,
        cover_images),
      delivery_date = COALESCE(NULLIF(p_data->>'delivery_date','')::date, delivery_date),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) MAJOR — OTP is the real gate; collapse the double email-verification
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_otps ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- verify_signup_otp: stamp verified_at ONLY on a genuine success (used_at alone
-- is also set on expiry/max-attempts, so it cannot prove verification).
CREATE OR REPLACE FUNCTION public.verify_signup_otp(p_email text, p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    UPDATE public.email_otps SET used_at = now(), verified_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('verified', true);
  END IF;

  RETURN jsonb_build_object(
    'error', 'invalid_otp',
    'message', 'Incorrect code.',
    'attempts_left', greatest(0, 5 - (v_row.attempts + 1))
  );
END;
$function$;

-- signup_new_company: (a) require a server-verified OTP for this email before
-- creating anything (closes the client-only bypass); (b) create the owner
-- email_verified=true so the auto-bridge confirms the auth identity immediately
-- (no GoTrue activation link, no second email).
--
-- ⚠️ INTERNAL / SUPER-ADMIN PROVISIONING (note 1): this RPC is the PUBLIC signup
-- path and now demands a verified email_otps row. To provision a tenant WITHOUT
-- the UI OTP round-trip (the way ZZTEST/ZZTEST2 were seeded), first insert a
-- pre-verified token, e.g.:
--   INSERT INTO public.email_otps(email,otp_hash,purpose,channel,expires_at,verified_at,used_at)
--   VALUES (lower('you@example.com'),'-','signup','email',
--           now()+interval '10 min', now(), now());
-- then call signup_new_company(...). Otherwise it returns error 'email_not_verified'.
CREATE OR REPLACE FUNCTION public.signup_new_company(p_full_name text, p_email text, p_phone text, p_company_name text, p_password text, p_company_type text DEFAULT 'real_estate'::text, p_country text DEFAULT 'Pakistan'::text, p_city text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_plan_code text DEFAULT 'free_trial'::text, p_billing_cycle text DEFAULT 'monthly'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id  uuid;
  v_user_id     uuid;
  v_sub_id      uuid;
  v_plan        public.subscription_plans%ROWTYPE;
  v_hash        text;
  v_base        text;
  v_username    text;
  v_suffix      int;
  v_trial_ends  timestamptz;
  v_sub_status  text;
  v_inv_result  jsonb;
  v_inv_id      uuid;
  v_inv_number  text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_users WHERE LOWER(email) = LOWER(TRIM(p_email))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'email_taken',
      'message', 'This email is already registered.');
  END IF;

  -- Server-enforced email proof: a genuinely-verified signup OTP must exist for
  -- this email within the last 2 hours. The client-side flag alone is decorative.
  IF NOT EXISTS (
    SELECT 1 FROM public.email_otps
    WHERE email = LOWER(TRIM(p_email)) AND purpose = 'signup'
      AND verified_at IS NOT NULL AND verified_at > now() - INTERVAL '2 hours'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'email_not_verified',
      'message', 'Please verify your email with the code we sent before continuing.');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans
  WHERE  plan_code = p_plan_code AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE  plan_code = 'free_trial' AND is_active = true LIMIT 1;
  END IF;

  v_base := LOWER(REGEXP_REPLACE(TRIM(p_company_name), '[^a-zA-Z0-9]', '', 'g'));
  IF length(v_base) < 2 THEN v_base := 'company'; END IF;
  v_base := LEFT(v_base, 20);

  v_username := v_base;
  IF EXISTS (SELECT 1 FROM public.companies WHERE company_code = v_username)
     OR EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := v_base || v_suffix::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE company_code = v_username)
        AND    NOT EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username);
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 999;
    END LOOP;
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  INSERT INTO public.companies (
    company_code, company_name, company_type, country, city, address,
    status, onboarding_complete
  ) VALUES (
    v_username, TRIM(p_company_name), p_company_type,
    COALESCE(NULLIF(TRIM(p_country), ''), 'Pakistan'),
    NULLIF(TRIM(p_city), ''), NULLIF(TRIM(p_address), ''),
    'active', false
  ) RETURNING id INTO v_company_id;

  -- Owner created email_verified=TRUE (the OTP above already proved the email).
  -- The app_users->auth.users auto-bridge then mints a CONFIRMED auth identity,
  -- so the owner can sign in immediately — no activation link.
  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone,
    role, password_hash, status, email_verified
  ) VALUES (
    v_company_id, TRIM(p_full_name), v_username,
    LOWER(TRIM(p_email)), NULLIF(TRIM(p_phone), ''),
    'owner', v_hash, 'active', true
  ) RETURNING id INTO v_user_id;

  IF v_plan.plan_code = 'free_trial' THEN
    v_sub_status := 'trialing';
    v_trial_ends := now() + (v_plan.trial_days || ' days')::interval;
  ELSE
    v_sub_status := 'pending_payment';
    v_trial_ends := NULL;
  END IF;

  INSERT INTO public.subscriptions (
    company_id, plan_id, status, billing_cycle, amount, currency,
    trial_ends_at, current_period_start, current_period_end
  ) VALUES (
    v_company_id, v_plan.id, v_sub_status, v_plan.billing_cycle,
    v_plan.price, v_plan.currency, v_trial_ends, now(),
    COALESCE(v_trial_ends,
      CASE v_plan.billing_cycle
        WHEN 'yearly' THEN now() + interval '1 year'
        ELSE now() + interval '1 month'
      END)
  ) RETURNING id INTO v_sub_id;

  IF v_sub_status = 'pending_payment' THEN
    SELECT public.create_invoice_for_subscription(v_sub_id) INTO v_inv_result;
    v_inv_id     := (v_inv_result->>'invoice_id')::uuid;
    v_inv_number := v_inv_result->>'invoice_number';
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'status',         v_sub_status,
    'company_id',     v_company_id,
    'company_code',   v_username,
    'username',       v_username,
    'user_id',        v_user_id,
    'trial_ends_at',  v_trial_ends,
    'plan_code',      v_plan.plan_code,
    'invoice_id',     v_inv_id,
    'invoice_number', v_inv_number
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) MAJOR — user identity: admin-chosen username + optional (synthetic) email
-- ─────────────────────────────────────────────────────────────────────────────
-- Synthetic plumbing identity domain. Emails on this domain are NEVER mailed and
-- are treated as "no real email" by the reset UI (temp password shown on-screen).
CREATE OR REPLACE FUNCTION public._is_synthetic_email(p_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT p_email IS NOT NULL AND lower(p_email) LIKE '%@users.internal'; $$;

CREATE OR REPLACE FUNCTION public.create_app_user(p_company_id uuid, p_full_name text, p_role text, p_password text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_module_permissions jsonb DEFAULT '{}'::jsonb, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_hash text; v_company_code text; v_username text; v_base text; v_suffix int;
  v_can_add boolean; v_expiry int; v_force boolean; v_email text; v_synthetic boolean := false;
  v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden_no_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'forbidden_wrong_tenant' USING ERRCODE = '42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin, false) OR v_me.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT company_code INTO v_company_code FROM public.companies WHERE id = p_company_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found', 'message', 'Company not found.');
  END IF;

  SELECT (check_plan_limit(p_company_id, 'users')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached', 'message', 'User limit reached for your plan. Please upgrade.');
  END IF;

  -- ── Username: admin-chosen → else derived from full name → else role ──
  v_base := lower(trim(coalesce(p_username, '')));
  IF v_base = '' THEN
    v_base := regexp_replace(lower(coalesce(p_full_name,'')), '[^a-z0-9._-]', '', 'g');
    v_base := left(v_base, 30);
  END IF;
  IF v_base = '' THEN v_base := p_role; END IF;
  IF v_base !~ '^[a-z0-9._-]{2,30}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_username',
      'message', 'Username must be 2-30 chars: lowercase letters, numbers, dot, dash or underscore.');
  END IF;
  v_username := v_base;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := v_base || v_suffix::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username);
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 999;
    END LOOP;
  END IF;

  -- ── Email: optional. When absent, mint a synthetic plumbing identity used
  --    only for the auth bridge (never mailed). Globally unique (username is
  --    unique within company; company_code is globally unique).
  v_email := NULLIF(LOWER(TRIM(COALESCE(p_email, ''))), '');
  IF v_email IS NULL THEN
    v_email := v_username || '.' || v_company_code || '@users.internal';
    v_synthetic := true;
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  SELECT expiry_days, force_change_on_first_login INTO v_expiry, v_force
  FROM public.company_password_policies WHERE company_id = p_company_id;
  v_expiry := COALESCE(v_expiry, 90);
  v_force  := COALESCE(v_force, true);

  PERFORM set_config('rms.audit_reason', 'user_created', true);
  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone, role, password_hash, status, module_permissions,
    needs_password_reset, password_changed_at, password_expires_at, email_verified
  ) VALUES (
    p_company_id, TRIM(p_full_name), v_username, v_email,
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    p_role, v_hash, 'active', COALESCE(p_module_permissions, '{}'::jsonb),
    v_force, now(),
    CASE WHEN v_expiry > 0 THEN now() + (v_expiry || ' days')::interval ELSE NULL END,
    true
  ) RETURNING id INTO v_user_id;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'username', v_username,
    'email', v_email, 'synthetic_email', v_synthetic);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- admin_reset_subuser_password: real email -> mail temp pw (as before).
-- synthetic/no email -> skip mail, return temp pw so the UI shows it on-screen once.
CREATE OR REPLACE FUNCTION public.admin_reset_subuser_password(p_user_id uuid, p_temp_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller   RECORD;
  v_sub_user RECORD;
  v_mailable boolean;
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

  PERFORM set_config('rms.audit_reason', 'password_reset', true);
  UPDATE public.app_users
  SET password_hash        = crypt(p_temp_password, gen_salt('bf', 10)),
      needs_password_reset = true,
      session_version      = coalesce(session_version, 0) + 1
  WHERE id = v_sub_user.id;

  UPDATE auth.users
  SET encrypted_password = crypt(p_temp_password, gen_salt('bf', 10))
  WHERE id = v_sub_user.auth_user_id;

  v_mailable := v_sub_user.email IS NOT NULL AND trim(v_sub_user.email) <> ''
                AND NOT public._is_synthetic_email(v_sub_user.email);

  IF v_mailable THEN
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
    RETURN jsonb_build_object('reset', true, 'delivery', 'email');
  END IF;

  -- No mailable email — return the temp password for one-time on-screen display.
  RETURN jsonb_build_object('reset', true, 'delivery', 'onscreen', 'temp_password', p_temp_password);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) MAJOR — semantic audit reason for credential actions
--   update_app_user already row-audits via the generic trigger; tag the reason.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_app_user(p_user_id uuid, p_company_id uuid, p_full_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_password text DEFAULT NULL::text, p_module_permissions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_me     public.app_users := public._rms_caller();
  v_target public.app_users;
  v_hash   text;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'Only an admin can manage users.');
  END IF;

  SELECT * INTO v_target FROM public.app_users
  WHERE id = p_user_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found',
      'message', 'User not found.');
  END IF;

  IF NOT COALESCE(v_me.is_super_admin, false) THEN
    IF p_role IS NOT NULL AND p_role IN ('owner','admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_role',
        'message', 'You cannot grant owner or admin role.');
    END IF;
    IF v_target.role IN ('owner','admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_target',
        'message', 'You cannot modify an owner or admin user.');
    END IF;
    IF v_target.id = v_me.id
       AND p_role IS NOT NULL AND p_role IS DISTINCT FROM v_target.role THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_self_role',
        'message', 'You cannot change your own role.');
    END IF;
  END IF;

  IF p_password IS NOT NULL AND LENGTH(TRIM(p_password)) > 0 THEN
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  END IF;

  PERFORM set_config('rms.audit_reason',
    CASE WHEN p_status IS NOT NULL THEN 'user_' || p_status
         WHEN p_role   IS NOT NULL AND p_role IS DISTINCT FROM v_target.role THEN 'user_role_change'
         WHEN v_hash   IS NOT NULL THEN 'password_set'
         ELSE 'user_update' END, true);

  UPDATE public.app_users SET
    full_name          = COALESCE(NULLIF(TRIM(p_full_name),''),  full_name),
    role               = COALESCE(p_role,               role),
    email              = CASE WHEN p_email IS NOT NULL
                              THEN NULLIF(LOWER(TRIM(p_email)),'') ELSE email END,
    phone              = CASE WHEN p_phone IS NOT NULL
                              THEN NULLIF(TRIM(p_phone),'')        ELSE phone END,
    status             = COALESCE(p_status,             status),
    password_hash      = COALESCE(v_hash,               password_hash),
    module_permissions = COALESCE(p_module_permissions, module_permissions),
    updated_at         = NOW()
  WHERE id = p_user_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- Generic audit trigger: ADDITIVE one-liner only — pick up a transaction-local
-- semantic reason when a credential RPC set one. No-op (NULL) by default; nothing
-- else in this function changes.
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_data JSONB;
  v_new_data JSONB;
  v_row_data JSONB;
  v_changed_fields TEXT[];
  v_auth_uid UUID;
  v_user_name TEXT := 'system';
  v_user_role TEXT := 'unknown';
  v_company_id UUID;
  v_record_id TEXT;
  v_is_sensitive BOOLEAN := FALSE;
  v_reason TEXT := NULL;
  v_ip INET;
  v_user_agent TEXT;
  v_headers JSONB;
BEGIN
  -- ── Request headers (IP, user-agent from Supabase request context) ──
  BEGIN
    v_headers := current_setting('request.headers', true)::JSONB;
    BEGIN
      v_ip := (COALESCE( split_part(v_headers->>'x-forwarded-for', ',', 1), v_headers->>'x-real-ip', '' ))::INET;
    EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
    v_user_agent := left(COALESCE(v_headers->>'user-agent',''), 500);
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_user_agent := NULL;
  END;

  -- ── Auth user ──────────────────────────────────────────────────────
  BEGIN
    v_auth_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN v_auth_uid := NULL; END;
  IF v_auth_uid IS NOT NULL THEN
    BEGIN
      SELECT full_name, role INTO v_user_name, v_user_role
      FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_user_name := v_auth_uid::TEXT; v_user_role := 'unknown';
    END;
  END IF;

  -- ── Build data snapshots ───────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD); v_new_data := NULL; v_row_data := v_old_data;
    v_is_sensitive := TRUE; -- every delete is sensitive
  ELSIF TG_OP = 'INSERT' THEN
    v_old_data := NULL; v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
  ELSE -- UPDATE
    v_old_data := to_jsonb(OLD); v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
    -- Which columns actually changed?
    SELECT array_agg(kv.key ORDER BY kv.key) INTO v_changed_fields
    FROM jsonb_each(v_old_data) AS kv
    WHERE kv.value IS DISTINCT FROM (v_new_data -> kv.key);

    -- Flag sensitive changes by table + field
    IF TG_TABLE_NAME = 'payments' AND (v_old_data->>'amount') IS DISTINCT FROM (v_new_data->>'amount') THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'sales' AND (
         (v_old_data->>'sale_price') IS DISTINCT FROM (v_new_data->>'sale_price')
      OR (v_old_data->>'net_amount') IS DISTINCT FROM (v_new_data->>'net_amount')) THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'installments' AND (v_old_data->>'amount_due') IS DISTINCT FROM (v_new_data->>'amount_due') THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'pdc_cheques'
       AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status')
       AND (v_new_data->>'status' = 'bounced' OR v_old_data->>'status' = 'bounced') THEN
      v_is_sensitive := TRUE;
    END IF;
  END IF;

  -- ── Backdated-entry warning (INSERT/UPDATE only; null-safe across tables) ──
  IF v_new_data IS NOT NULL THEN
    BEGIN
      IF NULLIF(v_new_data->>'payment_date','')::date < (CURRENT_DATE - 1)
         OR NULLIF(v_new_data->>'sale_date','')::date < (CURRENT_DATE - 1) THEN
        v_is_sensitive := TRUE;
        v_reason := 'backdated_entry';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- malformed/non-date value -> ignore, never break the parent op
    END;
  END IF;

  -- ── ADDITIVE: semantic reason from a credential RPC (no-op by default) ──
  v_reason := COALESCE(v_reason, NULLIF(current_setting('rms.audit_reason', true), ''));

  -- ── Record ID & company ─────────────────────────────────────────────
  v_record_id := COALESCE(v_row_data->>'id', '?');
  BEGIN
    v_company_id := (v_row_data->>'company_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_company_id := NULL; END;
  IF v_company_id IS NULL AND v_auth_uid IS NOT NULL THEN
    BEGIN
      SELECT company_id INTO v_company_id FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ── Write audit log — wrapped so it NEVER fails the parent op ───────
  BEGIN
    INSERT INTO public.audit_logs (
      company_id, table_name, record_id, action, old_data, new_data, changed_fields,
      changed_by, changed_by_name, changed_by_role, is_sensitive, reason, module, ip_address, user_agent
    ) VALUES (
      v_company_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old_data, v_new_data, v_changed_fields,
      v_auth_uid, COALESCE(v_user_name, 'system'), COALESCE(v_user_role, 'unknown'),
      v_is_sensitive, v_reason, TG_TABLE_NAME, v_ip, v_user_agent
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[audit] %.% failed: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
