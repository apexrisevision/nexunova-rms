-- Authz hardening — Batch 1 of 5 (highest-risk ungated RPCs). Source: RPC_AUTHZ_TRIAGE.md.
-- Guard pattern (null-safe; _rms_caller() returns an app_users row, NOT raising on no session,
-- so an explicit v_me.id IS NULL check is required — task's bare `IF NOT v_me.is_super_admin`
-- would let a no-session caller through because NULL is not TRUE):
--   v_me := public._rms_caller();
--   IF v_me.id IS NULL THEN RAISE;                              -- no session
--   IF NOT super_admin AND company_id IS DISTINCT FROM p_company_id THEN RAISE;  -- tenant (super bypass)
--   IF NOT (super_admin OR role IN ('owner','admin')) THEN RAISE;                -- role
--
-- SCOPE NOTE: triage items 1-3 (set_company_feature_flag, upsert_sa_announcement,
-- delete_sa_announcement) are NOT in this migration — they ALREADY enforce super-admin via
-- `PERFORM public._rms_require_super_admin()` (which checks id-null + is_super_admin and RAISEs).
-- The triage regex false-flagged them. Re-gating would be redundant and weaker; left untouched.
--
-- Body changes preserve each function's signature, return type, search_path, and logic — only
-- the guard block is prepended.

-- ── 4. create_app_user — ADMIN-ONLY (caller + tenant + role) ───────────────────
CREATE OR REPLACE FUNCTION public.create_app_user(p_company_id uuid, p_full_name text, p_role text, p_password text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_module_permissions jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id     uuid;
  v_hash        text;
  v_admin_uname text;
  v_username    text;
  v_suffix      int;
  v_can_add     boolean;
  v_expiry      int;
  v_force       boolean;
  v_email       text;
  v_me          public.app_users;
BEGIN
  -- authz guard (batch 1)
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden_no_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'forbidden_wrong_tenant' USING ERRCODE = '42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin, false) OR v_me.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT company_code INTO v_admin_uname FROM public.companies WHERE id = p_company_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found', 'message', 'Company not found.');
  END IF;

  v_email := NULLIF(LOWER(TRIM(COALESCE(p_email, ''))), '');
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'email_required',
      'message', 'A valid email is required to create a user.');
  END IF;

  SELECT (check_plan_limit(p_company_id, 'users')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached',
      'message', 'User limit reached for your plan. Please upgrade.');
  END IF;

  v_username := p_role;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := p_role || v_suffix::text;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username
      );
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 99;
    END LOOP;
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  SELECT expiry_days, force_change_on_first_login INTO v_expiry, v_force
  FROM public.company_password_policies WHERE company_id = p_company_id;
  v_expiry := COALESCE(v_expiry, 90);
  v_force  := COALESCE(v_force, true);

  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone,
    role, password_hash, status, module_permissions,
    needs_password_reset, password_changed_at, password_expires_at,
    email_verified
  )
  VALUES (
    p_company_id, TRIM(p_full_name), v_username,
    v_email,
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    p_role, v_hash, 'active',
    COALESCE(p_module_permissions, '{}'::jsonb),
    v_force,
    now(),
    CASE WHEN v_expiry > 0 THEN now() + (v_expiry || ' days')::interval ELSE NULL END,
    true
  )
  RETURNING id INTO v_user_id;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'username', v_username);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- ── 5. save_security_settings — ADMIN-ONLY (caller + tenant + role) ────────────
CREATE OR REPLACE FUNCTION public.save_security_settings(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur public.company_security_settings%ROWTYPE;
  v_me  public.app_users;
BEGIN
  -- authz guard (batch 1)
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden_no_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'forbidden_wrong_tenant' USING ERRCODE = '42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin, false) OR v_me.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_cur FROM company_security_settings WHERE company_id = p_company_id;

  INSERT INTO company_security_settings (
    company_id, session_timeout_min, lockout_threshold,
    lockout_duration_min, ip_whitelist_enabled, require_2fa_admin, updated_at
  ) VALUES (
    p_company_id,
    COALESCE((p_data->>'session_timeout_min')::int,      v_cur.session_timeout_min,  120),
    COALESCE((p_data->>'lockout_threshold')::int,        v_cur.lockout_threshold,    5),
    COALESCE((p_data->>'lockout_duration_min')::int,     v_cur.lockout_duration_min, 15),
    COALESCE((p_data->>'ip_whitelist_enabled')::boolean, v_cur.ip_whitelist_enabled, false),
    COALESCE((p_data->>'require_2fa_admin')::boolean,    v_cur.require_2fa_admin,    false),
    now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    session_timeout_min  = EXCLUDED.session_timeout_min,
    lockout_threshold    = EXCLUDED.lockout_threshold,
    lockout_duration_min = EXCLUDED.lockout_duration_min,
    ip_whitelist_enabled = EXCLUDED.ip_whitelist_enabled,
    require_2fa_admin    = EXCLUDED.require_2fa_admin,
    updated_at           = now();

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── 6. delete_sale_type — ADMIN-ONLY + REVOKE PUBLIC/anon ──────────────────────
CREATE OR REPLACE FUNCTION public.delete_sale_type(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  -- authz guard (batch 1)
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden_no_session' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'forbidden_wrong_tenant' USING ERRCODE = '42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin, false) OR v_me.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  DELETE FROM public.category_sale_types WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

REVOKE EXECUTE ON FUNCTION public.delete_sale_type(p_id uuid, p_company_id uuid) FROM PUBLIC, anon;

-- ── 7/8. REVOKE-ONLY (dead + destructive; no body change) ──────────────────────
REVOKE EXECUTE ON FUNCTION public.delete_payment(p_payment_id uuid, p_company_id uuid, p_deleted_by uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_client_simple(p_id uuid, p_company_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_unit_simple(p_id uuid, p_company_id uuid) FROM PUBLIC, anon, authenticated;
