-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 1: category writers accept project_id
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- upsert_unit_type / upsert_unit_status now thread project_id from p_data into
-- the INSERT branch. Per-project uniqueness is already enforced by the Batch-1
-- re-scoped uniques (company_id, project_id, type_code|status_code|sort_order).
--
-- project_id is IMMUTABLE: the UPDATE branch deliberately does NOT touch it
-- (a category belongs to one project for life; "move" = create a new one).
-- Still nullable at the DB level until the Step 9 NOT NULL flip, so the existing
-- category form keeps working during the interim window (it just inserts a NULL
-- project_id until the Step 7 picker supplies one). No payment-type writer exists.
-- CREATE OR REPLACE preserves existing grants.

CREATE OR REPLACE FUNCTION public.upsert_unit_type(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_types (company_id, project_id, type_code, type_name, description, sort_order, is_active)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'type_code', p_data->>'type_name', NULLIF(p_data->>'description',''),
            COALESCE((p_data->>'sort_order')::int, 0), COALESCE((p_data->>'is_active')::bool, true))
    RETURNING id INTO v_id;
  ELSE
    -- project_id intentionally NOT updated (immutable)
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
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'status_code', p_data->>'status_name',
            COALESCE(p_data->>'color_hex','#6b7280'), COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), COALESCE((p_data->>'is_available')::bool, false))
    RETURNING id INTO v_id;
  ELSE
    -- project_id intentionally NOT updated (immutable)
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
