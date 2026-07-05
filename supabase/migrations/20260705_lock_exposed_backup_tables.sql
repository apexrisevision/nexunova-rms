-- P0 security fix: lock leftover backup/snapshot tables.
--
-- These tables were created as one-off recovery snapshots but shipped with
-- RLS OFF and the Supabase-default anon/authenticated grants (SELECT + full
-- DML incl. TRUNCATE). That exposed real KBH pricing / received-money data and
-- FMH unit status to anyone holding the public anon key — readable AND
-- destroyable. This closes the hole without dropping the data (retained as
-- recovery reference; Rashid decides later whether to drop them).
--
-- Fix = the standard deny-all floor: ENABLE + FORCE RLS with ZERO policies,
-- and REVOKE ALL from anon / authenticated / PUBLIC. Table owner, service_role,
-- and SECURITY DEFINER functions are unaffected.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kbh_pricing_snapshot_20260624',
    'kbh_received_snapshot_20260624',
    'fmh_unit_status_backup_20260628',
    '_sched_backup_20260616'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    END IF;
  END LOOP;
END $$;
