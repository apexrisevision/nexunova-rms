-- Phase 5 — KBH goes live: Artwork A gets its thirty outlines, eight floors open.
--
-- The polygons here were traced off the drawing itself, NOT drawn afresh and NOT
-- carried over from ZZTEST. What sat on ZZTEST's artwork was the placeholder grid
-- from scripts/seed-phase5-shapes.js — thirty identical 0.13x0.13 cells laid out
-- 6x5, which the seed script itself calls "not the final draughting". Six of them
-- landed on the title band, off the building, and cell "01" sat on the flat the
-- architect labelled X 23. Publishing that would have put a wrong map in front of
-- live sales staff, so it was traced properly first.
--
-- Every unit was identified by the X-number PRINTED ON THE DRAWING and then
-- cross-checked against the area this database already holds for that slot. All
-- thirty agree — 909/522/565/965/886 down the left block, 419.19/488.08/441.13 for
-- both split clusters, and so on. That agreement is what rules out a polygon on
-- the wrong flat; the proof render is in migration_work/kbh_live/.
--
-- Geometry hangs off the ARTWORK, so these thirty rows serve every floor that uses
-- Artwork A. Nothing is copied per floor.
--
-- Floors: the eight that were split to match this drawing are published. Ground
-- (8 units, a different layout), 3rd and 6th (X-17 and X-10 were never split,
-- because they had live sales) stay coming_soon until Artwork B arrives. The
-- publish is GUARDED: a floor only opens if its slot join actually resolves to all
-- thirty units, so a floor can never go live half-drawn.
--
-- Reversible: DELETE the shapes for this artwork and set the eight plans back to
-- 'draft'. No unit, sale, reservation or price is touched by any of this.

BEGIN;

DO $mig$
DECLARE
  v_art  uuid := '3dbfd2ba-43a0-4e54-8391-9f9c451b5a67';   -- KBH, Artwork A
  v_co   uuid;
  v_proj uuid;
  v_n    int;
