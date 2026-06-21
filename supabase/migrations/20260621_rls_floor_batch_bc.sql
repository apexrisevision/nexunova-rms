-- RLS defense-in-depth floor — BATCH B + C (Phase 2). 2026-06-21.
--
-- BATCH B (YELLOW): lead_role_config was the one real gap — RLS was OFF and anon had
-- grants, so it was directly readable via PostgREST. Enable RLS + the deny floor.
-- Its only readers are SECURITY DEFINER (create_lead / get_my_lead_config /
-- import_leads), which bypass RLS — so this closes direct exposure with no app impact.
ALTER TABLE public.lead_role_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon ON public.lead_role_config;
CREATE POLICY deny_all_anon ON public.lead_role_config
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- BATCH C (RED): _sched_backup_20260616 is a 46-row backup of `installments`
-- (sale_id, installment_number, due_date, amount_due, amount_paid, status, ...) taken
-- during the 2026-06-16 schedule roll-over fix. It is RLS-OFF with anon grants =
-- directly exposed. Nothing in the codebase or any DB object references it.
-- LOCK ONLY (do NOT drop — dropping is a separate owner-approved step): enable RLS and
-- revoke the direct grants so it is no longer reachable via PostgREST.
ALTER TABLE public._sched_backup_20260616 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._sched_backup_20260616 FROM anon, authenticated;
