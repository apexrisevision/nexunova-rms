-- 20261111a: a second address — permanent and current.
-- Rashid, 11-Nov-2026: the Application Form has a Postal and a Residential
-- address, but the system kept one address and printed it twice.
--   * sale_approval_forms.buyer_current_address and clients.current_address (new)
--   * SAF: _saf_inputs / saf_save take it; saf_supersede copies it;
--     _saf_make_sale copies it onto the client (new client, or an existing one
--     when the form has it). The existing address stays the PERMANENT address.
--   * Client form: create_client / _update_client_core save it.
-- Base: the live definitions (pg_get_functiondef).

ALTER TABLE public.sale_approval_forms ADD COLUMN IF NOT EXISTS buyer_current_address text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS current_address text;

CREATE OR REPLACE FUNCTION public._saf_inputs(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(COALESCE(p, '{}'::jsonb)) AS e(k, v)
   WHERE k = ANY (ARRAY['plan_type','discount_amount','discount_reason','discount_approved_by',
                        'installment_count','first_due_date','balloon_amount','balloon_due_date',
                        'schedule_json','sale_date',
                        'buyer_name','buyer_relation','buyer_father','buyer_cnic','buyer_phone','buyer_address','buyer_current_address',
                        'buyer_name_reason','nominee','buyer_photo_url','nominee_photo_url',
                        'agent_id','sub_agent_name','commission_pct','commission_reason']);
$function$;

CREATE OR REPLACE FUNCTION public.saf_save(p_id uuid, p_input jsonb, p_commit boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
        v_in jsonb := public._saf_inputs(p_input); v_f jsonb; v_agent uuid; v_dir uuid; v_dir_name text;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_draft',
      'message', 'Only a draft can be changed. This form is ' || v_row.status || '.'); END IF;

  v_agent := COALESCE(NULLIF(v_in->>'agent_id', '')::uuid, v_row.agent_id);
  IF v_agent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = v_agent
        AND a.company_id = v_row.company_id AND a.project_id = v_row.project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_agent', 'message', 'That agent is not on this project.'); END IF;
  v_dir := COALESCE(NULLIF(v_in->>'discount_approved_by', '')::uuid, v_row.discount_approved_by);
  IF v_dir IS NOT NULL THEN
    SELECT su.full_name INTO v_dir_name FROM public.sales_users su
     WHERE su.id = v_dir AND su.company_id = v_row.company_id AND su.role = 'director';
    IF v_dir_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'bad_director', 'message', 'Discount approved by must be a director.'); END IF;
  END IF;

  v_f := to_jsonb(v_row) || v_in;
  IF v_agent IS DISTINCT FROM v_row.agent_id THEN
    v_f := v_f || jsonb_build_object('commission_standard_pct', public._saf_std_commission(v_row.company_id, v_row.project_id, v_agent));
    IF NOT (v_in ? 'commission_pct') THEN v_f := v_f - 'commission_pct'; END IF;
  END IF;
  IF (v_f->>'plan_type') IS DISTINCT FROM v_row.plan_type AND NOT (v_in ? 'discount_amount') THEN
    v_f := v_f - 'discount_amount';
  END IF;
  v_f := public._saf_compute(v_f);

  IF NOT COALESCE(p_commit, true) THEN
    RETURN jsonb_build_object('success', true, 'preview', true,
      'saf', v_f || jsonb_build_object('flags', public._saf_flags(v_f), 'problems', public._saf_problems(v_f)));
  END IF;

  UPDATE public.sale_approval_forms SET
    plan_type = v_f->>'plan_type', standard_discount_pct = (v_f->>'standard_discount_pct')::numeric,
    discount_amount = (v_f->>'discount_amount')::numeric, discount_pct = (v_f->>'discount_pct')::numeric,
    discount_reason = NULLIF(btrim(v_f->>'discount_reason'), ''),
    discount_approved_by = v_dir, discount_approved_by_name = v_dir_name,
    discount_beyond_standard = (v_f->>'discount_beyond_standard')::boolean,
    net_price = (v_f->>'net_price')::numeric, dp_pct = (v_f->>'dp_pct')::numeric, dp_amount = (v_f->>'dp_amount')::numeric,
    installment_count = (v_f->>'installment_count')::int, installment_amount = (v_f->>'installment_amount')::numeric,
    first_due_date = (v_f->>'first_due_date')::date,
    balloon_amount = (v_f->>'balloon_amount')::numeric, balloon_due_date = (v_f->>'balloon_due_date')::date,
    schedule_json = v_f->'schedule_json', sale_date = (v_f->>'sale_date')::date,
    buyer_name = NULLIF(btrim(v_f->>'buyer_name'), ''), buyer_relation = NULLIF(v_f->>'buyer_relation', ''),
    buyer_father = NULLIF(btrim(v_f->>'buyer_father'), ''), buyer_cnic = NULLIF(btrim(v_f->>'buyer_cnic'), ''),
    buyer_phone = NULLIF(btrim(v_f->>'buyer_phone'), ''), buyer_address = NULLIF(btrim(v_f->>'buyer_address'), ''),
    buyer_current_address = NULLIF(btrim(v_f->>'buyer_current_address'), ''),
    buyer_name_reason = NULLIF(btrim(v_f->>'buyer_name_reason'), ''),
    co_buyer = CASE WHEN jsonb_typeof(v_f->'co_buyer') = 'object' THEN v_f->'co_buyer' END,
    nominee  = CASE WHEN jsonb_typeof(v_f->'nominee')  = 'object' THEN v_f->'nominee'  END,
    buyer_photo_url   = public._saf_photo_ok(v_row.company_id, v_f->>'buyer_photo_url'),
    nominee_photo_url = public._saf_photo_ok(v_row.company_id, v_f->>'nominee_photo_url'),
    dp_balance = (v_f->>'dp_balance')::numeric,
    agent_id = v_agent, agent_name = (SELECT a.full_name FROM public.agents a WHERE a.id = v_agent),
    sub_agent_name = NULLIF(btrim(v_f->>'sub_agent_name'), ''),
    commission_standard_pct = (v_f->>'commission_standard_pct')::numeric,
    commission_pct = (v_f->>'commission_pct')::numeric, commission_amount = (v_f->>'commission_amount')::numeric,
    commission_reason = NULLIF(btrim(v_f->>'commission_reason'), ''),
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $function$;

