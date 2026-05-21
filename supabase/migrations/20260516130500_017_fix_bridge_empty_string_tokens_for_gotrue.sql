-- =====================================================================
-- 017 — Fix: GoTrue requires empty strings (not NULL) on token columns
-- =====================================================================
-- Symptom: signInWithPassword returned 500 "Database error querying schema".
-- Root cause: my migration 001 _bridge_app_user_to_auth left several
-- token text columns NULL (confirmation_token, recovery_token, etc.).
-- GoTrue's ORM does `WHERE token = $1` lookups; NULL fails the equality
-- and breaks the password verification path.
-- =====================================================================

UPDATE auth.users
SET    confirmation_token         = COALESCE(confirmation_token, ''),
       recovery_token             = COALESCE(recovery_token, ''),
       email_change_token_new     = COALESCE(email_change_token_new, ''),
       email_change_token_current = COALESCE(email_change_token_current, ''),
       email_change               = COALESCE(email_change, ''),
       phone_change               = COALESCE(phone_change, ''),
       phone_change_token         = COALESCE(phone_change_token, ''),
       reauthentication_token     = COALESCE(reauthentication_token, '');

CREATE OR REPLACE FUNCTION public._bridge_app_user_to_auth(p_app_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $fn$
DECLARE
  v_user    public.app_users%ROWTYPE;
  v_auth_id uuid;
BEGIN
  SELECT * INTO v_user FROM public.app_users WHERE id = p_app_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_user % not found', p_app_user_id; END IF;
  IF v_user.auth_user_id IS NOT NULL THEN RETURN v_user.auth_user_id; END IF;

  v_auth_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token,
    email_change_confirm_status, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_auth_id, 'authenticated', 'authenticated',
    LOWER(v_user.email), v_user.password_hash, now(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object(
      'full_name', v_user.full_name, 'role', v_user.role,
      'migrated_from', 'app_users', 'app_user_id', v_user.id::text),
    false, COALESCE(v_user.created_at, now()), now(),
    NULLIF(v_user.phone, ''), NULL,
    '', '', '', '', '', '', '', '', 0, false, false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at, id
  ) VALUES (
    v_auth_id::text, v_auth_id,
    jsonb_build_object('sub', v_auth_id::text, 'email', LOWER(v_user.email),
                       'email_verified', true, 'phone_verified', false),
    'email', NULL, COALESCE(v_user.created_at, now()), now(), gen_random_uuid()
  );

  UPDATE public.app_users
  SET    auth_user_id                = v_auth_id,
         auth_provider               = 'supabase',
         auth_migration_completed_at = now(),
         email_verified_at           = COALESCE(email_verified_at, now()),
         email_verified              = true
  WHERE  id = v_user.id;

  RETURN v_auth_id;
END;
$fn$;
