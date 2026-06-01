-- Extend manager read-only block to 7 admin-gated write-RPCs (Bucket A + B).
-- Managers are read-only oversight and must NEVER write, even with a project assignment.
-- Surgical: insert ONLY the 4-line manager block; everything else byte-for-byte unchanged
-- (return envelopes, UPA checks, restriction-level logic, inserts, EXCEPTION blocks, search_path).
-- Bucket A (insert as FIRST stmt inside the existing `IF NOT _rms_is_admin(v_me) THEN`, before UPA):
--   record_payment, cancel_payment, edit_installment_schedule, edit_payment_meta, edit_sale, update_client
-- Bucket B (insert after the `IF _rms_is_admin THEN core END IF;`, before restriction logic):
--   delete_legal_case
-- NOT touched: execute_unit_cancellation, execute_unit_transfer (Bucket C — no caller var; deferred).

-- ── A1. record_payment ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_payment(p_company_id uuid, p_sale_id uuid, p_installment_id uuid, p_is_down_payment boolean, p_amount numeric, p_payment_date date, p_payment_method text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_proof_url text DEFAULT NULL::text, p_payment_category text DEFAULT 'regular'::text, p_penalty_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0, p_tax_type text DEFAULT NULL::text, p_cheque_date date DEFAULT NULL::date, p_bank_id uuid DEFAULT NULL::uuid, p_adjustment_note text DEFAULT NULL::text, p_adjustment_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
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

-- ── A2. cancel_payment ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_payment(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_level text; v_project uuid; v_found boolean; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, s.project_id INTO v_found, v_project
  FROM public.payments p LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  -- Admin is the approver → executes directly.
  IF public._rms_is_admin(v_me) THEN
    RETURN public._cancel_payment_core(p_payment_id, p_company_id, COALESCE(p_cancelled_by, v_me.id));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'payment_void');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'payment_void');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'payments', p_payment_id::text, 'restriction_warning', true, 'restrictions', 'payment_void');
    RETURN public._cancel_payment_core(p_payment_id, p_company_id, COALESCE(p_cancelled_by, v_me.id));
  ELSE  -- soft (default): require approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request a payment void.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','payment_void','entity_table','payments','entity_id',p_payment_id,
      'project_id',v_project,'title','Payment void','comment',p_reason,
      'payload',jsonb_build_object('payment_id',p_payment_id,'reason',p_reason)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── A3. edit_installment_schedule ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edit_installment_schedule(p_sale_id uuid, p_company_id uuid, p_schedule jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, project_id INTO v_found, v_project FROM public.sales
  WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'schedule_change');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'schedule_change');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', true, 'restrictions', 'schedule_change');
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request schedule changes.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','schedule_change','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Installment schedule change','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'schedule',p_schedule)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── A4. edit_payment_meta ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edit_payment_meta(p_payment_id uuid, p_company_id uuid, p_payment_date date DEFAULT NULL::date, p_payment_method text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur_date date; v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_backdate boolean;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, p.payment_date, s.project_id INTO v_found, v_cur_date, v_project
  FROM public.payments p LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  -- Admin: direct.
  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  -- Backdate = moving the recorded date earlier than current value.
  v_backdate := (p_payment_date IS NOT NULL AND v_cur_date IS NOT NULL AND p_payment_date < v_cur_date);

  IF NOT v_backdate THEN
    -- metadata / same-or-later date: allowed (audited by trigger)
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'backdate');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'backdate');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'payments', p_payment_id::text, 'restriction_warning', true, 'restrictions', 'backdate');
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request a backdated payment edit.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','payment_backdate','entity_table','payments','entity_id',p_payment_id,
      'project_id',v_project,'title','Backdated payment edit','comment',p_reason,
      'payload',jsonb_build_object('payment_id',p_payment_id,'payment_date',p_payment_date,
        'payment_method',p_payment_method,'reference_no',p_reference_no,'bank_name',p_bank_name,
        'bank_id',p_bank_id,'notes',p_notes)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── A5. edit_sale ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_res jsonb;
  v_protected_keys text[] := ARRAY['discount','discount_amount','discount_percentage','price_per_sqft','area_sqft',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_prot jsonb; v_benign jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true, project_id INTO v_found, v_project FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  -- Admin: full edit directly.
  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_sale_core(p_sale_id, p_company_id, p_data);
  END IF;

  -- Split protected vs benign.
  SELECT jsonb_object_agg(k, p_data->k) INTO v_prot
  FROM unnest(v_protected_keys) k WHERE p_data ? k;
  v_benign := p_data - v_protected_keys;

  -- Apply benign edits immediately.
  IF v_benign <> '{}'::jsonb THEN
    v_res := public._edit_sale_core(p_sale_id, p_company_id, v_benign);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  -- No protected fields -> done.
  IF v_prot IS NULL THEN RETURN jsonb_build_object('success', true); END IF;

  v_level := public._rms_restriction_level(p_company_id, 'sale_edit');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'sale_edit');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', v_prot, true, 'restrictions', 'sale_edit');
    RETURN public._edit_sale_core(p_sale_id, p_company_id, v_prot);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request protected sale changes (discount/price/status).'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','sale_edit','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Protected sale edit','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'fields',v_prot)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── A6. update_client ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_client(p_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur_status text; v_project uuid; v_found boolean;
  v_new_status text; v_status_change boolean; v_demo jsonb; v_level text; v_ar jsonb; v_res jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, status, project_id INTO v_found, v_cur_status, v_project
  FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found or access denied'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  -- Admin: full update directly (incl status).
  IF public._rms_is_admin(v_me) THEN
    RETURN public._update_client_core(p_id, p_company_id, p_data);
  END IF;

  v_new_status   := NULLIF(p_data->>'status','');
  v_status_change := (p_data ? 'status') AND (v_new_status IS DISTINCT FROM v_cur_status);

  -- Apply non-status (demographic) fields immediately; status is stripped from this path.
  v_demo := p_data - 'status';
  IF v_demo <> '{}'::jsonb THEN
    v_res := public._update_client_core(p_id, p_company_id, v_demo);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  IF NOT v_status_change THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Status change is approval-gated.
  v_level := public._rms_restriction_level(p_company_id, 'client_status');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'client_status');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'clients', p_id::text, 'restriction_warning', true, 'restrictions', 'client_status');
    RETURN public._set_client_status_core(p_id, p_company_id, v_new_status);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request a client status change.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','client_status','entity_table','clients','entity_id',p_id,
      'project_id',v_project,'title','Client status change: '||v_new_status,'comment',p_reason,
      'payload',jsonb_build_object('client_id',p_id,'status',v_new_status)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── B1. delete_legal_case (Bucket B — block after admin-direct, before restriction) ──
CREATE OR REPLACE FUNCTION public.delete_legal_case(p_id uuid, p_company_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_found boolean; v_level text; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true INTO v_found FROM public.legal_cases WHERE id = p_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'legal_case_not_found'); END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._delete_legal_case_core(p_id, p_company_id);
  END IF;

  IF v_me.role = 'manager' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden',
      'message','Managers have read-only access.');
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'legal_delete');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'legal_delete');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'legal_cases', p_id::text, 'restriction_warning', true, 'restrictions', 'legal_delete');
    RETURN public._delete_legal_case_core(p_id, p_company_id);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request legal case deletion.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','legal_delete','entity_table','legal_cases','entity_id',p_id,
      'title','Legal case deletion','comment',p_reason,
      'payload',jsonb_build_object('case_id',p_id)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