BEGIN
  SELECT company_id, project_id INTO v_co, v_proj
    FROM public.unit_map_artworks WHERE id = v_art;
  IF v_co IS NULL THEN RAISE EXCEPTION 'KBH artwork A not found'; END IF;

  -- ── the thirty outlines, normalised 0..1 against the 2400x1600 drawing ──
  INSERT INTO public.unit_map_shapes (company_id, artwork_id, slot_code, points, label_x, label_y, zone_group)
  SELECT v_co, v_art, s.slot, s.pts, s.lx, s.ly, s.zone
    FROM (VALUES
  ('11', '[[0.5013,0.3694],[0.5829,0.3694],[0.5829,0.4375],[0.5013,0.4375]]'::jsonb, 0.5421, 0.4034, NULL),
  ('12', '[[0.3871,0.3706],[0.4738,0.3706],[0.4738,0.4938],[0.3871,0.4938]]'::jsonb, 0.4304, 0.4322, NULL),
  ('13', '[[0.3271,0.505],[0.4208,0.505],[0.4208,0.7513],[0.3271,0.7513]]'::jsonb, 0.374, 0.6281, NULL),
  ('14', '[[0.4225,0.505],[0.5092,0.505],[0.5092,0.7481],[0.4225,0.7481]]'::jsonb, 0.4658, 0.6266, NULL),
  ('15', '[[0.5125,0.505],[0.5542,0.505],[0.5542,0.745],[0.5125,0.745]]'::jsonb, 0.5333, 0.625, NULL),
  ('16', '[[0.5563,0.505],[0.6513,0.505],[0.6513,0.7513],[0.5563,0.7513]]'::jsonb, 0.6038, 0.6281, NULL),
  ('18', '[[0.1888,0.5006],[0.2838,0.5006],[0.2838,0.7481],[0.1888,0.7481]]'::jsonb, 0.2363, 0.6244, NULL),
  ('19', '[[0.0408,0.6012],[0.1621,0.6012],[0.1621,0.7463],[0.0575,0.7463],[0.0575,0.67],[0.0408,0.67]]'::jsonb, 0.1015, 0.6738, NULL),
  ('20', '[[0.0408,0.4425],[0.1621,0.4425],[0.1621,0.6012],[0.0408,0.6012]]'::jsonb, 0.1015, 0.5219, NULL),
  ('21', '[[0.0408,0.3531],[0.1608,0.3531],[0.1608,0.4425],[0.0408,0.4425]]'::jsonb, 0.1008, 0.3978, NULL),
  ('22', '[[0.0408,0.2675],[0.1608,0.2675],[0.1608,0.3531],[0.0408,0.3531]]'::jsonb, 0.1008, 0.3103, NULL),
  ('23', '[[0.0579,0.1219],[0.1588,0.1219],[0.1588,0.2675],[0.0408,0.2675],[0.0408,0.1581],[0.0579,0.1581]]'::jsonb, 0.0998, 0.1947, NULL),
  ('24', '[[0.1892,0.1219],[0.2788,0.1219],[0.2788,0.3206],[0.1892,0.3206]]'::jsonb, 0.234, 0.2213, NULL),
  ('25', '[[0.2792,0.1219],[0.34,0.1219],[0.34,0.3188],[0.2792,0.3188]]'::jsonb, 0.3096, 0.2203, NULL),
  ('26', '[[0.3421,0.1219],[0.46,0.1219],[0.46,0.1638],[0.4288,0.1638],[0.4288,0.3175],[0.3421,0.3175]]'::jsonb, 0.401, 0.2197, NULL),
  ('01', '[[0.5325,0.1219],[0.6404,0.1219],[0.6404,0.32],[0.5538,0.32],[0.5538,0.2031],[0.5325,0.2031]]'::jsonb, 0.5865, 0.2209, NULL),
  ('02', '[[0.6425,0.1219],[0.7079,0.1219],[0.7079,0.3188],[0.6425,0.3188]]'::jsonb, 0.6752, 0.2203, NULL),
  ('03', '[[0.71,0.1219],[0.7929,0.1219],[0.7929,0.3219],[0.71,0.3219]]'::jsonb, 0.7515, 0.2219, NULL),
  ('04', '[[0.8229,0.1219],[0.9238,0.1219],[0.9238,0.1581],[0.9408,0.1581],[0.9408,0.2675],[0.8229,0.2675]]'::jsonb, 0.8819, 0.1947, NULL),
  ('05', '[[0.8208,0.2675],[0.9408,0.2675],[0.9408,0.3531],[0.8208,0.3531]]'::jsonb, 0.8808, 0.3103, NULL),
  ('06', '[[0.8208,0.3531],[0.9408,0.3531],[0.9408,0.4425],[0.8208,0.4425]]'::jsonb, 0.8808, 0.3978, NULL),
  ('07', '[[0.8196,0.4425],[0.9408,0.4425],[0.9408,0.6012],[0.8196,0.6012]]'::jsonb, 0.8802, 0.5219, NULL),
  ('08', '[[0.8196,0.6012],[0.9408,0.6012],[0.9408,0.67],[0.9242,0.67],[0.9242,0.7463],[0.8196,0.7463]]'::jsonb, 0.8802, 0.6738, NULL),
  ('10A', '[[0.1888,0.3719],[0.2517,0.3719],[0.2517,0.4988],[0.1888,0.4988]]'::jsonb, 0.2202, 0.4353, '10'),
  ('10B', '[[0.2533,0.3706],[0.3346,0.3706],[0.3346,0.5],[0.2533,0.5]]'::jsonb, 0.294, 0.4353, '10'),
  ('10C', '[[0.3375,0.3706],[0.3854,0.3706],[0.3854,0.5],[0.3375,0.5]]'::jsonb, 0.3615, 0.4353, '10'),
  ('17C', '[[0.5846,0.3694],[0.66,0.3694],[0.66,0.4975],[0.5846,0.4975]]'::jsonb, 0.6223, 0.4334, '17'),
  ('17B', '[[0.6654,0.3694],[0.7229,0.3694],[0.7229,0.4975],[0.6654,0.4975]]'::jsonb, 0.6942, 0.4334, '17'),
  ('17A', '[[0.725,0.3694],[0.7867,0.3694],[0.7867,0.4975],[0.725,0.4975]]'::jsonb, 0.7558, 0.4334, '17'),
  ('09', '[[0.6975,0.5006],[0.7933,0.5006],[0.7933,0.7513],[0.6975,0.7513]]'::jsonb, 0.7454, 0.6259, NULL)
    ) AS s(slot, pts, lx, ly, zone)
  ON CONFLICT (artwork_id, slot_code) DO UPDATE
    SET points = EXCLUDED.points, label_x = EXCLUDED.label_x,
        label_y = EXCLUDED.label_y, zone_group = EXCLUDED.zone_group, updated_at = now();

  SELECT count(*) INTO v_n FROM public.unit_map_shapes WHERE artwork_id = v_art;
  IF v_n <> 30 THEN RAISE EXCEPTION 'expected 30 outlines on artwork A, found %', v_n; END IF;

  -- ── open the eight floors this drawing actually describes ───────────────
  -- The guard is the join itself: prefix + slot_code must reach all thirty live
  -- units. 3rd and 6th resolve to only 27 (X-17 and X-10 were never split), so
  -- they cannot pass and stay coming_soon on their own account.
  UPDATE public.unit_map_plans pl
     SET status = 'published', updated_at = now()
   WHERE pl.artwork_id = v_art
     AND pl.status = 'draft'
     AND (SELECT count(*) FROM public.unit_map_shapes s
           JOIN public.units u
             ON u.project_id = pl.project_id
            AND u.unit_no = pl.unit_prefix || '-' || s.slot_code
          WHERE s.artwork_id = v_art
            AND public._map_unit_state(u.id) <> 'retired') = 30;

  SELECT count(*) INTO v_n FROM public.unit_map_plans
   WHERE artwork_id = v_art AND status = 'published';
  IF v_n <> 8 THEN RAISE EXCEPTION 'expected 8 published floors, got %', v_n; END IF;

  RAISE NOTICE 'KBH map live: 30 outlines on artwork A, 8 floors published';
END $mig$;

COMMIT;
