-- =====================================================================
-- 009 — RLS on every new platform_* table
-- =====================================================================
ALTER TABLE public.platform_organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY pom_select_same_org ON public.platform_organization_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pom_insert_admin ON public.platform_organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pom_update_admin ON public.platform_organization_members
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_nexunova_staff())
  WITH CHECK (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pom_delete_admin ON public.platform_organization_members
  FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_nexunova_staff());

ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_select_admin ON public.platform_invitations
  FOR SELECT TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY inv_insert_admin ON public.platform_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY inv_update_admin ON public.platform_invitations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY inv_delete_admin ON public.platform_invitations
  FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));
CREATE POLICY inv_select_by_token_anon ON public.platform_invitations
  FOR SELECT TO anon
  USING (revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now());

ALTER TABLE public.platform_subscription_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY psf_select_all_auth ON public.platform_subscription_features
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY psf_write_staff_only ON public.platform_subscription_features
  FOR ALL TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.platform_subscription_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY psu_select_members ON public.platform_subscription_usage
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_nexunova_staff());
CREATE POLICY psu_write_staff_only ON public.platform_subscription_usage
  FOR INSERT TO authenticated WITH CHECK (public.is_nexunova_staff());
CREATE POLICY psu_update_staff_only ON public.platform_subscription_usage
  FOR UPDATE TO authenticated
  USING (public.is_nexunova_staff()) WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.platform_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY pet_select ON public.platform_email_templates
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.is_org_member(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pet_insert_admin ON public.platform_email_templates
  FOR INSERT TO authenticated
  WITH CHECK ((organization_id IS NULL AND public.is_nexunova_staff()) OR public.is_org_admin(organization_id));
CREATE POLICY pet_update_admin ON public.platform_email_templates
  FOR UPDATE TO authenticated
  USING ((organization_id IS NULL AND public.is_nexunova_staff()) OR public.is_org_admin(organization_id))
  WITH CHECK ((organization_id IS NULL AND public.is_nexunova_staff()) OR public.is_org_admin(organization_id));
CREATE POLICY pet_delete_admin ON public.platform_email_templates
  FOR DELETE TO authenticated
  USING ((organization_id IS NULL AND public.is_nexunova_staff()) OR public.is_org_admin(organization_id));

ALTER TABLE public.platform_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pel_select_admin ON public.platform_email_log
  FOR SELECT TO authenticated
  USING (
    public.is_nexunova_staff()
    OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id))
    OR to_user_id = public.current_app_user_id()
  );
CREATE POLICY pel_write_staff ON public.platform_email_log
  FOR INSERT TO authenticated WITH CHECK (public.is_nexunova_staff());

ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY pn_select_own ON public.platform_notifications
  FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_nexunova_staff());
CREATE POLICY pn_update_own ON public.platform_notifications
  FOR UPDATE TO authenticated
  USING (user_id = public.current_app_user_id())
  WITH CHECK (user_id = public.current_app_user_id());
CREATE POLICY pn_insert_org_admin ON public.platform_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pn_delete_own ON public.platform_notifications
  FOR DELETE TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_nexunova_staff());

ALTER TABLE public.platform_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY pak_select_admin ON public.platform_api_keys
  FOR SELECT TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pak_insert_admin ON public.platform_api_keys
  FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY pak_update_admin ON public.platform_api_keys
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY pak_delete_admin ON public.platform_api_keys
  FOR DELETE TO authenticated USING (public.is_org_admin(organization_id));

ALTER TABLE public.platform_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY pwh_select_admin ON public.platform_webhooks
  FOR SELECT TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_nexunova_staff());
CREATE POLICY pwh_insert_admin ON public.platform_webhooks
  FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY pwh_update_admin ON public.platform_webhooks
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY pwh_delete_admin ON public.platform_webhooks
  FOR DELETE TO authenticated USING (public.is_org_admin(organization_id));

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps_select_members ON public.platform_settings
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_nexunova_staff());
CREATE POLICY ps_insert_admin ON public.platform_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY ps_update_admin ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY ps_delete_admin ON public.platform_settings
  FOR DELETE TO authenticated USING (public.is_org_admin(organization_id));

ALTER TABLE public.platform_user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY pup_self_all ON public.platform_user_preferences
  FOR ALL TO authenticated
  USING (user_id = public.current_app_user_id())
  WITH CHECK (user_id = public.current_app_user_id());
