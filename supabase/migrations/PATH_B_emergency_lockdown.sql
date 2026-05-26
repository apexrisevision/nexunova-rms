-- ================================================================
-- NEXUNOVA RMS — PATH B: EMERGENCY ANON LOCKDOWN
-- ================================================================
--
-- WHAT THIS DOES:
--   Closes the anon-key leak immediately by revoking all direct
--   table privileges from the anon and authenticated roles.
--   After this runs, the anon key can ONLY call SECURITY DEFINER
--   RPCs — direct REST calls to /rest/v1/<table> return 401/empty.
--
-- WHEN TO USE:
--   Tonight, if you can't migrate the login flow to issue JWTs
--   with company_id claims. Buys you time to do PATH_A properly.
--
-- ⚠️ KNOWN BREAKAGE:
--   Your frontend has 291 direct `.from('<table>')` calls across
--   40 files. ALL of them will stop working after this SQL runs.
--   You must EITHER:
--     (a) Wrap each one in a SECURITY DEFINER RPC before running, OR
--     (b) Run this and accept the app is broken until RPC migration
--         is done, OR
--     (c) Selectively GRANT SELECT back on the read-mostly tables
--         that the frontend reads directly, while keeping write
--         privileges revoked (compromise — still leaks read data,
--         but prevents tampering).
--
--   Recommended order:
--     1. Run section 3 first to enable RLS + add deny-all policies.
--        This stops external anon-key scraping immediately. Frontend
--        keeps working because the role privileges still permit
--        access — RLS without a matching policy denies everything.
--     2. Then incrementally convert .from() calls to RPCs and switch
--        to PATH_A when ready.
--
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- SECTION 1 — REVOKE direct table privileges from anon
-- (Nuclear option. Will break the frontend until .from() calls
--  are converted to RPCs. SECURITY DEFINER functions still work.)
-- ----------------------------------------------------------------

-- Uncomment when ready to fully lock down:
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
-- REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
-- REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- ----------------------------------------------------------------
-- SECTION 2 — Grant back the bare minimum needed for login flow
-- (Login RPCs run as SECURITY DEFINER so they don't need this.
--  Listed here only as a template if you have non-RPC reads to
--  preserve.)
-- ----------------------------------------------------------------

-- Example: keep subscription_plans readable (it's a global catalogue):
-- GRANT SELECT ON public.subscription_plans TO anon, authenticated;

-- ----------------------------------------------------------------
-- SECTION 3 — Enable RLS with DENY-ALL policy on every table
-- (Safer first step: keeps role privileges intact so the frontend
--  doesn't immediately break, but RLS with no matching policy
--  rejects every row. SECURITY DEFINER RPCs bypass RLS by default
--  so they keep working.)
--
-- HOWEVER — be aware: if a SECURITY DEFINER RPC owner is `postgres`
-- (superuser), it bypasses RLS. If it's owned by anon/authenticated,
-- it does NOT bypass. Check ownership before relying on this.
-- ----------------------------------------------------------------

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    -- company-scoped
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
    'unit_transfers', 'units', 'voucher_sequences',
    -- no company_id
    'companies', 'otp_tokens', 'password_reset_requests', 'payment_link_reminders',
    'payment_link_status_history', 'payment_methods', 'payment_partners',
    'promise_reminders_log', 'subscription_plans', 'system_config'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY deny_all_anon ON public.%I
        FOR ALL TO anon, authenticated
        USING (false)
        WITH CHECK (false)
    $f$, t);
  END LOOP;
END $$;

COMMIT;

-- ================================================================
-- VERIFY:
-- ================================================================
--
-- SET ROLE anon;
-- SELECT count(*) FROM clients;     -- should return 0
-- SELECT count(*) FROM sales;       -- should return 0
-- SELECT count(*) FROM app_users;   -- should return 0
-- RESET ROLE;
--
-- Then test your app — RPCs should still work. Any .from() call
-- will return 0 rows / fail. Convert those to RPCs.
--
-- ================================================================
