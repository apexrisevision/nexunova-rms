-- ================================================================
-- NEXUNOVA RMS — FIX: create_app_user makes usable accounts
-- 2026-05-28
-- LATENT BUGS (every admin-created user):
--   1. username stored as `role@company_code` — the login form splits on
--      the last '@' to get username+company_code, so `recovery@ADMIN` was
--      unfindable. -> store the BARE role (recovery), numeric suffix on clash.
--   2. email_verified never set -> defaults false -> verify_login rejects
--      with email_not_verified. -> set email_verified=true (admin-created
--      accounts are provisioned by the company admin, not self-signup).
--   3. email is NOT NULL but the INSERT could write NULL -> the RPC silently
--      failed (caught -> generic server_error) when no email was passed.
--      -> require a valid email up front with a friendly error.
-- Body otherwise verbatim from the live DB dump (2026-05-28).
-- ================================================================

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
BEGIN
  SELECT company_code INTO v_admin_uname FROM public.companies WHERE id = p_company_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found', 'message', 'Company not found.');
  END IF;

  -- FIX 3: email is NOT NULL — require a valid one rather than failing on insert
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

  -- FIX 1: bare role username (login form resolves <username>@<company_code>)
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
    true   -- FIX 2: admin-created accounts are pre-verified so verify_login accepts them
  )
  RETURNING id INTO v_user_id;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'username', v_username);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;
