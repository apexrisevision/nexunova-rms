-- ════════════════════════════════════════════════════════════════════════════
-- FACEBOOK OAUTH — short-lived handshake state (Commit 4 of OAuth Connect)
-- Between the OAuth "exchange" step (code → user token → list of managed pages)
-- and the "save" step (user picks a page + project), the page access tokens must
-- live SERVER-SIDE only — never sent to the browser. This table holds that state
-- under a one-time nonce for ~10 minutes, written/read only by the fb-oauth Edge
-- Function (service_role). RLS deny-all floor; no anon/authenticated access.
-- Nothing else in the FB pipeline depends on this table (fully additive).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fb_oauth_sessions (
  nonce         text PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_user_id uuid NOT NULL,
  user_token    text,          -- long-lived FB user token (server-only)
  pages         jsonb,         -- [{page_id,name,access_token,tasks}] (server-only)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.fb_oauth_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='fb_oauth_sessions' AND policyname='deny_all_anon'
  ) THEN
    CREATE POLICY deny_all_anon ON public.fb_oauth_sessions FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
