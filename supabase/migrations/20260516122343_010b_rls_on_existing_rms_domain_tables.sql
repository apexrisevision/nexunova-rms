-- =====================================================================
-- 010b — RLS on all existing RMS domain tables (org members get full access)
-- =====================================================================
DO $$
DECLARE
  t text;
  rms_tables text[] := ARRAY[
    'additional_receivables', 'agent_commission_payments', 'agent_transactions',
    'agents', 'banks', 'blacklisted_clients', 'category_payment_types',
    'category_unit_statuses', 'category_unit_types', 'client_health_scores',
    'clients', 'company_payment_methods', 'contact_logs', 'escalations',
    'floors', 'follow_up_reminders', 'installments', 'legal_cases',
    'payables', 'payment_links', 'payment_promises', 'payments',
    'pdc_cheques', 'possessions', 'project_bank_accounts', 'project_expenses',
    'project_milestones', 'project_price_revisions', 'projects',
    'radar_action_logs', 'recovery_agents', 'recovery_radar_logs',
    'reminder_logs', 'sale_amendments', 'sale_documents', 'sale_sequences',
    'sales', 'unit_cancellations', 'unit_transfers', 'units', 'voucher_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY rms_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($q$
      DO $inner$
      DECLARE p text;
      BEGIN
        FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=%L
        LOOP EXECUTE format('DROP POLICY IF EXISTS %%I ON public.%I', p);
        END LOOP;
      END $inner$;
    $q$, t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.is_org_member(company_id) OR public.is_nexunova_staff())
    $q$, t || '_select_members', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.is_org_member(company_id) OR public.is_nexunova_staff())
    $q$, t || '_insert_members', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING      (public.is_org_member(company_id) OR public.is_nexunova_staff())
      WITH CHECK (public.is_org_member(company_id) OR public.is_nexunova_staff())
    $q$, t || '_update_members', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (public.is_org_member(company_id) OR public.is_nexunova_staff())
    $q$, t || '_delete_members', t);
  END LOOP;
END $$;

-- Child-of-child tables inherit via parent
ALTER TABLE public.payment_link_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY plr_all_members ON public.payment_link_reminders
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payment_links pl
    WHERE pl.id = payment_link_reminders.payment_link_id
      AND (public.is_org_member(pl.company_id) OR public.is_nexunova_staff())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payment_links pl
    WHERE pl.id = payment_link_reminders.payment_link_id
      AND (public.is_org_member(pl.company_id) OR public.is_nexunova_staff())));

ALTER TABLE public.payment_link_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY plsh_all_members ON public.payment_link_status_history
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payment_links pl
    WHERE pl.id = payment_link_status_history.payment_link_id
      AND (public.is_org_member(pl.company_id) OR public.is_nexunova_staff())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payment_links pl
    WHERE pl.id = payment_link_status_history.payment_link_id
      AND (public.is_org_member(pl.company_id) OR public.is_nexunova_staff())));

ALTER TABLE public.promise_reminders_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY prl_all_members ON public.promise_reminders_log
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payment_promises pp
    WHERE pp.id = promise_reminders_log.promise_id
      AND (public.is_org_member(pp.company_id) OR public.is_nexunova_staff())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payment_promises pp
    WHERE pp.id = promise_reminders_log.promise_id
      AND (public.is_org_member(pp.company_id) OR public.is_nexunova_staff())));
