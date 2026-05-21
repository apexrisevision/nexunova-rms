-- =====================================================================
-- 001 — AUTH BRIDGE: existing custom auth -> Supabase Auth
-- =====================================================================
-- Strategy: keep app_users.password_hash AND mirror into auth.users so
-- supabase.auth.signInWithPassword works. Existing bcrypt hashes are
-- $2a$ format and directly compatible with Supabase Auth.
-- =====================================================================
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS needs_password_reset        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_migration_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS avatar_url                  text,
  ADD COLUMN IF NOT EXISTS email_verified_at           timestamptz,
  ADD COLUMN IF NOT EXISTS phone_verified_at           timestamptz,
  ADD COLUMN IF NOT EXISTS preferences                 jsonb       NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.app_users
SET    email_verified_at = COALESCE(email_verified_at, now())
WHERE  email_verified = true AND email_verified_at IS NULL AND email IS NOT NULL;

-- Synthesize email for any user missing one — required for Supabase Auth
UPDATE public.app_users au
SET    email = LOWER(au.username || '@' || c.company_code || '.nxn.local')
FROM   public.companies c
WHERE  au.company_id = c.id
  AND  au.email IS NULL;

ALTER TABLE public.app_users
  ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
  ON public.app_users (LOWER(email));

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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_user % not found', p_app_user_id;
  END IF;

  IF v_user.auth_user_id IS NOT NULL THEN
    RETURN v_user.auth_user_id;
  END IF;

  v_auth_id := gen_random_uuid();

  -- auth.users: omit `confirmed_at` (generated column).
  INSERT INTO auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    phone, phone_confirmed_at,
    email_change_confirm_status,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_auth_id,
    'authenticated',
    'authenticated',
    LOWER(v_user.email),
    v_user.password_hash,
    now(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object(
      'full_name', v_user.full_name,
      'role', v_user.role,
      'migrated_from', 'app_users',
      'app_user_id', v_user.id::text
    ),
    false,
    COALESCE(v_user.created_at, now()),
    now(),
    NULLIF(v_user.phone, ''),
    NULL,
    0,
    false,
    false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at, id
  ) VALUES (
    v_auth_id::text,
    v_auth_id,
    jsonb_build_object(
      'sub',            v_auth_id::text,
      'email',          LOWER(v_user.email),
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    NULL,
    COALESCE(v_user.created_at, now()),
    now(),
    gen_random_uuid()
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

REVOKE ALL ON FUNCTION public._bridge_app_user_to_auth(uuid) FROM public, anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.app_users
    WHERE  auth_user_id IS NULL
      AND  status = 'active'
      AND  password_hash IS NOT NULL
  LOOP
    PERFORM public._bridge_app_user_to_auth(r.id);
  END LOOP;
END $$;

-- Auto-bridge trigger so every new app_users row gets mirrored.
CREATE OR REPLACE FUNCTION public._trg_app_users_auto_bridge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $fn$
BEGIN
  IF NEW.auth_user_id IS NULL
     AND NEW.password_hash IS NOT NULL
     AND NEW.email IS NOT NULL
     AND NEW.status = 'active'
  THEN
    PERFORM public._bridge_app_user_to_auth(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_app_users_auto_bridge ON public.app_users;
CREATE TRIGGER trg_app_users_auto_bridge
  AFTER INSERT ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public._trg_app_users_auto_bridge();

-- signup_new_company / create_app_user updates moved to 013 for cleaner diff history.
