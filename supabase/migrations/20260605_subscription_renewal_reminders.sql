-- ============================================================================
-- Subscription Renewal Reminders (platform billing — dunning)
-- ----------------------------------------------------------------------------
-- Emails + in-app notifications to the tenant owner BEFORE expiry, so they
-- renew in time and the system keeps running.
--
-- Decisions (Rashid, 2026-06-05):
--   * Touchpoints: 5, 3, 1 days before expiry  (+ an "expired" notice the
--     moment the period ends — fired from cron_expire_subscriptions).
--   * Channel: Email (Resend) for now. WhatsApp deferred to Phase 2 (needs a
--     Meta-approved business-initiated template + verified creds + a proven
--     send — message_log is currently empty, i.e. never sent in prod).
--
-- Email transport reuses the proven `send-otp-email` Edge Function (Resend),
-- invoked via pg_net exactly like the auth OTP RPCs. New purposes added there:
-- 'renewal_reminder' and 'subscription_expired'.
--
-- Dedup: platform_email_log row per (org, template_key, period_end, days_left)
-- so a threshold never double-sends.
-- ============================================================================

-- ── Pre-expiry reminders: 5 / 3 / 1 days out (run daily) ────────────────────
CREATE OR REPLACE FUNCTION public.cron_subscription_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v          RECORD;
  v_plan     public.subscription_plans%ROWTYPE;
  v_owner    RECORD;
  v_days     INT;
  v_expiry   TEXT;
  v_sent     INT := 0;
BEGIN
  FOR v IN
    SELECT s.id AS sub_id, s.company_id, s.current_period_end, s.plan_id,
           c.company_name, c.company_code
    FROM public.subscriptions s
    JOIN public.companies c ON c.id = s.company_id
    WHERE s.status = 'active'
      AND s.current_period_end IS NOT NULL
      AND c.company_code <> 'ADMIN'
      AND (s.current_period_end::date - CURRENT_DATE) = ANY (ARRAY[5, 3, 1])
  LOOP
    v_days := (v.current_period_end::date - CURRENT_DATE);

    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v.plan_id LIMIT 1;
    IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price, 0) = 0 THEN
      CONTINUE;   -- free trial: handled by trial nudges, not paid renewal
    END IF;

    -- owner (fallback admin) with an email
    SELECT id, full_name, email INTO v_owner
    FROM public.app_users
    WHERE company_id = v.company_id AND role IN ('owner', 'admin')
      AND email IS NOT NULL AND status = 'active'
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;
    IF v_owner.email IS NULL THEN CONTINUE; END IF;

    -- dedup: same threshold for same period already queued?
    IF EXISTS (
      SELECT 1 FROM public.platform_email_log
      WHERE organization_id = v.company_id
        AND template_key = 'renewal_reminder'
        AND variables->>'period_end' = v.current_period_end::date::text
        AND variables->>'days_left'  = v_days::text
    ) THEN CONTINUE; END IF;

    v_expiry := to_char(v.current_period_end, 'DD Mon YYYY');

    INSERT INTO public.platform_email_log(
      organization_id, to_email, to_user_id, from_email, template_key, subject,
      variables, status, provider, category)
    VALUES (
      v.company_id, v_owner.email, v_owner.id, 'Nexunova RMS <noreply@nexunova.com>',
      'renewal_reminder',
      'Your Nexunova subscription expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      jsonb_build_object(
        'days_left', v_days::text, 'period_end', v.current_period_end::date::text,
        'company_name', v.company_name, 'plan_name', v_plan.plan_name,
        'amount', v_plan.price::text, 'currency', v_plan.currency,
        'full_name', v_owner.full_name),
      'queued', 'resend', 'billing');

    INSERT INTO public.platform_notifications(
      organization_id, user_id, type, title, body, action_url, action_label,
      icon, priority, expires_at)
    VALUES (
      v.company_id, v_owner.id, 'billing',
      'Subscription expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      'Your ' || v_plan.plan_name || ' plan expires on ' || v_expiry || '. Renew now to avoid interruption.',
      '/login.html', 'Renew now', 'alert-triangle', 'high', v.current_period_end);

    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'email', v_owner.email, 'purpose', 'renewal_reminder',
        'full_name', v_owner.full_name, 'company_name', v.company_name,
        'days_left', v_days::text, 'expiry_date', v_expiry,
        'amount', v_plan.price::text, 'currency', v_plan.currency,
        'plan_name', v_plan.plan_name,
        'login_url', 'https://rms.nexunova.com/login.html'));

    v_sent := v_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reminders_sent', v_sent, 'ran_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.cron_subscription_reminders() FROM anon, authenticated;

