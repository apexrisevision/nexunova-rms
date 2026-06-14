-- ============================================================================
-- NEXUNOVA RMS — PAYMENT WALL — Daily renewal reminders (Build 2)
-- 2026-06-15
-- ----------------------------------------------------------------------------
-- ONLY CHANGE vs the live cron_subscription_reminders: the day-offset array
--   BEFORE:  ... = ANY (ARRAY[5, 3, 1])      (3 reminders: 5, 3, 1 days out)
--   AFTER:   ... = ANY (ARRAY[5, 4, 3, 2, 1, 0])  (daily, 5 days out → due day)
-- Everything else is byte-identical. The per-(period_end, days_left) dedup in
-- platform_email_log already prevents same-day double sends, so daily is safe.
-- Result for FG (period_end 2026-06-25): a renewal email every day 20–25 Jun.
-- Channel unchanged: Resend via send-otp-email (purpose 'renewal_reminder').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_subscription_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
      AND (s.current_period_end::date - CURRENT_DATE) = ANY (ARRAY[5, 4, 3, 2, 1, 0])
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
