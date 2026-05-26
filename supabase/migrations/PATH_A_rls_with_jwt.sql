-- ================================================================
-- NEXUNOVA RMS — PATH A: PROPER RLS WITH JWT CLAIMS
-- ================================================================
--
-- WHAT THIS DOES:
--   1. Enables RLS on all 57 tables
--   2. Creates helper functions current_company_id() and is_super_admin()
--      that read from JWT claims
--   3. Adds tenant-isolation policies on every table with company_id
--   4. Adds appropriate policies on the 10 tables without company_id
--
-- PREREQUISITE — FRONTEND CHANGES (do this BEFORE running this SQL):
--   Your app currently uses custom verify_login (no JWT). You must:
--
--   1. After verify_login succeeds, ALSO call supabase.auth.signInWithPassword
--      OR issue a Supabase Auth session from a custom RPC that signs a JWT
--      with claims: { company_id, is_super_admin, role }
--
--   2. The simplest path on Supabase: create a Postgres function
--      `issue_jwt(p_company_id uuid, p_role text, p_is_super_admin bool)`
--      that uses sign() from the pgjwt extension to produce a JWT, return
--      it to the frontend, and have the frontend set it via
--      supabase.auth.setSession({ access_token, refresh_token })
--
--   3. Verify via: SELECT current_setting('request.jwt.claims', true);
--      should return your claims JSON when called from a logged-in client.
--
-- IF YOU CAN'T MIGRATE AUTH YET, USE PATH_B_emergency_lockdown.sql INSTEAD.
--
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. HELPER FUNCTIONS
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'company_id',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'is_super_admin')::boolean,
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_company_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- ----------------------------------------------------------------
-- 2. ENABLE RLS + TENANT-ISOLATION POLICY ON ALL 47 COMPANY-SCOPED TABLES
-- ----------------------------------------------------------------
--
-- Policy rule: a row is visible/writable if EITHER
--   (a) company_id = current_company_id() from the caller's JWT, OR
--   (b) caller is super admin (is_super_admin() = true)
--
-- ----------------------------------------------------------------

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'additional_receivables', 'agent_commission_payments', 'agent_transactions',
    'agents', 'app_users', 'audit_log_archive', 'audit_logs', 'banks',
    'blacklisted_clients', 'category_payment_types', 'category_unit_statuses',
    'category_unit_types', 'client_health_scores', 'clients', 'company_payment_methods',
    'contact_logs', 'escalations', 'floors', 'follow_up_reminders', 'installments',
    'invoices', 'legal_cases', 'payables', 'payment_links', 'payment_promises',
    'payment_proofs', 'payments', 'pdc_cheques', 'possessions',
    'project_bank_accounts', 'project_expenses', 'project_milestones',
    'project_price_revisions', 'projects', 'radar_action_logs', 'recovery_agents',
    'recovery_radar_logs', 'reminder_logs', 'sale_amendments', 'sale_documents',
    'sale_sequences', 'sales', 'subscriptions', 'unit_cancellations',
    'unit_transfers', 'units', 'voucher_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO anon, authenticated
        USING (company_id = public.current_company_id() OR public.is_super_admin())
        WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin())
    $f$, t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 3. SPECIAL POLICIES FOR TABLES WITHOUT company_id
-- ----------------------------------------------------------------

-- companies: filter by id = caller's company_id (caller only sees own company)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_company ON public.companies;
CREATE POLICY own_company ON public.companies
  FOR ALL TO anon, authenticated
  USING (id = public.current_company_id() OR public.is_super_admin())
  WITH CHECK (id = public.current_company_id() OR public.is_super_admin());

-- subscription_plans: GLOBAL read-only catalogue (Basic/Pro/Ultimate). All can read.
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_readable ON public.subscription_plans;
CREATE POLICY plans_readable ON public.subscription_plans
  FOR SELECT TO anon, authenticated
  USING (true);