CREATE OR REPLACE FUNCTION public._saf_make_sale(p_id uuid, p_by uuid, p_by_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f public.sale_approval_forms; v_client uuid; v_code text; v_res jsonb; v_inst int;
        v_sale uuid; r jsonb; v_amt numeric; v_paid numeric := 0; v_n int := 0; v_pay jsonb;
        v_left numeric := 0;
BEGIN
  SELECT * INTO f FROM public.sale_approval_forms WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF f.status <> 'approved' OR f.sale_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_ready',
      'message', 'Only an approved form with no sale yet can be turned into a sale.'); END IF;

  SELECT id INTO v_client FROM public.clients
   WHERE company_id = f.company_id AND project_id = f.project_id
     AND regexp_replace(COALESCE(cnic, ''), '[^0-9]', '', 'g') = public._saf_digits(f.buyer_cnic) LIMIT 1;
  IF v_client IS NULL THEN
    v_code := public.generate_client_code(f.company_id, f.project_id);
    INSERT INTO public.clients (company_id, project_id, client_code, full_name, father_name, cnic, phone_primary,
                                address, country, status, overseas_local, next_of_kin_name, next_of_kin_relation,
                                next_of_kin_cnic, next_of_kin_phone, next_of_kin_address, client_photo_url, next_of_kin_photo_url, notes, created_by, current_address)
    VALUES (f.company_id, f.project_id, v_code, f.buyer_name, f.buyer_father, f.buyer_cnic, f.buyer_phone,
            f.buyer_address, 'Pakistan', 'active', 'local',
            f.nominee->>'name', f.nominee->>'relation', f.nominee->>'cnic', f.nominee->>'phone',
            NULLIF(btrim(f.nominee->>'address'), ''),
            f.buyer_photo_url, f.nominee_photo_url,
            'From ' || f.saf_no || ' (' || f.buyer_relation || ' ' || f.buyer_father || ')', p_by,
            NULLIF(btrim(f.buyer_current_address), ''))
    RETURNING id INTO v_client;
  ELSE
    UPDATE public.clients SET
      client_photo_url      = COALESCE(f.buyer_photo_url, client_photo_url),
      next_of_kin_photo_url = COALESCE(f.nominee_photo_url, next_of_kin_photo_url),
      next_of_kin_address   = COALESCE(NULLIF(btrim(f.nominee->>'address'), ''), next_of_kin_address),
      current_address       = COALESCE(NULLIF(btrim(f.buyer_current_address), ''), current_address),
      updated_at = now()
     WHERE id = v_client;
  END IF;

  SELECT count(*) INTO v_inst FROM jsonb_array_elements(f.schedule_json) e WHERE e->>'installment_type' = 'installment';
  v_res := public._create_sale_with_schedule_core(
    jsonb_build_object(
      'company_id', f.company_id, 'project_id', f.project_id, 'unit_id', f.unit_id, 'client_id', v_client,
      'agent_id', f.agent_id, 'price_per_sqft', f.rate_per_sqft, 'area_sqft', f.area_sqft,
      'discount', f.discount_amount, 'down_payment', f.dp_amount, 'installment_count', v_inst,
      'sale_date', f.sale_date, 'commission_rate', f.commission_pct, 'created_by', p_by,
      'notes', 'Sale Approval Form ' || f.saf_no || CASE WHEN f.approval_route = 'director' THEN ', approved by ' || f.approved_by_name
                 WHEN COALESCE(f.discount_amount, 0) > 0
                   THEN ', discount ' || to_char(f.discount_amount, 'FM999,999,999,990') || ' given, submitted by ' || COALESCE(f.submitted_by_name, '')
                 ELSE ', at the list price' END),
    f.schedule_json);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  v_sale := (v_res->>'sale_id')::uuid;

  -- payments = positive receipts capped at the NET received: a refund line
  -- (negative) cancels the token it refunds instead of being skipped
  SELECT COALESCE(sum(COALESCE((e->>'amount')::numeric, 0)), 0) INTO v_left
    FROM jsonb_array_elements(COALESCE(f.receipts, '[]'::jsonb)) e;
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(f.receipts, '[]'::jsonb)) e ORDER BY e->>'date', e->>'system_no' LOOP
    v_amt := LEAST(COALESCE((r->>'amount')::numeric, 0), v_left);
    CONTINUE WHEN v_amt <= 0;
    v_pay := public._rms_insert_simple_payment(
      f.company_id, v_sale, v_client, f.project_id, v_amt,
      COALESCE(NULLIF(r->>'date', '')::date, f.sale_date),
      CASE r->>'mode' WHEN 'Cash' THEN 'cash' WHEN 'Bank' THEN 'bank_transfer' ELSE 'adjustment' END,
      COALESCE(NULLIF(r->>'voucher_no', ''), r->>'system_no'), NULL,
      'NexuFinance ' || COALESCE(NULLIF(r->>'system_no', ''), r->>'voucher_no', '') || ', received before the sale (' || f.saf_no || ')',
      p_by::text, NULL, NULL, NULL);
    IF NOT COALESCE((v_pay->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Could not record receipt %: %', r->>'voucher_no', v_pay; END IF;
    v_paid := v_paid + v_amt; v_n := v_n + 1;
    v_left := v_left - v_amt;
  END LOOP;

  IF f.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET status = 'converted', converted_sale_id = v_sale, updated_at = now()
     WHERE id = f.reservation_id AND status = 'active';
  END IF;
  UPDATE public.sale_approval_forms SET
    filed_by = COALESCE(filed_by, p_by), filed_by_name = COALESCE(filed_by_name, p_by_name),
    filed_at = COALESCE(filed_at, now()), updated_at = now()
   WHERE id = p_id;
  RETURN v_res || jsonb_build_object('saf_no', f.saf_no, 'payments', v_n, 'received', v_paid);
END $function$;

CREATE OR REPLACE FUNCTION public.saf_supersede(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public._saf_me(); v_old public.sale_approval_forms;
        v_no int; v_id uuid; v_blk jsonb; v_m jsonb; v_f jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_old FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_old.status NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_supersedable',
      'message', 'Only an approved or rejected form can be redone.'); END IF;
  IF v_old.sale_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_exists',
      'message', 'The sale has already been made from this form. Change the sale, not the form.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sale_approval_forms WHERE unit_id = v_old.unit_id AND status IN ('draft','submitted','verified')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'open_form_exists',
      'message', 'This unit already has a form in progress.'); END IF;

  v_blk := public._saf_unit_block(v_old.unit_id);
  v_m   := public._saf_money(v_old.company_id, v_blk->>'unit_code');
  v_f := public._saf_compute(to_jsonb(v_old) || v_blk || jsonb_build_object('total_received', v_m->'total'));

  INSERT INTO public.saf_counters (company_id, last_no) VALUES (v_old.company_id, 1)
  ON CONFLICT (company_id) DO UPDATE SET last_no = public.saf_counters.last_no + 1
  RETURNING last_no INTO v_no;

  INSERT INTO public.sale_approval_forms (
    company_id, project_id, unit_id, reservation_id, saf_no, status, supersedes_id,
    unit_code, floor_label, block, area_sqft, rate_per_sqft, base_price,
    plan_type, standard_discount_pct, discount_amount, discount_pct, discount_reason,
    discount_approved_by, discount_approved_by_name, discount_beyond_standard,
    net_price, dp_pct, dp_amount, installment_count, installment_amount, first_due_date,
    balloon_amount, balloon_due_date, schedule_json, sale_date,
    buyer_name, buyer_relation, buyer_father, buyer_cnic, buyer_phone, buyer_address, buyer_current_address,
    reservation_buyer_name, buyer_name_reason, co_buyer, nominee,
    token_numbers, receipts, total_received, dp_balance, money_as_of,
    agent_id, agent_name, sub_agent_name, commission_standard_pct, commission_pct, commission_reason, commission_amount,
    prepared_by, prepared_by_name, prepared_at)
  VALUES (
    v_old.company_id, v_old.project_id, v_old.unit_id,
    (SELECT r.id FROM public.reservations r WHERE r.unit_id = v_old.unit_id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1),
    'SAF-' || lpad(v_no::text, 4, '0'), 'draft', v_old.id,
    v_blk->>'unit_code', v_blk->>'floor_label', v_blk->>'block', (v_blk->>'area_sqft')::numeric,
    (v_blk->>'rate_per_sqft')::numeric, (v_blk->>'base_price')::numeric,
    v_f->>'plan_type', (v_f->>'standard_discount_pct')::numeric, (v_f->>'discount_amount')::numeric,
    (v_f->>'discount_pct')::numeric, v_old.discount_reason, v_old.discount_approved_by, v_old.discount_approved_by_name,
    (v_f->>'discount_beyond_standard')::boolean,
    (v_f->>'net_price')::numeric, (v_f->>'dp_pct')::numeric, (v_f->>'dp_amount')::numeric,
    (v_f->>'installment_count')::int, (v_f->>'installment_amount')::numeric, (v_f->>'first_due_date')::date,
    (v_f->>'balloon_amount')::numeric, (v_f->>'balloon_due_date')::date, v_f->'schedule_json', (v_f->>'sale_date')::date,
    v_old.buyer_name, v_old.buyer_relation, v_old.buyer_father, v_old.buyer_cnic, v_old.buyer_phone, v_old.buyer_address, v_old.buyer_current_address,
    v_old.reservation_buyer_name, v_old.buyer_name_reason, v_old.co_buyer, v_old.nominee,
    v_m->>'token_numbers', v_m->'receipts', (v_m->>'total')::numeric, (v_f->>'dp_balance')::numeric, now(),
    v_old.agent_id, v_old.agent_name, v_old.sub_agent_name, v_old.commission_standard_pct,
    (v_f->>'commission_pct')::numeric, v_old.commission_reason, (v_f->>'commission_amount')::numeric,
    (c->>'user_id')::uuid, c->>'name', now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(v_id));
END $function$;

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
  v_code       TEXT; v_id UUID; v_existing UUID; v_can_add boolean;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.'); END IF;
  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required', 'message', 'A project must be selected for this client.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND company_id = v_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company', 'message', 'The selected project does not belong to your company.'); END IF;
  SELECT (check_plan_limit(v_company_id, 'clients')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit', 'message', 'Client limit reached for your plan. Please upgrade.'); END IF;
  IF v_cnic IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.clients WHERE company_id = v_company_id AND project_id = v_project_id AND cnic = v_cnic LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered', 'duplicate_id', v_existing::TEXT, 'duplicate_field', 'cnic'); END IF;
  END IF;
  v_code := public.generate_client_code(v_company_id, v_project_id);
  INSERT INTO public.clients (
    company_id, project_id, client_code, full_name, father_name, cnic, passport_no, phone_primary, phone_secondary, whatsapp,
    email, address, current_address, city, country, occupation, monthly_income, ntn, company_name, client_category, reference_by, notes, status, created_by,
    client_photo_url, cnic_front_url, cnic_back_url, overseas_local, next_of_kin_name, next_of_kin_relation, next_of_kin_phone,
    next_of_kin_cnic, next_of_kin_address, next_of_kin_photo_url, next_of_kin_cnic_front_url, next_of_kin_cnic_back_url,
    lead_source, bank_name, bank_account_title, bank_account_no, bank_iban
  ) VALUES (
    v_company_id, v_project_id, v_code, p_data->>'full_name', NULLIF(p_data->>'father_name',''), v_cnic, NULLIF(p_data->>'passport_no',''),
    p_data->>'phone_primary', NULLIF(p_data->>'phone_secondary',''), NULLIF(p_data->>'whatsapp',''),
    NULLIF(p_data->>'email',''), NULLIF(p_data->>'address',''), NULLIF(p_data->>'current_address',''), NULLIF(p_data->>'city',''), COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
    NULLIF(p_data->>'occupation',''), NULLIF(p_data->>'monthly_income','')::numeric, NULLIF(p_data->>'ntn',''),
    NULLIF(p_data->>'company_name',''), NULLIF(p_data->>'client_category',''), NULLIF(p_data->>'reference_by',''),
    NULLIF(p_data->>'notes',''), COALESCE(NULLIF(p_data->>'status',''),'active'), NULLIF(p_data->>'created_by','')::UUID,
    NULLIF(p_data->>'client_photo_url',''), NULLIF(p_data->>'cnic_front_url',''), NULLIF(p_data->>'cnic_back_url',''),
    COALESCE(NULLIF(p_data->>'overseas_local',''),'local'), NULLIF(p_data->>'next_of_kin_name',''), NULLIF(p_data->>'next_of_kin_relation',''),
    NULLIF(p_data->>'next_of_kin_phone',''), NULLIF(p_data->>'next_of_kin_cnic',''), NULLIF(p_data->>'next_of_kin_address',''),
    NULLIF(p_data->>'next_of_kin_photo_url',''),
    NULLIF(p_data->>'next_of_kin_cnic_front_url',''), NULLIF(p_data->>'next_of_kin_cnic_back_url',''),
    NULLIF(p_data->>'lead_source',''), NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'bank_account_title',''),
    NULLIF(p_data->>'bank_account_no',''), NULLIF(p_data->>'bank_iban','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public._update_client_core(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER; v_cnic TEXT := NULLIF(TRIM(p_data->>'cnic'), ''); v_dup UUID; v_proj UUID;
BEGIN
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  IF (p_data ? 'project_id') AND (p_data->>'project_id') IS NOT NULL AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable', 'message', 'A client cannot be moved to another project. Create a new client instead.'); END IF;
  IF v_cnic IS NOT NULL AND (p_data ? 'cnic') THEN
    SELECT id INTO v_dup FROM public.clients WHERE company_id = p_company_id AND project_id = v_proj AND cnic = v_cnic AND id <> p_id LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered to another client', 'duplicate_id', v_dup::TEXT, 'duplicate_field', 'cnic'); END IF;
  END IF;
  UPDATE public.clients SET
    full_name            = CASE WHEN p_data ? 'full_name'            THEN COALESCE(NULLIF(p_data->>'full_name',''), full_name)          ELSE full_name            END,
    father_name          = CASE WHEN p_data ? 'father_name'          THEN NULLIF(p_data->>'father_name','')                             ELSE father_name          END,
    cnic                 = CASE WHEN p_data ? 'cnic'                 THEN v_cnic                                                        ELSE cnic                 END,
    passport_no          = CASE WHEN p_data ? 'passport_no'          THEN NULLIF(p_data->>'passport_no','')                             ELSE passport_no          END,
    phone_primary        = CASE WHEN p_data ? 'phone_primary'        THEN COALESCE(NULLIF(p_data->>'phone_primary',''), phone_primary)  ELSE phone_primary        END,
    phone_secondary      = CASE WHEN p_data ? 'phone_secondary'      THEN NULLIF(p_data->>'phone_secondary','')                         ELSE phone_secondary      END,
    whatsapp             = CASE WHEN p_data ? 'whatsapp'             THEN NULLIF(p_data->>'whatsapp','')                                ELSE whatsapp             END,
    email                = CASE WHEN p_data ? 'email'                THEN NULLIF(p_data->>'email','')                                   ELSE email                END,
    address              = CASE WHEN p_data ? 'address'              THEN NULLIF(p_data->>'address','')                                 ELSE address              END,
    current_address      = CASE WHEN p_data ? 'current_address'      THEN NULLIF(p_data->>'current_address','')                         ELSE current_address      END,
    city                 = CASE WHEN p_data ? 'city'                 THEN NULLIF(p_data->>'city','')                                    ELSE city                 END,
    country              = CASE WHEN p_data ? 'country'              THEN COALESCE(NULLIF(p_data->>'country',''),'Pakistan')            ELSE country              END,
    occupation           = CASE WHEN p_data ? 'occupation'           THEN NULLIF(p_data->>'occupation','')                              ELSE occupation           END,
    monthly_income       = CASE WHEN p_data ? 'monthly_income'       THEN NULLIF(p_data->>'monthly_income','')::numeric                 ELSE monthly_income       END,
    ntn                  = CASE WHEN p_data ? 'ntn'                  THEN NULLIF(p_data->>'ntn','')                                     ELSE ntn                  END,
    company_name         = CASE WHEN p_data ? 'company_name'         THEN NULLIF(p_data->>'company_name','')                            ELSE company_name         END,
    client_category      = CASE WHEN p_data ? 'client_category'      THEN NULLIF(p_data->>'client_category','')                         ELSE client_category      END,
    reference_by         = CASE WHEN p_data ? 'reference_by'         THEN NULLIF(p_data->>'reference_by','')                            ELSE reference_by         END,
    notes                = CASE WHEN p_data ? 'notes'                THEN NULLIF(p_data->>'notes','')                                   ELSE notes                END,
    status               = CASE WHEN p_data ? 'status'               THEN COALESCE(NULLIF(p_data->>'status',''), 'active')             ELSE status               END,
    client_photo_url     = CASE WHEN p_data ? 'client_photo_url'     THEN NULLIF(p_data->>'client_photo_url','')                        ELSE client_photo_url     END,
    cnic_front_url       = CASE WHEN p_data ? 'cnic_front_url'       THEN NULLIF(p_data->>'cnic_front_url','')                          ELSE cnic_front_url       END,
    cnic_back_url        = CASE WHEN p_data ? 'cnic_back_url'        THEN NULLIF(p_data->>'cnic_back_url','')                           ELSE cnic_back_url        END,
    overseas_local       = CASE WHEN p_data ? 'overseas_local'       THEN COALESCE(NULLIF(p_data->>'overseas_local',''), 'local')       ELSE overseas_local       END,
    next_of_kin_name     = CASE WHEN p_data ? 'next_of_kin_name'     THEN NULLIF(p_data->>'next_of_kin_name','')                        ELSE next_of_kin_name     END,
    next_of_kin_relation = CASE WHEN p_data ? 'next_of_kin_relation' THEN NULLIF(p_data->>'next_of_kin_relation','')                    ELSE next_of_kin_relation END,
    next_of_kin_phone    = CASE WHEN p_data ? 'next_of_kin_phone'    THEN NULLIF(p_data->>'next_of_kin_phone','')                       ELSE next_of_kin_phone    END,
    next_of_kin_cnic      = CASE WHEN p_data ? 'next_of_kin_cnic'      THEN NULLIF(p_data->>'next_of_kin_cnic','')      ELSE next_of_kin_cnic      END,
    next_of_kin_address   = CASE WHEN p_data ? 'next_of_kin_address'   THEN NULLIF(p_data->>'next_of_kin_address','')   ELSE next_of_kin_address   END,
    next_of_kin_photo_url = CASE WHEN p_data ? 'next_of_kin_photo_url' THEN NULLIF(p_data->>'next_of_kin_photo_url','') ELSE next_of_kin_photo_url END,
    next_of_kin_cnic_front_url = CASE WHEN p_data ? 'next_of_kin_cnic_front_url' THEN NULLIF(p_data->>'next_of_kin_cnic_front_url','') ELSE next_of_kin_cnic_front_url END,
    next_of_kin_cnic_back_url  = CASE WHEN p_data ? 'next_of_kin_cnic_back_url'  THEN NULLIF(p_data->>'next_of_kin_cnic_back_url','')  ELSE next_of_kin_cnic_back_url  END,
    lead_source          = CASE WHEN p_data ? 'lead_source'          THEN NULLIF(p_data->>'lead_source','')                             ELSE lead_source          END,
    bank_name            = CASE WHEN p_data ? 'bank_name'            THEN NULLIF(p_data->>'bank_name','')                               ELSE bank_name            END,
    bank_account_title   = CASE WHEN p_data ? 'bank_account_title'   THEN NULLIF(p_data->>'bank_account_title','')                      ELSE bank_account_title   END,
    bank_account_no      = CASE WHEN p_data ? 'bank_account_no'      THEN NULLIF(p_data->>'bank_account_no','')                         ELSE bank_account_no      END,
    bank_iban            = CASE WHEN p_data ? 'bank_iban'            THEN NULLIF(p_data->>'bank_iban','')                               ELSE bank_iban            END,
    updated_at           = now()
  WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found or access denied'); END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
