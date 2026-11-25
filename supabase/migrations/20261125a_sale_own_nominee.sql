-- ══ A sale keeps its own nominee (20261125a) ══
-- NOT APPLIED. Owner, 25-Nov-2026: "GF 250 aur GF251 … sale approval form banaya to us mai Nominee 250 mai aik dafa aur
-- 251 mai dosra Nominee tha magar jab dono units ki sale banai to us mai aik hee nominee aa raha hai dono units mai"
-- and "GF250 mai change the Zarbat Sair name to Zarafat Sair".
-- Cause: _saf_make_sale wrote the form's nominee only onto the CLIENT (next of kin), never onto the sale. Ali Haider is
-- one client with two units, so SAF-0026 (GF-251) overwrote SAF-0025's (GF-250) nominee, and the Application / Booking
-- Form prints the client's next of kin for both.
--   1. _saf_make_sale also writes the form's nominee onto the sale it makes (name, CNIC, relation).
--   2. get_sale_detail returns the nominee's photo from the sale's own form.
--   3. Every sale made from a form gets its form's nominee (19 sales, all with an empty nominee today).
--   4. Ali Haider (CLT-2026-0015): father's name Zarbat Sair -> Zarafat Sair; his next-of-kin photo was SAF-0026's
--      (Muhammad Asif Raza) under SAF-0025's name (Muhammad Ali Raza) — the photo goes back to SAF-0025's to match.
-- The approved forms SAF-0025 / SAF-0026 are signed records and are not edited.

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
  -- the nominee belongs to the sale, not only to the client: one buyer with two units names a nominee per unit
  -- (20261125a — GF-250 / GF-251 both showed the second form's nominee)
  UPDATE public.sales SET nominee_name = NULLIF(btrim(f.nominee->>'name'), ''),
         nominee_cnic = NULLIF(btrim(f.nominee->>'cnic'), ''), nominee_relation = NULLIF(btrim(f.nominee->>'relation'), '')
   WHERE id = v_sale AND f.nominee IS NOT NULL;

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

CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale  JSONB;
  v_instl JSONB;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids  uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date,
    'status', s.status, 'price_per_sqft', s.price_per_sqft,
    'area_sqft', s.area_sqft, 'total_amount', s.total_amount,
    'discount', s.discount, 'net_amount', s.net_amount,
    'down_payment', s.down_payment, 'remaining_amount', s.remaining_amount,
    'installment_count', s.installment_count, 'notes', s.notes,
    'unit_id', u.id, 'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'floor_label', u.floor_label, 'unit_type', ut.type_name,
    'project_name', pr.project_name,
    'client_id', c.id, 'client_name', c.full_name,
    'agent_id', ag.id, 'agent_name', ag.full_name,
    'created_at', s.created_at,
    'co_buyer_name', s.co_buyer_name, 'co_buyer_cnic', s.co_buyer_cnic,
    'co_buyer_share_pct', s.co_buyer_share_pct,
    'nominee_name', s.nominee_name, 'nominee_cnic', s.nominee_cnic,
    'nominee_relation', s.nominee_relation,
    'nominee_photo_url', (SELECT f.nominee_photo_url FROM public.sale_approval_forms f WHERE f.id = s.saf_id),
    'wht_amount', s.wht_amount, 'cvt_amount', s.cvt_amount,
    'discount_approved_by', s.discount_approved_by,
    'discount_notes', s.discount_notes,
    'cancellation_reason', s.cancellation_reason,
    'cancellation_date', s.cancellation_date,
    'cancelled_by', s.cancelled_by,
    'commission_rate', s.commission_rate,
    'commission_notes', s.commission_notes,
    'delivery_breach', s.delivery_breach,
    'breach_months', s.breach_months,
    'breach_reason_type', s.breach_reason_type,
    'breach_reason_detail', s.breach_reason_detail,
    'breach_approved_by', s.breach_approved_by,
    'breach_approval_ref', s.breach_approval_ref,
    'breach_approved_at', s.breach_approved_at
  ) INTO v_sale
  FROM public.sales s
  LEFT JOIN public.units                u   ON u.id  = s.unit_id
  LEFT JOIN public.category_unit_types  ut  ON ut.id = u.unit_type_id
  LEFT JOIN public.projects             pr  ON pr.id = u.project_id
  LEFT JOIN public.clients              c   ON c.id  = s.client_id
  LEFT JOIN public.agents               ag  ON ag.id = s.agent_id
  WHERE s.id = p_sale_id AND s.company_id = p_company_id
    AND (v_all OR s.project_id = ANY(v_pids));

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', i.id, 'installment_number', i.installment_number,
      'due_date', i.due_date, 'amount_due', i.amount_due,
      'amount_paid', i.amount_paid,
      'balance', GREATEST(i.amount_due - i.amount_paid, 0),
      'installment_type', i.installment_type,
      'status', i.status, 'paid_at', i.paid_at, 'notes', i.notes
    ) ORDER BY i.installment_number
  ) INTO v_instl
  FROM public.installments i
  WHERE i.sale_id = p_sale_id AND i.company_id = p_company_id;

  RETURN jsonb_build_object(
    'success', true, 'sale', v_sale,
    'installments', COALESCE(v_instl, '[]'::JSONB)
  );
END;
$function$;

UPDATE public.sales s
   SET nominee_name = NULLIF(btrim(f.nominee->>'name'), ''), nominee_cnic = NULLIF(btrim(f.nominee->>'cnic'), ''),
       nominee_relation = NULLIF(btrim(f.nominee->>'relation'), ''), updated_at = now()
  FROM public.sale_approval_forms f
 WHERE f.id = s.saf_id AND s.nominee_name IS NULL AND NULLIF(btrim(f.nominee->>'name'), '') IS NOT NULL;

DO $c$
DECLARE n int;
BEGIN
  UPDATE public.clients
     SET father_name = 'Zarafat Sair',
         notes = replace(notes, 'Zarbat Sair', 'Zarafat Sair'),
         next_of_kin_photo_url = (SELECT nominee_photo_url FROM public.sale_approval_forms WHERE saf_no = 'SAF-0025'
                                    AND company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'),
         updated_at = now()
   WHERE id = '10363ec2-fd80-42a0-b312-766cc2835a2c' AND father_name = 'Zarbat Sair';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Ali Haider (CLT-2026-0015) with father Zarbat Sair: % rows', n; END IF;
END $c$;
