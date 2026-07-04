-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM FOLLOW-UP REMINDERS: WhatsApp + Web Push  |  2026-07-04
-- ------------------------------------------------------------------------
-- followup_reminder_engine delivered in-app only; WhatsApp/Push were no-ops.
-- This wires both, reusing the live comms dispatch (enqueue_message → Meta WA)
-- and a new web-push edge function. Adds:
--   • per-member + company-level channel toggles (default both ON)
--   • reminder_deliveries: cross-channel dedupe ledger (never send twice)
--   • push_subscriptions: PWA push endpoints per member/device
--   • quiet hours 21:00–08:00 Asia/Karachi (WA → scheduled to morning; push → skipped, retried next daytime cron)
--   • digest: 3+ due follow-ups in a window → ONE message, not N
--   • push on new lead assignment + follow-up due; click deep-links to the lead
-- Deploy deps (SEE END): VAPID keys + send-web-push edge fn + WA reminder template.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 1) Channel toggles -----------------------------------------------------
ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS notify_whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_push     boolean NOT NULL DEFAULT true;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS crm_notify_whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS crm_notify_push     boolean NOT NULL DEFAULT true;

-- 2) Dedupe ledger (authoritative "sent this reminder already?") ----------
CREATE TABLE IF NOT EXISTS public.reminder_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  channel       text NOT NULL,
  dedup_key     text NOT NULL,
  status        text NOT NULL DEFAULT 'sent',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_deliveries_uq UNIQUE (company_id, dedup_key)
);
ALTER TABLE public.reminder_deliveries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reminder_deliveries' AND policyname='deny_all_reminder_deliveries') THEN
    CREATE POLICY "deny_all_reminder_deliveries" ON public.reminder_deliveries AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 3) Push subscriptions (PWA endpoints) ----------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_user_id uuid NOT NULL REFERENCES public.sales_users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(sales_user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='push_subscriptions' AND policyname='deny_all_push_subscriptions') THEN
    CREATE POLICY "deny_all_push_subscriptions" ON public.push_subscriptions AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 4) Quiet-hours helpers (Asia/Karachi 21:00–08:00) ----------------------
-- Returns the timestamptz to schedule for (next 08:00) when in quiet hours,
-- else NULL = send immediately.
CREATE OR REPLACE FUNCTION public._crm_next_send_at()
 RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE v_local timestamp; v_h int; v_send timestamp;
BEGIN
  v_local := now() AT TIME ZONE 'Asia/Karachi';
  v_h := extract(hour FROM v_local);
  IF v_h >= 8 AND v_h < 21 THEN RETURN NULL; END IF;
  IF v_h >= 21 THEN v_send := date_trunc('day', v_local) + interval '1 day' + interval '8 hours';
  ELSE               v_send := date_trunc('day', v_local) + interval '8 hours'; END IF;
  RETURN v_send AT TIME ZONE 'Asia/Karachi';
END; $function$;

CREATE OR REPLACE FUNCTION public._crm_in_quiet_hours()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$ SELECT public._crm_next_send_at() IS NOT NULL; $function$;

-- 5) Channel senders (dedupe-guarded) ------------------------------------
CREATE OR REPLACE FUNCTION public._crm_send_whatsapp(p_company uuid, p_uid uuid, p_body text, p_dedup text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_okc boolean; v_okm boolean; v_phone text; v_ins uuid; v_sched timestamptz;
BEGIN
  SELECT crm_notify_whatsapp INTO v_okc FROM public.companies WHERE id=p_company;
  SELECT notify_whatsapp, phone INTO v_okm, v_phone FROM public.sales_users WHERE id=p_uid;
  IF NOT COALESCE(v_okc,true) OR NOT COALESCE(v_okm,true) THEN RETURN false; END IF;
  IF v_phone IS NULL OR trim(v_phone)='' THEN RETURN false; END IF;

  INSERT INTO public.reminder_deliveries (company_id, sales_user_id, channel, dedup_key, status)
  VALUES (p_company, p_uid, 'whatsapp', p_dedup, 'sent')
  ON CONFLICT (company_id, dedup_key) DO NOTHING RETURNING id INTO v_ins;
  IF v_ins IS NULL THEN RETURN false; END IF;   -- already sent

  v_sched := public._crm_next_send_at();          -- quiet hours → morning; else immediate
  PERFORM public.enqueue_message(p_company, jsonb_build_object(
    'channel','whatsapp', 'to_address', v_phone, 'body', p_body,
    'category','crm_reminder', 'dedup_key','crm:'||p_dedup,
    'scheduled_at', v_sched));
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public._crm_send_push(p_company uuid, p_uid uuid, p_title text, p_body text, p_url text, p_dedup text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v_okc boolean; v_okm boolean; v_ins uuid; s record; v_n int := 0;
BEGIN
  SELECT crm_notify_push INTO v_okc FROM public.companies WHERE id=p_company;
  SELECT notify_push INTO v_okm FROM public.sales_users WHERE id=p_uid;
  IF NOT COALESCE(v_okc,true) OR NOT COALESCE(v_okm,true) THEN RETURN false; END IF;
  IF public._crm_in_quiet_hours() THEN RETURN false; END IF;   -- skip; next daytime cron retries (no dedupe row yet)

  INSERT INTO public.reminder_deliveries (company_id, sales_user_id, channel, dedup_key, status)
  VALUES (p_company, p_uid, 'push', p_dedup, 'sent')
  ON CONFLICT (company_id, dedup_key) DO NOTHING RETURNING id INTO v_ins;
  IF v_ins IS NULL THEN RETURN false; END IF;

  FOR s IN SELECT endpoint, p256dh, auth FROM public.push_subscriptions WHERE sales_user_id=p_uid LOOP
    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-web-push',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := jsonb_build_object(
        'subscription', jsonb_build_object('endpoint', s.endpoint,
          'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)),
        'payload', jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url)));
    v_n := v_n + 1;
  END LOOP;
  RETURN true;
