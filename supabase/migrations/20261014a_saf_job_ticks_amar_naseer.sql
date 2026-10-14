-- SALE APPROVAL: on Awami the job goes by the login's NAME, not its role
-- (Rashid, 2026-10-14: "Bajeye ham role se differeciate karain ham naam se
-- filhal differenciate kartay hain. Magar dono k role mai access har cheez ka
-- complete do bas.")
--
--   amar@awami    = Accounts: makes and submits the SAF
--   naseer@awami  = Filing:   prints, files, makes the sale entry
--   both role admin (full access), password awami@123, must change it at the
--   first sign-in (needs_password_reset = true)
--
-- _saf_me: prepare = role accounts/finance, or amar on Awami
--          filing  = the 'saf_filing' tick, or naseer on Awami
--          approve = owner/admin who is neither (the read-only director view),
--                    so the two admins see their own job's screen
-- The users are made through create_app_user itself, under the owner's
-- identity, so the auth bridge, audit and plan limit run as from Users & Roles.

CREATE OR REPLACE FUNCTION public._saf_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users := public._rms_caller();
        v_awami constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
        v_prep boolean; v_fil boolean;
BEGIN
  IF v_me.id IS NULL OR COALESCE(v_me.status, 'active') <> 'active' THEN RETURN NULL; END IF;
  v_prep := v_me.role IN ('accounts','finance')
            OR (v_me.company_id = v_awami AND v_me.username = 'amar');
  v_fil  := COALESCE((v_me.module_permissions->>'saf_filing')::boolean, false)
            OR (v_me.company_id = v_awami AND v_me.username = 'naseer');
  RETURN jsonb_build_object(
    'user_id', v_me.id, 'company_id', v_me.company_id, 'role', v_me.role, 'name', v_me.full_name,
    'prepare', v_prep,
    'approve', v_me.role IN ('owner','admin') AND NOT v_prep AND NOT v_fil,
    'filing',  v_fil,
    'enabled', public._saf_on(v_me.company_id));
END $$;

DO $$
DECLARE
  v_co    uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';            -- Awami Market
  v_owner uuid;
  r jsonb;
BEGIN
  SELECT auth_user_id INTO v_owner FROM public.app_users
   WHERE company_id = v_co AND role = 'owner' AND username = 'awami';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Awami owner login not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE company_id = v_co AND username IN ('amar','naseer')) THEN
    RAISE EXCEPTION 'amar or naseer already exists on Awami';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  r := public.create_app_user(v_co, 'Amar', 'admin', 'awami@123', NULL, NULL, '{}'::jsonb, 'amar', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN RAISE EXCEPTION 'amar: %', r; END IF;

  r := public.create_app_user(v_co, 'Naseer', 'admin', 'awami@123', NULL, NULL, '{}'::jsonb, 'naseer', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN RAISE EXCEPTION 'naseer: %', r; END IF;

  -- first sign-in must change the password, whatever the company policy says
  UPDATE public.app_users SET needs_password_reset = true
   WHERE company_id = v_co AND username IN ('amar','naseer');
END $$;
