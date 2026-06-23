-- ════════════════════════════════════════════════════════════════════════════
-- FB CONNECTION → OPERATOR (lead_entry) HANDOFF
-- Move Facebook connection MANAGEMENT from director/admin to the lead_entry
-- operator, while the director keeps a READ-ONLY view and leads keep routing to
-- the active director EXACTLY as today.
--
--   READS  (list_fb_connections, fb_diag_overview)  → lead_entry + director + admin
--   WRITES (save_fb_page, delete_fb_page, disconnect_fb) → lead_entry + admin only
--            (director is read-only; admin kept as super-user fallback)
--
-- RECIPIENT LOCK: the operator must never choose/alter which director receives
-- leads. In save_fb_page, a lead_entry caller can never set recipient_sales_user_id
-- (payload value ignored; auto-resolved to the active director, same logic as
-- create_lead_from_fb; on update the existing recipient is preserved). A
-- defense-in-depth BEFORE trigger additionally refuses any recipient change that
-- does not come through save_fb_page's authorized path (Postgres has no native
-- per-column RLS; fb_connections is already RLS deny-all so no direct client write
-- is possible — this trigger guards the value at the row level regardless of path).
--
-- DOES NOT touch: fb-leads-webhook, create_lead_from_fb, lead routing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Defense-in-depth: recipient_sales_user_id may only be set/changed by the
--    authorized path (save_fb_page sets app.fb_recip_ok='1' for that statement).
CREATE OR REPLACE FUNCTION public._fb_lock_recipient() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.recipient_sales_user_id IS DISTINCT FROM (CASE WHEN TG_OP='UPDATE' THEN OLD.recipient_sales_user_id ELSE NULL END) THEN
    IF COALESCE(current_setting('app.fb_recip_ok', true),'0') <> '1' THEN
      -- unauthorized change → coerce back (keep old on update / null on insert)
      NEW.recipient_sales_user_id := CASE WHEN TG_OP='UPDATE' THEN OLD.recipient_sales_user_id ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_fb_lock_recipient ON public.fb_connections;
CREATE TRIGGER trg_fb_lock_recipient
  BEFORE INSERT OR UPDATE ON public.fb_connections
  FOR EACH ROW EXECUTE FUNCTION public._fb_lock_recipient();

-- ── save_fb_page: operator/admin write; operator recipient is auto-locked ─────
CREATE OR REPLACE FUNCTION public.save_fb_page(p_session_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_id uuid; v_pid text; v_tok text;
        v_proj uuid; v_recip uuid; v_status text; v_exists uuid; v_is_le boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  -- writes: operator (lead_entry) or admin. directors are read-only.
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  v_is_le := (v_role='lead_entry');

  v_pid := NULLIF(TRIM(COALESCE(p_payload->>'page_id','')),'');
  IF v_pid IS NULL THEN RETURN jsonb_build_object('success',false,'error','page_required','message','Facebook Page ID is required.'); END IF;
  v_id  := NULLIF(p_payload->>'id','')::uuid;
  v_tok := NULLIF(TRIM(COALESCE(p_payload->>'page_access_token','')),'');

  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  IF v_proj IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_proj AND company_id=v_co) THEN v_proj:=NULL; END IF;

  -- recipient director — operator can NEVER set/alter it; admin may pass a director.
  IF v_is_le THEN
    v_recip := NULL;
  ELSE
    v_recip := NULLIF(p_payload->>'recipient_sales_user_id','')::uuid;
    IF v_recip IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.sales_users WHERE id=v_recip AND company_id=v_co AND role IN ('director','admin')) THEN
      v_recip := NULL;
    END IF;
  END IF;
  IF v_recip IS NULL THEN  -- resolve active director (same as create_lead_from_fb)
    SELECT id INTO v_recip FROM public.sales_users
     WHERE company_id=v_co AND role='director' AND status='active'
     ORDER BY created_at NULLS LAST, id LIMIT 1;
  END IF;

  SELECT id INTO v_exists FROM public.fb_connections WHERE page_id=v_pid LIMIT 1;
  IF v_exists IS NOT NULL AND (v_id IS NULL OR v_exists <> v_id) THEN
    RETURN jsonb_build_object('success',false,'error','page_taken','message','That Facebook Page is already connected.');
  END IF;

  IF v_id IS NOT NULL THEN
    IF v_is_le THEN
      -- operator update: never touches recipient (existing value preserved)
      UPDATE public.fb_connections SET
        page_id=v_pid,
        page_name=NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''),
        page_access_token=COALESCE(v_tok, page_access_token),
        app_secret=COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), app_secret),
        project_id=v_proj,
        auto_notify=COALESCE((p_payload->>'auto_notify')::boolean, auto_notify),
        updated_at=now()
      WHERE id=v_id AND company_id=v_co;
    ELSE
      PERFORM set_config('app.fb_recip_ok','1', true);
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
    END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  ELSE
    PERFORM set_config('app.fb_recip_ok','1', true);  -- authorized recipient write
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

