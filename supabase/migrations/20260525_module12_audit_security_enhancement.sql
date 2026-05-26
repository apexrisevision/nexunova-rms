-- ================================================================
-- NEXUNOVA RMS — MODULE 12 — AUDIT & SECURITY ENHANCEMENT
-- 2026-05-25 — Applied via MCP + verified.
-- Tables : auth_events, company_ip_whitelists, company_security_settings
-- RPCs   : log_auth_event, get_auth_events, get_security_settings,
--          save_security_settings, get_ip_whitelist,
--          add_ip_whitelist_entry, remove_ip_whitelist_entry,
--          get_locked_users
-- JS     : session inactivity timeout (auth.js), Security tab (admin.js)
-- ================================================================

-- ── auth_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id      uuid,
  username     text,
  event_type   text NOT NULL
               CHECK (event_type IN (
                 'login_success','login_failed','login_locked',
                 'logout','session_expired','ip_blocked'
               )),
  ip_address   text,
  user_agent   text,
  details      jsonb,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_events_company_created
  ON public.auth_events (company_id, created_at DESC);

-- ── company_ip_whitelists ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_ip_whitelists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ip_range    text NOT NULL,
  label       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.company_ip_whitelists ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_ip_whitelists' AND policyname='ipwl_company_isolation') THEN
    CREATE POLICY ipwl_company_isolation ON public.company_ip_whitelists
      USING (company_id=(SELECT company_id FROM public.app_users WHERE id=auth.uid()))
      WITH CHECK (company_id=(SELECT company_id FROM public.app_users WHERE id=auth.uid()));
  END IF;
END $$;

-- ── company_security_settings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_security_settings (
  company_id            uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  session_timeout_min   int  NOT NULL DEFAULT 120,
  lockout_threshold     int  NOT NULL DEFAULT 5,
  lockout_duration_min  int  NOT NULL DEFAULT 15,
  ip_whitelist_enabled  boolean NOT NULL DEFAULT false,
  require_2fa_admin     boolean NOT NULL DEFAULT true,
  updated_at            timestamptz DEFAULT now()
);
ALTER TABLE public.company_security_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_security_settings' AND policyname='css_company_isolation') THEN
    CREATE POLICY css_company_isolation ON public.company_security_settings
      USING (company_id=(SELECT company_id FROM public.app_users WHERE id=auth.uid()))
      WITH CHECK (company_id=(SELECT company_id FROM public.app_users WHERE id=auth.uid()));
  END IF;
END $$;

-- ── RPCs (see applied migration for full bodies) ─────────────────
-- log_auth_event, get_auth_events, get_security_settings,
-- save_security_settings, get_ip_whitelist,
-- add_ip_whitelist_entry, remove_ip_whitelist_entry, get_locked_users
-- All GRANT-ed to anon, authenticated.
