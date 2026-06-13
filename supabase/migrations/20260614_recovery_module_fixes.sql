-- ════════════════════════════════════════════════════════════════════════════
-- Recovery Module Fix Phase — turn disconnected pages into a living system.
-- Source of truth for attribution = the calls pattern: officer UUID + project_id,
-- stamped SERVER-SIDE from _rms_caller(). Additive only — no table DDL, no
-- credential columns touched. See RECOVERY_MODULE_AUDIT.md.
-- ════════════════════════════════════════════════════════════════════════════

-- ── BLOCKER 1: project assignment ──────────────────────────────────────────
-- create_app_user gains p_project_ids → writes user_project_assignments so a new
-- recovery officer is actually assigned to projects (additive overload; the
-- existing p_username overload is left intact for any other caller).
CREATE OR REPLACE FUNCTION public.create_app_user(
  p_company_id uuid, p_full_name text, p_role text, p_password text,
  p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_module_permissions jsonb DEFAULT '{}'::jsonb, p_username text DEFAULT NULL::text,
  p_project_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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

  -- NEW: write project assignments (only valid projects of this company)
  IF p_project_ids IS NOT NULL THEN
    INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active, assigned_by)
    SELECT p_company_id, v_user_id, pid, 'manage', true, v_me.id
    FROM unnest(p_project_ids) AS pid
    WHERE EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pid AND pr.company_id = p_company_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'username', v_username,
    'email', v_email, 'synthetic_email', v_synthetic);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_app_user(uuid,text,text,text,text,text,jsonb,text,uuid[]) TO authenticated, service_role;

-- update_app_user gains p_project_ids → REPLACES the user's assignment set
-- (NULL = leave unchanged; [] = clear all). Additive overload.
CREATE OR REPLACE FUNCTION public.update_app_user(
  p_user_id uuid, p_company_id uuid, p_full_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_status text DEFAULT NULL::text,
  p_password text DEFAULT NULL::text, p_module_permissions jsonb DEFAULT NULL::jsonb,
  p_project_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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

  -- NEW: replace the assignment set when provided
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
GRANT EXECUTE ON FUNCTION public.update_app_user(uuid,uuid,text,text,text,text,text,text,jsonb,uuid[]) TO authenticated, service_role;

-- list_app_users: also surface each user's assigned projects (names), 'All' for
-- admin/owner. Lets the Users list show who is scoped to what.
CREATE OR REPLACE FUNCTION public.list_app_users(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                 u.id,
      'full_name',          u.full_name,
      'username',           u.username,
      'email',              u.email,
      'phone',              u.phone,
      'role',               u.role,
      'status',             u.status,
      'module_permissions', u.module_permissions,
      'created_at',         u.created_at,
      'last_login_at',      u.last_login_at,
      'projects',
        CASE WHEN u.role IN ('owner','admin') OR COALESCE(u.is_super_admin,false)
             THEN jsonb_build_array('All')
             ELSE COALESCE((
               SELECT jsonb_agg(p.project_name ORDER BY p.project_name)
               FROM public.user_project_assignments upa
               JOIN public.projects p ON p.id = upa.project_id
               WHERE upa.user_id = u.id AND upa.company_id = p_company_id AND upa.is_active
             ), '[]'::jsonb)
        END
    ) ORDER BY u.created_at
  ) INTO v_rows
  FROM public.app_users u
  WHERE u.company_id = p_company_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$function$;

