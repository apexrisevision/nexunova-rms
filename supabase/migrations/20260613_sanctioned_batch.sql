-- ════════════════════════════════════════════════════════════════════════════
-- SANCTIONED MIGRATION BATCH (2026-06-13) — five registered schema gaps + wiring.
-- Additive columns only; the sole data write is the floors.floor_code backfill
-- (preview reviewed before apply). RLS untouched (new columns inherit table
-- policies). Caller guards on the touched RPCs are preserved verbatim.
--   #16  category_unit_types.default_area / default_price   (per-type defaults)
--   --   floors.floor_code                                  ({floor} naming)
--   #18  pdc_cheques.replaced_by_id                         (replace linkage)
--   #19  clients.next_of_kin_cnic                           (nominee CNIC)
--   #20  clients.next_of_kin_photo_url                      (nominee photo)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. COLUMNS (additive) ───────────────────────────────────────────────────
ALTER TABLE public.category_unit_types
  ADD COLUMN IF NOT EXISTS default_area  numeric,
  ADD COLUMN IF NOT EXISTS default_price numeric;

ALTER TABLE public.floors
  ADD COLUMN IF NOT EXISTS floor_code text;

ALTER TABLE public.pdc_cheques
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid REFERENCES public.pdc_cheques(id);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS next_of_kin_cnic      text,
  ADD COLUMN IF NOT EXISTS next_of_kin_photo_url text;

-- ── 2. floor_code BACKFILL (derive from name; only fills NULLs) ─────────────
-- NOTE: POSIX regex — \M is the end-of-word boundary; \b is NOT a word boundary
-- in Postgres. Priority order matters (Upper/Lower Ground before Ground).
UPDATE public.floors SET floor_code = CASE
  WHEN name ~* 'upper ground' OR name ~* '^ug'                THEN 'UG'
  WHEN name ~* 'lower ground' OR name ~* '^lg'                THEN 'LG'
  WHEN name ~* '^ground' OR name ~* '^gf' OR name ~* '^g\M'   THEN 'G'
  WHEN name ~* 'mezzanine'                                    THEN 'M'
  WHEN name ~* 'basement'   THEN 'B' || coalesce((regexp_match(name,'(\d+)'))[1],'')
  WHEN name ~* 'penthouse'                                    THEN 'PH'
  WHEN name ~* 'roof|terrace'                                 THEN 'R'
  WHEN (regexp_match(name,'(\d+)'))[1] IS NOT NULL            THEN (regexp_match(name,'(\d+)'))[1]
  ELSE NULL
END
WHERE floor_code IS NULL;

-- ── 3. RPC EXTENSIONS (minimal deltas; bodies otherwise verbatim) ───────────

-- 3a. upsert_unit_type — persist per-type default_area / default_price (#16)
CREATE OR REPLACE FUNCTION public.upsert_unit_type(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    INSERT INTO public.category_unit_types (company_id, project_id, type_code, type_name, description, sort_order, is_active, default_area, default_price)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'type_code', p_data->>'type_name', NULLIF(p_data->>'description',''),
            COALESCE((p_data->>'sort_order')::int, 0), COALESCE((p_data->>'is_active')::bool, true),
            NULLIF(p_data->>'default_area','')::numeric, NULLIF(p_data->>'default_price','')::numeric)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.category_unit_types SET
      type_code = COALESCE(p_data->>'type_code', type_code),
      type_name = COALESCE(p_data->>'type_name', type_name),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      default_area  = COALESCE(NULLIF(p_data->>'default_area','')::numeric,  default_area),
      default_price = COALESCE(NULLIF(p_data->>'default_price','')::numeric, default_price),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- 3b. upsert_floor — persist floor_code
CREATE OR REPLACE FUNCTION public.upsert_floor(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    INSERT INTO public.floors (company_id, name, sort_order, is_active, floor_code)
    VALUES (p_company_id, p_data->>'name', COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), NULLIF(p_data->>'floor_code','')) RETURNING id INTO v_id;
  ELSE
    UPDATE public.floors SET
      name = COALESCE(p_data->>'name', name),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      floor_code = COALESCE(p_data->>'floor_code', floor_code)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- 3c. create_client — accept nominee CNIC + photo (#19/#20)
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
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this client.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND company_id = v_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company',
      'message', 'The selected project does not belong to your company.');
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
    next_of_kin_cnic, next_of_kin_photo_url,
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
    NULLIF(p_data->>'next_of_kin_phone',''),
    NULLIF(p_data->>'next_of_kin_cnic',''), NULLIF(p_data->>'next_of_kin_photo_url',''),
    NULLIF(p_data->>'lead_source',''),
    NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'bank_account_title',''),
    NULLIF(p_data->>'bank_account_no',''), NULLIF(p_data->>'bank_iban','')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 3d. _update_client_core — accept nominee CNIC + photo on edit (#19/#20)
CREATE OR REPLACE FUNCTION public._update_client_core(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER; v_cnic TEXT := NULLIF(TRIM(p_data->>'cnic'), ''); v_dup UUID; v_proj UUID;
BEGIN
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  IF (p_data ? 'project_id') AND (p_data->>'project_id') IS NOT NULL
     AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'A client cannot be moved to another project. Create a new client instead.'); END IF;
  IF v_cnic IS NOT NULL AND (p_data ? 'cnic') THEN
    SELECT id INTO v_dup FROM public.clients
    WHERE company_id = p_company_id AND project_id = v_proj AND cnic = v_cnic AND id <> p_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered to another client',
        'duplicate_id', v_dup::TEXT, 'duplicate_field', 'cnic'); END IF;
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

