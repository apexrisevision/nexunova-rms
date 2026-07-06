-- ============================================================================
-- GROUP BILLING ALIGNMENT + PAID (owner-authorized 2026-07-06)
-- ----------------------------------------------------------------------------
-- Fourteen Group / FMH / Awami onto ONE tenure: all Basic ₨10,000/month, invoice
-- ISSUED on the 20th, DUE on the 25th, renewing on the 25th. Amar Taj paid FMH +
-- Awami's current cycle; receipts emailed to amartaj55@gmail.com.
--
-- This file consolidates the owner-authorized correction that was applied live
-- (via several MCP steps). Two parts: (A) reusable function changes, (B) the
-- prod-specific data fixes (guarded).
--
-- IDs: Awami co 96d210e7… sub f1c72f87… inv aeb0e820… (INV-2026-0002→1024)
--      FMH   co 71d33e07… sub 4bd7ce7a… inv 02926d63… (INV-2026-0004→1025; 0007 voided)
--      Fourteen sub c36481c3… (anchor; period_end kept at 25 Jul)
-- ============================================================================

-- ── A. FUNCTION CHANGES (forward-reusable) ──────────────────────────────────

-- Invoice numbering floored at 1000 so numbers never reveal the true (low) count.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_year INT := EXTRACT(YEAR FROM NOW())::INT; v_seq INT; v_num TEXT;
BEGIN
  SELECT GREATEST(COALESCE(MAX(NULLIF(REGEXP_REPLACE(invoice_number, '^INV-\d{4}-', ''), '')::INT), 0), 1000) + 1
    INTO v_seq FROM public.invoices WHERE invoice_number LIKE 'INV-' || v_year || '-%';
  v_num := 'INV-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  WHILE EXISTS (SELECT 1 FROM public.invoices WHERE invoice_number = v_num) LOOP
    v_seq := v_seq + 1; v_num := 'INV-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  END LOOP;
  RETURN v_num;
END $$;

-- Invoice ISSUE date = 20th of the cycle month (due date already = 25th).
CREATE OR REPLACE FUNCTION public._platform_invoice_issue_date(p_anchor date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (date_trunc('month', p_anchor)::date + 19); $$;

CREATE OR REPLACE FUNCTION public._ensure_renewal_invoice(p_sub_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE; v_plan public.subscription_plans%ROWTYPE;
  v_inv uuid; v_no text; v_ps date := CURRENT_DATE; v_pe date; v_due date; v_iss date; v_amt numeric;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price,0) = 0 THEN RETURN NULL; END IF;
  SELECT id INTO v_inv FROM public.invoices
   WHERE subscription_id = p_sub_id AND status <> 'paid' AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_inv IS NOT NULL THEN RETURN v_inv; END IF;
  v_pe  := CASE v_plan.billing_cycle WHEN 'yearly' THEN v_ps + INTERVAL '1 year' - INTERVAL '1 day'
                                     ELSE v_ps + INTERVAL '1 month' - INTERVAL '1 day' END;
  v_due := public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  v_iss := public._platform_invoice_issue_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  v_amt := COALESCE(NULLIF(v_sub.amount, 0), v_plan.price);
  v_no  := public.generate_invoice_number(v_sub.company_id);
  INSERT INTO public.invoices (company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end, issue_date, due_date, status, notes)
  VALUES (v_sub.company_id, p_sub_id, v_no, v_plan.id, v_plan.plan_name, v_plan.billing_cycle, v_amt,
    COALESCE(v_sub.currency, v_plan.currency), v_ps, v_pe, v_iss, v_due, 'unpaid', 'Renewal invoice')
  RETURNING id INTO v_inv;
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION public.create_invoice_for_subscription(p_subscription_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me public.app_users; v_sub public.subscriptions%ROWTYPE; v_plan public.subscription_plans%ROWTYPE;
  v_inv_no TEXT; v_inv_id UUID; v_ps DATE := CURRENT_DATE; v_pe DATE; v_due DATE; v_iss DATE; v_amt numeric;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found'); END IF;
  v_me := public._rms_caller();
  IF v_me.id IS NOT NULL AND NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_sub.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'plan_not_found'); END IF;
  IF v_plan.plan_code = 'free_trial' OR v_plan.price = 0 THEN
    RETURN jsonb_build_object('success', true, 'invoice_id', NULL, 'skipped', true); END IF;
  SELECT id INTO v_inv_id FROM public.invoices
   WHERE subscription_id = p_subscription_id AND status <> 'paid' AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_inv_id IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'existing', true); END IF;
  v_pe := CASE v_plan.billing_cycle WHEN 'yearly' THEN v_ps + INTERVAL '1 year' - INTERVAL '1 day'
                                    ELSE v_ps + INTERVAL '1 month' - INTERVAL '1 day' END;
  v_due := public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  v_iss := public._platform_invoice_issue_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  v_amt := COALESCE(NULLIF(v_sub.amount, 0), v_plan.price);
  v_inv_no := public.generate_invoice_number(v_sub.company_id);
  INSERT INTO public.invoices (company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end, issue_date, due_date, status)
  VALUES (v_sub.company_id, p_subscription_id, v_inv_no, v_plan.id, v_plan.plan_name, v_plan.billing_cycle,
    v_amt, COALESCE(v_sub.currency, v_plan.currency), v_ps, v_pe, v_iss, v_due, 'unpaid')
  RETURNING id INTO v_inv_id;
  RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'invoice_number', v_inv_no);
