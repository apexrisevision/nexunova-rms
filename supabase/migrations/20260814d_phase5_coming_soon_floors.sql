-- Phase 5 — a floor whose drawing has not arrived yet is a STATE, not an error.
--
-- Artwork A (split) covers eight floors. Artwork B (unsplit, 3rd + 6th) arrives
-- tomorrow, and Ground has no drawing at all. Those three floors must open and say
-- "coming soon" — not throw, not show an empty canvas, not be missing from the
-- floor list. A missing drawing is a normal state of this feature, so it belongs
-- in the status column rather than in error handling at every call site.
--
-- Consequence: artwork_id becomes nullable, guarded so only a coming_soon plan is
-- allowed to have none.

BEGIN;

ALTER TABLE public.unit_map_plans ALTER COLUMN artwork_id DROP NOT NULL;

ALTER TABLE public.unit_map_plans DROP CONSTRAINT IF EXISTS unit_map_plans_status_chk;
ALTER TABLE public.unit_map_plans ADD CONSTRAINT unit_map_plans_status_chk
  CHECK (status IN ('draft','published','coming_soon'));

ALTER TABLE public.unit_map_plans DROP CONSTRAINT IF EXISTS unit_map_plans_artwork_required_chk;
ALTER TABLE public.unit_map_plans ADD CONSTRAINT unit_map_plans_artwork_required_chk
  CHECK (artwork_id IS NOT NULL OR status = 'coming_soon');

COMMENT ON COLUMN public.unit_map_plans.status IS
  'draft = admin-only, half-drawn. published = sales members see it. '
  'coming_soon = the floor exists and is listed, but its drawing has not arrived; '
  'the viewer shows a waiting state instead of a canvas.';

COMMIT;
