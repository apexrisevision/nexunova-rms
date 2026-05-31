-- ════════════════════════════════════════════════════════════
-- jsonb_populate_record null-overrides defaults — audit + fix sweep
-- 2026-05-31. Sibling fixes to commit 534a3ab (create_contact_log).
-- ════════════════════════════════════════════════════════════
-- Audit: 4 SECURITY DEFINER RPCs use INSERT … jsonb_populate_record(
--   NULL::public.<table>, <jsonb>). jsonb_populate_record sets every
--   column not present in the JSON to NULL — it does NOT honor the
--   column's DEFAULT. NOT NULL columns with DEFAULTs blow up on
--   INSERT when the caller didn't supply them.
--
--   • create_contact_log     → fixed in commit 534a3ab
--   • create_payment_promise → ACTIVELY USED (js/modals-log-call.js:882,
--                              called right after create_contact_log
--                              when user ticks "promise to pay"). Was
--                              silently swallowed by try/catch with
--                              console.warn. Fixed here.
--   • upsert_unit            → no JS callers (zero matches in repo;
--                              JS uses create_unit/update_unit which
--                              have explicit-column INSERTs). Latent
--                              dead code with the same shape. Fixed
--                              here preventively.
--   • upsert_client          → no JS callers (JS uses create_client/
--                              update_client). Latent. Fixed here
--                              preventively.
--
-- Empirically reproduced for create_payment_promise:
--   SELECT public.create_payment_promise(<co1>, jsonb_build_object(...))
--   → 23502: null value in column "id" of relation "payment_promises"
--     violates not-null constraint
--
-- Fix pattern (matches commit 534a3ab): backfill the NOT NULL+DEFAULT
-- columns into the jsonb payload BEFORE the INSERT, only if the caller
-- didn't supply them. Bodies otherwise verbatim.
--
-- Pre-existing latent bug NOT touched here: upsert_unit's UPDATE branch
-- uses "UPDATE units SET row = q.row …" which references a non-existent
-- column "row" — would throw if ever called. Out of scope; flagging
-- so a future fix-up doesn't trip on it.

-- ────────────────── 1. create_payment_promise (ACTIVELY USED) ──────────────────

