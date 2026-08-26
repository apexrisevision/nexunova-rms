-- ============================================================================
-- Close the anon hole on SECURITY DEFINER RPCs that carry NO caller guard.
-- ----------------------------------------------------------------------------
-- Follow-up to 20260826a (internal helpers + cron). These 14 functions are
-- SECURITY DEFINER, were executable by `anon` (the publishable key that ships
-- inside sales-portal.html), and their bodies contain no caller/session/tenant
-- check at all - they trust whatever company_id the caller passes in.
--
-- Proven live before this migration, calling as role `anon`:
--   * export_company_data(company_id) returned a full 29 KB company dump
--     (sales, clients, units) for a company id supplied by the caller.
--   * get_company_branding(company_id) returned the branding record.
--
-- `REVOKE ... FROM anon` alone is a fake lock: the grant these functions
-- actually carry is `=X/postgres`, i.e. PUBLIC. anon inherits it through
-- PUBLIC, so PUBLIC must be revoked too.
--
-- `authenticated` keeps its own explicit grant, so the admin app (which
-- establishes a real Supabase Auth session at login) is unaffected. The four
-- create_lead_from_* RPCs are reached only by Edge Functions that use the
-- service_role key, which is not affected by these grants either.
-- ============================================================================

-- No caller guard, no frontend caller: deletes leads.
REVOKE ALL ON FUNCTION public.cleanup_test_leads() FROM PUBLIC, anon;

-- Lead intake. Called only by Edge Functions using the service_role key.
REVOKE ALL ON FUNCTION public.create_lead_from_fb(p_page_id text, p_name text, p_phone text, p_email text, p_raw jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_lead_from_instagram(p_ig_account_id text, p_sender_id text, p_name text, p_text text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_lead_from_web(p_key text, p_name text, p_phone text, p_email text, p_project_id uuid, p_raw jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_lead_from_whatsapp(p_phone_number_id text, p_wa_id text, p_name text, p_text text) FROM PUBLIC, anon;

-- Whole-company export. The worst of the set.
REVOKE ALL ON FUNCTION public.export_company_data(p_company_id uuid) FROM PUBLIC, anon;

-- Admin-only reads and helpers, all company_id-by-parameter.
REVOKE ALL ON FUNCTION public.generate_project_code(p_company_id uuid, p_base text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_audit_entry(p_company_id uuid, p_audit_id bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_branding(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_portfolio_summary(p_company_id uuid, p_project_id uuid, p_to_date date, p_status text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_record_history(p_company_id uuid, p_table_name text, p_record_id text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recovery_position(p_company_id uuid, p_project_id uuid, p_from_date date, p_to_date date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_today_snapshot(p_company_id uuid, p_project_id uuid, p_today date) FROM PUBLIC, anon;

-- Trigger function; fires inside the owning statement, never called as an RPC.
REVOKE ALL ON FUNCTION public.trg_sales_user_welcome_note() FROM PUBLIC, anon;
