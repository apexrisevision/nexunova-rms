-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 2: per-project category seeding
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- seed_default_categories(company_id, project_id) inserts the canonical
-- 10 unit types + 10 unit statuses (the exact catalog the company was seeded with)
-- for ONE project. Idempotent: ON CONFLICT (…, code) DO NOTHING, so re-running is
-- a no-op. Hooked into upsert_project's INSERT branch so every NEW project is
-- auto-seeded its own 10+10 set (same transaction → a project can't be created
-- without categories). Step 3 uses this to reconcile the 2 existing projects.

CREATE OR REPLACE FUNCTION public.seed_default_categories(p_company_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.category_unit_types (company_id, project_id, type_code, type_name, sort_order, is_active) VALUES
    (p_company_id, p_project_id, 'STUDIO',    'Studio Apartment',    1,  true),
    (p_company_id, p_project_id, '1BHK',      '1 Bed Apartment',     2,  true),
    (p_company_id, p_project_id, '2BHK',      '2 Bed Apartment',     3,  true),
    (p_company_id, p_project_id, '3BHK',      '3 Bed Apartment',     4,  true),
    (p_company_id, p_project_id, 'PENT',      'Penthouse',           5,  true),
    (p_company_id, p_project_id, 'SHOP',      'Retail Shop',         6,  true),
    (p_company_id, p_project_id, 'OFFICE',    'Office Unit',         7,  true),
    (p_company_id, p_project_id, 'PLOT_5M',   '5 Marla Plot',        8,  true),
    (p_company_id, p_project_id, 'PLOT_10M',  '10 Marla Plot',       9,  true),
    (p_company_id, p_project_id, 'WAREHOUSE', 'Warehouse / Storage', 10, true)
  ON CONFLICT (company_id, project_id, type_code) DO NOTHING;

  INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available) VALUES
    (p_company_id, p_project_id, 'AVAILABLE',   'Available',         '#10b981', 1,  true, true),
    (p_company_id, p_project_id, 'BOOKED',      'Booked',            '#6366f1', 2,  true, false),
    (p_company_id, p_project_id, 'SOLD',        'Sold',              '#8b5cf6', 3,  true, false),
    (p_company_id, p_project_id, 'RESERVED',    'Reserved',          '#f59e0b', 4,  true, false),
    (p_company_id, p_project_id, 'INSTALLMENT', 'On Installment',    '#06b6d4', 5,  true, false),
    (p_company_id, p_project_id, 'MORTGAGED',   'Mortgaged',         '#f97316', 6,  true, false),
    (p_company_id, p_project_id, 'TRANSFER',    'Under Transfer',    '#a855f7', 7,  true, false),
    (p_company_id, p_project_id, 'HOLD',        'On Hold',           '#64748b', 8,  true, false),
    (p_company_id, p_project_id, 'POSSESSION',  'Possession Given',  '#0ea5e9', 9,  true, false),
    (p_company_id, p_project_id, 'DEAD',        'Dead / Cancelled',  '#ef4444', 10, true, false)
  ON CONFLICT (company_id, project_id, status_code) DO NOTHING;
END $function$;

GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid, uuid) TO anon, authenticated;

-- ── Hook: auto-seed a new project's categories (INSERT branch only) ──
-- Only the single PERFORM line is added vs. the current definition; the UPDATE
-- branch is unchanged (no re-seed on edit).
CREATE OR REPLACE FUNCTION public.upsert_project(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
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

    -- NEW: auto-seed this project's own 10 unit types + 10 statuses (same txn)
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
