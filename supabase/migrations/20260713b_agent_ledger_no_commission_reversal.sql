-- Owner decision (2026-07-13): when a unit is cancelled or transferred, the agent KEEPS his
-- commission AND the sale in his totals. Nothing is reversed. Instead his ledger carries a
-- zero-amount record line naming the unit and the voucher, so reading the ledger tells you what
-- happened. Supersedes the totals-reversal block that cancellation used to run.
--
-- Also fixes a third latent transfer bug: it inserted transaction_type='commission_accrued', which
-- the CHECK constraint did not allow — so any transfer WITH an agent died there. agent_transactions
-- was empty (0 rows), confirming no transfer with an agent had ever succeeded. The earlier ZZTEST
-- transfer only passed because it ran with agent_id = NULL, which skips that insert.
--
-- project_id is now set on every row the two RPCs write: list_agent_transactions filters by the
-- caller's assigned projects, so a null project_id would hide the line from non-admin users.

ALTER TABLE public.agent_transactions DROP CONSTRAINT agent_transactions_transaction_type_check;
ALTER TABLE public.agent_transactions ADD CONSTRAINT agent_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'commission_paid','clawback','adjustment_debit','adjustment_credit','write_off',
    'commission_accrued',        -- transfer accrues commission on the new sale
    'unit_cancelled',            -- record-only, amount 0: this agent's unit was cancelled
    'unit_transferred'           -- record-only, amount 0: this agent's unit went to a new buyer
  ]));


