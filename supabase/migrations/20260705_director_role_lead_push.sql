-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — DIRECTOR NOTIFICATIONS: ROLE-BASED, NOT PERSON-BASED  |  2026-07-05
-- ------------------------------------------------------------------------
-- Lead-arrival pushes were sent to ONE person (FB default receiver, else the
-- "first" director). Now they fan out to EVERY active director of the company,
-- so a company with 1, 2, or 3+ directors all get alerted.
--
-- Unchanged: the lead still LANDS with the same default receiver (ownership is
-- not touched). Only the notification fans out. Each director is deduped per
-- lead (push:<src>lead:<lead_id>:<director_uid>), respects their notify_push +
-- the company master switch (both enforced inside _crm_send_push), and keeps the
-- quiet-hours bypass (a hot lead alerts immediately, day or night).
--
-- Audit (all _crm_send_push / recipient callers reviewed): the 4 lead-arrival
-- fns are the only person-based director notifications. Already correct →
-- crm_brief_claim_pushes (all directors+admin), assign_lead (new owner),
-- send_followup_reminder / cron_followup_reminders (lead owner),
-- _announcement_push (author's chosen recipients). No other fix needed.
-- ════════════════════════════════════════════════════════════════════════

-- Helper: fan a push out to every active director of a company (dedupe per uid).
CREATE OR REPLACE FUNCTION public._crm_notify_directors(p_company uuid, p_title text, p_body text, p_url text, p_dedup_base text)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE d record; v_n int := 0;
BEGIN
  FOR d IN SELECT id FROM public.sales_users
            WHERE company_id=p_company AND role='director' AND status='active'
  LOOP
    IF public._crm_send_push(p_company, d.id, p_title, p_body, p_url,
         p_dedup_base||':'||d.id::text, true) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END; $function$;
REVOKE EXECUTE ON FUNCTION public._crm_notify_directors(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- ── create_lead_from_fb (push block → all directors) ────────────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_fb(p_page_id text, p_name text, p_phone text, p_email text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.fb_connections; v_owner uuid; v_tok text; v_res jsonb; v_lead uuid; v_src text; v_body text;
BEGIN
  SELECT * INTO c FROM public.fb_connections WHERE page_id=p_page_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','no_connection'); END IF;

  v_owner := c.recipient_sales_user_id;
  IF v_owner IS NULL THEN
    SELECT id INTO v_owner FROM public.sales_users
     WHERE company_id=c.company_id AND role='director' AND status='active'
     ORDER BY created_at NULLS LAST, id LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_director'); END IF;

  v_tok := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (c.company_id, v_owner, c.project_id, v_tok, now()+interval '2 minutes');

  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name',       COALESCE(NULLIF(TRIM(p_name),''),'Facebook lead'),
    'phone',      p_phone,
    'email',      p_email,
    'source',     'facebook',
    'project_id', c.project_id
  ), false);

  DELETE FROM public.sales_sessions WHERE session_token=v_tok;

  IF (v_res->>'success')::boolean THEN
    UPDATE public.fb_connections SET last_lead_at=now(), leads_count=COALESCE(leads_count,0)+1 WHERE id=c.id;

    -- Notify EVERY active director (role-based). The lead still lands with the
    -- default receiver (v_owner) above; only the alert fans out. p_ignore_quiet
    -- := TRUE — a Facebook lead is time-sensitive and bypasses quiet hours.
    -- Each director deduped push:fblead:<lead>:<uid>; notify_push + company
    -- master switch enforced inside _crm_send_push.
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL AND COALESCE(c.auto_notify, true) THEN
      v_src := COALESCE(NULLIF(TRIM(p_raw->>'campaign_name'),''), NULLIF(TRIM(p_raw->>'ad_name'),''), NULLIF(TRIM(c.page_name),''));
      v_body := COALESCE(NULLIF(TRIM(p_name),''),'Facebook lead')
                || CASE WHEN v_src IS NOT NULL THEN ' · '||v_src ELSE '' END;
      PERFORM public._crm_notify_directors(
        c.company_id, 'New Facebook lead', v_body,
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:fblead:'||v_lead::text);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;

-- ── create_lead_from_instagram (push block → all directors) ─────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_instagram(p_ig_account_id text, p_sender_id text, p_name text, p_text text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_co uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb; v_note text; v_user text; v_lead uuid;
BEGIN
  SELECT company_id, project_id, ig_username INTO v_co, v_proj, v_user FROM public.instagram_connections WHERE ig_account_id=p_ig_account_id AND active LIMIT 1;
  IF v_co IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_account'); END IF;
  SELECT id INTO v_owner FROM public.sales_users WHERE company_id=v_co AND role='director' AND status='active' ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_director'); END IF;
  v_note := 'Instagram DM'||CASE WHEN NULLIF(TRIM(COALESCE(p_sender_id,'')),'') IS NOT NULL THEN ' (IG user '||p_sender_id||')' ELSE '' END
            ||CASE WHEN NULLIF(TRIM(COALESCE(p_text,'')),'') IS NOT NULL THEN ': '||p_text ELSE '' END;
  v_tok := 'ig_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (v_co, v_owner, v_proj, v_tok, now()+interval '2 minutes');
  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name', COALESCE(NULLIF(TRIM(p_name),''),'Instagram lead'),
    'phone', NULL, 'source','instagram', 'notes', v_note, 'project_id', v_proj), false);
  DELETE FROM public.sales_sessions WHERE session_token=v_tok;
  IF v_res IS NOT NULL AND (v_res->>'success')='true' THEN
    UPDATE public.instagram_connections SET last_event_at=now(), leads_count=leads_count+1 WHERE ig_account_id=p_ig_account_id;
    -- lead-arrival push to ALL active directors; p_ignore_quiet=TRUE (bypass quiet hours)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_notify_directors(v_co, 'New Instagram lead',
        COALESCE(NULLIF(TRIM(p_name),''),'Instagram lead')
          || CASE WHEN NULLIF(TRIM(COALESCE(v_user,'')),'') IS NOT NULL THEN ' · @'||v_user ELSE ' · Instagram' END,
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:iglead:'||v_lead::text);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;

-- ── create_lead_from_whatsapp (push block → all directors) ──────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp(p_phone_number_id text, p_wa_id text, p_name text, p_text text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_co uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb; v_lead uuid;
BEGIN
  SELECT company_id, project_id INTO v_co, v_proj FROM public.whatsapp_connections WHERE phone_number_id=p_phone_number_id AND active LIMIT 1;
  IF v_co IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_number'); END IF;
  SELECT id INTO v_owner FROM public.sales_users WHERE company_id=v_co AND role='director' AND status='active' ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_director'); END IF;
  v_tok := 'wa_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (v_co, v_owner, v_proj, v_tok, now()+interval '2 minutes');
  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name',  COALESCE(NULLIF(TRIM(p_name),''),'WhatsApp lead'),
    'phone', p_wa_id, 'source','whatsapp',
    'notes', NULLIF(TRIM(COALESCE(p_text,'')),''), 'project_id', v_proj), false);
  DELETE FROM public.sales_sessions WHERE session_token=v_tok;
  IF v_res IS NOT NULL AND (v_res->>'success')='true' THEN
    UPDATE public.whatsapp_connections SET last_event_at=now(), leads_count=leads_count+1 WHERE phone_number_id=p_phone_number_id;
    -- lead-arrival push to ALL active directors; p_ignore_quiet=TRUE (bypass quiet hours)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_notify_directors(v_co, 'New WhatsApp lead',
        COALESCE(NULLIF(TRIM(p_name),''),'WhatsApp lead')||' · WhatsApp',
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:walead:'||v_lead::text);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;

-- ── create_lead_from_web (push block → all directors) ───────────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_web(p_key text, p_name text, p_phone text, p_email text, p_project_id uuid DEFAULT NULL::uuid, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_co uuid; v_def uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb; v_lead uuid;
BEGIN
  SELECT company_id, default_project_id INTO v_co, v_def FROM public.web_lead_config WHERE intake_key=p_key AND active LIMIT 1;
  IF v_co IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_key'); END IF;
  v_proj := COALESCE(p_project_id, v_def);
  SELECT id INTO v_owner FROM public.sales_users WHERE company_id=v_co AND role='director' AND status='active' ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_director'); END IF;
  v_tok := 'web_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (v_co, v_owner, v_proj, v_tok, now()+interval '2 minutes');
  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name',  COALESCE(NULLIF(TRIM(p_name),''),'Website lead'),
    'phone', p_phone, 'email', p_email, 'source','website', 'project_id', v_proj), false);
  DELETE FROM public.sales_sessions WHERE session_token=v_tok;
  IF v_res IS NOT NULL AND (v_res->>'success')='true' THEN
    -- lead-arrival push to ALL active directors; p_ignore_quiet=TRUE (bypass quiet hours)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_notify_directors(v_co, 'New website lead',
        COALESCE(NULLIF(TRIM(p_name),''),'Website lead')||' · Website',
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:weblead:'||v_lead::text);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;
-- ── AI Daily Brief already fans to ALL directors, but did NOT respect a
--    director's own notify_push toggle or the company master switch. Align it
--    with every other push path so a muted director isn't force-pushed. ──────
CREATE OR REPLACE FUNCTION public.crm_brief_claim_pushes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_date date; v_coname text; v_copush boolean;
        d record; v_ins uuid; v_subs jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  v_date := (now() AT TIME ZONE v_tz)::date;
  SELECT company_name, COALESCE(crm_notify_push,true) INTO v_coname, v_copush FROM public.companies WHERE id=p_company_id;
  IF NOT COALESCE(v_copush,true) THEN
    RETURN jsonb_build_object('success',true,'company',v_coname,'subs','[]'::jsonb);  -- company muted push
  END IF;
  FOR d IN
    SELECT id FROM public.sales_users
     WHERE company_id=p_company_id AND status='active' AND role IN ('director','admin')
       AND COALESCE(notify_push,true)                       -- respect the director's own toggle
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.sales_user_id=sales_users.id)
  LOOP
    INSERT INTO public.reminder_deliveries (company_id, sales_user_id, channel, dedup_key, status)
    VALUES (p_company_id, d.id, 'push', 'brief:'||d.id||':'||v_date, 'sent')
    ON CONFLICT (company_id, dedup_key) DO NOTHING RETURNING id INTO v_ins;
    IF v_ins IS NULL THEN CONTINUE; END IF;   -- already pushed today
    SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)),'[]'::jsonb)
      INTO v_subs FROM public.push_subscriptions WHERE sales_user_id=d.id;
    v_out := v_out || v_subs;
  END LOOP;
  RETURN jsonb_build_object('success',true,'company',v_coname,'subs',v_out);
END $function$;
REVOKE EXECUTE ON FUNCTION public.crm_brief_claim_pushes(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.crm_brief_claim_pushes(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPS: none (DB-only; no edge fn, no frontend). Migration applied to
-- prod = live. Reuses send-web-push (already deployed) + VAPID (already set).
-- ════════════════════════════════════════════════════════════════════════
