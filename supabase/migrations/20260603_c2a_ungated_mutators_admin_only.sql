-- BATCH C2-a (2026-06-03): gate destructive + financial mutators as ADMIN-ONLY.
-- These RPCs previously had NO caller gate (only filtered id + p_company_id, both attacker-supplied),
-- letting any authenticated tenant user delete/modify another tenant's financial rows.
-- Prelude proven in cancel_payment: null->auth_required, tenant-match->wrong_tenant, non-admin->forbidden.
-- (manager/recovery/accounts/staff are all non-admin => blocked.) Bodies otherwise unchanged.
-- EXCLUDED: fn_mark_unit_ex_cancelled — it is a trigger function (RETURNS trigger, bound to unit_cancellations),
--   not exposed by PostgREST as an RPC and unusable outside trigger context; gating is impossible/unnecessary.

CREATE OR REPLACE FUNCTION public.delete_client(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_rows integer;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE client_id=p_id AND company_id=p_company_id AND status<>'cancelled') THEN
    RAISE EXCEPTION 'client_has_active_financials';
  END IF;
  UPDATE public.clients SET status='inactive', updated_at=now()
  WHERE id=p_id AND company_id=p_company_id AND status<>'inactive';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('success',false,'error','Client not found, already inactive, or access denied'); END IF;
  RETURN jsonb_build_object('success',true,'action','deactivated');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id uuid, p_company_id uuid, p_deleted_by uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_amount numeric; v_inst_id uuid; v_pay_code text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT amount, installment_id, payment_code INTO v_amount, v_inst_id, v_pay_code
  FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','payment_not_found'); END IF;
  IF v_inst_id IS NOT NULL THEN
    UPDATE public.installments SET
      amount_paid = GREATEST(0, amount_paid - v_amount),
      status = CASE WHEN GREATEST(0, amount_paid - v_amount) <= 0 THEN 'pending'
                    WHEN GREATEST(0, amount_paid - v_amount) >= amount_due - 0.01 THEN 'paid'
                    ELSE 'partial' END,
      updated_at = NOW()
    WHERE id=v_inst_id AND company_id=p_company_id;
  END IF;
  DELETE FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true,'payment_code',v_pay_code,'reversed',v_amount);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.confirm_payment_deposit(p_payment_id uuid, p_company_id uuid, p_deposit_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.payments SET deposit_confirmed=true, deposit_date=p_deposit_date, updated_at=now()
  WHERE id=p_payment_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Payment not found'); END IF;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.defer_installment(p_installment_id uuid, p_company_id uuid, p_new_due_date date, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_row installments%ROWTYPE; v_new_status text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT * INTO v_row FROM installments WHERE id=p_installment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','installment_not_found'); END IF;
  IF v_row.status='paid' OR (v_row.amount_due - COALESCE(v_row.amount_paid,0)) <= 0 THEN
    RETURN jsonb_build_object('success',false,'error','installment_already_paid'); END IF;
  IF p_new_due_date IS NULL THEN RETURN jsonb_build_object('success',false,'error','new_due_date_required'); END IF;
  v_new_status := CASE WHEN COALESCE(v_row.amount_paid,0) > 0 THEN 'partial'
                       WHEN p_new_due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END;
  UPDATE installments SET due_date=p_new_due_date, status=v_new_status,
    notes = COALESCE(notes || ' | ', '') || 'Deferred from ' || COALESCE(v_row.due_date::text,'?')
            || ' to ' || p_new_due_date::text || COALESCE(': ' || p_reason, ''),
    updated_at = NOW()
  WHERE id=p_installment_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true,'id',p_installment_id,'new_due_date',p_new_due_date,'status',v_new_status);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.update_additional_receivable(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.additional_receivables SET
    amount=COALESCE((p_data->>'amount')::numeric, amount),
    description=COALESCE(p_data->>'description', description),
    due_date=COALESCE(NULLIF(p_data->>'due_date','')::date, due_date),
    status=COALESCE(p_data->>'status', status),
    paid_amount=COALESCE((p_data->>'paid_amount')::numeric, paid_amount),
    paid_date=COALESCE(NULLIF(p_data->>'paid_date','')::date, paid_date),
    notes=COALESCE(NULLIF(p_data->>'notes',''), notes),
    updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
END $function$;

CREATE OR REPLACE FUNCTION public.update_payable(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.payables SET
    status=COALESCE(p_data->>'status', status),
    paid_amount=COALESCE((p_data->>'paid_amount')::numeric, paid_amount),
    paid_date=COALESCE(NULLIF(p_data->>'paid_date','')::date, paid_date),
    payment_method=COALESCE(NULLIF(p_data->>'payment_method',''), payment_method),
    bank_id=COALESCE(NULLIF(p_data->>'bank_id','')::uuid, bank_id),
    reference=COALESCE(NULLIF(p_data->>'reference',''), reference),
    notes=COALESCE(NULLIF(p_data->>'notes',''), notes),
    updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
END $function$;

CREATE OR REPLACE FUNCTION public.add_legal_cost(p_company_id uuid, p_case_id uuid, p_cost jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_costs jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT legal_costs INTO v_costs FROM public.legal_cases WHERE id=p_case_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Case not found'); END IF;
  UPDATE public.legal_cases SET legal_costs=COALESCE(v_costs,'[]'::jsonb) || jsonb_build_array(p_cost), updated_at=now()
  WHERE id=p_case_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.remove_legal_cost(p_company_id uuid, p_case_id uuid, p_index integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_costs jsonb; v_new jsonb := '[]'::jsonb; i integer;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT legal_costs INTO v_costs FROM public.legal_cases WHERE id=p_case_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Case not found'); END IF;
  FOR i IN 0..jsonb_array_length(COALESCE(v_costs,'[]'::jsonb)) - 1 LOOP
    IF i <> p_index THEN v_new := v_new || jsonb_build_array(v_costs -> i); END IF;
  END LOOP;
  UPDATE public.legal_cases SET legal_costs=v_new, updated_at=now() WHERE id=p_case_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.remove_legal_document(p_company_id uuid, p_case_id uuid, p_index integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_docs jsonb; v_new jsonb := '[]'::jsonb; i integer;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT documents INTO v_docs FROM public.legal_cases WHERE id=p_case_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Case not found'); END IF;
  FOR i IN 0..jsonb_array_length(COALESCE(v_docs,'[]'::jsonb)) - 1 LOOP
    IF i <> p_index THEN v_new := v_new || jsonb_build_array(v_docs -> i); END IF;
  END LOOP;
  UPDATE public.legal_cases SET documents=v_new, updated_at=now() WHERE id=p_case_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
