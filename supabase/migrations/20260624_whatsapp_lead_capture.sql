-- ════════════════════════════════════════════════════════════════════════════
-- WHATSAPP LEAD CAPTURE (Cloud API) — inbound WhatsApp messages → leads in CRM
-- Each company connects their WhatsApp Business number (Phone Number ID). Meta's
-- webhook hits wa-leads-webhook; the message becomes a lead via create_lead
-- (dedupe + guard reused) under the company's active director, source='whatsapp'.
-- Per-company verify_token (matched on the webhook GET — no platform secret).
-- (Applied live via MCP 2026-06-24; this file is the repo record.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  phone_number_id text PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  waba_id         text,
  display_number  text,
  access_token    text,
  verify_token    text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),
  project_id      uuid,
  active          boolean NOT NULL DEFAULT true,
  leads_count     integer NOT NULL DEFAULT 0,
  last_event_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_conn_company ON public.whatsapp_connections(company_id);
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_connections' AND policyname='deny_all_anon') THEN
    CREATE POLICY deny_all_anon ON public.whatsapp_connections FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

UPDATE public.lead_role_config
   SET create_sources = create_sources || '["whatsapp"]'::jsonb
 WHERE can_have_leads AND NOT (COALESCE(create_sources,'[]'::jsonb) @> '["whatsapp"]'::jsonb);

CREATE OR REPLACE FUNCTION public.save_whatsapp_connection(p_session_token text, p_phone_number_id text, p_display_number text DEFAULT NULL, p_waba_id text DEFAULT NULL, p_access_token text DEFAULT NULL, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_pnid text; v_exist uuid; v_vt text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_pnid := NULLIF(TRIM(COALESCE(p_phone_number_id,'')),'');
  IF v_pnid IS NULL THEN RETURN jsonb_build_object('success',false,'error','phone_number_id_required','message','Phone Number ID is required.'); END IF;
  SELECT company_id INTO v_exist FROM public.whatsapp_connections WHERE phone_number_id=v_pnid;
  IF v_exist IS NOT NULL AND v_exist <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','number_taken','message','This number is connected to another company.'); END IF;
  INSERT INTO public.whatsapp_connections(phone_number_id, company_id, waba_id, display_number, access_token, project_id)
  VALUES (v_pnid, v_ses.company_id, NULLIF(TRIM(COALESCE(p_waba_id,'')),''), NULLIF(TRIM(COALESCE(p_display_number,'')),''), NULLIF(TRIM(COALESCE(p_access_token,'')),''), p_project_id)
  ON CONFLICT (phone_number_id) DO UPDATE SET
    waba_id=excluded.waba_id, display_number=excluded.display_number,
    access_token=COALESCE(excluded.access_token, public.whatsapp_connections.access_token),
    project_id=excluded.project_id, active=true, updated_at=now();
  SELECT verify_token INTO v_vt FROM public.whatsapp_connections WHERE phone_number_id=v_pnid;
  RETURN jsonb_build_object('success',true,'phone_number_id',v_pnid,'verify_token',v_vt);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_whatsapp_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'phone_number_id', w.phone_number_id, 'display_number', w.display_number, 'waba_id', w.waba_id,
    'verify_token', w.verify_token, 'project_id', w.project_id, 'project_name', p.name,
    'has_token', (w.access_token IS NOT NULL AND length(w.access_token)>0),
    'active', w.active, 'leads_count', w.leads_count, 'last_event_at', w.last_event_at
  ) ORDER BY w.created_at), '[]'::jsonb) INTO v_rows
  FROM public.whatsapp_connections w LEFT JOIN public.projects p ON p.id=w.project_id
  WHERE w.company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'connections',v_rows);
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_whatsapp_connection(p_session_token text, p_phone_number_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.whatsapp_connections WHERE phone_number_id=p_phone_number_id AND company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp(p_phone_number_id text, p_wa_id text, p_name text, p_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb;
BEGIN
  SELECT company_id, project_id INTO v_co, v_proj FROM public.whatsapp_connections WHERE phone_number_id=p_phone_number_id AND active LIMIT 1;
  IF v_co IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_number'); END IF;
  SELECT id INTO v_owner FROM public.sales_users WHERE company_id=v_co AND role='director' AND status='active' ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_director'); END IF;
  v_tok := 'wa_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.sales_sessions(company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES (v_co, v_owner, v_proj, v_tok, now()+interval '2 minutes');
  v_res := public.create_lead(v_tok, jsonb_build_object(
    'name', COALESCE(NULLIF(TRIM(p_name),''),'WhatsApp lead'),
    'phone', p_wa_id, 'source','whatsapp',
    'notes', NULLIF(TRIM(COALESCE(p_text,'')),''), 'project_id', v_proj), false);
  DELETE FROM public.sales_sessions WHERE session_token=v_tok;
  IF v_res IS NOT NULL AND (v_res->>'success')='true' THEN
    UPDATE public.whatsapp_connections SET last_event_at=now(), leads_count=leads_count+1 WHERE phone_number_id=p_phone_number_id;
  END IF;
  RETURN v_res;
END; $function$;

GRANT EXECUTE ON FUNCTION public.save_whatsapp_connection(text,text,text,text,text,uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_connections(text)                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_whatsapp_connection(text,text)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_lead_from_whatsapp(text,text,text,text)            TO service_role;
