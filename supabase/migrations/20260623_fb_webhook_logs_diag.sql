-- ════════════════════════════════════════════════════════════════════════════
-- FACEBOOK LEADS — webhook logging + diagnostics (Commit 1 of FB diagnostics module)
-- Adds an observability layer over the existing fb-leads-webhook pipeline. Nothing
-- here changes how leads are created (create_lead_from_fb / create_lead are untouched);
-- it only RECORDS what happens so the director can debug from the portal.
--
--  • facebook_webhook_logs  — one row per webhook event (verify GET / leadgen POST /
--    internal test), carrying the raw payload, the outcome, and (for leadgen) the
--    resulting lead + dedupe reason. Written by the Edge Function via service_role.
--  • fb_diag_overview(token) — director/admin read RPC powering the diagnostics UI:
--    per-page webhook health + last 50 logs + last 50 import attempts. Masks tokens.
--
-- Security: RLS deny-all floor (reads go only through the SECURITY DEFINER RPC; writes
-- only through the Edge Function's service_role, which bypasses RLS). Matches the
-- project-wide "no GoTrue → deny-all RLS only" rule.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.facebook_webhook_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.fb_connections(id) ON DELETE SET NULL,
  page_id       text,
  form_id       text,
  leadgen_id    text,
  event_type    text NOT NULL DEFAULT 'leadgen',  -- verify | leadgen | test
  raw_payload   jsonb,
  status        text,                              -- verified | forbidden | received | processed | duplicate | failed
  error_message text,
  lead_id       uuid,
  lead_name     text,
  lead_phone    text,
  is_test       boolean NOT NULL DEFAULT false,
  http_status   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fb_webhook_logs_company_created
  ON public.facebook_webhook_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_webhook_logs_page
  ON public.facebook_webhook_logs (page_id);

-- RLS deny-all floor: no direct anon/authenticated access. Service-role (Edge) and
-- SECURITY DEFINER functions are unaffected.
ALTER TABLE public.facebook_webhook_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='facebook_webhook_logs' AND policyname='deny_all_anon'
  ) THEN
    CREATE POLICY deny_all_anon ON public.facebook_webhook_logs FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── Diagnostics read RPC ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fb_diag_overview(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_health jsonb; v_logs jsonb; v_imports jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  -- per-page webhook health, derived from the log
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

  -- last 50 raw webhook events
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_logs FROM (
    SELECT w.id, w.created_at, w.processed_at, w.page_id, w.form_id, w.leadgen_id,
           w.event_type, w.status, w.error_message, w.is_test, w.http_status, w.raw_payload
    FROM public.facebook_webhook_logs w
    WHERE w.company_id=v_ses.company_id
    ORDER BY w.created_at DESC LIMIT 50
  ) x;

  -- last 50 lead import attempts (leadgen + test that tried to create a lead)
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

GRANT EXECUTE ON FUNCTION public.fb_diag_overview(text) TO anon, authenticated, service_role;
