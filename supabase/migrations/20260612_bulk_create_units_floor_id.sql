-- Phase 3C (Q1): bulk_create_units now writes floor_id (the FK), not just
-- floor_label/floor_no — so bulk-generated units don't re-introduce the §11
-- label-string trap. Mirrors create_unit (which already sets floor_id). The
-- floor_id column already exists; this is an RPC body change, not DDL on tables.
-- Applied to prod via MCP apply_migration 2026-06-12; verified with a rolled-back
-- 3-unit sample (floor_id populated on 3/3 rows, FG row counts unchanged).
CREATE OR REPLACE FUNCTION public.bulk_create_units(p_company_id uuid, p_project_id uuid, p_units jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit JSONB; v_code TEXT; v_inserted INTEGER := 0; v_error_count INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[]; v_idx INTEGER := 0;
  v_limit_info JSONB; v_max INTEGER; v_current INTEGER; v_requested INTEGER;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company', 'inserted', 0, 'errors', 1,
      'error_details', jsonb_build_array('The selected project does not belong to your company.'));
  END IF;

  v_requested  := jsonb_array_length(p_units);
  v_limit_info := public.check_plan_limit(p_company_id, 'units');
  v_max        := (v_limit_info->>'max_allowed')::INTEGER;
  v_current    := (v_limit_info->>'current_count')::INTEGER;

  IF v_max > 0 AND (v_current + v_requested) > v_max THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'plan_limit', 'inserted', 0, 'errors', 1,
      'error_details', jsonb_build_array(
        format('Unit limit reached: plan allows %s units, you already have %s, and you are trying to add %s more. Upgrade your plan to continue.', v_max, v_current, v_requested)
      )
    );
  END IF;

  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_code := public.generate_unit_code(p_company_id);
      INSERT INTO public.units (
        company_id, project_id, unit_no, unit_code, unit_type_id, status_id,
        floor_id, floor_no, floor_label, block, area, area_unit, bedrooms, bathrooms, parking_count,
        base_price, features, notes, created_by
      ) VALUES (
        p_company_id, p_project_id, v_unit->>'unit_no', v_code,
        NULLIF(v_unit->>'unit_type_id', '')::UUID, NULLIF(v_unit->>'status_id', '')::UUID,
        NULLIF(v_unit->>'floor_id', '')::UUID,
        NULLIF(v_unit->>'floor_no', '')::INTEGER, NULLIF(v_unit->>'floor_label', ''),
        NULLIF(v_unit->>'block', ''), NULLIF(v_unit->>'area', '')::NUMERIC,
        COALESCE(NULLIF(v_unit->>'area_unit', ''), 'sqft'),
        NULLIF(v_unit->>'bedrooms', '')::INTEGER, NULLIF(v_unit->>'bathrooms', '')::INTEGER,
        COALESCE(NULLIF(v_unit->>'parking_count', '')::INTEGER, 0),
        COALESCE(NULLIF(v_unit->>'base_price', '')::NUMERIC, 0),
        '{}'::JSONB, NULLIF(v_unit->>'notes', ''), NULLIF(v_unit->>'created_by', '')::UUID
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || ('Row ' || v_idx || ' (' || COALESCE(v_unit->>'unit_no','?') || '): ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_error_count = 0, 'inserted', v_inserted, 'errors', v_error_count,
    'error_details', to_jsonb(v_errors)
  );
END;
$function$;