-- ============================================================================
-- Subscription Expiry Enforcement (platform billing)
-- ----------------------------------------------------------------------------
-- Goal: a subscriber may use the RMS ONLY within the tenure they paid for
--       (monthly or yearly). When current_period_end passes, access stops.
--
-- Decisions (Rashid, 2026-06-05):
--   * Hard stop (0-day grace) — block as soon as the period ends.
--   * Auto renewal invoice — on expiry, generate the next-period unpaid
--     invoice and move the subscription to 'pending_payment' so the EXISTING
--     self-serve payment-wall (3-step pay + proof) and verify_payment approval
--     pipeline handle renewal with ZERO frontend changes.
--
-- Lifecycle:
--   active/trialing + period_end < now()
--     ├─ paid plan  → create renewal invoice (unpaid) + status='pending_payment'
--     │               (pending_payment is a blocked status -> RMS locked,
--     │                verify_login returns the unpaid invoice, wall shows pay flow)
--     └─ free trial → status='expired' (no invoice; must upgrade)
--
-- The super-admin's own ADMIN company is always excluded.
-- Runs hourly via pg_cron so the hard-stop lag is at most ~1 hour.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_expire_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_inv_no  TEXT;
  v_pstart  DATE;
  v_pend    DATE;
  v_expired INT := 0;   -- subscriptions moved out of active/trialing
  v_renew   INT := 0;   -- renewal invoices generated
BEGIN
  FOR v_sub IN
    SELECT s.*
    FROM public.subscriptions s
    JOIN public.companies c ON c.id = s.company_id
    WHERE s.status IN ('active', 'trialing')
      AND s.current_period_end IS NOT NULL
      AND s.current_period_end < now()
      AND c.company_code <> 'ADMIN'        -- never lock the super-admin company
  LOOP
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;

    -- Free trial / zero-price → just expire, no invoice to pay.
    IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price, 0) = 0 THEN
      UPDATE public.subscriptions
        SET status = 'expired', updated_at = now()
      WHERE id = v_sub.id;
      v_expired := v_expired + 1;
      CONTINUE;
    END IF;

    -- Paid plan → ensure there is an unpaid renewal invoice to pay against.
    IF NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.subscription_id = v_sub.id AND i.status = 'unpaid'
    ) THEN
      v_pstart := CURRENT_DATE;
      v_pend := CASE v_plan.billing_cycle
        WHEN 'yearly' THEN v_pstart + INTERVAL '1 year'  - INTERVAL '1 day'
        ELSE               v_pstart + INTERVAL '1 month' - INTERVAL '1 day'
      END;
      v_inv_no := public.generate_invoice_number(v_sub.company_id);

      INSERT INTO public.invoices (
        company_id, subscription_id, invoice_number, plan_id, plan_name,
        billing_cycle, amount, currency, period_start, period_end,
        issue_date, due_date, status, notes
      ) VALUES (
        v_sub.company_id, v_sub.id, v_inv_no, v_plan.id, v_plan.plan_name,
        v_plan.billing_cycle, v_plan.price, v_plan.currency,
        v_pstart, v_pend, CURRENT_DATE, CURRENT_DATE + 7, 'unpaid',
        'Renewal invoice (auto-generated at period end)'
      );
      v_renew := v_renew + 1;
    END IF;

    -- Lock the tenant: pending_payment is a blocked status, and verify_login
    -- surfaces the unpaid invoice for it, so the self-serve pay flow appears.
    UPDATE public.subscriptions
      SET status = 'pending_payment', updated_at = now()
    WHERE id = v_sub.id;
    v_expired := v_expired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired,
    'renewal_invoices', v_renew,
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cron_expire_subscriptions() FROM anon, authenticated;

-- Hourly hard-stop sweep (UTC). Idempotent: only touches rows whose period ended.
SELECT cron.schedule(
  'expire-subscriptions',
  '7 * * * *',
  $$ SET search_path = public; SELECT public.cron_expire_subscriptions(); $$
);
