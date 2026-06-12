-- ============================================================================
-- Phase 3F — Record Payment + PDC lifecycle (Nexunova RMS)
-- ----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--   1. _rms_credit_installments_fifo  — internal: waterfall-credit a payment
--      across a sale's installments, oldest-open-first. Mirrors the EXACT
--      ordering of get_recovery_position (the one-aging-law).
--   2. _rms_insert_simple_payment     — internal: PAY-/PRV- numbering + insert
--      an installment_id-NULL payment + FIFO-credit installments.amount_paid.
--   3. record_payment_simple          — public write for the Record Payment flow.
--   4. mark_pdc_cleared (REPLACE)     — Deposited-only guard; on clear, CREATE
--      the actual payment (the promise becomes money) so it flows into RP.
--   5. create_pdc_bundle              — batch cheque insert (sets project_id +
--      client_id from the sale; single transaction).
--   6. mark_pdc_bounced (REPLACE)     — status + bounce meta + a contact_logs
--      recovery follow-up (NO payment ever created; NO maker-checker this phase).
--
-- ────────────────────────────────────────────────────────────────────────────
-- ALLOCATION POLICY (Phase 3F):  payments are written with installment_id = NULL.
--   No payment row is *pinned* to an installment — the explicit-allocation engine
--   (register #14, with approvals) is the future single home of allocation, and
--   it must be free to re-allocate. get_recovery_position computes the FIFO aging
--   at READ time from payments alone; it is the source of truth.
--
--   installments.amount_paid is maintained here ONLY as a denormalised mirror of
--   that same read-time FIFO truth (so the ~25 RPC readers + report/portal/
--   eligibility/refund-math surfaces that still read installments stay correct
--   until they migrate to RP). The write-FIFO below is a MIRROR of RP's law,
--   never a competing fork. Ordering is copied verbatim from get_recovery_position:
--       OVER (PARTITION BY sale_id ORDER BY due_date, installment_number)
--   Incremental oldest-open-first crediting yields a per-line distribution
--   identical to RP's total-paid waterfall (distribution of a fixed total is
--   order-independent). Σ installments.amount_paid == Σ payments per sale, except
--   for a true advance that exceeds the entire remaining schedule — which RP also
--   leaves unallocated to any line (shown as r_advance).
--
-- KNOWN GAP (do NOT work around this phase — register with #14):
--   delete_payment rewinds amount_paid only when installment_id IS NOT NULL.
--   A simple (NULL-installment) payment therefore CANNOT be correctly reversed
--   by it — proper reversal must re-run FIFO over the sale's remaining payments.
--   Until #14 lands, the Phase-3F UI exposes NO delete/reverse action on simple
--   payments.
-- ============================================================================

-- 1. ── FIFO credit helper ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rms_credit_installments_fifo(
  p_company_id uuid, p_sale_id uuid, p_amount numeric
) RETURNS numeric           -- returns the amount actually applied to lines
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining numeric := COALESCE(p_amount, 0);
  v_applied   numeric := 0;
  v_cap       numeric;
  v_apply     numeric;
  rec record;
BEGIN
  IF v_remaining <= 0 THEN RETURN 0; END IF;
  -- Order mirrors get_recovery_position verbatim: due_date, installment_number.
  FOR rec IN
    SELECT id, amount_due, amount_paid
    FROM public.installments
    WHERE sale_id = p_sale_id AND company_id = p_company_id
      AND amount_paid < amount_due - 0.005
    ORDER BY due_date, installment_number
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.005;
    v_cap   := rec.amount_due - rec.amount_paid;
    v_apply := LEAST(v_cap, v_remaining);
    UPDATE public.installments
    SET amount_paid = amount_paid + v_apply,
        status = CASE WHEN amount_paid + v_apply >= amount_due - 0.005 THEN 'paid'
                      WHEN amount_paid + v_apply > 0                    THEN 'partial'
                      ELSE status END,
        updated_at = NOW()
    WHERE id = rec.id;
    v_remaining := v_remaining - v_apply;
    v_applied   := v_applied   + v_apply;
  END LOOP;
  RETURN v_applied;   -- any residual (p_amount - v_applied) is a true advance
END;
$function$;

-- 2. ── Internal: number + insert a simple payment, then FIFO-credit ──────────
--   No auth here — callers (record_payment_simple, mark_pdc_cleared) gate access.
CREATE OR REPLACE FUNCTION public._rms_insert_simple_payment(
  p_company_id   uuid,
  p_sale_id      uuid,
  p_client_id    uuid,
  p_project_id   uuid,
  p_amount       numeric,
  p_payment_date date,
  p_method       text,
  p_reference_no text,
  p_bank_name    text,
  p_notes        text,
  p_created_by   text,
  p_cheque_date  date,
  p_bank_id      uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ym text := TO_CHAR(CURRENT_DATE, 'YYMM');
  v_seq integer; v_pay_code text;
  v_fy_start integer; v_fy_label text; v_prv_seq integer; v_voucher_code text;
  v_pay_id uuid;
BEGIN
  -- PAY-YYMM-#### (matches record_payment exactly)
  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(payment_code, '^PAY-[0-9]+-0*', '') AS INTEGER)), 0) + 1
  INTO v_seq FROM public.payments
  WHERE company_id = p_company_id AND payment_code LIKE 'PAY-' || v_ym || '-%';
  v_pay_code := 'PAY-' || v_ym || '-' || LPAD(v_seq::text, 4, '0');

  -- PRV-FYFY-##### voucher
  IF EXTRACT(MONTH FROM CURRENT_DATE)::int >= 7 THEN v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  ELSE v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int - 1; END IF;
  v_fy_label := RIGHT(v_fy_start::text, 2) || RIGHT((v_fy_start + 1)::text, 2);
  INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
  VALUES (p_company_id, 'PRV', v_fy_label, 1)
  ON CONFLICT (company_id, prefix, year) DO UPDATE SET seq = voucher_sequences.seq + 1
  RETURNING seq INTO v_prv_seq;
  v_voucher_code := 'PRV-' || v_fy_label || '-' || LPAD(v_prv_seq::text, 5, '0');

  -- installment_id is intentionally NULL (see ALLOCATION POLICY at top of file).
  INSERT INTO public.payments (
    company_id, payment_code, voucher_code, sale_id, installment_id, client_id, project_id,
    amount, payment_date, payment_method, reference_no, bank_name, notes, status, created_by,
    cheque_date, bank_id, payment_category
  ) VALUES (
    p_company_id, v_pay_code, v_voucher_code, p_sale_id, NULL, p_client_id, p_project_id,
    p_amount, p_payment_date, p_method,
    NULLIF(TRIM(COALESCE(p_reference_no,'')),''), NULLIF(TRIM(COALESCE(p_bank_name,'')),''),
    NULLIF(TRIM(COALESCE(p_notes,'')),''), 'received', p_created_by,
    p_cheque_date, p_bank_id, 'regular'
  ) RETURNING id INTO v_pay_id;

  PERFORM public._rms_credit_installments_fifo(p_company_id, p_sale_id, p_amount);

  RETURN jsonb_build_object('success', true, 'payment_id', v_pay_id,
                            'payment_code', v_pay_code, 'voucher_code', v_voucher_code);
