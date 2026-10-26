-- 20261026a: the super-admin billing buttons could not save.
--   * platform_audit_log is a view on audit_logs, and audit_logs_action_check did
--     not allow 'payment_recorded' (admin_extend_subscription = "Record Payment &
--     Extend") or 'invoice_sent' (mark_invoice_sent = "Generate & Send Invoice"),
--     so both calls failed at their last step and rolled back. Both are allowed now.
--   * admin_extend_subscription: payment_proofs.reference_number is NOT NULL, so a
--     payment recorded without a reference failed; it now saves "Manual entry".
-- Found 2026-10-26 when Awami and FMH were renewed (done by hand that day).

ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action = ANY (ARRAY[
  'INSERT','UPDATE','DELETE','approval_applied','approval_rejected','restriction_warning','restriction_block',
  'payment_recorded','invoice_sent']));

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(p_company_id uuid, p_cycle text, p_amount numeric, p_method text, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_sub public.subscriptions%ROWTYPE; v_plan public.subscription_plans%ROWTYPE;
  v_co public.companies%ROWTYPE; v_int interval; v_start timestamptz; v_end timestamptz;
  v_inv uuid; v_no text; v_amt numeric; v_inv_amt numeric; v_recv numeric; v_new_status text;
BEGIN
  PERFORM public._rms_require_super_admin();
  v_me := public._rms_caller();
  IF p_cycle NOT IN ('month','year') THEN RETURN jsonb_build_object('success',false,'error','invalid_cycle'); END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id=p_company_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','no_subscription'); END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=v_sub.plan_id LIMIT 1;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;
  v_int   := CASE WHEN p_cycle='year' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END;
  v_start := CASE WHEN COALESCE(v_sub.current_period_end, now()) < now() THEN now() ELSE v_sub.current_period_start END;
  v_end   := GREATEST(COALESCE(v_sub.current_period_end, now()), now()) + v_int;
  v_amt   := COALESCE(p_amount, v_plan.price, 0);
  SELECT id INTO v_inv FROM public.invoices
   WHERE subscription_id = v_sub.id AND status <> 'paid' AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_inv IS NULL THEN
    v_no := public.generate_invoice_number(p_company_id);
    INSERT INTO public.invoices (company_id,subscription_id,invoice_number,plan_id,plan_name,billing_cycle,
        amount,currency,period_start,period_end,issue_date,due_date,status,notes,metadata)
    VALUES (p_company_id,v_sub.id,v_no,v_sub.plan_id,COALESCE(v_plan.plan_name,'Manual'),p_cycle||'ly',
        v_amt,COALESCE(v_plan.currency,'PKR'),
        GREATEST(COALESCE(v_sub.current_period_end,now()),now())::date, v_end::date,
        CURRENT_DATE, public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE)),
        'unpaid','Manual payment recorded by super-admin'||COALESCE(' · ref '||p_reference,''),
        jsonb_build_object('source','admin_manual','method',p_method,'reference',p_reference,'recorded_by',v_me.id,'note',p_note))
    RETURNING id INTO v_inv;
  END IF;
  INSERT INTO public.payment_proofs (company_id,invoice_id,submitted_by,reference_number,amount_paid,currency,
      payment_date,payer_name,receipt_url,status,verified_by,verified_at,verification_notes,metadata)
  VALUES (p_company_id,v_inv,v_me.id,COALESCE(NULLIF(btrim(p_reference),''),'Manual entry'),v_amt,COALESCE(v_plan.currency,'PKR'),
      CURRENT_DATE,COALESCE(v_co.company_name,''),'admin:manual-recorded','approved',v_me.id,now(),
      'Recorded manually by super-admin'||COALESCE(' · '||p_note,''),
      jsonb_build_object('source','admin_manual','method',p_method));
  SELECT amount INTO v_inv_amt FROM public.invoices WHERE id = v_inv;
  v_recv := public._invoice_received(v_inv);
  v_new_status := CASE WHEN v_recv >= v_inv_amt THEN 'paid' WHEN v_recv > 0 THEN 'partial' ELSE 'unpaid' END;
  UPDATE public.invoices SET status = v_new_status,
      paid_date = CASE WHEN v_new_status='paid' THEN CURRENT_DATE ELSE paid_date END, updated_at = now()
   WHERE id = v_inv;
  UPDATE public.subscriptions SET status='active', current_period_start=v_start, current_period_end=v_end,
      payment_method=COALESCE(p_method,payment_method), cancelled_at=NULL, updated_at=now() WHERE id=v_sub.id;
  INSERT INTO public.audit_logs (company_id,table_name,record_id,action,new_data,changed_by,changed_by_name,
      changed_by_role,module,reason,is_sensitive)
  VALUES (p_company_id,'subscriptions',v_sub.id::text,'UPDATE',
      jsonb_build_object('event','manual_payment_extend','cycle',p_cycle,'amount',p_amount,'method',p_method,
        'reference',p_reference,'new_period_end',v_end,'invoice',v_inv,'invoice_status',v_new_status),
      v_me.id,v_me.full_name,v_me.role,'billing','Super-admin recorded payment & extended subscription',true);
  INSERT INTO public.platform_audit_log (organization_id,user_id,user_name,user_role,entity_type,entity_id,
      action,after_data,module,reason,is_sensitive)
  VALUES (p_company_id,v_me.id,v_me.full_name,v_me.role,'invoice',v_inv::text,'payment_recorded',
      jsonb_build_object('amount',v_amt,'method',p_method,'reference',p_reference,'invoice_status',v_new_status,'received',v_recv),
      'billing','Super-admin recorded payment & extended subscription',true);
  RETURN jsonb_build_object('success',true,'company_id',p_company_id,'invoice_id',v_inv,
    'invoice_status',v_new_status,'received',v_recv,'balance',GREATEST(v_inv_amt-v_recv,0),
    'new_period_start',v_start,'new_period_end',v_end,'status','active','amount',v_amt,'cycle',p_cycle);
END $function$;
