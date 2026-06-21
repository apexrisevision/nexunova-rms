-- RLS defense-in-depth floor — BATCH A (Phase 2). 2026-06-21.
-- These GREEN-B sales-module tables already have RLS enabled with ZERO policies,
-- i.e. direct anon/authenticated access is already implicitly denied. This adds the
-- EXPLICIT deny_all_anon floor (matching the existing core-table pattern) so the
-- intent is documented and a future permissive policy can't silently re-open them.
--
-- Functional no-op: every legitimate read/write goes through SECURITY DEFINER RPCs
-- (which bypass RLS). The app passes a session token as an RPC argument — there is
-- NO GoTrue auth.uid()/jwt company claim in a direct PostgREST request — so the ONLY
-- correct policy is USING(false) WITH CHECK(false). No scoped expressions.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leads','lead_activities','lead_assignments','lead_views','reservations','sale_submissions',
    'ad_campaigns','sales_announcements','announcement_receipts','sales_targets','location_history',
    'map_sites','fb_connections','campaign_clients','recovery_campaigns','app_settings',
    'sales_sessions','sales_users'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
    EXECUTE format('CREATE POLICY deny_all_anon ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;
