-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 5: client writers
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- create_client now REQUIRES project_id (rejects if missing), stores it, uses the
-- 2-arg generate_client_code(company, project), and scopes the CNIC duplicate
-- check to (company, project) — so the same CNIC can exist once per project.
-- update_client treats project_id as IMMUTABLE: it never writes project_id, and
-- rejects an update that passes a *different* project_id (move = new record).
-- Its CNIC dedup is also scoped to the client's own project.

CREATE OR REPLACE FUNCTION public.create_client(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID := (p_data->>'company_id')::UUID;
  v_project_id UUID := (p_data->>'project_id')::UUID;
  v_cnic       TEXT := NULLIF(TRIM(p_data->>'cnic'), '');
  v_code       TEXT;
  v_id         UUID;
  v_existing   UUID;
  v_can_add    boolean;
BEGIN
  -- Project is mandatory (every client belongs to exactly one project)
  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this client.');
  END IF;

  -- Plan limit check (company-level)
  SELECT (check_plan_limit(v_company_id, 'clients')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Client limit reached for your plan. Please upgrade.');
  END IF;

  -- CNIC duplicate check scoped to the project
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
    NULLIF(p_data->>'father_name',      ''),
    v_cnic,
    NULLIF(p_data->>'passport_no',      ''),
    p_data->>'phone_primary',
    NULLIF(p_data->>'phone_secondary',  ''),
    NULLIF(p_data->>'whatsapp',         ''),
    NULLIF(p_data->>'email',            ''),
    NULLIF(p_data->>'address',          ''),
    NULLIF(p_data->>'city',             ''),
    COALESCE(NULLIF(p_data->>'country', ''), 'Pakistan'),
    NULLIF(p_data->>'occupation',       ''),
    NULLIF(p_data->>'company_name',     ''),
    NULLIF(p_data->>'client_category',  ''),
    NULLIF(p_data->>'reference_by',     ''),
    NULLIF(p_data->>'notes',            ''),
    COALESCE(NULLIF(p_data->>'status',  ''), 'active'),
    NULLIF(p_data->>'created_by',       '')::UUID,
    NULLIF(p_data->>'client_photo_url',    ''),
    NULLIF(p_data->>'cnic_front_url',      ''),
    NULLIF(p_data->>'cnic_back_url',       ''),
    COALESCE(NULLIF(p_data->>'overseas_local',''), 'local'),
    NULLIF(p_data->>'next_of_kin_name',    ''),
    NULLIF(p_data->>'next_of_kin_relation',''),
    NULLIF(p_data->>'next_of_kin_phone',   ''),
    NULLIF(p_data->>'lead_source',         ''),
    NULLIF(p_data->>'bank_name',           ''),
    NULLIF(p_data->>'bank_account_title',  ''),
    NULLIF(p_data->>'bank_account_no',     ''),
    NULLIF(p_data->>'bank_iban',           '')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_client(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows  INTEGER;
  v_cnic  TEXT := NULLIF(TRIM(p_data->>'cnic'), '');
  v_dup   UUID;
  v_proj  UUID;
BEGIN
  -- Resolve the client's (immutable) project once
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_id AND company_id = p_company_id;

  -- project_id is IMMUTABLE: reject an attempt to change it (move = new record)
  IF (p_data ? 'project_id')
     AND (p_data->>'project_id') IS NOT NULL
     AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'A client cannot be moved to another project. Create a new client instead.');
  END IF;

  -- CNIC duplicate check scoped to the client's own project
  IF v_cnic IS NOT NULL AND (p_data ? 'cnic') THEN
    SELECT id INTO v_dup FROM public.clients
    WHERE company_id = p_company_id AND project_id = v_proj AND cnic = v_cnic AND id <> p_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered to another client',
        'duplicate_id', v_dup::TEXT, 'duplicate_field', 'cnic');
    END IF;
  END IF;

  -- project_id intentionally NOT in the SET list (immutable)
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
    occupation           = CASE WHEN p_data ? 'occupation'           THEN NULLIF(p_data->>'occupation','')                             ELSE occupation           END,
    company_name         = CASE WHEN p_data ? 'company_name'         THEN NULLIF(p_data->>'company_name','')                           ELSE company_name         END,
    client_category      = CASE WHEN p_data ? 'client_category'      THEN NULLIF(p_data->>'client_category','')                        ELSE client_category      END,
    reference_by         = CASE WHEN p_data ? 'reference_by'         THEN NULLIF(p_data->>'reference_by','')                           ELSE reference_by         END,
    notes                = CASE WHEN p_data ? 'notes'                THEN NULLIF(p_data->>'notes','')                                   ELSE notes                END,
    status               = CASE WHEN p_data ? 'status'               THEN COALESCE(NULLIF(p_data->>'status',''), 'active')             ELSE status               END,
    client_photo_url     = CASE WHEN p_data ? 'client_photo_url'     THEN NULLIF(p_data->>'client_photo_url','')                       ELSE client_photo_url     END,
    cnic_front_url       = CASE WHEN p_data ? 'cnic_front_url'       THEN NULLIF(p_data->>'cnic_front_url','')                         ELSE cnic_front_url       END,
    cnic_back_url        = CASE WHEN p_data ? 'cnic_back_url'        THEN NULLIF(p_data->>'cnic_back_url','')                          ELSE cnic_back_url        END,
    overseas_local       = CASE WHEN p_data ? 'overseas_local'       THEN COALESCE(NULLIF(p_data->>'overseas_local',''), 'local')      ELSE overseas_local       END,
    next_of_kin_name     = CASE WHEN p_data ? 'next_of_kin_name'     THEN NULLIF(p_data->>'next_of_kin_name','')                       ELSE next_of_kin_name     END,
    next_of_kin_relation = CASE WHEN p_data ? 'next_of_kin_relation' THEN NULLIF(p_data->>'next_of_kin_relation','')                   ELSE next_of_kin_relation END,
    next_of_kin_phone    = CASE WHEN p_data ? 'next_of_kin_phone'    THEN NULLIF(p_data->>'next_of_kin_phone','')                      ELSE next_of_kin_phone    END,
    lead_source          = CASE WHEN p_data ? 'lead_source'          THEN NULLIF(p_data->>'lead_source','')                            ELSE lead_source          END,
    bank_name            = CASE WHEN p_data ? 'bank_name'            THEN NULLIF(p_data->>'bank_name','')                              ELSE bank_name            END,
    bank_account_title   = CASE WHEN p_data ? 'bank_account_title'   THEN NULLIF(p_data->>'bank_account_title','')                    ELSE bank_account_title   END,
    bank_account_no      = CASE WHEN p_data ? 'bank_account_no'      THEN NULLIF(p_data->>'bank_account_no','')                       ELSE bank_account_no      END,
    bank_iban            = CASE WHEN p_data ? 'bank_iban'            THEN NULLIF(p_data->>'bank_iban','')                              ELSE bank_iban            END,
    updated_at           = now()
  WHERE id = p_id AND company_id = p_company_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Client not found or access denied');
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
