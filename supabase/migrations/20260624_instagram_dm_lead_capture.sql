-- ════════════════════════════════════════════════════════════════════════════
-- INSTAGRAM DM LEAD CAPTURE — inbound Instagram Direct Messages → leads in CRM
-- (Instagram lead ADS already arrive via the Facebook Page leadgen webhook; this
--  captures Direct Messages, a separate source.) Resolve company by IG business
--  account id (webhook entry.id). Instagram shares no phone — lead has the message
--  (+ sender IG id) as notes, source='instagram'; follow-up happens in Instagram.
-- (Applied live via MCP 2026-06-24; this file is the repo record.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.instagram_connections (
  ig_account_id  text PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ig_username    text,
  page_id        text,
  access_token   text,
  verify_token   text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),
  project_id     uuid,
  active         boolean NOT NULL DEFAULT true,
  leads_count    integer NOT NULL DEFAULT 0,
  last_event_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_conn_company ON public.instagram_connections(company_id);
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='instagram_connections' AND policyname='deny_all_anon') THEN
    CREATE POLICY deny_all_anon ON public.instagram_connections FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

UPDATE public.lead_role_config
   SET create_sources = create_sources || '["instagram"]'::jsonb
 WHERE can_have_leads AND NOT (COALESCE(create_sources,'[]'::jsonb) @> '["instagram"]'::jsonb);

CREATE OR REPLACE FUNCTION public.save_instagram_connection(p_session_token text, p_ig_account_id text, p_ig_username text DEFAULT NULL, p_page_id text DEFAULT NULL, p_access_token text DEFAULT NULL, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_id text; v_exist uuid; v_vt text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_id := NULLIF(TRIM(COALESCE(p_ig_account_id,'')),'');
  IF v_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','ig_account_id_required','message','Instagram account ID is required.'); END IF;
  SELECT company_id INTO v_exist FROM public.instagram_connections WHERE ig_account_id=v_id;
  IF v_exist IS NOT NULL AND v_exist <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','account_taken','message','This Instagram account is connected to another company.'); END IF;
  INSERT INTO public.instagram_connections(ig_account_id, company_id, ig_username, page_id, access_token, project_id)
  VALUES (v_id, v_ses.company_id, NULLIF(TRIM(COALESCE(p_ig_username,'')),''), NULLIF(TRIM(COALESCE(p_page_id,'')),''), NULLIF(TRIM(COALESCE(p_access_token,'')),''), p_project_id)
  ON CONFLICT (ig_account_id) DO UPDATE SET
    ig_username=excluded.ig_username, page_id=excluded.page_id,
    access_token=COALESCE(excluded.access_token, public.instagram_connections.access_token),
    project_id=excluded.project_id, active=true, updated_at=now();
  SELECT verify_token INTO v_vt FROM public.instagram_connections WHERE ig_account_id=v_id;
  RETURN jsonb_build_object('success',true,'ig_account_id',v_id,'verify_token',v_vt);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_instagram_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ig_account_id', w.ig_account_id, 'ig_username', w.ig_username, 'page_id', w.page_id,
    'verify_token', w.verify_token, 'project_id', w.project_id, 'project_name', p.name,
    'has_token', (w.access_token IS NOT NULL AND length(w.access_token)>0),
    'active', w.active, 'leads_count', w.leads_count, 'last_event_at', w.last_event_at
  ) ORDER BY w.created_at), '[]'::jsonb) INTO v_rows
  FROM public.instagram_connections w LEFT JOIN public.projects p ON p.id=w.project_id
  WHERE w.company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'connections',v_rows);
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_instagram_connection(p_session_token text, p_ig_account_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.instagram_connections WHERE ig_account_id=p_ig_account_id AND company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_lead_from_instagram(p_ig_account_id text, p_sender_id text, p_name text, p_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid; v_proj uuid; v_owner uuid; v_tok text; v_res jsonb; v_note text;
BEGIN
  SELECT company_id, project_id INTO v_co, v_proj FROM public.instagram_connections WHERE ig_account_id=p_ig_account_id AND active LIMIT 1;
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
  END IF;
  RETURN v_res;
END; $function$;

GRANT EXECUTE ON FUNCTION public.save_instagram_connection(text,text,text,text,text,uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_instagram_connections(text)                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_instagram_connection(text,text)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_lead_from_instagram(text,text,text,text)            TO service_role;
