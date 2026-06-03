-- BATCH C1 (2026-06-03): gate update_app_user.
-- Closes CRITICAL cross-tenant account takeover + privilege escalation:
-- the live function had NO caller gate (only filtered id + p_company_id, both attacker-supplied),
-- letting any authenticated tenant user reset any user's password in any company, or self-escalate to owner.
-- Signature unchanged. Prelude = the proven cancel_payment pattern (super-admin exempt from wrong_tenant).
-- Admin-only (user management); no officer/manager path. Escalation guards skipped for super-admin.

CREATE OR REPLACE FUNCTION public.update_app_user(
  p_user_id uuid, p_company_id uuid,
  p_full_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text, p_password text DEFAULT NULL::text,
  p_module_permissions jsonb DEFAULT NULL::jsonb)
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
  -- prelude (exact pattern proven in cancel_payment)
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