END $$;

-- ── B. DATA FIXES (prod-specific, owner-authorized; guarded) ────────────────
DO $$
DECLARE v_basic uuid; v_actor uuid;
  v_awa_sub uuid := 'f1c72f87-2621-4e5c-a3b2-70bbf46160e2';
  v_fmh_sub uuid := '4bd7ce7a-edeb-450a-adde-cfca0bee48f9';
  v_awa_inv uuid := 'aeb0e820-eca0-46a9-887a-b0d05fb56c13';
  v_fmh_inv uuid := '02926d63-e5fe-46a4-ad9d-b72b82ba2e55';
  v_awa_co  uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  v_fmh_co  uuid := '71d33e07-e55c-49af-8f5b-fdd7fd6e8612';
BEGIN
  SELECT id INTO v_basic FROM public.subscription_plans WHERE plan_code='basic_monthly' LIMIT 1;
  SELECT id INTO v_actor FROM public.app_users WHERE is_super_admin LIMIT 1;

  -- subscriptions: Basic ₨10k, active, 25 Jun–25 Jul; Fourteen kept at 25 Jul
  UPDATE public.subscriptions SET plan_id=v_basic, amount=10000, billing_cycle='monthly', status='active',
     current_period_start='2026-06-25 12:00:00+00', current_period_end='2026-07-25 18:59:59+00', updated_at=now()
   WHERE id IN (v_awa_sub, v_fmh_sub);
  UPDATE public.subscriptions SET current_period_end='2026-07-25 18:59:59+00', updated_at=now()
   WHERE id='c36481c3-e62c-41c5-894b-f9e3b067baa0' AND current_period_end='2026-08-25 18:59:59+00';

  -- billing contacts → Amar Taj (Fourteen stays Jasim)
  UPDATE public.companies SET business_email='amartaj55@gmail.com', updated_at=now() WHERE id IN (v_awa_co, v_fmh_co);

  -- grace_days = 0 for both (upsert)
  UPDATE public.platform_settings SET setting_value=to_jsonb(0), updated_at=now()
   WHERE setting_key='billing_grace_days' AND organization_id IN (v_awa_co, v_fmh_co);
  INSERT INTO public.platform_settings (organization_id, setting_key, setting_value, category)
  SELECT cid, 'billing_grace_days', to_jsonb(0), 'billing' FROM (VALUES (v_awa_co), (v_fmh_co)) v(cid)
  WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings p WHERE p.organization_id=v.cid AND p.setting_key='billing_grace_days');

  -- invoices: Basic ₨10,000, period 25 Jun–25 Jul, issue 20 Jun / due 25 Jun, PAID,
  -- renumbered to a higher base (Awami 1024, FMH 1025). FMH INV-0007 voided.
  UPDATE public.invoices SET invoice_number='INV-2026-1024', amount=10000, plan_id=v_basic, plan_name='Basic',
     billing_cycle='monthly', period_start='2026-06-25', period_end='2026-07-25', issue_date='2026-06-20',
     due_date='2026-06-25', status='paid', paid_date=CURRENT_DATE, updated_at=now()
   WHERE id=v_awa_inv;
  UPDATE public.invoices SET invoice_number='INV-2026-1025', amount=10000, plan_name='Basic',
     billing_cycle='monthly', period_start='2026-06-25', period_end='2026-07-25', issue_date='2026-06-20',
     due_date='2026-06-25', status='paid', paid_date=CURRENT_DATE, updated_at=now()
   WHERE id=v_fmh_inv;
  UPDATE public.invoices SET status='cancelled', voided_at=now(), updated_at=now()
   WHERE invoice_number='INV-2026-0007' AND company_id=v_fmh_co AND voided_at IS NULL;

  -- payments recorded (₨10,000 each; approved). Guarded against re-insert.
  INSERT INTO public.payment_proofs (company_id, invoice_id, submitted_by, reference_number, amount_paid,
      currency, payment_date, payer_name, receipt_url, status, verified_by, verified_at, verification_notes, metadata)
  SELECT v_fmh_co, v_fmh_inv, v_actor, 'FMH-0706', 10000, 'PKR', CURRENT_DATE, 'FMH (Amar Taj)',
      'admin:manual-recorded', 'approved', v_actor, now(), 'Owner-recorded: FMH paid ₨10,000',
      jsonb_build_object('source','admin_manual','method','manual')
  WHERE NOT EXISTS (SELECT 1 FROM public.payment_proofs WHERE invoice_id=v_fmh_inv AND reference_number='FMH-0706');
  INSERT INTO public.payment_proofs (company_id, invoice_id, submitted_by, reference_number, amount_paid,
      currency, payment_date, payer_name, receipt_url, status, verified_by, verified_at, verification_notes, metadata)
  SELECT v_awa_co, v_awa_inv, v_actor, 'AWAMI-0706', 10000, 'PKR', CURRENT_DATE, 'Awami Market (Amar Taj)',
      'admin:manual-recorded', 'approved', v_actor, now(), 'Owner-recorded: Awami paid ₨10,000',
      jsonb_build_object('source','admin_manual','method','manual')
  WHERE NOT EXISTS (SELECT 1 FROM public.payment_proofs WHERE invoice_id=v_awa_inv AND reference_number='AWAMI-0706');

  -- audit trail (action limited to allowed set → 'UPDATE'; detail in after_data)
  INSERT INTO public.platform_audit_log (organization_id,user_id,user_name,user_role,entity_type,entity_id,action,after_data,module,reason,is_sensitive) VALUES
   (v_awa_co,v_actor,'super-admin (billing)','owner','invoice','INV-2026-1024','UPDATE',
     jsonb_build_object('event','correct+paid','plan','Pro→Basic','amount',10000,'status','paid','period_end','2026-07-25'),'billing','Awami→Basic ₨10k, paid, 25 Jul cycle',true),
   (v_fmh_co,v_actor,'super-admin (billing)','owner','invoice','INV-2026-1025','UPDATE',
     jsonb_build_object('event','correct+paid','amount',10000,'status','paid','period_end','2026-07-25','was','wrongly_paid_then_reopened'),'billing','FMH ₨10k paid, 25 Jul cycle',true),
   ('3249e3b5-c411-4f5f-ae48-0246304c9c87',v_actor,'super-admin (billing)','owner','subscription','c36481c3-e62c-41c5-894b-f9e3b067baa0','UPDATE',
     jsonb_build_object('event','revert_grace_extend','period_end','25 Jul'),'billing','Fourteen anchor kept at 25 Jul',true);
END $$;
