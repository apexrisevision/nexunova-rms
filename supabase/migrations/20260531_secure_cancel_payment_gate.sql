-- P0 Security Hardening — cancel_payment approval gate (Phase 1A, vertical slice)
-- Closes the bypass where any authenticated user could void payments via rpc with
-- no role/approval check. Pattern mirrors execute_unit_cancellation:
--   public wrapper (gate) -> _rms_restriction_level -> create_approval_request | _core
--   _core is REVOKED from clients; only SECURITY DEFINER callers (wrapper, approve_request) run it.

-- M0: restriction rule (default soft) for payment_void
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'payment_void', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='payment_void');

-- Executor (original cancel_payment body), internal-only
CREATE OR REPLACE FUNCTION public._cancel_payment_core(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_payment record;
BEGIN
  SELECT id, payment_code, voucher_code, amount, installment_id, status
  INTO v_payment FROM public.payments
  WHERE id = p_payment_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;
  IF v_payment.status = 'cancelled' THEN RETURN jsonb_build_object('success', false, 'error', 'already_cancelled'); END IF;
  UPDATE public.payments SET status='cancelled', updated_at=NOW() WHERE id=p_payment_id AND company_id=p_company_id;
  IF v_payment.installment_id IS NOT NULL THEN
    UPDATE public.installments
    SET amount_paid = GREATEST(0, amount_paid - v_payment.amount),
        status = CASE WHEN GREATEST(0, amount_paid - v_payment.amount)=0 THEN 'pending'
                      WHEN GREATEST(0, amount_paid - v_payment.amount) < amount_due THEN 'partial' ELSE 'paid' END,
        updated_at = NOW()
    WHERE id = v_payment.installment_id AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'payment_code', v_payment.payment_code, 'voucher_code', v_payment.voucher_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
REVOKE EXECUTE ON FUNCTION public._cancel_payment_core(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Gate wrapper (replaces old 3-arg public cancel_payment)
DROP FUNCTION IF EXISTS public.cancel_payment(uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION public.cancel_payment(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

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
GRANT EXECUTE ON FUNCTION public.cancel_payment(uuid,uuid,uuid,text) TO authenticated;

-- NOTE: approve_request gains a 'payment_void' apply-branch in companion migration
-- 20260531_approve_request_payment_void_branch.sql (calls _cancel_payment_core from payload).