-- Daily at 03:00 UTC (08:00 PKT)
SELECT cron.schedule(
  'subscription-reminders',
  '0 3 * * *',
  $$ SET search_path = public; SELECT public.cron_subscription_reminders(); $$
);

-- ── Add the "expired" notice to the existing expiry sweep ───────────────────
-- (fires once, the moment a paid sub flips to pending_payment)
CREATE OR REPLACE FUNCTION public.cron_expire_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_owner   RECORD;
  v_co_name TEXT;
  v_inv_no  TEXT;
  v_pstart  DATE;
  v_pend    DATE;
  v_expired INT := 0;
  v_renew   INT := 0;
BEGIN
  FOR v_sub IN
    SELECT s.*
    FROM public.subscriptions s
    JOIN public.companies c ON c.id = s.company_id
    WHERE s.status IN ('active', 'trialing')
      AND s.current_period_end IS NOT NULL
      AND s.current_period_end < now()
      AND c.company_code <> 'ADMIN'
  LOOP
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;

    IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price, 0) = 0 THEN
      UPDATE public.subscriptions SET status = 'expired', updated_at = now() WHERE id = v_sub.id;
      v_expired := v_expired + 1;
      CONTINUE;
    END IF;

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

    UPDATE public.subscriptions SET status = 'pending_payment', updated_at = now() WHERE id = v_sub.id;
    v_expired := v_expired + 1;

    -- One-time "expired" email + notification to the owner
    SELECT company_name INTO v_co_name FROM public.companies WHERE id = v_sub.company_id;
    SELECT id, full_name, email INTO v_owner
    FROM public.app_users
    WHERE company_id = v_sub.company_id AND role IN ('owner', 'admin')
      AND email IS NOT NULL AND status = 'active'
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;

    IF v_owner.email IS NOT NULL THEN
      INSERT INTO public.platform_email_log(
        organization_id, to_email, to_user_id, from_email, template_key, subject,
        variables, status, provider, category)
      VALUES (
        v_sub.company_id, v_owner.email, v_owner.id, 'Nexunova RMS <noreply@nexunova.com>',
        'subscription_expired', 'Your Nexunova subscription has expired',
        jsonb_build_object('company_name', v_co_name, 'plan_name', v_plan.plan_name,
          'amount', v_plan.price::text, 'currency', v_plan.currency,
          'full_name', v_owner.full_name),
        'queued', 'resend', 'billing');

      INSERT INTO public.platform_notifications(
        organization_id, user_id, type, title, body, action_url, action_label,
        icon, priority)
      VALUES (
        v_sub.company_id, v_owner.id, 'billing', 'Subscription expired',
        'Your ' || v_plan.plan_name || ' plan has expired. Pay to reactivate your system.',
        '/login.html', 'Pay & reactivate', 'alert-octagon', 'urgent');

      PERFORM net.http_post(
        url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'email', v_owner.email, 'purpose', 'subscription_expired',
          'full_name', v_owner.full_name, 'company_name', v_co_name,
          'amount', v_plan.price::text, 'currency', v_plan.currency,
          'plan_name', v_plan.plan_name,
          'login_url', 'https://rms.nexunova.com/login.html'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'expired_count', v_expired, 'renewal_invoices', v_renew, 'ran_at', now());
END;
$function$;