-- 3e. update_pdc_cheque — allow setting replaced_by_id (#18)
CREATE OR REPLACE FUNCTION public.update_pdc_cheque(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller(); v_project uuid;
  v_allowed text[] := ARRAY['cheque_no','bank_name','amount','cheque_date','received_date','status','notes',
    'bounce_reason','bounce_date','penalty_amount','penalty_collected','penalty_date','penalty_notes',
    'deposit_date','clearance_date','sale_id','client_id','replaced_by_id'];
  v_setters text := ''; v_key text; v_sql text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM pdc_cheques WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','pdc_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_data) LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters || format('%I = NULLIF($1->>%L, %L)::%s, ', v_key, v_key, '',
        CASE v_key WHEN 'amount' THEN 'numeric' WHEN 'penalty_amount' THEN 'numeric'
          WHEN 'cheque_date' THEN 'date' WHEN 'received_date' THEN 'date' WHEN 'bounce_date' THEN 'date'
          WHEN 'penalty_date' THEN 'date' WHEN 'deposit_date' THEN 'date' WHEN 'clearance_date' THEN 'date'
          WHEN 'sale_id' THEN 'uuid' WHEN 'client_id' THEN 'uuid' WHEN 'replaced_by_id' THEN 'uuid'
          WHEN 'penalty_collected' THEN 'boolean' ELSE 'text' END);
    END IF;
  END LOOP;
  IF v_setters = '' THEN RETURN jsonb_build_object('success', true, 'updated', 0); END IF;
  v_setters := v_setters || 'updated_at = now()';
  v_sql := format('UPDATE pdc_cheques SET %s WHERE id = %L AND company_id = %L', v_setters, p_id, p_company_id);
  EXECUTE v_sql USING p_data;
  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- 3f. get_pdc_register — expose replaced_by_id so the UI can render the link (#18)
CREATE OR REPLACE FUNCTION public.get_pdc_register(p_company_id uuid, p_status text DEFAULT 'All'::text, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'cheque_date') DESC NULLS LAST, r->>'id')
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', pc.id, 'cheque_no', pc.cheque_no, 'bank_name', pc.bank_name, 'amount', pc.amount,
      'cheque_date', TO_CHAR(pc.cheque_date, 'YYYY-MM-DD'),
      'received_date', TO_CHAR(pc.received_date, 'YYYY-MM-DD'),
      'clearance_date', TO_CHAR(pc.clearance_date, 'YYYY-MM-DD'),
      'deposit_date', TO_CHAR(pc.deposit_date, 'YYYY-MM-DD'),
      'bounce_date', TO_CHAR(pc.bounce_date, 'YYYY-MM-DD'),
      'status', pc.status, 'notes', pc.notes, 'bounce_reason', pc.bounce_reason,
      'payment_id', pc.payment_id, 'sale_id', pc.sale_id, 'client_id', pc.client_id,
      'replaced_by_id', pc.replaced_by_id,
      'client_name', c.full_name, 'sale_number', s.sale_number,
      'unit_no', u.unit_no, 'unit_code', u.unit_code,
      'project_id', s.project_id, 'project_name', pr.project_name
    ) AS r
    FROM pdc_cheques pc
    LEFT JOIN clients  c  ON c.id  = pc.client_id  AND c.company_id  = p_company_id
    LEFT JOIN sales    s  ON s.id  = pc.sale_id    AND s.company_id  = p_company_id
    LEFT JOIN units    u  ON u.id  = s.unit_id
    LEFT JOIN projects pr ON pr.id = s.project_id
    WHERE pc.company_id = p_company_id
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_status = 'All' OR LOWER(pc.status) = LOWER(p_status))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR pc.cheque_date >= p_date_from)
      AND (p_date_to    IS NULL OR pc.cheque_date <= p_date_to)
  ) sub;

  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