CREATE OR REPLACE FUNCTION public.create_payment_promise(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid;
  v_enriched jsonb;
BEGIN
  IF v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project)));

  -- jsonb_populate_record null-overrides DEFAULTs: backfill the NOT NULL+
  -- DEFAULT columns when caller omits them so the constraints are satisfied.
  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'promise_made_on','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('promise_made_on', CURRENT_DATE);
  END IF;
  IF NULLIF(v_enriched->>'logged_by','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('logged_by', '');
  END IF;
  IF NULLIF(v_enriched->>'status','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('status', 'pending');
  END IF;

  INSERT INTO public.payment_promises
  SELECT * FROM jsonb_populate_record(NULL::public.payment_promises, v_enriched)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ────────────────── 2. upsert_unit (LEGACY — preventive) ──────────────────
-- The UPDATE branch has a separate latent bug (SET row = q.row references a
-- non-existent column); left untouched on purpose, out of scope here.

CREATE OR REPLACE FUNCTION public.upsert_unit(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row record;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
  v_data jsonb;
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
    v_data := p_data || jsonb_build_object('company_id', p_company_id);

    -- jsonb_populate_record null-overrides DEFAULTs: backfill the NOT NULL+
    -- DEFAULT columns on public.units when caller omits them.
    IF NULLIF(v_data->>'id','') IS NULL THEN
      v_data := v_data || jsonb_build_object('id', gen_random_uuid());
    END IF;
    IF NULLIF(v_data->>'base_price','') IS NULL THEN
      v_data := v_data || jsonb_build_object('base_price', 0);
    END IF;
    IF NULL IS NOT DISTINCT FROM v_data->'features' OR v_data->'features' = 'null'::jsonb THEN
      v_data := v_data || jsonb_build_object('features', '{}'::jsonb);
    END IF;
    IF NULLIF(v_data->>'parking_count','') IS NULL THEN
      v_data := v_data || jsonb_build_object('parking_count', 0);
    END IF;
    IF NULLIF(v_data->>'is_premium','') IS NULL THEN
      v_data := v_data || jsonb_build_object('is_premium', false);
    END IF;
    IF NULLIF(v_data->>'origin_type','') IS NULL THEN
      v_data := v_data || jsonb_build_object('origin_type', 'fresh');
    END IF;
    IF NULLIF(v_data->>'created_at','') IS NULL THEN
      v_data := v_data || jsonb_build_object('created_at', now());
    END IF;
    IF NULLIF(v_data->>'updated_at','') IS NULL THEN
      v_data := v_data || jsonb_build_object('updated_at', now());
    END IF;

    INSERT INTO public.units SELECT * FROM jsonb_populate_record(NULL::public.units, v_data)
    RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSE
    -- Pre-existing latent bug: this UPDATE references a non-existent column
    -- "row" and would throw if called. No JS caller currently hits this path.
    -- Preserved verbatim to avoid scope-creep; flag for a separate cleanup.
    UPDATE public.units SET row = q.row FROM (
      SELECT to_jsonb(public.units.*) || p_data AS row FROM public.units WHERE id = p_id AND company_id = p_company_id
    ) q WHERE units.id = p_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ────────────────── 3. upsert_client (LEGACY — preventive) ──────────────────

CREATE OR REPLACE FUNCTION public.upsert_client(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_row record; v_data jsonb;
BEGIN
  v_data := p_data || jsonb_build_object('company_id', p_company_id);
  IF p_id IS NULL THEN
    -- jsonb_populate_record null-overrides DEFAULTs: backfill the NOT NULL+
    -- DEFAULT columns on public.clients when caller omits them.
    IF NULLIF(v_data->>'id','') IS NULL THEN
      v_data := v_data || jsonb_build_object('id', gen_random_uuid());
    END IF;
    IF NULLIF(v_data->>'status','') IS NULL THEN
      v_data := v_data || jsonb_build_object('status', 'active');
    END IF;
    IF NULLIF(v_data->>'comms_opt_out','') IS NULL THEN
      v_data := v_data || jsonb_build_object('comms_opt_out', false);
    END IF;

    INSERT INTO public.clients SELECT * FROM jsonb_populate_record(NULL::public.clients, v_data)
    RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSE
    UPDATE public.clients SET
      full_name = COALESCE(p_data->>'full_name', full_name),
      father_name = COALESCE(p_data->>'father_name', father_name),
      cnic = COALESCE(p_data->>'cnic', cnic),
      passport_no = COALESCE(p_data->>'passport_no', passport_no),
      phone_primary = COALESCE(p_data->>'phone_primary', phone_primary),
      phone_secondary = COALESCE(p_data->>'phone_secondary', phone_secondary),
      whatsapp = COALESCE(p_data->>'whatsapp', whatsapp),
      email = COALESCE(p_data->>'email', email),
      address = COALESCE(p_data->>'address', address),
      city = COALESCE(p_data->>'city', city),
      country = COALESCE(p_data->>'country', country),
      occupation = COALESCE(p_data->>'occupation', occupation),
      company_name = COALESCE(p_data->>'company_name', company_name),
      reference_by = COALESCE(p_data->>'reference_by', reference_by),
      client_category = COALESCE(p_data->>'client_category', client_category),
      notes = COALESCE(p_data->>'notes', notes),
      status = COALESCE(p_data->>'status', status),
      client_photo_url = COALESCE(p_data->>'client_photo_url', client_photo_url),
      cnic_front_url = COALESCE(p_data->>'cnic_front_url', cnic_front_url),
      cnic_back_url = COALESCE(p_data->>'cnic_back_url', cnic_back_url),
      overseas_local = COALESCE(p_data->>'overseas_local', overseas_local),
      next_of_kin_name = COALESCE(p_data->>'next_of_kin_name', next_of_kin_name),
      next_of_kin_relation = COALESCE(p_data->>'next_of_kin_relation', next_of_kin_relation),
      next_of_kin_phone = COALESCE(p_data->>'next_of_kin_phone', next_of_kin_phone),
      lead_source = COALESCE(p_data->>'lead_source', lead_source),
      bank_name = COALESCE(p_data->>'bank_name', bank_name),
      bank_account_title = COALESCE(p_data->>'bank_account_title', bank_account_title),
      bank_account_no = COALESCE(p_data->>'bank_account_no', bank_account_no),
      bank_iban = COALESCE(p_data->>'bank_iban', bank_iban),
      metadata = COALESCE(p_data->'metadata', metadata),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;
