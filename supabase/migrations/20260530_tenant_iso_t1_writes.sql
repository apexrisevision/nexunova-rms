-- ════════════════════════════════════════════════════════════
-- TENANT-ISOLATION T1: wrong_tenant guard on all 11 write RPCs
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Mechanical prepend right after the existing auth_required check.
-- Pattern (positional p_company_id):
--   IF NOT COALESCE(v_me.is_super_admin, false)
--      AND v_me.company_id IS DISTINCT FROM p_company_id THEN
--     RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
--   END IF;
-- Pattern (jsonb-derived v_company_id — create_client/create_unit/create_sale_with_schedule):
--   same, gated on v_company_id.
-- Super-admin (is_super_admin=true) preserves cross-tenant capability by design.
-- Body otherwise verbatim. No other behavior changed.

-- ─── 1. upsert_project (positional, admin-only) ───
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
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
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

-- ─── 2. upsert_floor (positional, admin-only) ───
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
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
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

-- ─── 3. create_client (jsonb-derived) ───
CREATE OR REPLACE FUNCTION public.create_client(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID := (p_data->>'company_id')::UUID;
  v_project_id UUID := (p_data->>'project_id')::UUID;
  v_cnic       TEXT := NULLIF(TRIM(p_data->>'cnic'), '');
  v_code       TEXT;
  v_id         UUID;
  v_existing   UUID;
  v_can_add    boolean;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = v_company_id
                     AND project_id = v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this client.');
  END IF;

  SELECT (check_plan_limit(v_company_id, 'clients')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Client limit reached for your plan. Please upgrade.');
  END IF;

  IF v_cnic IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.clients
    WHERE company_id = v_company_id AND project_id = v_project_id AND cnic = v_cnic LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered',
        'duplicate_id', v_existing::TEXT, 'duplicate_field', 'cnic');
    END IF;
  END IF;

  v_code := public.generate_client_code(v_company_id, v_project_id);

  INSERT INTO public.clients (
    company_id, project_id, client_code, full_name, father_name,
    cnic, passport_no, phone_primary, phone_secondary, whatsapp,
    email, address, city, country,
    occupation, company_name, client_category, reference_by,
    notes, status, created_by,
    client_photo_url, cnic_front_url, cnic_back_url,
    overseas_local, next_of_kin_name, next_of_kin_relation, next_of_kin_phone,
    lead_source, bank_name, bank_account_title, bank_account_no, bank_iban
  ) VALUES (
    v_company_id, v_project_id, v_code,
    p_data->>'full_name',
    NULLIF(p_data->>'father_name',''), v_cnic, NULLIF(p_data->>'passport_no',''),
    p_data->>'phone_primary',
    NULLIF(p_data->>'phone_secondary',''), NULLIF(p_data->>'whatsapp',''),
    NULLIF(p_data->>'email',''), NULLIF(p_data->>'address',''),
    NULLIF(p_data->>'city',''), COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
    NULLIF(p_data->>'occupation',''), NULLIF(p_data->>'company_name',''),
    NULLIF(p_data->>'client_category',''), NULLIF(p_data->>'reference_by',''),
    NULLIF(p_data->>'notes',''), COALESCE(NULLIF(p_data->>'status',''),'active'),
    NULLIF(p_data->>'created_by','')::UUID,
    NULLIF(p_data->>'client_photo_url',''), NULLIF(p_data->>'cnic_front_url',''),
    NULLIF(p_data->>'cnic_back_url',''),
    COALESCE(NULLIF(p_data->>'overseas_local',''),'local'),
    NULLIF(p_data->>'next_of_kin_name',''), NULLIF(p_data->>'next_of_kin_relation',''),
    NULLIF(p_data->>'next_of_kin_phone',''), NULLIF(p_data->>'lead_source',''),
    NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'bank_account_title',''),
    NULLIF(p_data->>'bank_account_no',''), NULLIF(p_data->>'bank_iban','')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ─── 4. create_agent (positional) ───
CREATE OR REPLACE FUNCTION public.create_agent(p_company_id uuid, p_created_by uuid, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_cnic text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_commission_percent numeric DEFAULT 2.00, p_bank_name text DEFAULT NULL::text, p_bank_account_no text DEFAULT NULL::text, p_bank_account_title text DEFAULT NULL::text, p_join_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'active'::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_code       TEXT; v_agent_id UUID;
  v_max_agents INT;  v_cur_count INT; v_plan_code TEXT;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF p_project_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = p_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this agent.');
  END IF;
  SELECT sp.max_agents, sp.plan_code INTO v_max_agents, v_plan_code
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id ORDER BY s.created_at DESC LIMIT 1;
  SELECT COUNT(*) INTO v_cur_count FROM public.agents
  WHERE company_id = p_company_id AND status = 'active';
  IF v_max_agents IS NOT NULL AND v_cur_count >= v_max_agents THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Agent limit reached for your plan. Please upgrade to add more agents.');
  END IF;
  IF p_cnic IS NOT NULL AND p_cnic <> '' THEN
    IF EXISTS (SELECT 1 FROM public.agents WHERE company_id = p_company_id AND project_id = p_project_id AND cnic = p_cnic) THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_cnic',
        'message', 'An agent with this CNIC already exists in this project.');
    END IF;
  END IF;
  IF p_commission_percent < 0 OR p_commission_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_commission',
      'message', 'Commission must be between 0 and 100.');
  END IF;
  v_code := public.generate_agent_code(p_company_id, p_project_id);
  INSERT INTO public.agents (
    company_id, project_id, created_by, agent_code, full_name, phone, email, cnic,
    address, commission_percent, bank_name, bank_account_no, bank_account_title,
    join_date, notes, status
  ) VALUES (
    p_company_id, p_project_id, p_created_by, v_code, p_full_name, p_phone, p_email, p_cnic,
    p_address, p_commission_percent, p_bank_name, p_bank_account_no, p_bank_account_title,
    p_join_date, p_notes, p_status
  ) RETURNING id INTO v_agent_id;
  RETURN jsonb_build_object('success', true, 'agent_id', v_agent_id, 'agent_code', v_code);