CREATE OR REPLACE FUNCTION public._execute_unit_cancellation_core(p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid, p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text, p_detailed_reason text, p_overdue_count integer DEFAULT 0, p_days_past_due integer DEFAULT 0, p_notices_sent integer DEFAULT 0, p_last_notice_date date DEFAULT NULL::date, p_legal_action boolean DEFAULT false, p_total_paid numeric DEFAULT 0, p_booking_forfeiture numeric DEFAULT 0, p_cancellation_charges numeric DEFAULT 0, p_late_penalty numeric DEFAULT 0, p_processing_fee numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_other_deductions_note text DEFAULT NULL::text, p_net_refund numeric DEFAULT 0, p_refund_method text DEFAULT NULL::text, p_refund_payment_mode text DEFAULT NULL::text, p_refund_bank_id uuid DEFAULT NULL::uuid, p_refund_reference text DEFAULT NULL::text, p_refund_date date DEFAULT NULL::date, p_expected_refund_date date DEFAULT NULL::date, p_refund_notes text DEFAULT NULL::text, p_agent_commission_total numeric DEFAULT 0, p_agent_commission_paid numeric DEFAULT 0, p_agent_commission_pending numeric DEFAULT 0, p_commission_action text DEFAULT 'no_clawback'::text, p_commission_recovery_amt numeric DEFAULT 0, p_commission_recovery_method text DEFAULT NULL::text, p_commission_notes text DEFAULT NULL::text, p_client_flag text DEFAULT 'none'::text, p_blacklist_reason text DEFAULT NULL::text, p_initiated_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_voucher_no          TEXT;
  v_seq                 INT;
  v_cancellation_id     UUID;
  v_available_status_id UUID;
  v_total_deductions    NUMERIC;
  v_voided              INT;
  v_unit_label          TEXT;
BEGIN
  SELECT id INTO v_available_status_id
  FROM public.category_unit_statuses
  WHERE company_id = p_company_id AND project_id = p_project_id AND is_available = true AND is_active = true
  ORDER BY sort_order LIMIT 1;

  -- Refuse rather than half-cancel: without this the unit stays Sold and the caller is still
  -- told the cancellation succeeded.
  IF v_available_status_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_available_status',
      'message', 'This project has no active "Available" unit status, so the unit cannot be released. Add one in Categories → Unit Statuses, then cancel again.');
  END IF;

  SELECT COALESCE(MAX(
    CASE WHEN cancellation_voucher_no ~ ('^UC-' || EXTRACT(YEAR FROM NOW())::TEXT || '-[0-9]+$')
         THEN SUBSTRING(cancellation_voucher_no FROM 9)::INT ELSE 0 END
  ), 0) + 1 INTO v_seq
  FROM public.unit_cancellations WHERE company_id = p_company_id;

  v_voucher_no       := 'UC-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(v_seq::TEXT, 4, '0');
  v_total_deductions := COALESCE(p_booking_forfeiture,0) + COALESCE(p_cancellation_charges,0)
                      + COALESCE(p_late_penalty,0) + COALESCE(p_processing_fee,0)
                      + COALESCE(p_other_deductions,0);

  INSERT INTO public.unit_cancellations (
    company_id, cancellation_voucher_no, cancellation_date, effective_date,
    unit_id, project_id, sale_id, client_id,
    cancellation_type, reason_category, detailed_reason,
    overdue_installments_count, days_past_due, notices_sent_count,
    last_notice_date, legal_action_initiated,
    total_paid, booking_forfeiture, cancellation_charges, late_payment_penalty,
    processing_fee, other_deductions, other_deductions_note,
    total_deductions, net_refund_amount,
    refund_method, refund_payment_mode, refund_bank_id, refund_reference, refund_date,
    expected_refund_date, refund_notes,
    agent_id, agent_commission_total, agent_commission_paid, agent_commission_pending,
    commission_action, commission_recovery_amount, commission_recovery_method, commission_notes,
    client_flag, blacklist_reason,
    initiated_by, notes, status
  ) VALUES (
    p_company_id, v_voucher_no, p_cancellation_date, p_effective_date,
    p_unit_id, p_project_id, p_sale_id, p_client_id,
    p_cancellation_type, p_reason_category, p_detailed_reason,
    p_overdue_count, p_days_past_due, p_notices_sent,
    p_last_notice_date, p_legal_action,
    p_total_paid, p_booking_forfeiture, p_cancellation_charges, p_late_penalty,
    p_processing_fee, p_other_deductions, p_other_deductions_note,
    v_total_deductions, p_net_refund,
    p_refund_method, p_refund_payment_mode, p_refund_bank_id, p_refund_reference, p_refund_date,
    p_expected_refund_date, p_refund_notes,
    p_agent_id, p_agent_commission_total, p_agent_commission_paid, p_agent_commission_pending,
    p_commission_action, p_commission_recovery_amt, p_commission_recovery_method, p_commission_notes,
    p_client_flag, p_blacklist_reason,
    p_initiated_by, p_notes, 'completed'
  ) RETURNING id INTO v_cancellation_id;

  UPDATE public.sales
  SET is_active=false, closed_at=NOW(), closure_reason='cancelled',
      cancellation_reason=p_detailed_reason, cancellation_date=p_cancellation_date,
      cancelled_by=p_initiated_by, status='cancelled', updated_at=NOW()
  WHERE id = p_sale_id AND company_id = p_company_id;

  UPDATE public.units SET status_id = v_available_status_id, updated_at = NOW()
  WHERE id = p_unit_id AND company_id = p_company_id;

  -- Void every not-yet-paid installment. 'paid' rows stay: they record money actually received.
  UPDATE public.installments SET status='cancelled', updated_at=NOW()
  WHERE sale_id = p_sale_id AND company_id = p_company_id
    AND status IN ('pending','partial','overdue');
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  -- Agent: commission and sale totals are deliberately NOT reversed (owner decision 2026-07-13).
  -- Instead drop a zero-amount marker in his ledger so the cancellation is visible there.
  IF p_agent_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(u.unit_no,''), u.unit_code, 'unit')
      INTO v_unit_label
      FROM public.units u WHERE u.id = p_unit_id AND u.company_id = p_company_id;

    INSERT INTO public.agent_transactions (
      company_id, project_id, agent_id, transaction_type, amount,
      related_sale_id, related_cancellation_id, reference, notes, created_by
    ) VALUES (
      p_company_id, p_project_id, p_agent_id, 'unit_cancelled', 0,
      p_sale_id, v_cancellation_id, v_voucher_no,
      'Unit ' || COALESCE(v_unit_label,'—') || ' cancelled on ' || p_cancellation_date::text
        || '. Commission NOT reversed — record only.'
        || CASE WHEN NULLIF(TRIM(COALESCE(p_detailed_reason,'')),'') IS NULL THEN ''
                ELSE ' Reason: ' || p_detailed_reason END,
      p_initiated_by
    );
  END IF;

  IF p_client_flag = 'blacklisted' THEN
    UPDATE public.clients SET has_cancellation_history=true, is_defaulter=true, is_blacklisted=true,
      flag_notes=COALESCE(p_blacklist_reason, p_detailed_reason), updated_at=NOW()
    WHERE id = p_client_id AND company_id = p_company_id;
    INSERT INTO public.blacklisted_clients (company_id, client_id, reason, related_cancellation_id, approved_by)
    VALUES (p_company_id, p_client_id, COALESCE(p_blacklist_reason, p_detailed_reason), v_cancellation_id, p_initiated_by)
    ON CONFLICT (company_id, client_id) DO UPDATE SET reason = EXCLUDED.reason, is_active = true, removed_date = NULL;
  ELSIF p_client_flag = 'defaulter' THEN
    UPDATE public.clients SET has_cancellation_history=true, is_defaulter=true, flag_notes=p_detailed_reason, updated_at=NOW()
    WHERE id = p_client_id AND company_id = p_company_id;
  ELSE
    UPDATE public.clients SET has_cancellation_history=true, updated_at=NOW()
    WHERE id = p_client_id AND company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id,
    'voucher_no', v_voucher_no, 'installments_voided', v_voided);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;


