-- 20261024b: a Sale Approval Form's token refunds are netted, not skipped.
-- _saf_make_sale recorded every POSITIVE NexuFinance receipt line as a payment
-- and skipped negative lines (refunds), so a refunded token was carried into
-- the new buyer's sale. LG-135 / SAF-0009 -> SAL-2026-0007: CRV-0036 +200,000
-- and CPV-0091 -200,000 (refund to the old buyer) net to 0, but the sale got
-- a 200,000 payment (PAY-2610-0007, voided by hand).
-- Now: v_left = the sum of all lines; each positive line is capped at what is
-- left. Net 0 -> no payment; +500,000 / -100,000 -> 400,000 recorded.
-- Base: the live definition (pg_get_functiondef), identical to 20261024a.
-- Only the receipts loop changes.

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
