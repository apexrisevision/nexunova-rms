-- ══ RMS Users: the OWNER may deactivate / reactivate an ADMIN (20261118d) ══
-- NOT APPLIED until the owner says yes.
--
-- The bug: the Users screen shows "Deactivate" on an admin's row, but update_app_user refused
-- every change to an owner or admin unless the caller is a platform super admin — so even the
-- company OWNER got "You cannot modify an owner or admin user." (Awami, 18-Nov: freeing a plan
-- slot by deactivating amar@awami.)
--
-- The change, in both overloads: the owner may change ONLY the status of an admin (not
-- themself). Everything else stays refused exactly as before — an admin touching another admin,
-- anyone touching an owner, and any change to an admin's role, password, name, email, phone,
-- module access or projects.

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
    -- the owner may switch an admin on or off — the status and nothing else (20261118d)
    IF v_target.role IN ('owner','admin')
       AND NOT (v_me.role = 'owner' AND v_target.role = 'admin' AND v_target.id <> v_me.id
                AND p_status IN ('active','inactive')
                AND p_role IS NULL AND p_password IS NULL AND p_full_name IS NULL AND p_email IS NULL
                AND p_phone IS NULL AND p_module_permissions IS NULL) THEN
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

CREATE OR REPLACE FUNCTION public.update_app_user(p_user_id uuid, p_company_id uuid, p_full_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_password text DEFAULT NULL::text, p_module_permissions jsonb DEFAULT NULL::jsonb, p_project_ids uuid[] DEFAULT NULL::uuid[])
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
    RETURN jsonb_build_object('success', false, 'error', 'not_found', 'message', 'User not found.');
  END IF;

  IF NOT COALESCE(v_me.is_super_admin, false) THEN
    IF p_role IS NOT NULL AND p_role IN ('owner','admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_role',
        'message', 'You cannot grant owner or admin role.');
    END IF;
    -- the owner may switch an admin on or off — the status and nothing else (20261118d)
    IF v_target.role IN ('owner','admin')
       AND NOT (v_me.role = 'owner' AND v_target.role = 'admin' AND v_target.id <> v_me.id
                AND p_status IN ('active','inactive')
                AND p_role IS NULL AND p_password IS NULL AND p_full_name IS NULL AND p_email IS NULL
                AND p_phone IS NULL AND p_module_permissions IS NULL AND p_project_ids IS NULL) THEN
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

  IF p_project_ids IS NOT NULL THEN
    DELETE FROM public.user_project_assignments
    WHERE user_id = p_user_id AND company_id = p_company_id;
    INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active, assigned_by)
    SELECT p_company_id, p_user_id, pid, 'manage', true, v_me.id
    FROM unnest(p_project_ids) AS pid
    WHERE EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pid AND pr.company_id = p_company_id);
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;
