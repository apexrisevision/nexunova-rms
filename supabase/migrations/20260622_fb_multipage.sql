-- ════════════════════════════════════════════════════════════════════════════
-- FB LEAD-ADS — MULTI-PAGE per company, each mapped to a PROJECT, ingested through
-- the SAME validated create_lead path (no parallel raw insert).
--   A) schema: drop UNIQUE(company_id) → partial UNIQUE(page_id); add project_id
--   B) RPCs: list_fb_connections / save_fb_page / delete_fb_page (director/admin)
--   C) create_lead_from_fb(page_id,…) — service-callable; resolves page→project+
--      director, mints a short-lived director session and routes through create_lead
--      so _norm_phone dedupe + project guard + owner=director are all reused.
--   Replaces the single-page get_fb_connection / save_fb_connection.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) SCHEMA ──
ALTER TABLE public.fb_connections DROP CONSTRAINT IF EXISTS fb_connections_company_id_key;
ALTER TABLE public.fb_connections ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
-- one FB page connects exactly once (globally); many unconfigured (null) rows allowed
CREATE UNIQUE INDEX IF NOT EXISTS fb_connections_page_id_uidx ON public.fb_connections (page_id) WHERE page_id IS NOT NULL;

-- ── drop the single-page RPCs the new UI replaces ──
DROP FUNCTION IF EXISTS public.get_fb_connection(text);
DROP FUNCTION IF EXISTS public.save_fb_connection(text, jsonb);

-- ── B) list pages for the company (director/admin) ──
CREATE OR REPLACE FUNCTION public.list_fb_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'page_id',c.page_id,'page_name',c.page_name,
    'has_token',(c.page_access_token IS NOT NULL AND length(c.page_access_token)>0),
    'token_tail', CASE WHEN c.page_access_token IS NOT NULL THEN right(c.page_access_token,6) ELSE NULL END,
    'verify_token',c.verify_token,'project_id',c.project_id,'project_name',p.project_name,
    'recipient_sales_user_id',c.recipient_sales_user_id,'recipient_name',ru.full_name,
    'auto_notify',c.auto_notify,'status',c.status,'last_lead_at',c.last_lead_at,'leads_count',c.leads_count
  ) ORDER BY c.created_at), '[]'::jsonb) INTO v_rows
  FROM public.fb_connections c
  LEFT JOIN public.projects p ON p.id=c.project_id
  LEFT JOIN public.sales_users ru ON ru.id=c.recipient_sales_user_id
  WHERE c.company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'pages',v_rows);
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_fb_connections(text) TO anon, authenticated;

-- ── B) upsert one page (director/admin) ──
CREATE OR REPLACE FUNCTION public.save_fb_page(p_session_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_id uuid; v_pid text; v_tok text;
        v_proj uuid; v_recip uuid; v_status text; v_exists uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;

  v_pid := NULLIF(TRIM(COALESCE(p_payload->>'page_id','')),'');
  IF v_pid IS NULL THEN RETURN jsonb_build_object('success',false,'error','page_required','message','Facebook Page ID is required.'); END IF;
  v_id  := NULLIF(p_payload->>'id','')::uuid;
  v_tok := NULLIF(TRIM(COALESCE(p_payload->>'page_access_token','')),'');

  -- project must belong to THIS company (else cleared)
  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  IF v_proj IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_proj AND company_id=v_co) THEN v_proj:=NULL; END IF;

  -- recipient (lead owner) must belong to company; default to the caller
  v_recip := NULLIF(p_payload->>'recipient_sales_user_id','')::uuid;
  IF v_recip IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales_users WHERE id=v_recip AND company_id=v_co) THEN v_recip := v_ses.sales_user_id; END IF;

  -- a page connects exactly once (globally)
  SELECT id INTO v_exists FROM public.fb_connections WHERE page_id=v_pid LIMIT 1;
  IF v_exists IS NOT NULL AND (v_id IS NULL OR v_exists <> v_id) THEN
    RETURN jsonb_build_object('success',false,'error','page_taken','message','That Facebook Page is already connected.'); END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.fb_connections SET
      page_id=v_pid,
      page_name=NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''),
      page_access_token=COALESCE(v_tok, page_access_token),
      app_secret=COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), app_secret),
      project_id=v_proj,
      recipient_sales_user_id=v_recip,
      auto_notify=COALESCE((p_payload->>'auto_notify')::boolean, auto_notify),
      updated_at=now()
    WHERE id=v_id AND company_id=v_co;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  ELSE
    INSERT INTO public.fb_connections(company_id, page_id, page_name, page_access_token, app_secret,
                                      project_id, recipient_sales_user_id, auto_notify)
    VALUES (v_co, v_pid, NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''), v_tok,
            NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), v_proj, v_recip,
            COALESCE((p_payload->>'auto_notify')::boolean, true))
    RETURNING id INTO v_id;
  END IF;

  SELECT page_access_token INTO v_tok FROM public.fb_connections WHERE id=v_id;
  v_status := CASE WHEN v_pid IS NOT NULL AND v_tok IS NOT NULL THEN 'connected' ELSE 'disconnected' END;
  UPDATE public.fb_connections SET status=v_status WHERE id=v_id;
  RETURN jsonb_build_object('success',true,'id',v_id,'status',v_status);
END; $function$;
GRANT EXECUTE ON FUNCTION public.save_fb_page(text, jsonb) TO anon, authenticated;

-- ── B) delete one page (director/admin) ──
CREATE OR REPLACE FUNCTION public.delete_fb_page(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.fb_connections WHERE id=p_id AND company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_fb_page(text, uuid) TO anon, authenticated;

-- ── C) service-callable: resolve page → project+director, route through create_lead ──
CREATE OR REPLACE FUNCTION public.create_lead_from_fb(p_page_id text, p_name text, p_phone text, p_email text, p_raw jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.fb_connections; v_owner uuid; v_tok text; v_res jsonb;
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

  -- mint a short-lived session for the director so the FB lead goes through the
  -- exact same validated create_lead path (dedupe / project guard / owner)
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
  END IF;
  RETURN v_res;
END; $function$;
GRANT EXECUTE ON FUNCTION public.create_lead_from_fb(text,text,text,text,jsonb) TO service_role;
