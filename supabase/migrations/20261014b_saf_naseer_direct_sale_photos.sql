-- SALE APPROVAL, 2026-10-14 (Rashid): "ye SAF banaye ga naseer hee, agar price
-- difference howa to directors ki taraf chali jai agar nahi howa to direct sale
-- create ho jai" · "schedule ... statement mai received amount nahi aa rahi" ·
-- "client image aur nominee image b lagani hai ... SAF mai rakho" ·
-- "combine sale ko hatao sirf nominee rehne do"
--
--   1. naseer@awami prepares AND files; amar@awami has no SAF job any more
--      (as an admin he gets the read-only director view)
--   2. full list price: Submit approves it and makes the sale in the same step
--      discount / lower price: the Directors' Room; the director's Approve
--      makes the sale (created by whoever prepared the form); Decline sends
--      it back with the reason, as before
--   3. the sale gets the form's NexuFinance receipts as payments (date, mode,
--      voucher number), credited to the schedule first-due-first, so the
--      statement and the schedule show what was received
--   4. buyer photo (required) and nominee photo (required when a nominee is
--      named) on the form; they go to the client record with the sale
--   5. co-buyer is no longer taken (the column stays, for old forms)
--   6. GF-253 / SAL-2026-0004 (made before this): its two bank receipts are
--      recorded; the 100,000 cash Naseer entered by hand stands for CRV-0031

ALTER TABLE public.sale_approval_forms
  ADD COLUMN IF NOT EXISTS buyer_photo_url   text,
  ADD COLUMN IF NOT EXISTS nominee_photo_url text;

-- ── 1. who does what ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._saf_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users := public._rms_caller();
        v_awami constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
        v_naseer boolean; v_prep boolean; v_fil boolean;
BEGIN
  IF v_me.id IS NULL OR COALESCE(v_me.status, 'active') <> 'active' THEN RETURN NULL; END IF;
  -- Awami, by name: naseer makes the form and the sale
  v_naseer := v_me.company_id = v_awami AND v_me.username = 'naseer';
  v_prep := v_me.role IN ('accounts','finance') OR v_naseer;
  v_fil  := COALESCE((v_me.module_permissions->>'saf_filing')::boolean, false) OR v_naseer;
  RETURN jsonb_build_object(
    'user_id', v_me.id, 'company_id', v_me.company_id, 'role', v_me.role, 'name', v_me.full_name,
    'prepare', v_prep,
    'approve', v_me.role IN ('owner','admin') AND NOT v_prep AND NOT v_fil,
    'filing',  v_fil,
    'enabled', public._saf_on(v_me.company_id));
END $$;

