-- ════════════════════════════════════════════════════════════════════════════
-- FB LEADS — stamp the SOURCE PAGE and the INSTANT-FORM ANSWERS on each lead
--
-- Two pages now feed the SAME project (KHUSHAL BAGH HEIGHTS), so leads from
-- different Pages were indistinguishable: public.leads carried only
-- source='facebook' + project_id. The page/form ids and every question answer
-- were already arriving from Meta and being kept in facebook_webhook_logs
-- .raw_payload.lead.field_data — but create_lead_from_fb accepted p_raw and
-- never used it, so nothing reached the lead row.
--
--   A1) leads += fb_page_id / fb_page_name / fb_form_id / fb_answers
--       (all nullable, no default → no table rewrite, existing rows untouched)
--   A2) create_lead_from_fb: after create_lead succeeds, stamp those 4 columns.
--       create_lead itself is NOT touched — it is shared by the manual, web,
--       WhatsApp and Instagram lead paths.
--
-- trg_deal_sync_from_lead fires on this UPDATE: its UPDATE branch deliberately
-- does NOT sync stage/lost_reason ("deal-authoritative"), and every other column
-- it copies is unchanged by us, so the deal row is rewritten with identical
-- values (only deals.updated_at bumps). Verified before applying.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A1) SCHEMA ──
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS fb_page_id   text,
  ADD COLUMN IF NOT EXISTS fb_page_name text,
  ADD COLUMN IF NOT EXISTS fb_form_id   text,
  ADD COLUMN IF NOT EXISTS fb_answers   jsonb;

COMMENT ON COLUMN public.leads.fb_answers IS
  'Meta instant-form field_data as delivered: [{name, values[]}, …]. Question set differs per form, so render generically.';

-- ── A2) create_lead_from_fb — unchanged except the new stamping block ──
CREATE OR REPLACE FUNCTION public.create_lead_from_fb(p_page_id text, p_name text, p_phone text, p_email text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

GRANT EXECUTE ON FUNCTION public.create_lead_from_fb(text,text,text,text,jsonb) TO service_role;
