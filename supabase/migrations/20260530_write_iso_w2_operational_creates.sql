-- ════════════════════════════════════════════════════════════
-- WRITE-ISOLATION W2: admin-OR-assigned-officer guard on 4 operational creates
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- create_client, create_agent, create_unit, upsert_unit:
-- Admin/owner bypass; non-admin must have user_project_assignments
-- for the target project_id (rejected with project_not_assigned else).
-- Body preserved verbatim below the guard prelude.
-- For upsert_unit UPDATE path: project_id is IMMUTABLE on records (§3.1),
-- so gate on the EXISTING row's project_id, not p_data's.

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

COMMENT ON FUNCTION public.create_client(jsonb) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Non-admin must have user_project_assignments
for the target project_id (auth_required / project_id_required / project_not_assigned
gates at top). Member of W2.$$;

COMMENT ON FUNCTION public.create_agent(uuid,uuid,text,text,text,text,text,numeric,text,text,text,date,text,text,uuid) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Same guard pattern as create_client; gates on
positional p_project_id. Member of W2.$$;

COMMENT ON FUNCTION public.create_unit(jsonb) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Same guard pattern as create_client. Member of W2.$$;

COMMENT ON FUNCTION public.upsert_unit(uuid, jsonb, uuid) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Gate applies to both INSERT (gate on
p_data->>'project_id') and UPDATE (gate on existing row's project_id, since
project_id is IMMUTABLE on records per §3.1). Member of W2.$$;
