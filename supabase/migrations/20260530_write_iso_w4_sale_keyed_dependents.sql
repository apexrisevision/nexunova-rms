-- ════════════════════════════════════════════════════════════
-- WRITE-ISOLATION W4: admin-OR-assigned-officer guard on sale-keyed dependents
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- record_payment, create_pdc_cheque: project_id derived from PARENT sale.
-- admin bypass; non-admin must have UPA for the parent sale's project.
-- For create_pdc_cheque, non-admin must supply sale_id (we need it to
-- derive the gate); admins can still create NULL-sale cheques.
-- Internal call path verify_payment_link → record_payment: the staffer's
-- session flows through _rms_caller automatically, gate passes as long
-- as the staffer has UPA for the sale's project.

CREATE OR REPLACE FUNCTION public.record_payment(p_company_id uuid, p_sale_id uuid, p_installment_id uuid, p_is_down_payment boolean, p_amount numeric, p_payment_date date, p_payment_method text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_proof_url text DEFAULT NULL::text, p_payment_category text DEFAULT 'regular'::text, p_penalty_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0, p_tax_type text DEFAULT NULL::text, p_cheque_date date DEFAULT NULL::date, p_bank_id uuid DEFAULT NULL::uuid, p_adjustment_note text DEFAULT NULL::text, p_adjustment_type text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inst_id      uuid;
  v_amt_due      numeric;  v_amt_paid     numeric;  v_outstanding  numeric;
  v_pay_id       uuid;     v_pay_code     text;     v_row_count    integer;
  v_seq          integer;  v_ym           text;     v_dp_amount    numeric;
  v_fy_start     integer;  v_fy_label     text;     v_prv_seq      integer;
  v_voucher_code text;
  v_me           public.app_users := public._rms_caller();
  v_target_pid   uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    SELECT project_id INTO v_target_pid FROM public.sales
    WHERE id = p_sale_id AND company_id = p_company_id;
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  v_ym := TO_CHAR(CURRENT_DATE, 'YYMM');
  IF EXTRACT(MONTH FROM CURRENT_DATE)::int >= 7 THEN
    v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  ELSE
    v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int - 1;
  END IF;
  v_fy_label := RIGHT(v_fy_start::text, 2) || RIGHT((v_fy_start + 1)::text, 2);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF p_is_down_payment AND (p_installment_id IS NULL) THEN
    SELECT id, amount_due, amount_paid INTO v_inst_id, v_amt_due, v_amt_paid
    FROM public.installments
    WHERE sale_id = p_sale_id AND company_id = p_company_id
      AND installment_type = 'down_payment' AND amount_paid < amount_due
    ORDER BY installment_number LIMIT 1;
    IF v_inst_id IS NULL THEN
      SELECT down_payment INTO v_dp_amount FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
      INSERT INTO public.installments
        (company_id, sale_id, installment_number, installment_type, due_date, amount_due, amount_paid, status, notes)
      SELECT p_company_id, p_sale_id, 0, 'down_payment', sale_date, v_dp_amount, 0, 'pending', 'Down Payment / Booking'
      FROM public.sales WHERE id = p_sale_id
      RETURNING id, amount_due, amount_paid INTO v_inst_id, v_amt_due, v_amt_paid;
    END IF;
  ELSE
    v_inst_id := COALESCE(p_installment_id,
      (SELECT id FROM public.installments
       WHERE sale_id = p_sale_id AND company_id = p_company_id
         AND installment_type = 'down_payment' AND amount_paid < amount_due
       ORDER BY installment_number LIMIT 1));
    SELECT amount_due, amount_paid INTO v_amt_due, v_amt_paid
    FROM public.installments WHERE id = v_inst_id AND company_id = p_company_id;
  END IF;

  IF v_inst_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'installment_not_found');
  END IF;

  v_outstanding := GREATEST(v_amt_due - v_amt_paid, 0);
  IF p_amount > v_outstanding + 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'exceeds_outstanding', 'outstanding', v_outstanding);
  END IF;

  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(payment_code, '^PAY-[0-9]+-0*', '') AS INTEGER)), 0) + 1
  INTO v_seq FROM public.payments
  WHERE company_id = p_company_id AND payment_code LIKE 'PAY-' || v_ym || '-%';
  v_pay_code := 'PAY-' || v_ym || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
  VALUES (p_company_id, 'PRV', v_fy_label, 1)
  ON CONFLICT (company_id, prefix, year)
  DO UPDATE SET seq = voucher_sequences.seq + 1
  RETURNING seq INTO v_prv_seq;
  v_voucher_code := 'PRV-' || v_fy_label || '-' || LPAD(v_prv_seq::text, 5, '0');

  INSERT INTO public.payments (
    company_id, payment_code, voucher_code, sale_id, installment_id, client_id,
    amount, payment_date, payment_method, reference_no, bank_name, notes, status, created_by,
    proof_url, payment_category, penalty_amount, tax_amount, tax_type,
    cheque_date, bank_id, adjustment_note, adjustment_type
  )
  SELECT p_company_id, v_pay_code, v_voucher_code, p_sale_id, v_inst_id, s.client_id,
    p_amount, p_payment_date, p_payment_method,
    NULLIF(TRIM(COALESCE(p_reference_no,'')),''), NULLIF(TRIM(COALESCE(p_bank_name,'')),''),
    NULLIF(TRIM(COALESCE(p_notes,'')),''), 'received', p_created_by,
    NULLIF(TRIM(COALESCE(p_proof_url,'')),''), COALESCE(p_payment_category,'regular'),
    COALESCE(p_penalty_amount,0), COALESCE(p_tax_amount,0),
    NULLIF(TRIM(COALESCE(p_tax_type,'')),''), p_cheque_date, p_bank_id,
    NULLIF(TRIM(COALESCE(p_adjustment_note,'')),''), NULLIF(TRIM(COALESCE(p_adjustment_type,'')),'')
  FROM public.sales s WHERE s.id = p_sale_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  SELECT id INTO v_pay_id FROM public.payments WHERE payment_code = v_pay_code AND company_id = p_company_id;

  UPDATE public.installments SET amount_paid = amount_paid + p_amount,
    status = CASE WHEN (amount_paid + p_amount) >= amount_due THEN 'paid'
                  WHEN (amount_paid + p_amount) > 0 THEN 'partial'
                  ELSE status END,
    updated_at = NOW()
  WHERE id = v_inst_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'payment_id', v_pay_id, 'payment_code', v_pay_code,
    'voucher_code', v_voucher_code, 'new_amt_paid', v_amt_paid + p_amount,
    'new_outstanding', GREATEST(0, v_outstanding - p_amount));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_pdc_cheque(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_sale_id uuid;
  v_me public.app_users := public._rms_caller();
  v_target_pid uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;

  v_sale_id := NULLIF(p_data->>'sale_id','')::uuid;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_id_required_for_non_admin');
    END IF;
    SELECT project_id INTO v_target_pid FROM public.sales
    WHERE id = v_sale_id AND company_id = p_company_id;
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'sale_not_in_company');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF p_data->>'cheque_no' IS NULL OR (p_data->>'amount')::numeric IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'cheque_no_and_amount_required');
  END IF;
  IF v_sale_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales WHERE id = v_sale_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_in_company');
  END IF;
  INSERT INTO pdc_cheques(company_id, sale_id, client_id, cheque_no, bank_name, amount,
    cheque_date, received_date, status, notes, created_by)
  VALUES (p_company_id, v_sale_id, NULLIF(p_data->>'client_id','')::uuid,
    p_data->>'cheque_no', p_data->>'bank_name', (p_data->>'amount')::numeric,
    NULLIF(p_data->>'cheque_date','')::date, NULLIF(p_data->>'received_date','')::date,
    COALESCE(p_data->>'status', 'pending'),
    p_data->>'notes', p_data->>'created_by')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.record_payment(uuid,uuid,uuid,boolean,numeric,date,text,text,text,text,uuid,text,text,numeric,numeric,text,date,uuid,text,text) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Sale-keyed dependent. Gate derived from
parent sale's project_id (auth_required / sale_not_found / project_not_assigned).
Internal caller verify_payment_link passes through naturally — its verifying
staffer's session flows via _rms_caller; staffer must have UPA for the sale's
project. Member of W4.$$;

COMMENT ON FUNCTION public.create_pdc_cheque(uuid, jsonb) IS
$$ADMIN-OR-ASSIGNED-OFFICER WRITE — Sale-keyed dependent. Non-admin must
provide sale_id (sale_id_required_for_non_admin else) so the parent project
can be derived; admins can still create NULL-sale cheques (e.g. security
deposits). Member of W4.$$;
