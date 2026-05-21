-- =====================================================================
-- 014 — Drop pre-existing qual:true policies that leaked cross-org rows
-- =====================================================================
-- Pre-existing policies were OR-combined with my strict policies in 010a,
-- which made them ineffective. Drop the permissive ones.
DROP POLICY IF EXISTS audit_logs_select     ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert     ON public.audit_logs;
DROP POLICY IF EXISTS audit_archive_select  ON public.audit_log_archive;
DROP POLICY IF EXISTS reminders_all_access  ON public.promise_reminders_log;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND qual IN ('true','TRUE')
      AND tablename NOT IN (
        'payment_methods','payment_partners','platform_subscription_features',
        'system_config','subscription_plans'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    RAISE NOTICE 'Dropped permissive policy %.%.%', p.schemaname, p.tablename, p.policyname;
  END LOOP;
END $$;

DROP POLICY IF EXISTS members_all_access ON public.platform_organization_members;
