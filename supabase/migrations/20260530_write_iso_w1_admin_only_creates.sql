-- ════════════════════════════════════════════════════════════
-- WRITE-ISOLATION W1: admin-only guard on upsert_project + upsert_floor
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Both RPCs guarded at top of BEGIN: _rms_caller() must resolve, then
-- _rms_is_admin() must be true. Reject envelope {success:false,
-- error:'auth_required'|'admin_only'} matches existing positive shape.
-- Body otherwise preserved verbatim. Guard applies to BOTH create
-- (p_id IS NULL) and edit (p_id IS NOT NULL).

CREATE OR REPLACE FUNCTION public.upsert_project(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.projects (
      company_id, project_code, project_name, description, location, city, country,
      total_area, area_unit, total_units, start_date, expected_completion_date, status,
      cover_image_url, metadata, builder_name, builder_contact, builder_email,
      gps_lat, gps_lng, map_link, construction_progress, amenities,
      noc_number, noc_authority, noc_date, noc_notes, cover_images, delivery_date, created_by
    ) VALUES (
      p_company_id, p_data->>'project_code', p_data->>'project_name', NULLIF(p_data->>'description',''),
      NULLIF(p_data->>'location',''), NULLIF(p_data->>'city',''), COALESCE(p_data->>'country','Pakistan'),
      NULLIF(p_data->>'total_area','')::numeric, COALESCE(p_data->>'area_unit','sqft'),
      COALESCE((p_data->>'total_units')::int, 0), NULLIF(p_data->>'start_date','')::date,
      NULLIF(p_data->>'expected_completion_date','')::date, COALESCE(p_data->>'status','active'),
      NULLIF(p_data->>'cover_image_url',''), COALESCE(p_data->'metadata', '{}'::jsonb),
      NULLIF(p_data->>'builder_name',''), NULLIF(p_data->>'builder_contact',''), NULLIF(p_data->>'builder_email',''),
      NULLIF(p_data->>'gps_lat','')::float8, NULLIF(p_data->>'gps_lng','')::float8,
      NULLIF(p_data->>'map_link',''), COALESCE((p_data->>'construction_progress')::int, 0),
      CASE WHEN p_data->'amenities' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'amenities')) END,
      NULLIF(p_data->>'noc_number',''), NULLIF(p_data->>'noc_authority',''),
      NULLIF(p_data->>'noc_date','')::date, NULLIF(p_data->>'noc_notes',''),
      CASE WHEN p_data->'cover_images' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'cover_images')) END,
      NULLIF(p_data->>'delivery_date','')::date, NULLIF(p_data->>'created_by','')::uuid
    ) RETURNING id INTO v_id;
    PERFORM public.seed_default_categories(p_company_id, v_id);
  ELSE
    UPDATE public.projects SET
      project_code = COALESCE(p_data->>'project_code', project_code),
      project_name = COALESCE(p_data->>'project_name', project_name),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      location = COALESCE(NULLIF(p_data->>'location',''), location),
      city = COALESCE(NULLIF(p_data->>'city',''), city),
      country = COALESCE(p_data->>'country', country),
      total_area = COALESCE(NULLIF(p_data->>'total_area','')::numeric, total_area),
      area_unit = COALESCE(p_data->>'area_unit', area_unit),
      total_units = COALESCE((p_data->>'total_units')::int, total_units),
      start_date = COALESCE(NULLIF(p_data->>'start_date','')::date, start_date),
      expected_completion_date = COALESCE(NULLIF(p_data->>'expected_completion_date','')::date, expected_completion_date),
      status = COALESCE(p_data->>'status', status),
      cover_image_url = COALESCE(NULLIF(p_data->>'cover_image_url',''), cover_image_url),
      metadata = COALESCE(p_data->'metadata', metadata),
      builder_name = COALESCE(NULLIF(p_data->>'builder_name',''), builder_name),
      builder_contact = COALESCE(NULLIF(p_data->>'builder_contact',''), builder_contact),
      builder_email = COALESCE(NULLIF(p_data->>'builder_email',''), builder_email),
      gps_lat = COALESCE(NULLIF(p_data->>'gps_lat','')::float8, gps_lat),
      gps_lng = COALESCE(NULLIF(p_data->>'gps_lng','')::float8, gps_lng),
      map_link = COALESCE(NULLIF(p_data->>'map_link',''), map_link),
      construction_progress = COALESCE((p_data->>'construction_progress')::int, construction_progress),
      amenities = COALESCE(
        CASE WHEN p_data->'amenities' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'amenities')) END,
        amenities),
      noc_number = COALESCE(NULLIF(p_data->>'noc_number',''), noc_number),
      noc_authority = COALESCE(NULLIF(p_data->>'noc_authority',''), noc_authority),
      noc_date = COALESCE(NULLIF(p_data->>'noc_date','')::date, noc_date),
      noc_notes = COALESCE(NULLIF(p_data->>'noc_notes',''), noc_notes),
      cover_images = COALESCE(
        CASE WHEN p_data->'cover_images' IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'cover_images')) END,
        cover_images),
      delivery_date = COALESCE(NULLIF(p_data->>'delivery_date','')::date, delivery_date),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.upsert_floor(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.floors (company_id, name, sort_order, is_active)
    VALUES (p_company_id, p_data->>'name', COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.floors SET
      name = COALESCE(p_data->>'name', name),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

COMMENT ON FUNCTION public.upsert_project(uuid, jsonb, uuid) IS
$$ADMIN-ONLY WRITE — Project add/edit is setup-level (master_context §3.1).
Guard at top: _rms_caller() must resolve (auth_required else); _rms_is_admin
must be true (admin_only else). Applies to both INSERT (p_id NULL) and UPDATE.
Internal call from seed_default_categories unaffected (seed does direct INSERTs).
Member of W1 — see migration 20260530_write_iso_w1.$$;

COMMENT ON FUNCTION public.upsert_floor(uuid, jsonb, uuid) IS
$$ADMIN-ONLY WRITE — Floors are company-level setup metadata (no project_id —
"generic vocabulary, not business data"). Same guard pattern as upsert_project.
Member of W1.$$;
