-- KBH Application Form support: 3 optional client fields for the booking form.
-- occupation already exists; add monthly_income + ntn. Additive, reversible.
-- get_client_by_id returns to_jsonb(clients) so the new columns surface with no RPC change.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS monthly_income numeric NULL,
  ADD COLUMN IF NOT EXISTS ntn            text    NULL;

-- create_client: persist the new fields (occupation already handled)
CREATE OR REPLACE FUNCTION public.create_client(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    next_of_kin_cnic, next_of_kin_photo_url, lead_source, bank_name, bank_account_title, bank_account_no, bank_iban
  ) VALUES (
    v_company_id, v_project_id, v_code, p_data->>'full_name', NULLIF(p_data->>'father_name',''), v_cnic, NULLIF(p_data->>'passport_no',''),
    p_data->>'phone_primary', NULLIF(p_data->>'phone_secondary',''), NULLIF(p_data->>'whatsapp',''),
    NULLIF(p_data->>'email',''), NULLIF(p_data->>'address',''), NULLIF(p_data->>'city',''), COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
    NULLIF(p_data->>'occupation',''), NULLIF(p_data->>'monthly_income','')::numeric, NULLIF(p_data->>'ntn',''),
    NULLIF(p_data->>'company_name',''), NULLIF(p_data->>'client_category',''), NULLIF(p_data->>'reference_by',''),
    NULLIF(p_data->>'notes',''), COALESCE(NULLIF(p_data->>'status',''),'active'), NULLIF(p_data->>'created_by','')::UUID,
    NULLIF(p_data->>'client_photo_url',''), NULLIF(p_data->>'cnic_front_url',''), NULLIF(p_data->>'cnic_back_url',''),
    COALESCE(NULLIF(p_data->>'overseas_local',''),'local'), NULLIF(p_data->>'next_of_kin_name',''), NULLIF(p_data->>'next_of_kin_relation',''),
    NULLIF(p_data->>'next_of_kin_phone',''), NULLIF(p_data->>'next_of_kin_cnic',''), NULLIF(p_data->>'next_of_kin_photo_url',''),
    NULLIF(p_data->>'lead_source',''), NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'bank_account_title',''),
    NULLIF(p_data->>'bank_account_no',''), NULLIF(p_data->>'bank_iban','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- _update_client_core: presence-gated monthly_income + ntn (occupation already handled)
CREATE OR REPLACE FUNCTION public._update_client_core(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    next_of_kin_photo_url = CASE WHEN p_data ? 'next_of_kin_photo_url' THEN NULLIF(p_data->>'next_of_kin_photo_url','') ELSE next_of_kin_photo_url END,
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