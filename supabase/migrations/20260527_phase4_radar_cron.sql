-- =====================================================================
-- Phase 4 / Component 2 follow-up — pg_cron nightly refresh.
-- Applied to itqxljtfbrppntgyfush on 2026-05-27.
--
-- Schedules two unattended nightly jobs (cron times are UTC; the DB runs UTC):
--   20:30 UTC = 01:30 AM PKT  ->  recalculate_all_health_scores  (per active company)
--   21:00 UTC = 02:00 AM PKT  ->  generate_recovery_radar (top 50, per active company)
-- Health scores run 30 min BEFORE the radar by design: the radar's Default Risk
-- board + the score factors read client_health_scores, so scores must be fresh first.
--
-- SCHEMA ADAPTATION: the dictated `WHERE is_active = true` was changed to
-- `WHERE status = 'active'`. companies has NO is_active column; the active flag
-- is companies.status (text DEFAULT 'active', paired with suspended_at).
--
-- SAFETY: both target RPCs are SECURITY DEFINER but do NOT pin search_path, so
-- each cron command prepends `SET search_path = public` so the functions'
-- unqualified table references resolve under the pg_cron background worker.
--
-- IDEMPOTENT: cron.schedule(jobname, ...) upserts by name (pg_cron 1.4+), so
-- re-running this migration updates the two jobs rather than duplicating them.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 01:30 AM PKT — recalculate health scores for every active company (runs FIRST)
SELECT cron.schedule(
  'nightly-health-scores',
  '30 20 * * *',
  $job$ SET search_path = public; SELECT public.recalculate_all_health_scores(id) FROM public.companies WHERE status = 'active'; $job$
);

-- 02:00 AM PKT — regenerate the recovery radar (top 50) for every active company
SELECT cron.schedule(
  'nightly-radar-refresh',
  '0 21 * * *',
  $job$ SET search_path = public; SELECT public.generate_recovery_radar(id, CURRENT_DATE, 50, NULL::text) FROM public.companies WHERE status = 'active'; $job$
);