-- ── delete_fb_page: operator + admin (director read-only) ────────────────────
CREATE OR REPLACE FUNCTION public.delete_fb_page(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.fb_connections WHERE id=p_id AND company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

-- ── disconnect_fb (legacy): align gate to operator + admin ───────────────────
CREATE OR REPLACE FUNCTION public.disconnect_fb(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  UPDATE public.fb_connections SET page_id=NULL, page_access_token=NULL, status='disconnected', updated_at=now()
   WHERE company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;

-- ── list_fb_connections: read for operator + director + admin ────────────────
CREATE OR REPLACE FUNCTION public.list_fb_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
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

-- ── fb_diag_overview: read for operator + director + admin ───────────────────
CREATE OR REPLACE FUNCTION public.fb_diag_overview(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_health jsonb; v_logs jsonb; v_imports jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(h ORDER BY h.page_name NULLS LAST, h.page_id), '[]'::jsonb) INTO v_health FROM (
    SELECT c.id AS connection_id, c.page_id, c.page_name, c.status AS connection_status,
      (SELECT max(w.created_at) FROM public.facebook_webhook_logs w
         WHERE w.company_id=v_ses.company_id AND w.page_id=c.page_id AND w.event_type='verify') AS last_verify_at,
      (SELECT max(w.created_at) FROM public.facebook_webhook_logs w
         WHERE w.company_id=v_ses.company_id AND w.page_id=c.page_id AND w.event_type IN ('leadgen','test')) AS last_event_at,
      (SELECT w.status FROM public.facebook_webhook_logs w
         WHERE w.company_id=v_ses.company_id AND w.page_id=c.page_id ORDER BY w.created_at DESC LIMIT 1) AS last_status,
      (SELECT w.http_status FROM public.facebook_webhook_logs w
         WHERE w.company_id=v_ses.company_id AND w.page_id=c.page_id ORDER BY w.created_at DESC LIMIT 1) AS last_http_status,
      (SELECT w.error_message FROM public.facebook_webhook_logs w
         WHERE w.company_id=v_ses.company_id AND w.page_id=c.page_id AND w.error_message IS NOT NULL
         ORDER BY w.created_at DESC LIMIT 1) AS last_error
    FROM public.fb_connections c WHERE c.company_id=v_ses.company_id
  ) h;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_logs FROM (
    SELECT w.id, w.created_at, w.processed_at, w.page_id, w.form_id, w.leadgen_id,
           w.event_type, w.status, w.error_message, w.is_test, w.http_status, w.raw_payload
    FROM public.facebook_webhook_logs w
    WHERE w.company_id=v_ses.company_id
    ORDER BY w.created_at DESC LIMIT 50
  ) x;

  SELECT COALESCE(jsonb_agg(y ORDER BY y.created_at DESC), '[]'::jsonb) INTO v_imports FROM (
    SELECT w.id, w.created_at, w.page_id, c.page_name, w.form_id, w.leadgen_id,
           w.status, w.error_message, w.lead_id, w.lead_name, w.lead_phone, w.is_test,
           p.project_name
    FROM public.facebook_webhook_logs w
    LEFT JOIN public.fb_connections c ON c.page_id=w.page_id AND c.company_id=w.company_id
    LEFT JOIN public.projects p ON p.id=c.project_id
    WHERE w.company_id=v_ses.company_id AND w.event_type IN ('leadgen','test')
    ORDER BY w.created_at DESC LIMIT 50
  ) y;

  RETURN jsonb_build_object('success',true,'health',v_health,'logs',v_logs,'imports',v_imports);
END; $function$;

GRANT EXECUTE ON FUNCTION public.list_fb_connections(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fb_diag_overview(text)    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_fb_page(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_fb_page(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_fb(text)       TO anon, authenticated, service_role;
