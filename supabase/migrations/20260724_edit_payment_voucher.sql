-- edit_payment — correct a wrongly-posted receipt IN PLACE (same voucher number).
-- Money integrity is preserved the same way cancel_payment does it: payments are
-- FIFO-allocated (installment_id NULL), so after changing the row we rebuild the
-- whole sale's allocation from the surviving receipts. Every edit is audit-logged
-- (old->new via _trg_audit) with a mandatory reason. Admin/owner only; others must
-- void & re-enter (which itself needs approval) or ask an admin.
CREATE OR REPLACE FUNCTION public.edit_payment(
  p_payment_id uuid,
  p_company_id uuid,
  p_data       jsonb,
  p_reason     text DEFAULT NULL,
  p_edited_by  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me         public.app_users := public._rms_caller();
  v_pay        record;
  v_new_amount numeric;
  v_new_date   date;
  v_new_method text;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  -- Editing received money is admin/owner only.
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'Only an admin/owner can edit a receipt. Void it and enter a fresh one, or ask an admin.');
  END IF;

  -- Reason mandatory (min 10 chars) — same rule as a void.
  IF length(TRIM(COALESCE(p_reason,''))) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required',
      'message', 'A reason (at least 10 characters) is required to edit a receipt.');
  END IF;

  SELECT id, sale_id, status, amount INTO v_pay
  FROM public.payments WHERE id = p_payment_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;
  IF v_pay.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cancelled',
      'message', 'This voucher is cancelled and cannot be edited.'); END IF;

  -- Validate the mutable money fields when supplied.
  IF p_data ? 'amount' THEN
    v_new_amount := NULLIF(p_data->>'amount','')::numeric;
    IF v_new_amount IS NULL OR v_new_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'bad_amount',
        'message', 'Amount must be greater than zero.'); END IF;
  END IF;
  v_new_date   := CASE WHEN p_data ? 'payment_date'   THEN NULLIF(p_data->>'payment_date','')::date END;
  v_new_method := CASE WHEN p_data ? 'payment_method' THEN NULLIF(p_data->>'payment_method','')      END;

  PERFORM set_config('rms.audit_reason', p_reason, true);

  UPDATE public.payments SET
    amount         = COALESCE(v_new_amount, amount),
    payment_date   = COALESCE(v_new_date, payment_date),           -- NOT NULL: keep old if blank
    payment_method = COALESCE(v_new_method, payment_method),        -- keep old if blank
    reference_no   = CASE WHEN p_data ? 'reference_no' THEN NULLIF(p_data->>'reference_no','') ELSE reference_no END,
    bank_name      = CASE WHEN p_data ? 'bank_name'    THEN NULLIF(p_data->>'bank_name','')    ELSE bank_name    END,
    notes          = CASE WHEN p_data ? 'notes'        THEN NULLIF(p_data->>'notes','')        ELSE notes        END,
    updated_at     = NOW()
  WHERE id = p_payment_id AND company_id = p_company_id;

  -- Re-FIFO the sale so balances / recovery / portfolio all reflect the new amount.
  IF v_pay.sale_id IS NOT NULL THEN
    PERFORM public._rms_rebuild_sale_allocation(p_company_id, v_pay.sale_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

GRANT EXECUTE ON FUNCTION public.edit_payment(uuid, uuid, jsonb, text, uuid) TO authenticated, service_role;
