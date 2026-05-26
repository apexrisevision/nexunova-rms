-- ============================================================
-- Audit remediation 2026-05-26 — 4 items only
-- Applied to remote via Supabase MCP (migration: audit_remediation_20260526).
-- ============================================================

-- ---- Item 1: enable RLS + deny_all_anon (matches existing RMS table pattern) ----
ALTER TABLE public.auth_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_feature_flags  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_announcements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_support_tickets     ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_anon ON public.auth_events
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.company_feature_flags
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.sa_announcements
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.sa_support_tickets
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ---- Item 2: fix isolation predicate app_users.id -> app_users.auth_user_id ----
-- auth.uid() returns the auth user id; the matching column on app_users is auth_user_id, not id.
ALTER POLICY company_isolation ON public.buyer_complaints
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY cs_company_isolation ON public.commission_structures
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()))
  WITH CHECK (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY ipwl_company_isolation ON public.company_ip_whitelists
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()))
  WITH CHECK (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY css_company_isolation ON public.company_security_settings
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()))
  WITH CHECK (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY fv_company_isolation ON public.field_visits
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()))
  WITH CHECK (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY instsnap_company_isolation ON public.installment_snapshots
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

ALTER POLICY noc_company_isolation ON public.noc
  USING (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()))
  WITH CHECK (company_id = (SELECT app_users.company_id FROM public.app_users WHERE app_users.auth_user_id = auth.uid()));

-- ---- Item 3: drop redundant duplicate triggers (keep one each) ----
DROP TRIGGER IF EXISTS trg_agents_updated_at ON public.agents;        -- keep trg_agents_upd
DROP TRIGGER IF EXISTS clients_set_updated_at ON public.clients;      -- keep trg_clients_upd
DROP TRIGGER IF EXISTS trg_call_health        ON public.contact_logs; -- keep trg_health_contact
DROP TRIGGER IF EXISTS trg_health_payment     ON public.payments;     -- keep trg_payment_health
DROP TRIGGER IF EXISTS trg_health_pdc         ON public.pdc_cheques;  -- keep trg_pdc_health
DROP TRIGGER IF EXISTS units_set_updated_at   ON public.units;        -- keep trg_units_upd

-- ---- Item 4: resolve get_record_history overload ambiguity ----
-- Both signatures shared the PostgREST param-name set {p_company_id,p_table_name,p_record_id}.
-- The (text,text,uuid) variant was broken (selected non-existent columns user_name/user_role,
-- declared id uuid vs actual bigint) and unused by the app. Keep the (uuid,text,text) variant.
DROP FUNCTION IF EXISTS public.get_record_history(text, text, uuid);
