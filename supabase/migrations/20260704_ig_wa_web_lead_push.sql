-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM: lead-arrival push for Instagram / WhatsApp / Web
-- 2026-07-04
-- ------------------------------------------------------------------------
-- Same pattern as create_lead_from_fb (commit a9607d3): when a lead lands from
-- Instagram DM / WhatsApp / a website form, push the DEFAULT RECEIVER (the
-- company's first active director for these sources — no per-connection
-- recipient column) the instant it arrives. Reuses the live push stack; no
-- edge-fn change. Manual assign_lead push (P1-T2) untouched.
--   • p_ignore_quiet=TRUE — social/web leads are time-sensitive, notify even
--     during 21:00–08:00 quiet hours.
--   • dedupe key push:<src>lead:<lead_id> (one push per arrival); create_lead's
--     phone-dedup stops duplicate WhatsApp/Web leads on retries (IG has no phone
--     → each DM is a genuinely new lead).
--   • member notify_push + company master switch respected inside _crm_send_push.
-- ════════════════════════════════════════════════════════════════════════

-- Instagram ----------------------------------------------------------------
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
    -- lead-arrival push to the default receiver; p_ignore_quiet=TRUE (bypass quiet hours — time-sensitive)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_send_push(v_co, v_owner, 'New Instagram lead',
        COALESCE(NULLIF(TRIM(p_name),''),'Instagram lead')
          || CASE WHEN NULLIF(TRIM(COALESCE(v_user,'')),'') IS NOT NULL THEN ' · @'||v_user ELSE ' · Instagram' END,
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:iglead:'||v_lead::text, true);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;

-- WhatsApp -----------------------------------------------------------------
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
    -- lead-arrival push to the default receiver; p_ignore_quiet=TRUE (bypass quiet hours — time-sensitive)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_send_push(v_co, v_owner, 'New WhatsApp lead',
        COALESCE(NULLIF(TRIM(p_name),''),'WhatsApp lead')||' · WhatsApp',
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:walead:'||v_lead::text, true);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;

-- Website ------------------------------------------------------------------
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
    -- lead-arrival push to the default receiver; p_ignore_quiet=TRUE (bypass quiet hours — time-sensitive)
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL THEN
      PERFORM public._crm_send_push(v_co, v_owner, 'New website lead',
        COALESCE(NULLIF(TRIM(p_name),''),'Website lead')||' · Website',
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:weblead:'||v_lead::text, true);
    END IF;
  END IF;
  RETURN v_res;
END; $function$;
