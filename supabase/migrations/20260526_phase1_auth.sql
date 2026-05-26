-- ============================================================================
-- Migration: 20260526_phase1_auth
-- STATUS: DRAFT — NOT YET APPLIED. Review, then apply via Supabase MCP.
--
-- Auth-system server companions for the auth.js wiring (Option A: real Supabase session).
-- See NEXUNOVA_RMS_MASTER_CONTEXT.md §1-2 and the bridge finding (2026-05-26):
--   app_users.password_hash (bcrypt cost 10) and auth.users.encrypted_password (cost 6)
--   had DRIFTED and there is no sync trigger. These functions make login self-healing by
--   re-syncing auth.users from the just-verified / newly-set plaintext, so signInWithPassword
--   always matches.
--
-- Two changes:
--   1) verify_login  — add needs_password_reset + password_expires_at to the response,
--                      and re-sync auth.users.encrypted_password from the verified password.
--   2) change_password — NEW: policy + last-N history check + expiry, updates BOTH
--                      app_users and auth.users, bumps session_version, records history.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1. verify_login v2  (adds 2 fields + auth.users password self-heal)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_login(p_company_code text, p_username text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_co   public.companies%ROWTYPE;
  v_user public.app_users%ROWTYPE;
  v_sub_status   TEXT;
  v_plan_code    TEXT;
  v_inv_id       UUID;
  v_inv_number   TEXT;
  v_inv_amount   NUMERIC;
  v_inv_due      DATE;
  v_inv_currency TEXT;
BEGIN
  SELECT * INTO v_co FROM public.companies
  WHERE LOWER(company_code) = LOWER(TRIM(p_company_code)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','invalid_credentials');
  END IF;

  IF v_co.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','company_inactive');
  END IF;

  SELECT * INTO v_user FROM public.app_users
  WHERE company_id = v_co.id AND LOWER(username) = LOWER(TRIM(p_username)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','invalid_credentials');
  END IF;

  IF v_user.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','user_inactive');
  END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > NOW() THEN
    RETURN jsonb_build_object('success',false,'error','account_locked','locked_until',v_user.locked_until);
  END IF;

  IF v_user.password_hash IS NULL
    OR extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash
  THEN
    IF v_user.failed_login_attempts + 1 >= 5 THEN
      UPDATE public.app_users
        SET failed_login_attempts = 0, locked_until = NOW() + INTERVAL '15 minutes', updated_at = NOW()
      WHERE id = v_user.id;
      RETURN jsonb_build_object('success',false,'error','account_locked','locked_until',NOW() + INTERVAL '15 minutes');
    ELSE
      UPDATE public.app_users
        SET failed_login_attempts = failed_login_attempts + 1, updated_at = NOW()
      WHERE id = v_user.id;
    END IF;
    RETURN jsonb_build_object('success',false,'error','invalid_credentials');
  END IF;

  IF v_user.email_verified = false THEN
    RETURN jsonb_build_object('success',false,'error','email_not_verified','email',v_user.email);
  END IF;

  UPDATE public.app_users
    SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
  WHERE id = v_user.id;

  -- [NEW] Self-heal the GoTrue side so supabase.auth.signInWithPassword(email, p_password) matches.
  -- (Password is already verified above; keep auth.users.encrypted_password in sync each login.)
  IF v_user.auth_user_id IS NOT NULL THEN
    UPDATE auth.users
      SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          updated_at         = NOW()
    WHERE id = v_user.auth_user_id;
  END IF;

  SELECT s.status, sp.plan_code INTO v_sub_status, v_plan_code
  FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = v_co.id ORDER BY s.created_at DESC LIMIT 1;

  IF v_sub_status IN ('pending_payment', 'payment_under_review') THEN
    SELECT i.id, i.invoice_number, i.amount, i.due_date, i.currency
    INTO v_inv_id, v_inv_number, v_inv_amount, v_inv_due, v_inv_currency
    FROM public.invoices i
    WHERE i.company_id = v_co.id AND i.status = 'unpaid'
    ORDER BY i.created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id',                   v_user.id,
      'name',                 v_user.full_name,
      'username',             v_user.username,
      'email',                v_user.email,
      'role',                 v_user.role,
      'module_permissions',   v_user.module_permissions,
      'session_version',      v_user.session_version,
      'needs_password_reset', v_user.needs_password_reset,   -- [NEW] force-change-on-first-login
      'password_expires_at',  v_user.password_expires_at     -- [NEW] expiry gate
    ),
    'company', jsonb_build_object(
      'id',                  v_co.id,
      'name',                v_co.company_name,
      'code',                v_co.company_code,
      'onboarding_complete', v_co.onboarding_complete,
      'sub_status',          COALESCE(v_sub_status, 'active'),
      'plan_code',           v_plan_code,
      'invoice_id',          v_inv_id,
      'invoice_number',      v_inv_number,
      'invoice_amount',      v_inv_amount,
      'invoice_due',         v_inv_due,
      'invoice_currency',    COALESCE(v_inv_currency, 'PKR')
    )
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. change_password  (policy + history(N) + expiry; syncs app_users AND auth.users)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_password(p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_me      public.app_users;
  v_pol     public.company_password_policies;
  v_min     int;  v_up bool; v_lo bool; v_num bool; v_sym bool; v_hist int; v_expiry int;
  v_reused  boolean;
  v_app_hash  text;
  v_auth_hash text;
  v_new_ver int;
BEGIN
  SELECT * INTO v_me FROM public.app_users WHERE auth_user_id = auth.uid() AND status='active' LIMIT 1;
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF p_new_password IS NULL OR length(p_new_password)=0 THEN
    RETURN jsonb_build_object('success',false,'error','password_required'); END IF;

  -- Resolve policy (company override or defaults)
  SELECT * INTO v_pol FROM public.company_password_policies WHERE company_id=v_me.company_id;
  v_min    := COALESCE(v_pol.min_length, 8);
  v_up     := COALESCE(v_pol.require_uppercase, true);
  v_lo     := COALESCE(v_pol.require_lowercase, true);
  v_num    := COALESCE(v_pol.require_number, true);
  v_sym    := COALESCE(v_pol.require_symbol, false);
  v_hist   := COALESCE(v_pol.history_count, 3);
  v_expiry := COALESCE(v_pol.expiry_days, 90);

  -- Complexity checks
  IF length(p_new_password) < v_min THEN
    RETURN jsonb_build_object('success',false,'error','policy_violation','message','Minimum length is '||v_min||' characters.'); END IF;
  IF v_up  AND p_new_password !~ '[A-Z]'      THEN RETURN jsonb_build_object('success',false,'error','policy_violation','message','Must include an uppercase letter.'); END IF;
  IF v_lo  AND p_new_password !~ '[a-z]'      THEN RETURN jsonb_build_object('success',false,'error','policy_violation','message','Must include a lowercase letter.'); END IF;
  IF v_num AND p_new_password !~ '[0-9]'      THEN RETURN jsonb_build_object('success',false,'error','policy_violation','message','Must include a number.'); END IF;
  IF v_sym AND p_new_password !~ '[^A-Za-z0-9]' THEN RETURN jsonb_build_object('success',false,'error','policy_violation','message','Must include a symbol.'); END IF;

  -- History: reject reuse of current password or the last N stored hashes
  v_reused := (v_me.password_hash IS NOT NULL
               AND extensions.crypt(p_new_password, v_me.password_hash) = v_me.password_hash);
  IF NOT v_reused THEN
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT password_hash FROM public.password_history
        WHERE user_id = v_me.id ORDER BY changed_at DESC LIMIT v_hist
      ) h WHERE extensions.crypt(p_new_password, h.password_hash) = h.password_hash
    ) INTO v_reused;
  END IF;
  IF v_reused THEN
    RETURN jsonb_build_object('success',false,'error','password_reused',
      'message','You cannot reuse one of your last '||v_hist||' passwords.'); END IF;

  v_app_hash  := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));  -- app side (cost 10)
  v_auth_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf'));      -- GoTrue side
  v_new_ver   := COALESCE(v_me.session_version, 1) + 1;

  UPDATE public.app_users SET
    password_hash        = v_app_hash,
    password_changed_at  = now(),
    password_expires_at  = CASE WHEN v_expiry > 0 THEN now() + (v_expiry || ' days')::interval ELSE NULL END,
    needs_password_reset = false,
    session_version      = v_new_ver,
    updated_at           = now()
  WHERE id = v_me.id;

  -- Keep GoTrue in sync so signInWithPassword works with the new password
  IF v_me.auth_user_id IS NOT NULL THEN
    UPDATE auth.users SET encrypted_password = v_auth_hash, updated_at = now()
    WHERE id = v_me.auth_user_id;
  END IF;

  INSERT INTO public.password_history (company_id, user_id, password_hash)
  VALUES (v_me.company_id, v_me.id, v_app_hash);

  RETURN jsonb_build_object('success', true, 'session_version', v_new_ver);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- ============================================================================
-- END — DRAFT. NOT APPLIED.
-- Dependency: app_users.needs_password_reset / password_changed_at / password_expires_at
-- already exist (added in 20260526_phase1_new_tables). password_history table exists too.
-- ============================================================================
