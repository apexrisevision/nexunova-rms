-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance v1 · r · ROLLBACK — a tool, NEVER applied as a migration
--
-- Removes every object 20260916a–d created: the nine nf_ tables (and with
-- them every row, trigger and policy) and every nf_ / _nf_ function.
--
-- ⚠️ DESTRUCTIVE. Once a real day has been recorded, running this deletes the
-- cash book. Export first (docs/PLAN.md §1.3 B shape) and get the owner's OK.
--
-- Touches nothing else: companies, auth.users and every cash_* table of the
-- old build are left exactly as they are. Rehearsed by
-- scripts/nf/verify-nf-schema.js (assertion RB01) on every run.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS
  public.nf_audit, public.nf_pdcs, public.nf_lines, public.nf_days,
  public.nf_report_categories, public.nf_floors, public.nf_accounts,
  public.nf_settings, public.nf_members
  CASCADE;

DO $drop$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.proname LIKE 'nf\_%' OR p.proname LIKE '\_nf\_%') LOOP
    EXECUTE format('DROP FUNCTION %s CASCADE', f);
  END LOOP;
END
$drop$;

COMMIT;
