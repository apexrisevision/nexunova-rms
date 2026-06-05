-- ============================================================================
-- Wire tokenized pay-links into the reminder + expiry crons.
--   * Reminders (5/3/1 days) now ensure an early renewal invoice + pay-link,
--     so the "Pay Now" button works before expiry (pay.html?t=<token>).
--   * Expiry notice links to the same tokenized pay page.
-- Falls back to the login page if a token can't be issued.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_subscription_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v        RECORD;
  v_plan   public.subscription_plans%ROWTYPE;
  v_owner  RECORD;
  v_days   INT;
  v_expiry TEXT;
  v_inv    uuid;
  v_token  TEXT;
  v_url    TEXT;
  v_sent   INT := 0;
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
      CONTINUE;
    END IF;

    SELECT id, full_name, email INTO v_owner
    FROM public.app_users
    WHERE company_id = v.company_id AND role IN ('owner', 'admin')
      AND email IS NOT NULL AND status = 'active'
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;
    IF v_owner.email IS NULL THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.platform_email_log
      WHERE organization_id = v.company_id AND template_key = 'renewal_reminder'
        AND variables->>'period_end' = v.current_period_end::date::text
        AND variables->>'days_left'  = v_days::text
    ) THEN CONTINUE; END IF;

    -- early renewal invoice + tokenized pay-link
    v_inv   := public._ensure_renewal_invoice(v.sub_id);
    v_token := public._ensure_subscription_pay_link(v_inv);
    v_url   := CASE WHEN v_token IS NOT NULL
                    THEN 'https://rms.nexunova.com/pay.html?t=' || v_token
                    ELSE 'https://rms.nexunova.com/login.html' END;

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
        'full_name', v_owner.full_name, 'pay_url', v_url),
      'queued', 'resend', 'billing');

    INSERT INTO public.platform_notifications(
      organization_id, user_id, type, title, body, action_url, action_label,
      icon, priority, expires_at)
    VALUES (
      v.company_id, v_owner.id, 'billing',
      'Subscription expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      'Your ' || v_plan.plan_name || ' plan expires on ' || v_expiry || '. Renew now to avoid interruption.',
      v_url, 'Renew now', 'alert-triangle', 'high', v.current_period_end);

    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'email', v_owner.email, 'purpose', 'renewal_reminder',
        'full_name', v_owner.full_name, 'company_name', v.company_name,
        'days_left', v_days::text, 'expiry_date', v_expiry,
        'amount', v_plan.price::text, 'currency', v_plan.currency,
        'plan_name', v_plan.plan_name, 'login_url', v_url));

    v_sent := v_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reminders_sent', v_sent, 'ran_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.cron_expire_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_owner   RECORD;
  v_co_name TEXT;
  v_inv     uuid;
  v_token   TEXT;
  v_url     TEXT;
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

    -- ensure renewal invoice (idempotent) + count if newly created
    IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.subscription_id = v_sub.id AND i.status = 'unpaid') THEN
      v_renew := v_renew + 1;
    END IF;
    v_inv   := public._ensure_renewal_invoice(v_sub.id);
    v_token := public._ensure_subscription_pay_link(v_inv);
    v_url   := CASE WHEN v_token IS NOT NULL
                    THEN 'https://rms.nexunova.com/pay.html?t=' || v_token
                    ELSE 'https://rms.nexunova.com/login.html' END;

    UPDATE public.subscriptions SET status = 'pending_payment', updated_at = now() WHERE id = v_sub.id;
    v_expired := v_expired + 1;

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
          'full_name', v_owner.full_name, 'pay_url', v_url),
        'queued', 'resend', 'billing');

      INSERT INTO public.platform_notifications(
        organization_id, user_id, type, title, body, action_url, action_label,
        icon, priority)
      VALUES (
        v_sub.company_id, v_owner.id, 'billing', 'Subscription expired',
        'Your ' || v_plan.plan_name || ' plan has expired. Pay to reactivate your system.',
        v_url, 'Pay & reactivate', 'alert-octagon', 'urgent');

      PERFORM net.http_post(
        url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'email', v_owner.email, 'purpose', 'subscription_expired',
          'full_name', v_owner.full_name, 'company_name', v_co_name,
          'amount', v_plan.price::text, 'currency', v_plan.currency,
          'plan_name', v_plan.plan_name, 'login_url', v_url));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'expired_count', v_expired, 'renewal_invoices', v_renew, 'ran_at', now());
END;
$function$;