CREATE OR REPLACE FUNCTION public._execute_unit_transfer_v2_core(p_company_id uuid, p_transfer_date date, p_unit_id uuid, p_project_id uuid, p_old_sale_id uuid, p_old_client_id uuid, p_old_total_paid numeric, p_old_outstanding numeric, p_old_sale_price numeric, p_old_close_note text, p_new_client_id uuid, p_new_sale jsonb, p_installments jsonb DEFAULT '[]'::jsonb, p_transfer_fee numeric DEFAULT 0, p_documentation_charges numeric DEFAULT 0, p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL::text, p_charges_paid_by text DEFAULT 'new'::text, p_charges_payment_method text DEFAULT NULL::text, p_charges_reference text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_commission_rate numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_created_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_voucher_no      text;
  v_new_sale_id     uuid;
  v_new_sale_number text;
  v_transfer_id     uuid;
  v_total_charges   numeric;
  v_net_amount      numeric;
  v_down_payment    numeric;
  v_inst            jsonb;
  v_voided          int;
  v_old_agent_id    uuid;
  v_unit_label      text;
BEGIN
  v_voucher_no := public.generate_voucher_no(p_company_id, 'TRF');

  v_total_charges := COALESCE(p_transfer_fee,0) + COALESCE(p_documentation_charges,0) + COALESCE(p_other_charges,0);
  v_down_payment  := COALESCE((p_new_sale->>'down_payment')::numeric, 0);

  SELECT agent_id INTO v_old_agent_id
    FROM public.sales WHERE id = p_old_sale_id AND company_id = p_company_id;

  SELECT COALESCE(NULLIF(u.unit_no,''), u.unit_code, 'unit')
    INTO v_unit_label
    FROM public.units u WHERE u.id = p_unit_id AND u.company_id = p_company_id;

  UPDATE public.sales
     SET is_active   = false,
         closed_at   = NOW(),
         closure_reason = 'transferred',
         notes       = COALESCE(notes,'') ||
                       CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                       '[Transferred on ' || p_transfer_date::text || ' — voucher ' || v_voucher_no || ']' ||
                       CASE WHEN p_old_close_note IS NULL OR p_old_close_note = '' THEN '' ELSE E'\n' || p_old_close_note END,
         updated_at  = NOW()
   WHERE id = p_old_sale_id AND company_id = p_company_id;

  -- The old owner's schedule dies with the old sale, else its unpaid rows keep surfacing as live
  -- dues on the unit timeline under the previous client's name.
  UPDATE public.installments SET status='cancelled', updated_at=NOW()
   WHERE sale_id = p_old_sale_id AND company_id = p_company_id
     AND status IN ('pending','partial','overdue');
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  -- total_amount / net_amount / remaining_amount are GENERATED ALWAYS — never insert them.
  -- sale_number left null on purpose: trg_sale_number_gen assigns SAL-<year>-#### from
  -- sale_sequences.last_num, the same counter every other sale uses.
  INSERT INTO public.sales (
    company_id, sale_number, unit_id, client_id, agent_id,
    price_per_sqft, area_sqft, discount,
    down_payment, installment_count, sale_date,
    status, is_active, is_transfer, transferred_from_sale_id, project_id,
    commission_rate, notes, created_by, payment_plan_type
  ) VALUES (
    p_company_id, NULL, p_unit_id, p_new_client_id, p_agent_id,
    COALESCE((p_new_sale->>'price_per_sqft')::numeric,0),
    COALESCE((p_new_sale->>'area_sqft')::numeric,0),
    COALESCE((p_new_sale->>'discount')::numeric,0),
    v_down_payment,
    COALESCE((p_new_sale->>'installment_count')::int, 0),
    p_transfer_date,
    'active', true, true, p_old_sale_id, p_project_id,
    COALESCE(p_commission_rate, 0),
    p_new_sale->>'notes',
    NULL,
    COALESCE(p_new_sale->>'payment_plan_type','installment')
  ) RETURNING id, sale_number, net_amount INTO v_new_sale_id, v_new_sale_number, v_net_amount;

  v_net_amount := COALESCE(v_net_amount, 0);

  IF v_down_payment > 0 THEN
    INSERT INTO public.installments (
      company_id, sale_id, installment_number, installment_type, due_date,
      amount_due, amount_paid, status, notes
    ) VALUES (
      p_company_id, v_new_sale_id, 0, 'down_payment', p_transfer_date,
      v_down_payment, v_down_payment, 'paid', 'BOOKING (Transfer)'
    );
  END IF;

  IF jsonb_array_length(COALESCE(p_installments,'[]'::jsonb)) > 0 THEN
    FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
      INSERT INTO public.installments (
        company_id, sale_id, installment_number, installment_type,
        due_date, amount_due, amount_paid, status, notes
      ) VALUES (
        p_company_id, v_new_sale_id,
        COALESCE((v_inst->>'installment_number')::int, 1),
        COALESCE(v_inst->>'installment_type','installment'),
        (v_inst->>'due_date')::date,
        COALESCE((v_inst->>'amount_due')::numeric,0),
        0, 'pending',
        v_inst->>'notes'
      );
    END LOOP;
  END IF;

  INSERT INTO public.unit_transfers (
    company_id, transfer_voucher_no, transfer_date, unit_id, project_id,
    old_sale_id, old_client_id, old_total_paid, old_outstanding, old_sale_price,
    settlement_type, settlement_note,
    new_sale_id, new_client_id, new_sale_price,
    price_difference,
    margin_beneficiary, margin_to_old_client, margin_to_company,
    transfer_fee, documentation_charges, other_charges, other_charges_desc,
    total_transfer_charges, charges_paid_by,
    charges_payment_method, charges_reference,
    notes, created_by
  ) VALUES (
    p_company_id, v_voucher_no, p_transfer_date, p_unit_id, p_project_id,
    p_old_sale_id, p_old_client_id, p_old_total_paid, p_old_outstanding, p_old_sale_price,
    'direct', p_old_close_note,
    v_new_sale_id, p_new_client_id, v_net_amount,
    v_net_amount - COALESCE(p_old_sale_price,0),
    NULL, 0, 0,
    COALESCE(p_transfer_fee,0), COALESCE(p_documentation_charges,0),
    COALESCE(p_other_charges,0), p_other_charges_desc,
    v_total_charges, p_charges_paid_by,
    p_charges_payment_method, p_charges_reference,
    p_notes, p_created_by
  ) RETURNING id INTO v_transfer_id;

  UPDATE public.units
     SET origin_type = 'transferred',
         last_event_at = NOW(),
         updated_at = NOW()
   WHERE id = p_unit_id AND company_id = p_company_id;

  -- Old agent: nothing reversed (owner decision). Zero-amount marker so his ledger shows the unit
  -- left him.
  IF v_old_agent_id IS NOT NULL THEN
    INSERT INTO public.agent_transactions (
      company_id, project_id, agent_id, transaction_type, amount,
      related_sale_id, related_transfer_id, reference, notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_old_agent_id, 'unit_transferred', 0,
      p_old_sale_id, v_transfer_id, v_voucher_no,
      'Unit ' || COALESCE(v_unit_label,'—') || ' transferred to a new buyer on ' || p_transfer_date::text
        || '. Commission NOT reversed — record only.',
      p_created_by
    );
  END IF;

  IF p_agent_id IS NOT NULL AND COALESCE(p_commission_rate,0) > 0 THEN
    INSERT INTO public.agent_transactions (
      company_id, project_id, agent_id, transaction_type, amount,
      related_sale_id, related_transfer_id,
      reference, notes, created_by
    ) VALUES (
      p_company_id, p_project_id, p_agent_id, 'commission_accrued',
      ROUND(v_net_amount * p_commission_rate / 100.0, 2),
      v_new_sale_id, v_transfer_id,
      v_voucher_no, 'Transfer commission accrued', p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'transfer_id',     v_transfer_id,
    'voucher_no',      v_voucher_no,
    'new_sale_id',     v_new_sale_id,
    'new_sale_number', v_new_sale_number,
    'old_installments_voided', v_voided
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;