END; $function$;

-- 6) send_followup_reminder — in_app kept; wa/push now delegate to senders --
CREATE OR REPLACE FUNCTION public.send_followup_reminder(p_sales_user_id uuid, p_lead_id uuid, p_channel text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_lead public.leads; v_overdue boolean; v_title text; v_body text; v_url text; v_dedup text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_overdue := v_lead.next_follow_up_at::date < current_date;
  v_title := CASE WHEN v_overdue THEN 'Overdue follow-up' ELSE 'Follow-up due today' END;
  v_body  := 'Follow up with '||COALESCE(v_lead.name,'your lead')
             ||CASE WHEN v_lead.phone IS NOT NULL THEN ' ('||v_lead.phone||')' ELSE '' END
             ||CASE WHEN v_overdue THEN ' — was due '||to_char(v_lead.next_follow_up_at,'DD Mon') ELSE ' — due today' END||'.';
  v_url   := 'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id;
  v_dedup := 'fu:'||p_lead_id||':'||v_lead.next_follow_up_at::date;

  IF p_channel='in_app' THEN
    INSERT INTO public.sales_announcements (company_id, sales_user_id, title, body, is_important, is_active, attachments)
    VALUES (v_lead.company_id, p_sales_user_id, v_title, v_body, v_overdue, true, '[]'::jsonb);
    RETURN true;
  ELSIF p_channel='whatsapp' THEN
    RETURN public._crm_send_whatsapp(v_lead.company_id, p_sales_user_id, v_body||' Open: '||v_url, 'wa:'||v_dedup);
  ELSIF p_channel='push' THEN
    RETURN public._crm_send_push(v_lead.company_id, p_sales_user_id, v_title, v_body, v_url, 'push:'||v_dedup);
  END IF;
  RETURN false;
END; $function$;

-- 7) cron — in_app per lead + WA/Push per owner (digest if 3+) ------------
CREATE OR REPLACE FUNCTION public.cron_followup_reminders()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE rec record; o record; v_n int := 0; v_url text; v_body text;
BEGIN
  -- Pass A: in-app, per lead (unchanged; guarded by followup_notified_for)
  FOR rec IN
    SELECT id, owner_sales_user_id, next_follow_up_at FROM public.leads
    WHERE next_follow_up_at IS NOT NULL AND status NOT IN ('won','lost') AND owner_sales_user_id IS NOT NULL
      AND next_follow_up_at::date <= current_date
      AND (followup_notified_for IS NULL OR followup_notified_for <> next_follow_up_at::date)
  LOOP
    PERFORM public.send_followup_reminder(rec.owner_sales_user_id, rec.id, 'in_app');
    UPDATE public.leads SET followup_notified_for = rec.next_follow_up_at::date WHERE id=rec.id;
    v_n := v_n + 1;
  END LOOP;

  -- Pass B: WhatsApp + Push, grouped per owner, digest when 3+ due
  FOR o IN
    SELECT l.company_id, l.owner_sales_user_id AS uid, count(*) AS cnt,
           string_agg(l.name, ', ' ORDER BY l.next_follow_up_at) AS names
    FROM public.leads l
    WHERE l.next_follow_up_at IS NOT NULL AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
      AND l.next_follow_up_at::date <= current_date
    GROUP BY l.company_id, l.owner_sales_user_id
  LOOP
    IF o.cnt >= 3 THEN
      v_url  := 'https://rms.nexunova.com/sales-portal.html';
      v_body := 'You have '||o.cnt||' follow-ups due today: '
                ||left(o.names,180)||CASE WHEN length(o.names)>180 THEN '…' ELSE '' END;
      PERFORM public._crm_send_whatsapp(o.company_id, o.uid, v_body||'. Open your CRM: '||v_url,
              'wa:fudigest:'||o.uid||':'||current_date);
      PERFORM public._crm_send_push(o.company_id, o.uid, 'Follow-ups due',
              o.cnt||' follow-ups are due today.', v_url, 'push:fudigest:'||o.uid||':'||current_date);
    ELSE
      FOR rec IN
        SELECT id FROM public.leads
        WHERE company_id=o.company_id AND owner_sales_user_id=o.uid
          AND next_follow_up_at IS NOT NULL AND status NOT IN ('won','lost')
          AND next_follow_up_at::date <= current_date
      LOOP
        PERFORM public.send_followup_reminder(o.uid, rec.id, 'whatsapp');
        PERFORM public.send_followup_reminder(o.uid, rec.id, 'push');
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'notified',v_n,'ran_at',now());
END; $function$;

