-- =====================================================================
-- 010a — RLS on companies + app_users + subscriptions + invoices +
--        subscription_plans + system_config + audit_logs + assorted globals
-- =====================================================================
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY co_select_members ON public.companies
  FOR SELECT TO authenticated
  USING (public.is_org_member(id) OR public.is_nexunova_staff());
CREATE POLICY co_update_admin ON public.companies
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(id) OR public.is_nexunova_staff())
  WITH CHECK (public.is_org_admin(id) OR public.is_nexunova_staff());
CREATE POLICY co_delete_staff ON public.companies
  FOR DELETE TO authenticated USING (public.is_nexunova_staff());
CREATE POLICY co_slug_lookup_anon ON public.companies FOR SELECT TO anon USING (false);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY au_select_self_or_shared_org ON public.app_users
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.is_nexunova_staff()
    OR EXISTS (
      SELECT 1 FROM public.platform_organization_members pom
      WHERE pom.user_id = app_users.id
        AND pom.organization_id IN (SELECT public.current_user_org_ids())
        AND pom.status = 'active'
    )
  );
CREATE POLICY au_update_self ON public.app_users
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_org_admin(company_id) OR public.is_nexunova_staff())
  WITH CHECK (auth_user_id = auth.uid() OR public.is_org_admin(company_id) OR public.is_nexunova_staff());
CREATE POLICY au_insert_admin ON public.app_users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(company_id) OR public.is_nexunova_staff());
CREATE POLICY au_delete_admin ON public.app_users
  FOR DELETE TO authenticated
  USING (public.is_org_admin(company_id) OR public.is_nexunova_staff());

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sub_select_members ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.is_org_member(company_id) OR public.is_nexunova_staff());
CREATE POLICY sub_write_admin ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(company_id) OR public.is_nexunova_staff())
  WITH CHECK (public.is_org_admin(company_id) OR public.is_nexunova_staff());

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY sp_select_all ON public.subscription_plans
  FOR SELECT TO authenticated, anon
  USING (is_active = true OR public.is_nexunova_staff());
CREATE POLICY sp_write_staff ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_select_admin ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_org_admin(company_id) OR public.is_nexunova_staff());
CREATE POLICY inv_write_staff ON public.invoices
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY sysc_select_all ON public.system_config
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY sysc_write_staff ON public.system_config
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY al_select_admin ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_org_member(company_id) OR public.is_nexunova_staff());

ALTER TABLE public.audit_log_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY ala_select_admin ON public.audit_log_archive
  FOR SELECT TO authenticated
  USING (public.is_org_admin(company_id) OR public.is_nexunova_staff());

ALTER TABLE public.otp_tokens ENABLE ROW LEVEL SECURITY;
-- No SELECT policy → service-role only via edge functions.

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY pm_select_all ON public.payment_methods
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY pm_write_staff ON public.payment_methods
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.payment_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_select_all ON public.payment_partners
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY pp_write_staff ON public.payment_partners
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_proof_select_admin ON public.payment_proofs
  FOR SELECT TO authenticated
  USING (public.is_org_admin(company_id) OR public.is_nexunova_staff());
CREATE POLICY pp_proof_insert_admin ON public.payment_proofs
  FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(company_id));
CREATE POLICY pp_proof_update_staff ON public.payment_proofs
  FOR UPDATE TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());
