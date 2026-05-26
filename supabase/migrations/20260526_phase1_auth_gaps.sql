-- ============================================================================
-- Migration: 20260526_phase1_auth_gaps
-- STATUS: DRAFT — NOT YET APPLIED. Review, then apply via Supabase MCP.
--
-- Closes the two Option-A gaps found on 2026-05-26 so NEW users (not just the
-- pre-bridged admin) work under the real-Supabase-session model:
--   (a) Wire the existing _trg_app_users_auto_bridge() as an AFTER INSERT trigger
--       so every new app_users row gets a linked auth.users (GoTrue) identity.
--   (b) create_app_user sets initial password_expires_at + needs_password_reset
--       (force-change-on-first-login) from the company password policy.
--
-- Notes:
--  * The bridge only fires when the new row has email + password_hash + status='active'
--    (see _trg_app_users_auto_bridge); users created without an email are NOT bridged
--    and cannot use signInWithPassword — capture an email at user creation.
--  * verify_login v2 self-heals auth.users.encrypted_password on first login, so the
--    bridge only needs to create the linked row; the password converges on first login.
-- ============================================================================

-- ── (a) Auto-bridge trigger for new users ───────────────────────────────────
-- AFTER INSERT: the row must exist before _bridge_app_user_to_auth(NEW.id) updates it.
DROP TRIGGER IF EXISTS trg_app_users_auto_bridge ON public.app_users;
CREATE TRIGGER trg_app_users_auto_bridge
  AFTER INSERT ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public._trg_app_users_auto_bridge();

-- ── (b) create_app_user: set first-login + expiry from the password policy ───
CREATE OR REPLACE FUNCTION public.create_app_user(
  p_company_id uuid, p_full_name text, p_role text, p_password text,
  p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_module_permissions jsonb DEFAULT '{}'::jsonb)
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
  v_expiry      int;       -- [NEW]
  v_force       boolean;   -- [NEW]
BEGIN
  SELECT company_code INTO v_admin_uname FROM public.companies WHERE id = p_company_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found', 'message', 'Company not found.');
  END IF;

  SELECT (check_plan_limit(p_company_id, 'users')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached',
      'message', 'User limit reached for your plan. Please upgrade.');
  END IF;

  v_username := p_role || '@' || v_admin_uname;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := p_role || v_suffix::text || '@' || v_admin_uname;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username
      );
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 99;
    END LOOP;
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  -- [NEW] Resolve password-policy expiry + force-change (defaults if no policy row).
  SELECT expiry_days, force_change_on_first_login INTO v_expiry, v_force
  FROM public.company_password_policies WHERE company_id = p_company_id;
  v_expiry := COALESCE(v_expiry, 90);
  v_force  := COALESCE(v_force, true);

  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone,
    role, password_hash, status, module_permissions,
    needs_password_reset, password_changed_at, password_expires_at   -- [NEW]
  )
  VALUES (
    p_company_id, TRIM(p_full_name), v_username,
    NULLIF(LOWER(TRIM(COALESCE(p_email, ''))), ''),
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    p_role, v_hash, 'active',
    COALESCE(p_module_permissions, '{}'::jsonb),
    v_force,                                                          -- force change on first login
    now(),
    CASE WHEN v_expiry > 0 THEN now() + (v_expiry || ' days')::interval ELSE NULL END
  )
  RETURNING id INTO v_user_id;
  -- AFTER INSERT trigger trg_app_users_auto_bridge now provisions the auth.users identity.

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'username', v_username);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

-- ============================================================================
-- END — DRAFT. NOT APPLIED.
-- ============================================================================
