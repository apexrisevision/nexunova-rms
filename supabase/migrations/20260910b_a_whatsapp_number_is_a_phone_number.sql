-- A WhatsApp number is a phone number.
--
-- The Facebook webhook takes the phone from the first form field whose name
-- contains "phone". The "Fourteen Manzil Heights Peshawar" form asks for it as
-- `whatsapp_number`, so 27 leads (31 Aug - 2 Sep 2026) arrived with phone NULL
-- while the number sat in fb_answers. They were assigned on and the rep saw a
-- name with nothing to call.
--
-- The fix lives here rather than in the edge function: when the webhook hands
-- over no phone, take it from the form's own answers - the first field named
-- like phone / whatsapp / mobile / contact / cell whose value carries at least
-- ten digits (so "preferred_contact_time = morning" is never read as a number).
-- Resolving it BEFORE create_lead means the duplicate check sees the number too;
-- a NULL phone is how "Muhammad Shah" got in twice an hour apart.
--
-- Checked against all 336 Facebook leads that carry answers: on the 309 that
-- already had a phone, the same rule reproduces the stored number on 308 (the
-- one exception is a 6-digit "177776", which the ten-digit guard rejects and
-- which never reaches this path because its phone was not empty).
--
-- Everything else in the function is unchanged. CREATE OR REPLACE keeps the
-- existing grants.

CREATE OR REPLACE FUNCTION public.create_lead_from_fb(p_page_id text, p_name text, p_phone text, p_email text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.fb_connections; v_owner uuid; v_tok text; v_res jsonb; v_lead uuid; v_src text; v_body text;
        v_phone text;
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

  -- A form may ask for the number under a name without "phone" in it
  -- (e.g. whatsapp_number). Fall back to the form's answers before creating.
  v_phone := NULLIF(regexp_replace(COALESCE(p_phone,''), '\s', '', 'g'), '');
  IF v_phone IS NULL AND jsonb_typeof(p_raw->'field_data') = 'array' THEN
    SELECT regexp_replace(f.a->'values'->>0, '\s', '', 'g') INTO v_phone
      FROM jsonb_array_elements(p_raw->'field_data') WITH ORDINALITY AS f(a, i)
     WHERE f.a->>'name' ~* '(phone|whatsapp|mobile|contact|cell)'
       AND length(regexp_replace(COALESCE(f.a->'values'->>0,''), '\D', '', 'g')) >= 10
     ORDER BY f.i
     LIMIT 1;
  END IF;

  v_tok := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (c.company_id, v_owner, c.project_id, v_tok, now()+interval '2 minutes');

  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name',       COALESCE(NULLIF(TRIM(p_name),''),'Facebook lead'),
    'phone',      v_phone,
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

    -- FB provenance: which Page it came from + the instant-form answers, so two
    -- Pages feeding one project stay distinguishable and the Q/A is on the lead.
    IF v_lead IS NOT NULL THEN
      UPDATE public.leads SET
        fb_page_id   = p_page_id,
        fb_page_name = c.page_name,
        fb_form_id   = NULLIF(TRIM(COALESCE(p_raw->>'form_id','')),''),
        fb_answers   = CASE WHEN jsonb_typeof(p_raw->'field_data')='array'
                            THEN p_raw->'field_data' ELSE NULL END
      WHERE id = v_lead;
    END IF;

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
