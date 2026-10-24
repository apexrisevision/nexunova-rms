-- 20261024a: the nominee's address.
-- The SAF asked for the nominee's name, relation, CNIC and phone but not the
-- address, and the client record had nowhere to keep one.
--   * clients.next_of_kin_address (new column)
--   * SAF: with a nominee name, the address is required (_saf_problems);
--     it lives in sale_approval_forms.nominee->>'address' (jsonb, saved as is)
--   * _saf_make_sale copies it onto the client (new client, or an existing
--     one when the form has an address)
--   * create_client / _update_client_core save it from the client form

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_of_kin_address text;

CREATE OR REPLACE FUNCTION public._saf_problems(f jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p jsonb := '[]'::jsonb; v_cnic text := public._saf_digits(f->>'buyer_cnic');
BEGIN
  IF NULLIF(btrim(f->>'buyer_name'), '') IS NULL THEN p := p || '"Buyer name is required."'; END IF;
  IF NULLIF(btrim(f->>'buyer_father'), '') IS NULL OR NULLIF(f->>'buyer_relation', '') IS NULL THEN
    p := p || '"Father / husband name (S/O, D/O or W/O) is required."'; END IF;
  IF length(v_cnic) <> 13 THEN p := p || '"CNIC must be 13 digits."'; END IF;
  IF length(public._saf_digits(f->>'buyer_phone')) < 10 THEN p := p || '"Buyer phone is required."'; END IF;
  IF NULLIF(btrim(f->>'buyer_photo_url'), '') IS NULL THEN p := p || '"Add the buyer''s photo."'; END IF;
  IF NULLIF(btrim(f#>>'{nominee,name}'), '') IS NOT NULL AND NULLIF(btrim(f->>'nominee_photo_url'), '') IS NULL THEN
    p := p || '"Add the nominee''s photo, or leave the nominee empty."'; END IF;
  IF NULLIF(btrim(f#>>'{nominee,name}'), '') IS NOT NULL AND NULLIF(btrim(f#>>'{nominee,address}'), '') IS NULL THEN
    p := p || '"Add the nominee''s address, or leave the nominee empty."'; END IF;
  IF NULLIF(f->>'agent_id', '') IS NULL THEN p := p || '"Pick the agent who sold it."'; END IF;
  IF NULLIF(f->>'plan_type', '') IS NULL THEN p := p || '"Pick a payment plan."'; END IF;
  IF abs(COALESCE((f->>'schedule_total')::numeric, 0) - COALESCE((f->>'net_price')::numeric, 0)) > 1 THEN
    p := p || to_jsonb('The schedule adds up to ' || to_char(COALESCE((f->>'schedule_total')::numeric, 0), 'FM999,999,999,990')
                       || ', not the net price ' || to_char(COALESCE((f->>'net_price')::numeric, 0), 'FM999,999,999,990') || '.');
  END IF;
  IF COALESCE((f->>'net_price')::numeric, 0) <= 0 THEN p := p || '"The unit has no price."'; END IF;
  IF COALESCE((f->>'discount_amount')::numeric, 0) > 0 AND NULLIF(btrim(f->>'discount_reason'), '') IS NULL
     AND COALESCE((f->>'discount_beyond_standard')::boolean, false) THEN
    p := p || '"A discount beyond the plan needs a reason."'; END IF;
  IF COALESCE((f->>'commission_pct')::numeric, 0) IS DISTINCT FROM COALESCE((f->>'commission_standard_pct')::numeric, 0)
     AND NULLIF(btrim(f->>'commission_reason'), '') IS NULL THEN
    p := p || '"A commission different from the standard needs a reason."'; END IF;
  IF NULLIF(btrim(f->>'reservation_buyer_name'), '') IS NOT NULL
     AND lower(btrim(f->>'reservation_buyer_name')) <> lower(btrim(COALESCE(f->>'buyer_name', '')))
     AND NULLIF(btrim(f->>'buyer_name_reason'), '') IS NULL THEN
    p := p || '"The buyer is not the name on the hold. Say why."'; END IF;
  RETURN p;
END $function$;

CREATE OR REPLACE FUNCTION public._saf_make_sale(p_id uuid, p_by uuid, p_by_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f public.sale_approval_forms; v_client uuid; v_code text; v_res jsonb; v_inst int;
        v_sale uuid; r jsonb; v_amt numeric; v_paid numeric := 0; v_n int := 0; v_pay jsonb;
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
                                next_of_kin_cnic, next_of_kin_phone, next_of_kin_address, client_photo_url, next_of_kin_photo_url, notes, created_by)
    VALUES (f.company_id, f.project_id, v_code, f.buyer_name, f.buyer_father, f.buyer_cnic, f.buyer_phone,
            f.buyer_address, 'Pakistan', 'active', 'local',
            f.nominee->>'name', f.nominee->>'relation', f.nominee->>'cnic', f.nominee->>'phone',
            NULLIF(btrim(f.nominee->>'address'), ''),
            f.buyer_photo_url, f.nominee_photo_url,
            'From ' || f.saf_no || ' (' || f.buyer_relation || ' ' || f.buyer_father || ')', p_by)
    RETURNING id INTO v_client;
  ELSE
    UPDATE public.clients SET
      client_photo_url      = COALESCE(f.buyer_photo_url, client_photo_url),
      next_of_kin_photo_url = COALESCE(f.nominee_photo_url, next_of_kin_photo_url),
      next_of_kin_address   = COALESCE(NULLIF(btrim(f.nominee->>'address'), ''), next_of_kin_address),
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

  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(f.receipts, '[]'::jsonb)) e ORDER BY e->>'date', e->>'system_no' LOOP
    v_amt := COALESCE((r->>'amount')::numeric, 0);
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
    email, address, city, country, occupation, monthly_income, ntn, company_name, client_category, reference_by, notes, status, created_by,
    client_photo_url, cnic_front_url, cnic_back_url, overseas_local, next_of_kin_name, next_of_kin_relation, next_of_kin_phone,
    next_of_kin_cnic, next_of_kin_address, next_of_kin_photo_url, next_of_kin_cnic_front_url, next_of_kin_cnic_back_url,
    lead_source, bank_name, bank_account_title, bank_account_no, bank_iban
  ) VALUES (
    v_company_id, v_project_id, v_code, p_data->>'full_name', NULLIF(p_data->>'father_name',''), v_cnic, NULLIF(p_data->>'passport_no',''),
    p_data->>'phone_primary', NULLIF(p_data->>'phone_secondary',''), NULLIF(p_data->>'whatsapp',''),
    NULLIF(p_data->>'email',''), NULLIF(p_data->>'address',''), NULLIF(p_data->>'city',''), COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
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
