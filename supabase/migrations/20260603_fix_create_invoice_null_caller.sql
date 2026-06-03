-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-03  Fix: signup never created the pending-payment invoice → the
-- payment-proof step failed with invoice_not_found.
--
-- signup_new_company (anon SECURITY DEFINER) calls create_invoice_for_subscription()
-- for pending_payment plans, but that helper bailed with 'auth_required' because
-- it ran `v_me := _rms_caller(); IF v_me.id IS NULL THEN RETURN 'auth_required'`
-- — and during signup there is no auth session (auth.uid() is null), so the
-- INSERT INTO invoices was never reached. signup swallowed the error object and
-- returned invoice_id=null → submit_payment_proof later matched WHERE id=null → not found.
--
-- FIX: remove the hard null-caller stop; apply the tenant check ONLY when there
-- is a real caller. Safe because anon has NO direct EXECUTE on this function —
-- the only anon route is via the SECURITY DEFINER signup_new_company (null caller).
-- Body otherwise verbatim.
-- + one-time backfill for existing pending signups that never got an invoice.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_invoice_for_subscription(p_subscription_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me      public.app_users;
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_inv_no  TEXT;
  v_inv_id  UUID;
  v_period_start DATE := CURRENT_DATE;
  v_period_end   DATE;
  v_due_date     DATE := CURRENT_DATE + 7;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found'); END IF;

  v_me := public._rms_caller();
  -- Tenant check ONLY for a real caller. A NULL caller = the SECURITY DEFINER signup
  -- path (signup_new_company → this fn during anon signup). anon has NO direct
  -- EXECUTE on this function, so allowing a null caller does not open an anon hole.
  IF v_me.id IS NOT NULL
     AND NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_sub.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'plan_not_found'); END IF;

  IF v_plan.plan_code = 'free_trial' OR v_plan.price = 0 THEN
    RETURN jsonb_build_object('success', true, 'invoice_id', NULL, 'skipped', true);
  END IF;

  v_period_end := CASE v_plan.billing_cycle
    WHEN 'yearly'  THEN v_period_start + INTERVAL '1 year' - INTERVAL '1 day'
    ELSE                v_period_start + INTERVAL '1 month' - INTERVAL '1 day'
  END;

  v_inv_no := public.generate_invoice_number(v_sub.company_id);

  INSERT INTO public.invoices (
    company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end,
    issue_date, due_date, status
  ) VALUES (
    v_sub.company_id, p_subscription_id, v_inv_no, v_plan.id, v_plan.plan_name,
    v_plan.billing_cycle, v_plan.price, v_plan.currency,
    v_period_start, v_period_end, CURRENT_DATE, v_due_date, 'unpaid'
  ) RETURNING id INTO v_inv_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'invoice_number', v_inv_no);
END;
$function$;

-- One-time backfill: any pending_payment / payment_under_review subscription
-- that never received an invoice (e.g. alkhan / 35e26065).
DO $$
DECLARE r record; res jsonb;
BEGIN
  FOR r IN
    SELECT s.id FROM public.subscriptions s
    WHERE s.status IN ('pending_payment','payment_under_review')
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.subscription_id = s.id)
  LOOP
    res := public.create_invoice_for_subscription(r.id);
    RAISE NOTICE 'backfill sub % -> %', r.id, res;
  END LOOP;
END $$;
