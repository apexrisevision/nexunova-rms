-- ============================================================================
-- NEXUNOVA RMS — PAYMENT WALL — Super-admin "Record Payment & Extend" (Build 1)
-- 2026-06-15
-- ----------------------------------------------------------------------------
-- Gap closed: the ONLY writers of subscriptions.current_period_end were
-- cron_expire_subscriptions (never extends) and verify_payment (proof-gated).
-- So a customer who pays OUT-OF-BAND (bank transfer / JazzCash / EasyPaisa)
-- without submitting a proof through the wall could not be extended by the
-- platform owner. This adds a direct, super-admin-only "record payment + extend"
-- path, used from the SA Companies → company detail view.
--
-- Period math is COPIED EXACTLY from verify_payment (no gaps/overlaps):
--   start = (current_period_end < now ? now : current_period_start)
--   end   = GREATEST(current_period_end, now) + (1 month | 1 year)
--
-- It also writes the books trail (a PAID invoice + an APPROVED payment_proofs
-- row, mirroring verify_payment) and an audit_logs row, and reactivates the
-- subscription (status=active, clears cancelled_at / any pending state).
-- Additive + reversible. Super-admin gated via _rms_require_super_admin().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(
  p_company_id uuid, p_cycle text, p_amount numeric,
  p_method text, p_reference text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me public.app_users; v_sub public.subscriptions%ROWTYPE; v_plan public.subscription_plans%ROWTYPE;
  v_co public.companies%ROWTYPE; v_int interval; v_start timestamptz; v_end timestamptz; v_inv uuid; v_no text;
BEGIN
  PERFORM public._rms_require_super_admin();
  v_me := public._rms_caller();
  IF p_cycle NOT IN ('month','year') THEN RETURN jsonb_build_object('success',false,'error','invalid_cycle'); END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id=p_company_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','no_subscription'); END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=v_sub.plan_id LIMIT 1;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  v_int   := CASE WHEN p_cycle='year' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END;
  -- EXACT verify_payment anchor math (extend from current end if future, else from now)
  v_start := CASE WHEN COALESCE(v_sub.current_period_end, now()) < now() THEN now() ELSE v_sub.current_period_start END;
  v_end   := GREATEST(COALESCE(v_sub.current_period_end, now()), now()) + v_int;

  -- PAID invoice for the purchased window
  v_no := public.generate_invoice_number(p_company_id);
  INSERT INTO public.invoices (company_id,subscription_id,invoice_number,plan_id,plan_name,billing_cycle,
      amount,currency,period_start,period_end,issue_date,due_date,status,paid_date,notes,metadata)
  VALUES (p_company_id,v_sub.id,v_no,v_sub.plan_id,COALESCE(v_plan.plan_name,'Manual'),p_cycle||'ly',
      COALESCE(p_amount,v_plan.price,0),COALESCE(v_plan.currency,'PKR'),
      GREATEST(COALESCE(v_sub.current_period_end,now()),now())::date, v_end::date,
      CURRENT_DATE,CURRENT_DATE,'paid',CURRENT_DATE,
      'Manual payment recorded by super-admin'||COALESCE(' · ref '||p_reference,''),
      jsonb_build_object('source','admin_manual','method',p_method,'reference',p_reference,'recorded_by',v_me.id,'note',p_note))
  RETURNING id INTO v_inv;

  -- APPROVED proof mirror (receipt_url is NOT NULL → sentinel for manual entries)
  INSERT INTO public.payment_proofs (company_id,invoice_id,submitted_by,reference_number,amount_paid,currency,
      payment_date,payer_name,receipt_url,status,verified_by,verified_at,verification_notes,metadata)
  VALUES (p_company_id,v_inv,v_me.id,p_reference,COALESCE(p_amount,v_plan.price,0),COALESCE(v_plan.currency,'PKR'),
      CURRENT_DATE,COALESCE(v_co.company_name,''),'admin:manual-recorded','approved',v_me.id,now(),
      'Recorded manually by super-admin'||COALESCE(' · '||p_note,''),
      jsonb_build_object('source','admin_manual','method',p_method));

  -- Extend + reactivate (clears pending_payment / payment_under_review / cancelled)
  UPDATE public.subscriptions SET status='active', current_period_start=v_start, current_period_end=v_end,
      payment_method=COALESCE(p_method,payment_method), cancelled_at=NULL, updated_at=now()
  WHERE id=v_sub.id;

  -- Audit (action constrained to the allowed set → 'UPDATE')
  INSERT INTO public.audit_logs (company_id,table_name,record_id,action,new_data,changed_by,changed_by_name,
      changed_by_role,module,reason,is_sensitive)
  VALUES (p_company_id,'subscriptions',v_sub.id::text,'UPDATE',
      jsonb_build_object('event','manual_payment_extend','cycle',p_cycle,'amount',p_amount,'method',p_method,
        'reference',p_reference,'new_period_end',v_end,'invoice',v_inv),
      v_me.id,v_me.full_name,v_me.role,'billing','Super-admin recorded payment & extended subscription',true);

  RETURN jsonb_build_object('success',true,'company_id',p_company_id,'invoice_id',v_inv,
    'new_period_start',v_start,'new_period_end',v_end,'status','active','amount',COALESCE(p_amount,v_plan.price,0),'cycle',p_cycle);
END; $$;

REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid,text,numeric,text,text,text) TO authenticated;
