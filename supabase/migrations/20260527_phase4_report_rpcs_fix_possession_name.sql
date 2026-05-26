-- =====================================================================
-- Phase 4 / Component 4 — follow-up: disambiguate post-possession-dues RPC.
-- Applied to itqxljtfbrppntgyfush on 2026-05-27.
--
-- phase4_report_rpcs created get_post_possession_dues(uuid, uuid), which
-- collided with a pre-existing get_post_possession_dues(uuid) that powers
-- js/pages/possession.js (sources the `possessions` table, returns a
-- {success, rows} envelope — a different report for a different page).
-- A 1-arg call became ambiguous between the two. Rename the new 2-arg
-- report RPC so both coexist; the report viewer/hub use the *_report name.
-- =====================================================================

ALTER FUNCTION public.get_post_possession_dues(uuid, uuid)
  RENAME TO get_post_possession_dues_report;