END;
$function$;

-- ─── 5. create_unit (jsonb-derived) ───
CREATE OR REPLACE FUNCTION public.create_unit(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID := (p_data->>'company_id')::UUID;
  v_project_id UUID := (p_data->>'project_id')::UUID;
  v_code       TEXT; v_id UUID; v_can_add boolean;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = v_company_id
                     AND project_id = v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  SELECT (check_plan_limit(v_company_id, 'units')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Unit limit reached for your plan. Please upgrade.');
  END IF;
  v_code := public.generate_unit_code(v_company_id);
  INSERT INTO public.units (
    company_id, project_id, unit_no, unit_code, unit_type_id, status_id,
    floor_id, floor_no, floor_label, block, area, carpet_area, area_unit,
    bedrooms, bathrooms, parking_count, facing, base_price, features, notes, created_by,
    is_premium, is_corner, maintenance_monthly, possession_date, handover_status,
    transfer_history, image_urls, document_urls
  ) VALUES (
    v_company_id, v_project_id, p_data->>'unit_no', v_code,
    NULLIF(p_data->>'unit_type_id','')::UUID, NULLIF(p_data->>'status_id','')::UUID,
    NULLIF(p_data->>'floor_id','')::UUID, NULLIF(p_data->>'floor_no','')::INTEGER,
    NULLIF(p_data->>'floor_label',''), NULLIF(p_data->>'block',''),
    NULLIF(p_data->>'area','')::NUMERIC, NULLIF(p_data->>'carpet_area','')::NUMERIC,
    COALESCE(NULLIF(p_data->>'area_unit',''),'sqft'),
    NULLIF(p_data->>'bedrooms','')::INTEGER, NULLIF(p_data->>'bathrooms','')::INTEGER,
    COALESCE(NULLIF(p_data->>'parking_count','')::INTEGER,0), NULLIF(p_data->>'facing',''),
    COALESCE(NULLIF(p_data->>'base_price','')::NUMERIC,0),
    COALESCE(p_data->'features','{}'::JSONB), NULLIF(p_data->>'notes',''),
    NULLIF(p_data->>'created_by','')::UUID,
    COALESCE((p_data->>'is_premium')::BOOLEAN,false),
    COALESCE((p_data->>'is_corner')::BOOLEAN,false),
    NULLIF(p_data->>'maintenance_monthly','')::NUMERIC,
    NULLIF(p_data->>'possession_date','')::DATE,
    NULLIF(p_data->>'handover_status',''), NULLIF(p_data->>'transfer_history',''),
    COALESCE(p_data->'image_urls','[]'::JSONB),
    COALESCE(p_data->'document_urls','[]'::JSONB)
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id::TEXT,'unit_code',v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

-- ─── 6. upsert_unit (positional) ───
CREATE OR REPLACE FUNCTION public.upsert_unit(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row record;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.units
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
    INSERT INTO public.units SELECT * FROM jsonb_populate_record(
      NULL::public.units, p_data || jsonb_build_object('company_id', p_company_id))
    RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSE
    UPDATE public.units SET row = q.row FROM (
      SELECT to_jsonb(public.units.*) || p_data AS row FROM public.units WHERE id = p_id AND company_id = p_company_id
    ) q WHERE units.id = p_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ─── 7. upsert_unit_type (positional) ───
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
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
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

-- ─── 8. upsert_unit_status (positional) ───
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
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
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

-- ─── 9. record_payment (positional) ───
CREATE OR REPLACE FUNCTION public.record_payment(p_company_id uuid, p_sale_id uuid, p_installment_id uuid, p_is_down_payment boolean, p_amount numeric, p_payment_date date, p_payment_method text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_proof_url text DEFAULT NULL::text, p_payment_category text DEFAULT 'regular'::text, p_penalty_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0, p_tax_type text DEFAULT NULL::text, p_cheque_date date DEFAULT NULL::date, p_bank_id uuid DEFAULT NULL::uuid, p_adjustment_note text DEFAULT NULL::text, p_adjustment_type text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inst_id      uuid;
  v_amt_due      numeric;  v_amt_paid     numeric;  v_outstanding  numeric;
  v_pay_id       uuid;     v_pay_code     text;     v_row_count    integer;
  v_seq          integer;  v_ym           text;     v_dp_amount    numeric;
  v_fy_start     integer;  v_fy_label     text;     v_prv_seq      integer;
  v_voucher_code text;
  v_me           public.app_users := public._rms_caller();
  v_target_pid   uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    SELECT project_id INTO v_target_pid FROM public.sales
    WHERE id = p_sale_id AND company_id = p_company_id;
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  v_ym := TO_CHAR(CURRENT_DATE, 'YYMM');
  IF EXTRACT(MONTH FROM CURRENT_DATE)::int >= 7 THEN
    v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  ELSE
    v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int - 1;
  END IF;
  v_fy_label := RIGHT(v_fy_start::text, 2) || RIGHT((v_fy_start + 1)::text, 2);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF p_is_down_payment AND (p_installment_id IS NULL) THEN
    SELECT id, amount_due, amount_paid INTO v_inst_id, v_amt_due, v_amt_paid
    FROM public.installments
    WHERE sale_id = p_sale_id AND company_id = p_company_id
      AND installment_type = 'down_payment' AND amount_paid < amount_due
    ORDER BY installment_number LIMIT 1;
    IF v_inst_id IS NULL THEN
      SELECT down_payment INTO v_dp_amount FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
      INSERT INTO public.installments
        (company_id, sale_id, installment_number, installment_type, due_date, amount_due, amount_paid, status, notes)
      SELECT p_company_id, p_sale_id, 0, 'down_payment', sale_date, v_dp_amount, 0, 'pending', 'Down Payment / Booking'
      FROM public.sales WHERE id = p_sale_id
      RETURNING id, amount_due, amount_paid INTO v_inst_id, v_amt_due, v_amt_paid;
    END IF;
  ELSE
    v_inst_id := COALESCE(p_installment_id,
      (SELECT id FROM public.installments
       WHERE sale_id = p_sale_id AND company_id = p_company_id
         AND installment_type = 'down_payment' AND amount_paid < amount_due
       ORDER BY installment_number LIMIT 1));
    SELECT amount_due, amount_paid INTO v_amt_due, v_amt_paid
    FROM public.installments WHERE id = v_inst_id AND company_id = p_company_id;
  END IF;

  IF v_inst_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'installment_not_found');
  END IF;

  v_outstanding := GREATEST(v_amt_due - v_amt_paid, 0);
  IF p_amount > v_outstanding + 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'exceeds_outstanding', 'outstanding', v_outstanding);
  END IF;

  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(payment_code, '^PAY-[0-9]+-0*', '') AS INTEGER)), 0) + 1
  INTO v_seq FROM public.payments
  WHERE company_id = p_company_id AND payment_code LIKE 'PAY-' || v_ym || '-%';
  v_pay_code := 'PAY-' || v_ym || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
  VALUES (p_company_id, 'PRV', v_fy_label, 1)
  ON CONFLICT (company_id, prefix, year)
  DO UPDATE SET seq = voucher_sequences.seq + 1
  RETURNING seq INTO v_prv_seq;
  v_voucher_code := 'PRV-' || v_fy_label || '-' || LPAD(v_prv_seq::text, 5, '0');

  INSERT INTO public.payments (
    company_id, payment_code, voucher_code, sale_id, installment_id, client_id,
    amount, payment_date, payment_method, reference_no, bank_name, notes, status, created_by,
    proof_url, payment_category, penalty_amount, tax_amount, tax_type,
    cheque_date, bank_id, adjustment_note, adjustment_type
  )
  SELECT p_company_id, v_pay_code, v_voucher_code, p_sale_id, v_inst_id, s.client_id,
    p_amount, p_payment_date, p_payment_method,
    NULLIF(TRIM(COALESCE(p_reference_no,'')),''), NULLIF(TRIM(COALESCE(p_bank_name,'')),''),
    NULLIF(TRIM(COALESCE(p_notes,'')),''), 'received', p_created_by,
    NULLIF(TRIM(COALESCE(p_proof_url,'')),''), COALESCE(p_payment_category,'regular'),
    COALESCE(p_penalty_amount,0), COALESCE(p_tax_amount,0),
    NULLIF(TRIM(COALESCE(p_tax_type,'')),''), p_cheque_date, p_bank_id,
    NULLIF(TRIM(COALESCE(p_adjustment_note,'')),''), NULLIF(TRIM(COALESCE(p_adjustment_type,'')),'')
  FROM public.sales s WHERE s.id = p_sale_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  SELECT id INTO v_pay_id FROM public.payments WHERE payment_code = v_pay_code AND company_id = p_company_id;

  UPDATE public.installments SET amount_paid = amount_paid + p_amount,
    status = CASE WHEN (amount_paid + p_amount) >= amount_due THEN 'paid'
                  WHEN (amount_paid + p_amount) > 0 THEN 'partial'
                  ELSE status END,
    updated_at = NOW()
  WHERE id = v_inst_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'payment_id', v_pay_id, 'payment_code', v_pay_code,
    'voucher_code', v_voucher_code, 'new_amt_paid', v_amt_paid + p_amount,
    'new_outstanding', GREATEST(0, v_outstanding - p_amount));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ─── 10. create_pdc_cheque (positional) ───
