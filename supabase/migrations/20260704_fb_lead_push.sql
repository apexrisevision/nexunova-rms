-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM: web push when a Facebook lead lands (default receiver)
-- 2026-07-04
-- ------------------------------------------------------------------------
-- FB leads arrive via fb-leads-webhook → create_lead_from_fb and land with the
-- page's default receiver (fb_connections.recipient_sales_user_id, else the
-- company's first active director). This is NOT an assign_lead, so no push
-- fired — the director only found out by opening the app. Now the default
-- receiver gets an instant push. (Manual director→employee assign_lead push
-- from P1-T2 is untouched.)
-- Reuses the live push stack; no edge-fn change.
-- ════════════════════════════════════════════════════════════════════════

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

    -- NEW: notify the default receiver the instant the lead lands.
    -- p_ignore_quiet := TRUE on purpose — a Facebook lead is time-sensitive; a hot
    -- lead at 10pm must alert immediately, so it BYPASSES the 21:00–08:00 quiet hours
    -- (unlike follow-up reminders which queue to morning). auto_notify + the member's
    -- notify_push + the company master switch are still respected inside _crm_send_push.
    v_lead := NULLIF(v_res->>'id','')::uuid;
    IF v_lead IS NOT NULL AND COALESCE(c.auto_notify, true) THEN
      v_src := COALESCE(NULLIF(TRIM(p_raw->>'campaign_name'),''), NULLIF(TRIM(p_raw->>'ad_name'),''), NULLIF(TRIM(c.page_name),''));
      v_body := COALESCE(NULLIF(TRIM(p_name),''),'Facebook lead')
                || CASE WHEN v_src IS NOT NULL THEN ' · '||v_src ELSE '' END;
      PERFORM public._crm_send_push(
        c.company_id, v_owner,
        'New Facebook lead', v_body,
        'https://rms.nexunova.com/sales-portal.html?lead='||v_lead::text,
        'push:fblead:'||v_lead::text,
        true   -- ignore_quiet: FB leads notify even during quiet hours
      );
    END IF;
  END IF;
  RETURN v_res;
END; $function$;