END;
$function$;

-- 3. ── Public: record_payment_simple ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_payment_simple(
  p_company_id   uuid,
  p_sale_id      uuid,
  p_amount       numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_no text DEFAULT NULL,
  p_bank_name    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_created_by   uuid DEFAULT NULL,
  p_cheque_date  date DEFAULT NULL,
  p_bank_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_client_id uuid; v_project_id uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN
       ('cash','cheque','bank_transfer','online','other','adjustment') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payment_method');
  END IF;

  SELECT client_id, project_id INTO v_client_id, v_project_id
  FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  -- Project gating for non-admins (managers read-only, officers need assignment)
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Managers have read-only access.');
    END IF;
    IF v_project_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments
        WHERE user_id = v_me.id AND company_id = p_company_id AND project_id = v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  RETURN public._rms_insert_simple_payment(
    p_company_id, p_sale_id, v_client_id, v_project_id, p_amount,
    COALESCE(p_payment_date, CURRENT_DATE), p_payment_method, p_reference_no, p_bank_name,
    p_notes, COALESCE(p_created_by::text, v_me.id::text), p_cheque_date, p_bank_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 4. ── mark_pdc_cleared (REPLACE) — Deposited-only; clearing creates money ───
CREATE OR REPLACE FUNCTION public.mark_pdc_cleared(
  p_cheque_id uuid, p_company_id uuid, p_cleared_date date, p_deposit_ref text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_row pdc_cheques%ROWTYPE;
  v_sale_client uuid; v_sale_project uuid;
  v_pay jsonb; v_pay_id uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT * INTO v_row FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_row.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_row.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_row.status = 'cleared' THEN RETURN jsonb_build_object('success', false, 'error', 'Already cleared'); END IF;
  -- Guard (spec B.4): a cheque can be Cleared ONLY from Deposited (presented).
  IF v_row.status <> 'presented' THEN
    RETURN jsonb_build_object('success', false, 'error', 'must_be_deposited_first',
      'message', 'Mark the cheque Deposited before clearing it.');
  END IF;

  -- The heart: clearing turns the promise into money. Create the payment if the
  -- cheque has none yet (mode cheque, ref = cheque no, created_by carried over).
  IF v_row.payment_id IS NULL THEN
    SELECT client_id, project_id INTO v_sale_client, v_sale_project
    FROM public.sales WHERE id = v_row.sale_id AND company_id = p_company_id;
    v_pay := public._rms_insert_simple_payment(
      p_company_id, v_row.sale_id, COALESCE(v_row.client_id, v_sale_client),
      COALESCE(v_row.project_id, v_sale_project), v_row.amount, p_cleared_date,
      'cheque', v_row.cheque_no, v_row.bank_name,
      NULLIF('PDC cleared'||COALESCE(' · Ref '||p_deposit_ref,''),''),
      COALESCE(v_row.created_by, v_me.id::text), v_row.cheque_date, NULL);
    v_pay_id := NULLIF(v_pay->>'payment_id','')::uuid;
  ELSE
    v_pay_id := v_row.payment_id;
    UPDATE payments SET status='cleared', updated_at=NOW() WHERE id=v_pay_id AND company_id=p_company_id;
  END IF;

  UPDATE pdc_cheques
  SET status='cleared', clearance_date=p_cleared_date, deposit_date=COALESCE(deposit_date, p_cleared_date),
      payment_id=v_pay_id,
      notes = CASE WHEN p_deposit_ref IS NOT NULL THEN COALESCE(notes || ' | ', '') || 'Deposit Ref: ' || p_deposit_ref ELSE notes END,
      updated_at=NOW()
  WHERE id=p_cheque_id AND company_id=p_company_id;

  RETURN jsonb_build_object('success', true, 'cheque_no', v_row.cheque_no, 'payment_id', v_pay_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 5. ── create_pdc_bundle — batch cheque insert (one transaction) ─────────────
CREATE OR REPLACE FUNCTION public.create_pdc_bundle(
  p_company_id uuid, p_sale_id uuid, p_cheques jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_client_id uuid; v_project_id uuid; v_sale_ok boolean;
  v_ids uuid[] := '{}'; v_id uuid; v_n int := 0; rec jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF p_sale_id IS NULL OR p_cheques IS NULL OR jsonb_typeof(p_cheques) <> 'array'
     OR jsonb_array_length(p_cheques) = 0 THEN
    RETURN jsonb_build_object('success',false,'error','no_cheques'); END IF;

  SELECT client_id, project_id, true INTO v_client_id, v_project_id, v_sale_ok
  FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT COALESCE(v_sale_ok,false) THEN RETURN jsonb_build_object('success',false,'error','sale_not_in_company'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_cheques) LOOP
    IF COALESCE(rec->>'cheque_no','') = '' OR (rec->>'amount') IS NULL
       OR (rec->>'cheque_date') IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','cheque_no_amount_date_required');
    END IF;
    INSERT INTO public.pdc_cheques(
      company_id, sale_id, client_id, project_id, cheque_no, bank_name, amount,
      cheque_date, received_date, status, notes, created_by)
    VALUES (
      p_company_id, p_sale_id, v_client_id, v_project_id,
      rec->>'cheque_no', NULLIF(rec->>'bank_name',''), (rec->>'amount')::numeric,
      (rec->>'cheque_date')::date,
      COALESCE(NULLIF(rec->>'received_date','')::date, CURRENT_DATE),
      'pending', NULLIF(rec->>'notes',''), v_me.id::text)
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id); v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_n, 'ids', to_jsonb(v_ids));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 6. ── mark_pdc_bounced (REPLACE) — follow-up entry, never a payment ─────────
CREATE OR REPLACE FUNCTION public.mark_pdc_bounced(
  p_cheque_id uuid, p_company_id uuid, p_bounce_date date, p_bounce_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_row pdc_cheques%ROWTYPE;
  v_unit_id uuid; v_followup_id uuid := NULL;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT * INTO v_row FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_row.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_row.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  -- No payment is ever created for a bounced cheque. Clearing is the only money
  -- path, and a cleared cheque cannot bounce — so there is nothing to reverse.
  IF v_row.status = 'cleared' THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot bounce a cleared cheque'); END IF;

  UPDATE pdc_cheques SET status='bounced', bounce_date=p_bounce_date, bounce_reason=p_bounce_reason, updated_at=NOW()
   WHERE id=p_cheque_id AND company_id=p_company_id;

  -- Recovery follow-up (contact_logs) — flagged for the recovery workflow.
  -- (Phase 3F: follow-up entry only; no maker-checker escalation.)
  IF v_row.client_id IS NOT NULL OR v_row.sale_id IS NOT NULL THEN
    SELECT unit_id INTO v_unit_id FROM public.sales WHERE id = v_row.sale_id AND company_id = p_company_id;
    INSERT INTO public.contact_logs (
      company_id, client_id, sale_id, unit_id, project_id, contact_date, channel, direction,
      response_received, status_tag, next_followup_date, next_action, escalation_flag, remarks, created_by)
    VALUES (
      p_company_id, v_row.client_id, v_row.sale_id, v_unit_id, v_row.project_id, p_bounce_date,
      'Call', 'Outbound', 'NoResponse', 'Active', p_bounce_date + 3,
      'Recover bounced PDC',
      'pdc_bounce',
      'PDC cheque ' || COALESCE(v_row.cheque_no,'?') || ' bounced (PKR ' || COALESCE(v_row.amount,0)::text || ')'
        || COALESCE(' — ' || p_bounce_reason, '') || '. Arrange replacement / recovery.',
      v_me.id::text)
    RETURNING id INTO v_followup_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'cheque_no', v_row.cheque_no,
    'followup_created', v_followup_id IS NOT NULL, 'followup_id', v_followup_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