CREATE OR REPLACE FUNCTION public.create_pdc_cheque(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_sale_id uuid;
  v_me public.app_users := public._rms_caller();
  v_target_pid uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  v_sale_id := NULLIF(p_data->>'sale_id','')::uuid;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_id_required_for_non_admin');
    END IF;
    SELECT project_id INTO v_target_pid FROM public.sales
    WHERE id = v_sale_id AND company_id = p_company_id;
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_not_in_company');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF p_data->>'cheque_no' IS NULL OR (p_data->>'amount')::numeric IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'cheque_no_and_amount_required');
  END IF;
  IF v_sale_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales WHERE id = v_sale_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_in_company');
  END IF;
  INSERT INTO pdc_cheques(company_id, sale_id, client_id, cheque_no, bank_name, amount,
    cheque_date, received_date, status, notes, created_by)
  VALUES (p_company_id, v_sale_id, NULLIF(p_data->>'client_id','')::uuid,
    p_data->>'cheque_no', p_data->>'bank_name', (p_data->>'amount')::numeric,
    NULLIF(p_data->>'cheque_date','')::date, NULLIF(p_data->>'received_date','')::date,
    COALESCE(p_data->>'status', 'pending'),
    p_data->>'notes', p_data->>'created_by')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ─── 11. create_sale_with_schedule (jsonb-derived) ───
CREATE OR REPLACE FUNCTION public.create_sale_with_schedule(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id        UUID; v_unit_id UUID; v_client_id UUID; v_agent_id UUID; v_project_id UUID;
  v_price_per_sqft    NUMERIC; v_area_sqft NUMERIC; v_discount NUMERIC; v_down_payment NUMERIC;
  v_installment_count INTEGER; v_notes TEXT; v_sale_date DATE; v_created_by UUID;
  v_net_amount NUMERIC; v_scheduled_sum NUMERIC; v_sale_id UUID; v_sale_number TEXT;
  v_inst JSONB; v_sold_status_id UUID; v_commission_rate NUMERIC; v_commission_amt NUMERIC;
  v_me                public.app_users := public._rms_caller();
BEGIN
  v_company_id        := (p_sale->>'company_id')::UUID;
  v_unit_id           := (p_sale->>'unit_id')::UUID;
  v_client_id         := (p_sale->>'client_id')::UUID;
  v_agent_id          := NULLIF(TRIM(COALESCE(p_sale->>'agent_id','')), '')::UUID;
  v_price_per_sqft    := (p_sale->>'price_per_sqft')::NUMERIC;
  v_area_sqft         := (p_sale->>'area_sqft')::NUMERIC;
  v_discount          := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_down_payment      := COALESCE((p_sale->>'down_payment')::NUMERIC, 0);
  v_installment_count := COALESCE((p_sale->>'installment_count')::INTEGER, 0);
  v_notes             := NULLIF(TRIM(COALESCE(p_sale->>'notes','')), '');
  v_sale_date         := COALESCE(NULLIF(p_sale->>'sale_date','')::DATE, CURRENT_DATE);
  v_created_by        := NULLIF(TRIM(COALESCE(p_sale->>'created_by','')), '')::UUID;
  v_commission_rate   := NULLIF(TRIM(COALESCE(p_sale->>'commission_rate','')), '')::NUMERIC;

  v_project_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_sale->>'project_id','')), '')::UUID,
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id)
  );

  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = v_company_id
                     AND project_id = v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients
                 WHERE id = v_client_id AND company_id = v_company_id AND project_id = v_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_project_client',
      'message', 'The selected client does not belong to this sale''s project.');
  END IF;
  IF v_agent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.agents
                   WHERE id = v_agent_id AND company_id = v_company_id AND project_id = v_project_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'cross_project_agent',
        'message', 'The selected agent does not belong to this sale''s project.');
    END IF;
  END IF;

  v_net_amount := (v_price_per_sqft * v_area_sqft) - v_discount;
  SELECT COALESCE(SUM((inst->>'amount_due')::NUMERIC), 0) INTO v_scheduled_sum
  FROM jsonb_array_elements(p_installments) AS inst;
  IF ABS(v_scheduled_sum - v_net_amount) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_mismatch',
      'detail', 'Scheduled ' || v_scheduled_sum || ' ≠ net ' || v_net_amount);
  END IF;

  INSERT INTO public.sales (
    company_id, unit_id, client_id, agent_id, project_id,
    price_per_sqft, area_sqft, discount, down_payment,
    installment_count, notes, status, sale_date, created_by, commission_rate
  ) VALUES (
    v_company_id, v_unit_id, v_client_id, v_agent_id, v_project_id,
    v_price_per_sqft, v_area_sqft, v_discount, v_down_payment,
    v_installment_count, v_notes, 'active', v_sale_date, v_created_by, v_commission_rate
  )
  RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    INSERT INTO public.installments (
      company_id, sale_id, project_id, installment_number,
      due_date, amount_due, installment_type, notes
    ) VALUES (
      v_company_id, v_sale_id, v_project_id,
      (v_inst->>'installment_number')::INTEGER,
      NULLIF(v_inst->>'due_date', '')::DATE,
      (v_inst->>'amount_due')::NUMERIC,
      COALESCE(NULLIF(v_inst->>'installment_type',''), 'installment'),
      NULLIF(v_inst->>'notes', '')
    );
  END LOOP;

  SELECT id INTO v_sold_status_id
  FROM public.category_unit_statuses
  WHERE company_id = v_company_id AND project_id = v_project_id
    AND (LOWER(status_code) = 'sold' OR LOWER(status_name) ILIKE '%sold%')
    AND is_active = true
  ORDER BY sort_order LIMIT 1;

  IF v_sold_status_id IS NOT NULL THEN
    UPDATE public.units SET status_id = v_sold_status_id, updated_at = NOW()
    WHERE id = v_unit_id AND company_id = v_company_id;
  END IF;

  IF v_agent_id IS NOT NULL THEN
    IF v_commission_rate IS NULL THEN
      SELECT commission_percent INTO v_commission_rate
      FROM public.agents WHERE id = v_agent_id AND company_id = v_company_id;
    END IF;
    v_commission_amt := COALESCE(v_net_amount * COALESCE(v_commission_rate, 0) / 100, 0);
    UPDATE public.agents SET
      total_sales_count       = COALESCE(total_sales_count, 0) + 1,
      total_sales_amount      = COALESCE(total_sales_amount, 0) + v_net_amount,
      total_commission_earned = COALESCE(total_commission_earned, 0) + v_commission_amt,
      updated_at = NOW()
    WHERE id = v_agent_id AND company_id = v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
