-- ════════════════════════════════════════════════════════════════════════════
-- WEBSITE LEAD CAPTURE — client's website form posts → leads in the CRM
-- Per-company public intake key. A browser form (or any POST) hits the web-lead
-- Edge Function with the key; the lead is created via create_lead (dedupe + guard
-- reused) under the company's active director, source='website'.
-- (Applied live via MCP 2026-06-24; this file is the repo record.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.web_lead_config (
  company_id         uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  intake_key         text UNIQUE NOT NULL,
  default_project_id uuid,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.web_lead_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_lead_config' AND policyname='deny_all_anon') THEN
    CREATE POLICY deny_all_anon ON public.web_lead_config FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- allow 'website' as a lead source for the roles that can own leads
UPDATE public.lead_role_config
   SET create_sources = create_sources || '["website"]'::jsonb
 WHERE can_have_leads AND NOT (COALESCE(create_sources,'[]'::jsonb) @> '["website"]'::jsonb);

CREATE OR REPLACE FUNCTION public.get_web_lead_config(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_key text; v_proj uuid; v_active boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT intake_key, default_project_id, active INTO v_key, v_proj, v_active FROM public.web_lead_config WHERE company_id=v_ses.company_id;
  IF v_key IS NULL THEN
    v_key := replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.web_lead_config(company_id, intake_key) VALUES (v_ses.company_id, v_key)
      ON CONFLICT (company_id) DO UPDATE SET updated_at=now()
      RETURNING intake_key, default_project_id, active INTO v_key, v_proj, v_active;
  END IF;
  RETURN jsonb_build_object('success',true,'intake_key',v_key,'default_project_id',v_proj,'active',COALESCE(v_active,true));
END; $function$;

CREATE OR REPLACE FUNCTION public.set_web_lead_config(p_session_token text, p_action text, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_key text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  INSERT INTO public.web_lead_config(company_id, intake_key) VALUES (v_ses.company_id, replace(gen_random_uuid()::text,'-',''))
    ON CONFLICT (company_id) DO NOTHING;
  IF p_action='regenerate' THEN
    UPDATE public.web_lead_config SET intake_key=replace(gen_random_uuid()::text,'-',''), updated_at=now() WHERE company_id=v_ses.company_id;
  ELSIF p_action='project' THEN
    UPDATE public.web_lead_config SET default_project_id=p_project_id, updated_at=now() WHERE company_id=v_ses.company_id;
  END IF;
  SELECT intake_key INTO v_key FROM public.web_lead_config WHERE company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'intake_key',v_key);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_lead_from_web(p_key text, p_name text, p_phone text, p_email text, p_project_id uuid DEFAULT NULL, p_raw jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid; v_def uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb;
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
  RETURN v_res;
END; $function$;

GRANT EXECUTE ON FUNCTION public.get_web_lead_config(text)            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_web_lead_config(text,text,uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_lead_from_web(text,text,text,text,uuid,jsonb) TO service_role;
