-- Phase 5 — the outlines follow the WALLS now, not a rectangle drawn round the flat.
--
-- Reported by Rashid off the screenshots: some polygons were fat squares standing on
-- their neighbour's rooms, which reads as one unit when two neighbours share a colour.
-- He was right, and the first check missed it twice over:
--   · it compared bounding BOXES with a 400px² tolerance
--   · and no two outlines ever overlapped each OTHER — both were shrunken rectangles,
--     so the defect was polygon-vs-DRAWING, never polygon-vs-polygon
--
-- Measured properly (share of a polygon covered by a second flat's fill colour), the
-- offenders were the interlocking middle-band clusters, where the flats step around
-- one another and a rectangle cannot be right:
--     17C 13%   10B 11%   12 10%   18 15%
-- UG-24/25, the pair originally suspected, measured clean at 3% — its boundary really
-- is a straight wall, and the bath inside UG-25's box is X-25's own.
--
-- Re-read off the drawing on a 20px grid. 10C, 17C, 17B, 18 and 09 are now L-shaped
-- because the flats are; the rest keep tightened rectangles that stay inside their own
-- walls. Under-covering by a few pixels is deliberate — a polygon that stops short is
-- harmless, one that crosses a wall is not.
--
-- Applied to BOTH artworks that use this drawing. ZZTEST still carried the placeholder
-- grid from scripts/seed-phase5-shapes.js — thirty identical 0.13x0.13 cells, six of
-- them off the building — which is what the confusing screenshot actually showed.

BEGIN;

DO $mig$
DECLARE
  v_art uuid;
  v_co  uuid;
  v_n   int;
BEGIN
  FOR v_art, v_co IN
    SELECT id, company_id FROM public.unit_map_artworks
     WHERE image_path = 'assets/maps/kbh_artwork_A_split_v2.png'
  LOOP
    INSERT INTO public.unit_map_shapes (company_id, artwork_id, slot_code, points, label_x, label_y, zone_group)
    SELECT v_co, v_art, s.slot, s.pts, s.lx, s.ly, s.zone
      FROM (VALUES
  ('11', '[[0.5013,0.3738],[0.5838,0.3738],[0.5838,0.4363],[0.5013,0.4363]]'::jsonb, 0.5425, 0.405, NULL),
  ('12', '[[0.3958,0.3731],[0.4746,0.3731],[0.4746,0.4563],[0.4442,0.4563],[0.4442,0.4938],[0.3958,0.4938]]'::jsonb, 0.4352, 0.4334, NULL),
  ('13', '[[0.3271,0.505],[0.4208,0.505],[0.4208,0.7513],[0.3271,0.7513]]'::jsonb, 0.374, 0.6281, NULL),
  ('14', '[[0.4225,0.505],[0.5092,0.505],[0.5092,0.7481],[0.4225,0.7481]]'::jsonb, 0.4658, 0.6266, NULL),
  ('15', '[[0.5125,0.505],[0.5542,0.505],[0.5542,0.745],[0.5125,0.745]]'::jsonb, 0.5333, 0.625, NULL),
  ('16', '[[0.5563,0.505],[0.6513,0.505],[0.6513,0.7513],[0.5563,0.7513]]'::jsonb, 0.6038, 0.6281, NULL),
  ('18', '[[0.1888,0.5063],[0.2838,0.5063],[0.2838,0.7481],[0.1888,0.7481]]'::jsonb, 0.2363, 0.6272, NULL),
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
  ('10A', '[[0.1896,0.3731],[0.25,0.3731],[0.25,0.4956],[0.1896,0.4956]]'::jsonb, 0.2198, 0.4344, '10'),
  ('10B', '[[0.2529,0.3731],[0.3354,0.3731],[0.3354,0.4375],[0.32,0.4375],[0.32,0.4956],[0.2529,0.4956]]'::jsonb, 0.2942, 0.4344, '10'),
  ('10C', '[[0.3367,0.3731],[0.3921,0.3731],[0.3921,0.4956],[0.3213,0.4956],[0.3213,0.4375],[0.3367,0.4375]]'::jsonb, 0.3567, 0.4344, '10'),
  ('17C', '[[0.5867,0.3731],[0.6438,0.3731],[0.6438,0.4313],[0.665,0.4313],[0.665,0.4956],[0.5846,0.4956],[0.5846,0.4313],[0.5867,0.4313]]'::jsonb, 0.6248, 0.4344, '17'),
  ('17B', '[[0.6458,0.3731],[0.7271,0.3731],[0.7271,0.4956],[0.6671,0.4956],[0.6671,0.4313],[0.6458,0.4313]]'::jsonb, 0.6865, 0.4344, '17'),
  ('17A', '[[0.7292,0.3731],[0.7954,0.3731],[0.7954,0.4956],[0.7292,0.4956]]'::jsonb, 0.7623, 0.4344, '17'),
  ('09', '[[0.6979,0.5063],[0.7929,0.5063],[0.7929,0.7481],[0.6979,0.7481]]'::jsonb, 0.7454, 0.6272, NULL)
      ) AS s(slot, pts, lx, ly, zone)
    ON CONFLICT (artwork_id, slot_code) DO UPDATE
      SET points = EXCLUDED.points, label_x = EXCLUDED.label_x,
          label_y = EXCLUDED.label_y, zone_group = EXCLUDED.zone_group, updated_at = now();

    SELECT count(*) INTO v_n FROM public.unit_map_shapes WHERE artwork_id = v_art;
    IF v_n <> 30 THEN RAISE EXCEPTION 'artwork % ended with % outlines, expected 30', v_art, v_n; END IF;
    RAISE NOTICE 'artwork % : 30 outlines rewritten', v_art;
  END LOOP;
END $mig$;

COMMIT;
