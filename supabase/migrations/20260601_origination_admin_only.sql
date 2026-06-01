-- Separation of duties: make account/inventory origination ADMIN/OWNER-only.
-- Non-admin callers (recovery / finance / manager) are rejected with:
--   {success:false, error:'forbidden', message:'Account creation is admin-only.'}
-- Admin / owner / super-admin continue to work unchanged.
--
-- Surgical change only:
--  - create_client / create_unit / create_sale_with_schedule: the existing
--    `IF NOT _rms_is_admin(v_me) THEN <require project assignment>` branch is
--    replaced by a hard `forbidden` return (removes the non-admin-allowed path).
--  - bulk_create_units: had NO guard at all → full guard added at the top
--    (resolve caller → auth_required → wrong_tenant → admin-only) before the
--    plan-limit logic.
--  - search_path=public added to all four (create_sale already had it).
-- Everything else (inserts, plan-limit checks, return shapes, cross-project
-- checks, commission/agent rollups) is byte-for-byte unchanged.
--
-- NOTE: create_client is also called by the new-buyer unit-transfer flow
-- (transfers.js _txSubmit). After this change, a new-buyer transfer initiated
-- by a non-admin will fail at the create_client step — intended under strict
-- separation of duties; revisit if non-admins must run transfers.

-- ── 1. create_client ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_client(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
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

-- ── 2. create_unit ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_unit(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
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

-- ── 3. bulk_create_units (full guard ADDED at top; was previously ungated) ─────
CREATE OR REPLACE FUNCTION public.bulk_create_units(p_company_id uuid, p_project_id uuid, p_units jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit         JSONB;
  v_code         TEXT;
  v_inserted     INTEGER := 0;
  v_error_count  INTEGER := 0;
  v_errors       TEXT[]  := ARRAY[]::TEXT[];
  v_idx          INTEGER := 0;
  v_limit_info   JSONB;
  v_max          INTEGER;
  v_current      INTEGER;
  v_requested    INTEGER;
  v_me           public.app_users := public._rms_caller();
BEGIN
  -- Admin-only guard (added 2026-06-01): this RPC previously had no auth/role check.
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;

  -- Plan limit check before touching any rows
  v_requested  := jsonb_array_length(p_units);
  v_limit_info := public.check_plan_limit(p_company_id, 'units');
  v_max        := (v_limit_info->>'max_allowed')::INTEGER;
  v_current    := (v_limit_info->>'current_count')::INTEGER;

  IF v_max > 0 AND (v_current + v_requested) > v_max THEN
    RETURN jsonb_build_object(
      'success',       false,
      'error',         'plan_limit',
      'inserted',      0,
      'errors',        1,
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
        company_id, project_id, unit_no, unit_code,
        unit_type_id, status_id,
        floor_no, floor_label, block,
        area, area_unit, bedrooms, bathrooms, parking_count,
        base_price, features, notes, created_by
      ) VALUES (
        p_company_id,
        p_project_id,
        v_unit->>'unit_no',
        v_code,
        NULLIF(v_unit->>'unit_type_id', '')::UUID,
        NULLIF(v_unit->>'status_id',    '')::UUID,
        NULLIF(v_unit->>'floor_no',     '')::INTEGER,
        NULLIF(v_unit->>'floor_label',  ''),
        NULLIF(v_unit->>'block',        ''),
        NULLIF(v_unit->>'area',         '')::NUMERIC,
        COALESCE(NULLIF(v_unit->>'area_unit', ''), 'sqft'),
        NULLIF(v_unit->>'bedrooms',     '')::INTEGER,
        NULLIF(v_unit->>'bathrooms',    '')::INTEGER,
        COALESCE(NULLIF(v_unit->>'parking_count', '')::INTEGER, 0),
        COALESCE(NULLIF(v_unit->>'base_price', '')::NUMERIC, 0),
        '{}'::JSONB,
        NULLIF(v_unit->>'notes',        ''),
        NULLIF(v_unit->>'created_by',   '')::UUID
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || ('Row ' || v_idx || ' (' || COALESCE(v_unit->>'unit_no','?') || '): ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',       v_error_count = 0,
    'inserted',      v_inserted,
    'errors',        v_error_count,
    'error_details', to_jsonb(v_errors)
  );
END;
$function$;

-- ── 4. create_sale_with_schedule ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sale_with_schedule(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
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
