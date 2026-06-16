-- ════════════════════════════════════════════════════════════════════════════
-- Payment cancel/delete must reverse the installment allocation.
-- Applied to prod via MCP apply_migration 2026-06-16.
--
-- Root cause: payments are FIFO-allocated across installments via
-- _rms_credit_installments_fifo with payments.installment_id left NULL. But
-- _cancel_payment_core / delete_payment only reversed the allocation WHEN
-- installment_id IS NOT NULL → for every real payment that branch was skipped,
-- so cancelling left installments.amount_paid inflated (collection overstated /
-- outstanding understated). Verified live: BKG-232 (+130k), BKG-183 (+100k).
--
-- Fix: a canonical, idempotent "rebuild this sale's allocation from the
-- remaining (non-cancelled) payments" helper, called after cancel and delete.
-- Self-healing: re-derives amount_paid/status from scratch every time.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._rms_rebuild_sale_allocation(p_company_id uuid, p_sale_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_received numeric;
  v_applied  numeric;
BEGIN
  UPDATE public.installments
     SET amount_paid = 0, updated_at = NOW()
   WHERE sale_id = p_sale_id AND company_id = p_company_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_received
    FROM public.payments
   WHERE sale_id = p_sale_id AND company_id = p_company_id
     AND COALESCE(status, '') <> 'cancelled';

  v_applied := public._rms_credit_installments_fifo(p_company_id, p_sale_id, v_received);

  UPDATE public.installments
     SET status = CASE
                    WHEN amount_due > 0 AND amount_paid >= amount_due - 0.005 THEN 'paid'
                    WHEN amount_paid > 0                                       THEN 'partial'
                    WHEN due_date < CURRENT_DATE                              THEN 'overdue'
                    ELSE 'pending'
                  END,
         paid_at = CASE WHEN amount_due > 0 AND amount_paid >= amount_due - 0.005 THEN paid_at ELSE NULL END,
         updated_at = NOW()
   WHERE sale_id = p_sale_id AND company_id = p_company_id;

  RETURN v_applied;
END;
$function$;

CREATE OR REPLACE FUNCTION public._cancel_payment_core(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_payment record;
BEGIN
  SELECT id, payment_code, voucher_code, amount, installment_id, sale_id, status
  INTO v_payment FROM public.payments
  WHERE id = p_payment_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;
  IF v_payment.status = 'cancelled' THEN RETURN jsonb_build_object('success', false, 'error', 'already_cancelled'); END IF;

  UPDATE public.payments SET status='cancelled', updated_at=NOW() WHERE id=p_payment_id AND company_id=p_company_id;

  -- Payments are FIFO-allocated with installment_id NULL → rebuild the whole
  -- sale from the remaining (non-cancelled) receipts.
  IF v_payment.sale_id IS NOT NULL THEN
    PERFORM public._rms_rebuild_sale_allocation(p_company_id, v_payment.sale_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_code', v_payment.payment_code, 'voucher_code', v_payment.voucher_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id uuid, p_company_id uuid, p_deleted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_amount numeric; v_sale_id uuid; v_pay_code text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;

  SELECT amount, sale_id, payment_code INTO v_amount, v_sale_id, v_pay_code
  FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','payment_not_found'); END IF;

  DELETE FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id;

  IF v_sale_id IS NOT NULL THEN
    PERFORM public._rms_rebuild_sale_allocation(p_company_id, v_sale_id);
  END IF;

  RETURN jsonb_build_object('success',true,'payment_code',v_pay_code,'reversed',v_amount);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;