-- ── BLOCKER 2: field visits + escalations attribute (officer UUID + project_id) ─
-- log_field_visit: add project_id to the INSERT (was computed for the auth check
-- but never stored → Team Performance project filter missed it).
CREATE OR REPLACE FUNCTION public.log_field_visit(p_company_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := gen_random_uuid();
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  IF NULLIF(trim(p_data->>'officer_name'), '') IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Officer name required'); END IF;
  IF NULLIF(p_data->>'visit_date', '') IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Visit date required'); END IF;

  v_proj := (SELECT project_id FROM public.units WHERE id = NULLIF(p_data->>'unit_id','')::uuid AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.clients WHERE id = NULLIF(p_data->>'client_id','')::uuid AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned','message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO field_visits (
    id, company_id, officer_id, officer_name, client_id, client_name, unit_id, unit_no, project_name, project_id,
    visit_date, visit_time, latitude, longitude, location_name, outcome, notes, photo_url
  ) VALUES (
    v_id, p_company_id, NULLIF(p_data->>'officer_id', '')::uuid, trim(p_data->>'officer_name'),
    NULLIF(p_data->>'client_id', '')::uuid, p_data->>'client_name', NULLIF(p_data->>'unit_id', '')::uuid,
    p_data->>'unit_no', p_data->>'project_name', v_proj, (p_data->>'visit_date')::date,
    NULLIF(p_data->>'visit_time', '')::time, NULLIF(p_data->>'latitude', '')::numeric,
    NULLIF(p_data->>'longitude', '')::numeric, p_data->>'location_name',
    COALESCE(NULLIF(p_data->>'outcome', ''), 'other'), p_data->>'notes', p_data->>'photo_url'
  );
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- create_escalation: add project_id to the INSERT.
CREATE OR REPLACE FUNCTION public.create_escalation(p_company_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  v_proj := (SELECT project_id FROM public.sales WHERE id = NULLIF(p_data->>'sale_id','')::uuid AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.clients WHERE id = (p_data->>'client_id')::uuid AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned','message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO public.escalations (
    company_id, client_id, sale_id, from_level, to_level, reason, escalated_by, escalated_to, status, project_id
  ) VALUES (
    p_company_id, (p_data->>'client_id')::uuid, NULLIF(p_data->>'sale_id','')::uuid,
    COALESCE((p_data->>'from_level')::int, 1), (p_data->>'to_level')::int,
    p_data->>'reason', NULLIF(p_data->>'escalated_by','')::uuid,
    NULLIF(p_data->>'escalated_to','')::uuid, COALESCE(p_data->>'status', 'open'), v_proj
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── MAJOR: promise attribution ─────────────────────────────────────────────
-- log_payment_promise: stamp logged_by = caller UUID (server-owned, the calls
-- pattern) and set project_id, so Team Performance counts the promise. Also
-- attribute the side contact_log to the officer.
CREATE OR REPLACE FUNCTION public.log_payment_promise(
  p_company_id uuid, p_client_id uuid, p_promised_amount numeric, p_promise_date date,
  p_sale_id uuid DEFAULT NULL::uuid, p_installment_id uuid DEFAULT NULL::uuid,
  p_promised_via text DEFAULT 'call'::text, p_promised_by_client text DEFAULT NULL::text,
  p_logged_by text DEFAULT ''::text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_existing UUID;
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  IF COALESCE(p_promised_amount, 0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive'); END IF;
  IF p_promise_date IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'promise_date_required'); END IF;

  v_proj := (SELECT project_id FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id);
  IF v_proj IS NULL THEN v_proj := (SELECT project_id FROM public.clients WHERE id = p_client_id AND company_id = p_company_id); END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned','message','You are not assigned to this project.');
    END IF;
  END IF;

  IF p_installment_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM payment_promises
    WHERE installment_id = p_installment_id AND status = 'pending' AND company_id = p_company_id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_active_promise', 'existing_id', v_existing);
    END IF;
  END IF;

  -- logged_by is SERVER-OWNED (officer UUID) so Team Performance can attribute it.
  INSERT INTO payment_promises (
    company_id, client_id, sale_id, installment_id, project_id,
    promised_amount, promise_date, promised_via, promised_by_client, logged_by, notes
  ) VALUES (
    p_company_id, p_client_id, p_sale_id, p_installment_id, v_proj,
    p_promised_amount, p_promise_date, COALESCE(p_promised_via, 'call'),
    p_promised_by_client, v_me.id::text, p_notes
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO contact_logs (
      company_id, client_id, sale_id, project_id, agent_id, created_by, channel, direction,
      contact_date, response_received, promise_to_pay,
      promise_amount, promise_date, remarks, status_tag
    ) VALUES (
      p_company_id, p_client_id, p_sale_id, v_proj, v_me.id::text, v_me.id::text,
      COALESCE(p_promised_via, 'call'), 'outbound',
      CURRENT_DATE, 'Promised', TRUE, p_promised_amount, p_promise_date,
      COALESCE(p_notes, 'Payment promise logged'), 'promise'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN (SELECT jsonb_build_object('success', true, 'id', pp.id,
    'promised_amount', pp.promised_amount, 'promise_date', pp.promise_date, 'status', pp.status
  ) FROM payment_promises pp WHERE pp.id = v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- mark_promise_kept: derive the project from the promise's sale/client when the
-- stored project_id is NULL, so an assigned officer can mark KEPT (previously a
-- NULL project_id was treated as "not assigned" → officers could only mark broken).
CREATE OR REPLACE FUNCTION public.mark_promise_kept(
  p_promise_id uuid, p_actual_amount numeric, p_actual_date date DEFAULT NULL::date,
  p_actual_via text DEFAULT NULL::text, p_related_payment_id uuid DEFAULT NULL::uuid,
  p_updated_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_co uuid; v_project uuid; v_promised numeric; v_status text; v_sale uuid; v_client uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  SELECT company_id, project_id, promised_amount, status, sale_id, client_id
    INTO v_co, v_project, v_promised, v_status, v_sale, v_client
  FROM public.payment_promises WHERE id=p_promise_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_found'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM v_co THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;

  -- derive project when the row predates project stamping
  IF v_project IS NULL THEN
    v_project := (SELECT project_id FROM public.sales WHERE id = v_sale AND company_id = v_co);
    IF v_project IS NULL THEN
      v_project := (SELECT project_id FROM public.clients WHERE id = v_client AND company_id = v_co);
    END IF;
  END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=v_co AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_pending'); END IF;
  UPDATE payment_promises SET
    status=CASE WHEN COALESCE(p_actual_amount,0) >= v_promised THEN 'kept' ELSE 'partial' END,
    actual_paid_amount=COALESCE(p_actual_amount, 0), actual_paid_date=COALESCE(p_actual_date, CURRENT_DATE),
    actual_paid_via=p_actual_via, related_payment_id=p_related_payment_id, updated_at=NOW()
  WHERE id=p_promise_id AND company_id=v_co;
  RETURN (SELECT jsonb_build_object('success', true, 'id', pp.id, 'status', pp.status, 'actual_paid_amount', pp.actual_paid_amount) FROM payment_promises pp WHERE pp.id=p_promise_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
