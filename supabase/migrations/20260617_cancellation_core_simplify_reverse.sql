-- ============================================================================
-- NEXUNOVA RMS — Cancellation = RMS record reversal only (money = QuickBooks)
-- 2026-06-17.
-- ----------------------------------------------------------------------------
-- Two fixes in _execute_unit_cancellation_core:
--  1. Available-status lookup was `status_code='available'` (lowercase, no company
--     scope) but statuses are seeded UPPERCASE -> the unit never returned to
--     Available. Now scoped to the unit's company+project via the is_available flag.
--  2. Commission/sales totals were only reversed under a clawback action; with the
--     simplified form ('no_clawback') nothing reversed. Now ALWAYS reverse this
--     voided sale's effect on the agent (sales_count, sales_amount, commission_earned).
-- Refund/forfeiture/clawback params still stored on the record for history.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._execute_unit_cancellation_core(p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid, p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text, p_detailed_reason text, p_overdue_count integer DEFAULT 0, p_days_past_due integer DEFAULT 0, p_notices_sent integer DEFAULT 0, p_last_notice_date date DEFAULT NULL::date, p_legal_action boolean DEFAULT false, p_total_paid numeric DEFAULT 0, p_booking_forfeiture numeric DEFAULT 0, p_cancellation_charges numeric DEFAULT 0, p_late_penalty numeric DEFAULT 0, p_processing_fee numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_other_deductions_note text DEFAULT NULL::text, p_net_refund numeric DEFAULT 0, p_refund_method text DEFAULT NULL::text, p_refund_payment_mode text DEFAULT NULL::text, p_refund_bank_id uuid DEFAULT NULL::uuid, p_refund_reference text DEFAULT NULL::text, p_refund_date date DEFAULT NULL::date, p_expected_refund_date date DEFAULT NULL::date, p_refund_notes text DEFAULT NULL::text, p_agent_commission_total numeric DEFAULT 0, p_agent_commission_paid numeric DEFAULT 0, p_agent_commission_pending numeric DEFAULT 0, p_commission_action text DEFAULT 'no_clawback'::text, p_commission_recovery_amt numeric DEFAULT 0, p_commission_recovery_method text DEFAULT NULL::text, p_commission_notes text DEFAULT NULL::text, p_client_flag text DEFAULT 'none'::text, p_blacklist_reason text DEFAULT NULL::text, p_initiated_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_voucher_no TEXT; v_seq INT; v_cancellation_id UUID; v_available_status_id UUID;
  v_total_deductions NUMERIC; v_sale_net NUMERIC; v_comm_rate NUMERIC; v_comm_amt NUMERIC;
BEGIN
  SELECT id INTO v_available_status_id
  FROM public.category_unit_statuses
  WHERE company_id = p_company_id AND project_id = p_project_id AND is_available = true AND is_active = true
  ORDER BY sort_order LIMIT 1;

  SELECT COALESCE(MAX(
    CASE WHEN cancellation_voucher_no ~ ('^UC-' || EXTRACT(YEAR FROM NOW())::TEXT || '-[0-9]+$')
         THEN SUBSTRING(cancellation_voucher_no FROM 9)::INT ELSE 0 END), 0) + 1 INTO v_seq
  FROM public.unit_cancellations WHERE company_id = p_company_id;
  v_voucher_no := 'UC-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(v_seq::TEXT, 4, '0');
  v_total_deductions := COALESCE(p_booking_forfeiture,0) + COALESCE(p_cancellation_charges,0)
                      + COALESCE(p_late_penalty,0) + COALESCE(p_processing_fee,0) + COALESCE(p_other_deductions,0);

  INSERT INTO public.unit_cancellations (
    company_id, cancellation_voucher_no, cancellation_date, effective_date, unit_id, project_id, sale_id, client_id,
    cancellation_type, reason_category, detailed_reason, overdue_installments_count, days_past_due, notices_sent_count,
    last_notice_date, legal_action_initiated, total_paid, booking_forfeiture, cancellation_charges, late_payment_penalty,
    processing_fee, other_deductions, other_deductions_note, total_deductions, net_refund_amount,
    refund_method, refund_payment_mode, refund_bank_id, refund_reference, refund_date, expected_refund_date, refund_notes,
    agent_id, agent_commission_total, agent_commission_paid, agent_commission_pending,
    commission_action, commission_recovery_amount, commission_recovery_method, commission_notes,
    client_flag, blacklist_reason, initiated_by, notes, status
  ) VALUES (
    p_company_id, v_voucher_no, p_cancellation_date, p_effective_date, p_unit_id, p_project_id, p_sale_id, p_client_id,
    p_cancellation_type, p_reason_category, p_detailed_reason, p_overdue_count, p_days_past_due, p_notices_sent,
    p_last_notice_date, p_legal_action, p_total_paid, p_booking_forfeiture, p_cancellation_charges, p_late_penalty,
    p_processing_fee, p_other_deductions, p_other_deductions_note, v_total_deductions, p_net_refund,
    p_refund_method, p_refund_payment_mode, p_refund_bank_id, p_refund_reference, p_refund_date, p_expected_refund_date, p_refund_notes,
    p_agent_id, p_agent_commission_total, p_agent_commission_paid, p_agent_commission_pending,
    p_commission_action, p_commission_recovery_amt, p_commission_recovery_method, p_commission_notes,
    p_client_flag, p_blacklist_reason, p_initiated_by, p_notes, 'completed'
  ) RETURNING id INTO v_cancellation_id;

  UPDATE public.sales
  SET is_active=false, closed_at=NOW(), closure_reason='cancelled', cancellation_reason=p_detailed_reason,
      cancellation_date=p_cancellation_date, cancelled_by=p_initiated_by, status='cancelled', updated_at=NOW()
  WHERE id = p_sale_id AND company_id = p_company_id;

  IF v_available_status_id IS NOT NULL THEN
    UPDATE public.units SET status_id = v_available_status_id, updated_at = NOW()
    WHERE id = p_unit_id AND company_id = p_company_id;
  END IF;

  UPDATE public.installments SET status='cancelled', updated_at=NOW()
  WHERE sale_id = p_sale_id AND company_id = p_company_id AND status = 'pending';

  IF p_agent_id IS NOT NULL THEN
    SELECT (COALESCE(price_per_sqft,0)*COALESCE(area_sqft,0) - COALESCE(discount,0)),
           COALESCE(commission_rate, (SELECT commission_percent FROM public.agents WHERE id=p_agent_id AND company_id=p_company_id))
      INTO v_sale_net, v_comm_rate
      FROM public.sales WHERE id=p_sale_id AND company_id=p_company_id;
    v_comm_amt := COALESCE(v_sale_net,0) * COALESCE(v_comm_rate,0) / 100;
    UPDATE public.agents SET
      total_sales_count       = GREATEST(0, COALESCE(total_sales_count,0) - 1),
      total_sales_amount      = GREATEST(0, COALESCE(total_sales_amount,0) - COALESCE(v_sale_net,0)),
      total_commission_earned = GREATEST(0, COALESCE(total_commission_earned,0) - COALESCE(v_comm_amt,0)),
      updated_at = NOW()
    WHERE id = p_agent_id AND company_id = p_company_id;
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

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id, 'voucher_no', v_voucher_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