REVOKE EXECUTE ON FUNCTION public.send_followup_reminder(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_followup_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._crm_send_whatsapp(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._crm_send_push(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- 8) assign_lead — push the new owner (reproduces live def + push hook) ---
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_tparent uuid; v_companywide boolean; v_lname text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT owner_sales_user_id, company_id, name INTO v_owner, v_company, v_lname FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  IF v_companywide AND v_company <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT v_companywide AND v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  SELECT full_name, parent_sales_user_id INTO v_tname, v_tparent
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  -- push the new owner (dedupe per lead+owner; quiet hours respected inside)
  PERFORM public._crm_send_push(v_company, p_to_id, 'New lead assigned',
    COALESCE(v_lname,'A new lead')||' was assigned to you.',
    'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id,
    'push:assigned:'||p_lead_id||':'||p_to_id);

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;

-- 9) Member self-service RPCs (session-gated) ----------------------------
CREATE OR REPLACE FUNCTION public.get_my_notify_prefs(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_wa boolean; v_pu boolean; v_cwa boolean; v_cpu boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT notify_whatsapp, notify_push INTO v_wa, v_pu FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT crm_notify_whatsapp, crm_notify_push INTO v_cwa, v_cpu FROM public.companies WHERE id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'whatsapp',v_wa,'push',v_pu,
    'company_whatsapp',COALESCE(v_cwa,true),'company_push',COALESCE(v_cpu,true));
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_my_notify_prefs(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_my_notify_prefs(p_session_token text, p_whatsapp boolean, p_push boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.sales_users
     SET notify_whatsapp=COALESCE(p_whatsapp,notify_whatsapp),
         notify_push=COALESCE(p_push,notify_push), updated_at=now()
   WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.set_my_notify_prefs(text, boolean, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_push_subscription(p_session_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF p_endpoint IS NULL OR p_p256dh IS NULL OR p_auth IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_subscription'); END IF;
  INSERT INTO public.push_subscriptions (company_id, sales_user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_ses.company_id, v_ses.sales_user_id, p_endpoint, p_p256dh, p_auth, p_ua)
  ON CONFLICT (endpoint) DO UPDATE
     SET sales_user_id=EXCLUDED.sales_user_id, company_id=EXCLUDED.company_id,
         p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, last_seen_at=now();
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_session_token text, p_endpoint text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint=p_endpoint AND sales_user_id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text, text) TO anon, authenticated;

-- 10) Admin company master switches (app_user admin) ---------------------
CREATE OR REPLACE FUNCTION public.admin_get_crm_notify()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users; v_wa boolean; v_pu boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT crm_notify_whatsapp, crm_notify_push INTO v_wa, v_pu FROM public.companies WHERE id=v_me.company_id;
  RETURN jsonb_build_object('success',true,'whatsapp',COALESCE(v_wa,true),'push',COALESCE(v_pu,true));
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_get_crm_notify() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_crm_notify(p_whatsapp boolean, p_push boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  UPDATE public.companies
     SET crm_notify_whatsapp=COALESCE(p_whatsapp,crm_notify_whatsapp),
         crm_notify_push=COALESCE(p_push,crm_notify_push)
   WHERE id=v_me.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_set_crm_notify(boolean, boolean) TO anon, authenticated;

-- cron already scheduled hourly in 20260621_followup_reminder_engine.sql
-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPENDENCIES (owner-only — see task report):
--   • Generate VAPID keypair; set edge secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
--   • Deploy the send-web-push edge function (--no-verify-jwt)
--   • Paste the VAPID PUBLIC key into sales-portal.html (PUSH_VAPID_PUBLIC)
--   • WhatsApp: ensure a Meta-approved staff-reminder template (freeform body relies
--     on an open 24h session window) — confirm with the comms module owner
-- ════════════════════════════════════════════════════════════════════════