-- ── 4/5. what a form takes: photos in, co-buyer out ─────────────────────────
CREATE OR REPLACE FUNCTION public._saf_inputs(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(COALESCE(p, '{}'::jsonb)) AS e(k, v)
   WHERE k = ANY (ARRAY['plan_type','discount_amount','discount_reason','discount_approved_by',
                        'installment_count','first_due_date','balloon_amount','balloon_due_date',
                        'schedule_json','sale_date',
                        'buyer_name','buyer_relation','buyer_father','buyer_cnic','buyer_phone','buyer_address',
                        'buyer_name_reason','nominee','buyer_photo_url','nominee_photo_url',
                        'agent_id','sub_agent_name','commission_pct','commission_reason']);
$$;

-- a photo must be one of this company's uploads in rms-documents
CREATE OR REPLACE FUNCTION public._saf_photo_ok(p_company uuid, p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NULLIF(btrim(p_url), '') IS NULL THEN NULL
              WHEN btrim(p_url) LIKE 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/' || p_company::text || '/%'
              THEN btrim(p_url) END;
$$;

CREATE OR REPLACE FUNCTION public._saf_problems(f jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- ── 3/4. the sale, from an approved form: one body for every door ───────────
CREATE OR REPLACE FUNCTION public._saf_make_sale(p_id uuid, p_by uuid, p_by_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
                                next_of_kin_cnic, next_of_kin_phone, client_photo_url, next_of_kin_photo_url, notes, created_by)
    VALUES (f.company_id, f.project_id, v_code, f.buyer_name, f.buyer_father, f.buyer_cnic, f.buyer_phone,
            f.buyer_address, 'Pakistan', 'active', 'local',
            f.nominee->>'name', f.nominee->>'relation', f.nominee->>'cnic', f.nominee->>'phone',
            f.buyer_photo_url, f.nominee_photo_url,
            'From ' || f.saf_no || ' (' || f.buyer_relation || ' ' || f.buyer_father || ')', p_by)
    RETURNING id INTO v_client;
  ELSE
    UPDATE public.clients SET
      client_photo_url      = COALESCE(f.buyer_photo_url, client_photo_url),
      next_of_kin_photo_url = COALESCE(f.nominee_photo_url, next_of_kin_photo_url),
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
      'notes', 'Sale Approval Form ' || f.saf_no || CASE WHEN f.approval_route = 'plan' THEN ', at the list price (no director approval needed)' ELSE ', approved by ' || f.approved_by_name END),
    f.schedule_json);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  v_sale := (v_res->>'sale_id')::uuid;

  -- the money already received, from NexuFinance, as payments on the sale
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
END $$;
REVOKE ALL ON FUNCTION public._saf_make_sale(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Filing's door (forms approved before this change); no "mark filed" first
CREATE OR REPLACE FUNCTION public.saf_create_sale(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me();
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'filing')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Filing makes the sale from an approved form.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sale_approval_forms WHERE id = p_id AND company_id = (c->>'company_id')::uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  RETURN public._saf_make_sale(p_id, (c->>'user_id')::uuid, c->>'name');
END $$;

-- ── live patches: saf_save (photos), saf_submit and saf_room_approve (sale) ──
DO $patch$
DECLARE d text; a text; n int;
BEGIN
  -- saf_save: store the two photos (this company's uploads only)
  d := pg_get_functiondef('public.saf_save(uuid,jsonb,boolean)'::regprocedure);
  a := E'    nominee  = CASE WHEN jsonb_typeof(v_f->''nominee'')  = ''object'' THEN v_f->''nominee''  END,\n';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'saf_save anchor found % times', n; END IF;
  d := replace(d, a, a ||
    E'    buyer_photo_url   = public._saf_photo_ok(v_row.company_id, v_f->>''buyer_photo_url''),\n' ||
    E'    nominee_photo_url = public._saf_photo_ok(v_row.company_id, v_f->>''nominee_photo_url''),\n');
  EXECUTE d;

  -- saf_submit: at the full price the sale is made in the same step
  d := pg_get_functiondef('public.saf_submit(uuid)'::regprocedure);
  a := E'v_full boolean; v_now timestamptz := now(); v_snap jsonb;';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'saf_submit declare anchor found % times', n; END IF;
  d := replace(d, a, a || ' v_sale jsonb;');
  a := E'      snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, ''UTF8'')), ''hex'')\n    WHERE id = p_id;\n  END IF;';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'saf_submit sale anchor found % times', n; END IF;
  d := replace(d, a,
    E'      snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, ''UTF8'')), ''hex'')\n    WHERE id = p_id;\n' ||
    E'    -- 20261014b: no director needed, so the sale is made now\n' ||
    E'    v_sale := public._saf_make_sale(p_id, (c->>''user_id'')::uuid, c->>''name'');\n' ||
    E'    IF NOT COALESCE((v_sale->>''success'')::boolean, false) THEN\n' ||
    E'      RAISE EXCEPTION ''The sale could not be made: %'', COALESCE(v_sale->>''message'', v_sale->>''error''); END IF;\n' ||
    E'  END IF;');
  EXECUTE d;

  -- saf_room_approve: the director's approval makes the sale
  d := pg_get_functiondef('public.saf_room_approve(text,text,uuid,text)'::regprocedure);
  a := E'v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now();';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'saf_room_approve declare anchor found % times', n; END IF;
  d := replace(d, a, a || ' v_sale jsonb;');
  a := E'  WHERE id = p_id;\n  RETURN jsonb_build_object(''success'', true, ''saf'', public._saf_view(p_id));';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'saf_room_approve sale anchor found % times', n; END IF;
  d := replace(d, a,
    E'  WHERE id = p_id;\n' ||
    E'  -- 20261014b: approved, so the sale is made now, in the name of whoever prepared the form\n' ||
    E'  v_sale := public._saf_make_sale(p_id, v_row.prepared_by, v_row.prepared_by_name);\n' ||
    E'  IF NOT COALESCE((v_sale->>''success'')::boolean, false) THEN\n' ||
    E'    RAISE EXCEPTION ''Approved, but the sale could not be made: %'', COALESCE(v_sale->>''message'', v_sale->>''error''); END IF;\n' ||
    E'  RETURN jsonb_build_object(''success'', true, ''saf'', public._saf_view(p_id), ''sale_number'', v_sale->>''sale_number'');');
  EXECUTE d;
END $patch$;

-- ── 6. GF-253 / SAL-2026-0004: the two bank receipts made before this ───────
DO $gf$
DECLARE v_co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
        v_sale constant uuid := 'ca07d728-f700-42f8-9a90-8c7e3a6ad528';
        s public.sales; v_by uuid; r jsonb; v_pay jsonb;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = v_sale AND company_id = v_co AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'SAL-2026-0004 not found'; END IF;
  SELECT id INTO v_by FROM public.app_users WHERE company_id = v_co AND username = 'naseer';
  FOR r IN SELECT e FROM public.sale_approval_forms f, jsonb_array_elements(f.receipts) e
            WHERE f.sale_id = v_sale AND e->>'mode' = 'Bank' ORDER BY e->>'system_no' LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.sale_id = v_sale AND p.reference_no = r->>'voucher_no');
    v_pay := public._rms_insert_simple_payment(v_co, v_sale, s.client_id, s.project_id, (r->>'amount')::numeric,
      (r->>'date')::date, 'bank_transfer', r->>'voucher_no', NULL,
      'NexuFinance ' || (r->>'system_no') || ', received before the sale (SAF-0002)', v_by::text, NULL, NULL, NULL);
    IF NOT COALESCE((v_pay->>'success')::boolean, false) THEN RAISE EXCEPTION 'GF-253 %: %', r->>'voucher_no', v_pay; END IF;
  END LOOP;
END $gf$;
