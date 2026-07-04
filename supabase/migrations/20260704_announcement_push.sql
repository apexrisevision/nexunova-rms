-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM: web push when a director publishes an announcement
-- 2026-07-04
-- ------------------------------------------------------------------------
-- Reuses the live push stack (_crm_send_push, push_subscriptions, VAPID edge
-- fn, reminder_deliveries dedupe, quiet-hours). On publish, every TARGETED
-- member (via _ann_recipients) gets ONE push (dedupe key push:ann:<id>:<uid>),
-- click deep-links to ?ann=<id> in the inbox. Respects notify_push + company
-- master switch. Priority 'urgent' ignores quiet hours (sends at night);
-- normal/important queue to the next daytime cron drain (like reminders).
-- No edge-fn change.
-- ════════════════════════════════════════════════════════════════════════

-- 0) push_enabled: ONLY announcements posted through the new post_announcement
--    are eligible for cron drain — pre-existing announcements are never back-pushed.
ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false;

-- 1) _crm_send_push gains p_ignore_quiet (urgent announcements bypass quiet) ---
DROP FUNCTION IF EXISTS public._crm_send_push(uuid,uuid,text,text,text,text);
CREATE OR REPLACE FUNCTION public._crm_send_push(p_company uuid, p_uid uuid, p_title text, p_body text, p_url text, p_dedup text, p_ignore_quiet boolean DEFAULT false)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v_okc boolean; v_okm boolean; v_ins uuid; s record; v_n int := 0;
BEGIN
  SELECT crm_notify_push INTO v_okc FROM public.companies WHERE id=p_company;
  SELECT notify_push INTO v_okm FROM public.sales_users WHERE id=p_uid;
  IF NOT COALESCE(v_okc,true) OR NOT COALESCE(v_okm,true) THEN RETURN false; END IF;
  IF NOT p_ignore_quiet AND public._crm_in_quiet_hours() THEN RETURN false; END IF;  -- skip; daytime cron retries (no dedupe row yet)

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
REVOKE EXECUTE ON FUNCTION public._crm_send_push(uuid,uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;

-- 2) _announcement_push — fan out to every targeted recipient -----------------
CREATE OR REPLACE FUNCTION public._announcement_push(p_id uuid, p_ignore_quiet boolean DEFAULT false)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE a public.sales_announcements; rec record; v_body text; v_url text; v_n int := 0;
BEGIN
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND OR NOT a.is_active THEN RETURN 0; END IF;
  v_url  := 'https://rms.nexunova.com/sales-portal.html?ann='||p_id;
  v_body := left(regexp_replace(COALESCE(a.body,''), '\s+', ' ', 'g'), 100)
            || CASE WHEN length(COALESCE(a.body,'')) > 100 THEN '…' ELSE '' END;
  FOR rec IN SELECT sales_user_id FROM public._ann_recipients(p_id) LOOP
    IF public._crm_send_push(a.company_id, rec.sales_user_id, a.title, v_body, v_url,
         'push:ann:'||p_id::text||':'||rec.sales_user_id::text, p_ignore_quiet) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END; $function$;
REVOKE EXECUTE ON FUNCTION public._announcement_push(uuid,boolean) FROM PUBLIC, anon, authenticated;

-- 3) post_announcement — push on publish (live def + hook) ---------------------
CREATE OR REPLACE FUNCTION public.post_announcement(p_session_token text, p_title text, p_body text, p_priority text DEFAULT 'normal'::text, p_target_type text DEFAULT 'all'::text, p_target_value text DEFAULT NULL::text, p_requires_ack boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_id uuid; v_tv text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Only a director can post announcements.'); END IF;
  IF coalesce(btrim(p_title),'')='' OR coalesce(btrim(p_body),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and message are required.'); END IF;
  IF p_priority NOT IN ('normal','important','urgent') THEN p_priority := 'normal'; END IF;
  IF p_target_type NOT IN ('all','role','team','user') THEN
    RETURN jsonb_build_object('success',false,'error','bad_target'); END IF;
  v_tv := NULLIF(btrim(COALESCE(p_target_value,'')),'');
  IF p_target_type='role' THEN
    IF v_tv IS NULL OR v_tv NOT IN ('sale_rep','marketing_manager','director','cfo','admin','lead_entry') THEN
      RETURN jsonb_build_object('success',false,'error','bad_role'); END IF;
  ELSIF p_target_type IN ('team','user') THEN
    IF v_tv IS NULL OR NOT EXISTS (SELECT 1 FROM public.sales_users WHERE id=v_tv::uuid AND company_id=v_ses.company_id) THEN
      RETURN jsonb_build_object('success',false,'error','bad_target_user'); END IF;
  ELSE
    v_tv := NULL;
  END IF;

  INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments,
        priority, target_type, target_value, author_sales_user_id, requires_ack, push_enabled)
  VALUES (v_ses.company_id, NULL, btrim(p_title), btrim(p_body),
          (p_priority IN ('important','urgent')), COALESCE(p_attachments,'[]'::jsonb),
          p_priority, p_target_type, v_tv, v_ses.sales_user_id, COALESCE(p_requires_ack,false), true)
  RETURNING id INTO v_id;

  -- push on publish: urgent bypasses quiet hours; normal/important queue to the daytime cron
  PERFORM public._announcement_push(v_id, (p_priority='urgent'));

  RETURN jsonb_build_object('success',true,'id',v_id);
END $function$;
REVOKE ALL ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb) TO anon, authenticated;

-- 4) cron drain — deliver non-urgent announcement pushes queued past quiet hours
CREATE OR REPLACE FUNCTION public.cron_announcement_push()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE rec record; v_n int := 0;
BEGIN
  IF public._crm_in_quiet_hours() THEN RETURN jsonb_build_object('success',true,'skipped','quiet_hours'); END IF;
  FOR rec IN
    SELECT id FROM public.sales_announcements
    WHERE is_active AND push_enabled AND priority <> 'urgent' AND created_at > now() - interval '24 hours'
  LOOP
    v_n := v_n + public._announcement_push(rec.id, false);   -- dedupe-guarded; only unsent recipients fire
  END LOOP;
  RETURN jsonb_build_object('success',true,'sent',v_n,'ran_at',now());
END; $function$;
REVOKE EXECUTE ON FUNCTION public.cron_announcement_push() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('crm-announcement-push'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('crm-announcement-push','5 * * * *',$$SET search_path=public; SELECT public.cron_announcement_push();$$);
