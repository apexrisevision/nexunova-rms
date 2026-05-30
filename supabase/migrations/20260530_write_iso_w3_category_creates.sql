-- ════════════════════════════════════════════════════════════
-- WRITE-ISOLATION W3: admin-OR-assigned-officer guard on per-project categories
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- upsert_unit_type, upsert_unit_status — same guard pattern as W2:
-- admin bypass; non-admin must have UPA for the target project_id.
-- Gate on p_data->>'project_id' for CREATE, existing row's project_id
-- for UPDATE (project_id is immutable on these records per the existing
-- "project_id intentionally NOT updated" comments in their bodies).
--
-- upsert_payment_type does NOT exist as an RPC (table is empty, unsurfaced).
-- Out of scope for W3.
--
-- seed_default_categories auto-seed path is UNAFFECTED — it does direct
-- INSERTs into the tables, not RPC calls, so the new guards never fire
-- during project creation's seeding hook.

CREATE OR REPLACE FUNCTION public.upsert_unit_type(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.category_unit_types
    WHERE id = p_id AND company_id = p_company_id;
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_types (company_id, project_id, type_code, type_name, description, sort_order, is_active)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'type_code', p_data->>'type_name', NULLIF(p_data->>'description',''),
            COALESCE((p_data->>'sort_order')::int, 0), COALESCE((p_data->>'is_active')::bool, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.category_unit_types SET
      type_code = COALESCE(p_data->>'type_code', type_code),
      type_name = COALESCE(p_data->>'type_name', type_name),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.upsert_unit_status(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.category_unit_statuses
    WHERE id = p_id AND company_id = p_company_id;
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'status_code', p_data->>'status_name',
            COALESCE(p_data->>'color_hex','#6b7280'), COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), COALESCE((p_data->>'is_available')::bool, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.category_unit_statuses SET
      status_code = COALESCE(p_data->>'status_code', status_code),
      status_name = COALESCE(p_data->>'status_name', status_name),
      color_hex = COALESCE(p_data->>'color_hex', color_hex),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      is_available = COALESCE((p_data->>'is_available')::bool, is_available),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

COMMENT ON FUNCTION public.upsert_unit_type(uuid, jsonb, uuid) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Per-project category. Same guard pattern
as upsert_unit (gate on p_data project_id for CREATE, existing row's project_id
for UPDATE). seed_default_categories does direct INSERTs so the auto-seed path
is unaffected. Member of W3.$$;

COMMENT ON FUNCTION public.upsert_unit_status(uuid, jsonb, uuid) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Same as upsert_unit_type. Member of W3.$$;