DROP POLICY IF EXISTS plans_admin_write ON public.subscription_plans;
CREATE POLICY plans_admin_write ON public.subscription_plans
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_super_admin());

-- payment_methods: global catalogue (4 payment methods company-wide)
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pm_readable ON public.payment_methods;
CREATE POLICY pm_readable ON public.payment_methods
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS pm_admin_write ON public.payment_methods;
CREATE POLICY pm_admin_write ON public.payment_methods
  FOR INSERT TO anon, authenticated WITH CHECK (public.is_super_admin());

-- payment_partners: global catalogue
ALTER TABLE public.payment_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pp_readable ON public.payment_partners;
CREATE POLICY pp_readable ON public.payment_partners
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS pp_admin_write ON public.payment_partners;
CREATE POLICY pp_admin_write ON public.payment_partners
  FOR INSERT TO anon, authenticated WITH CHECK (public.is_super_admin());

-- system_config: ONLY super admins
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sys_admin_only ON public.system_config;
CREATE POLICY sys_admin_only ON public.system_config
  FOR ALL TO anon, authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- otp_tokens: pre-auth — allow INSERT for OTP send, SELECT only your own row
-- (Best handled by SECURITY DEFINER RPC. Lock direct access to super admin.)
ALTER TABLE public.otp_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS otp_admin_only ON public.otp_tokens;
CREATE POLICY otp_admin_only ON public.otp_tokens
  FOR ALL TO anon, authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- password_reset_requests: same — RPC-only access
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pwd_admin_only ON public.password_reset_requests;
CREATE POLICY pwd_admin_only ON public.password_reset_requests
  FOR ALL TO anon, authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- payment_link_reminders: derive company via payment_links join
ALTER TABLE public.payment_link_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plr_via_link ON public.payment_link_reminders;
CREATE POLICY plr_via_link ON public.payment_link_reminders
  FOR ALL TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.payment_links pl
            WHERE pl.id = payment_link_reminders.payment_link_id
              AND pl.company_id = public.current_company_id())
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.payment_links pl
            WHERE pl.id = payment_link_reminders.payment_link_id
              AND pl.company_id = public.current_company_id())
    OR public.is_super_admin()
  );

-- payment_link_status_history: derive company via payment_links join
ALTER TABLE public.payment_link_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plsh_via_link ON public.payment_link_status_history;
CREATE POLICY plsh_via_link ON public.payment_link_status_history
  FOR ALL TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.payment_links pl
            WHERE pl.id = payment_link_status_history.payment_link_id
              AND pl.company_id = public.current_company_id())
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.payment_links pl
            WHERE pl.id = payment_link_status_history.payment_link_id
              AND pl.company_id = public.current_company_id())
    OR public.is_super_admin()
  );

-- promise_reminders_log: derive company via payment_promises join
ALTER TABLE public.promise_reminders_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prl_via_promise ON public.promise_reminders_log;
CREATE POLICY prl_via_promise ON public.promise_reminders_log
  FOR ALL TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.payment_promises pp
            WHERE pp.id = promise_reminders_log.promise_id
              AND pp.company_id = public.current_company_id())
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.payment_promises pp
            WHERE pp.id = promise_reminders_log.promise_id
              AND pp.company_id = public.current_company_id())
    OR public.is_super_admin()
  );

COMMIT;

-- ----------------------------------------------------------------
-- 4. VERIFICATION QUERIES — run these after commit to confirm
-- ----------------------------------------------------------------
--
-- a) RLS enabled on all tables:
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND rowsecurity=false;
--    -- should return 0 rows
--
-- b) Policy count:
--    SELECT tablename, COUNT(*) AS policies FROM pg_policies
--    WHERE schemaname='public' GROUP BY tablename ORDER BY tablename;
--
-- c) Anon leak test (should now return 0 rows for every table):
--    SET ROLE anon;
--    SELECT count(*) FROM clients;  -- 0 (no JWT context = no company_id)
--    RESET ROLE;
--
-- ================================================================
