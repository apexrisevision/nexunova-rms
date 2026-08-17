-- Phase 5 — the outlines are SNAPPED TO THE WALLS, measured not eyeballed.
--
-- Rashid checked the live portal himself and the borders were still wrong. He was
-- right twice over, because both checks I had written measured the wrong thing:
-- bounding-box overlap, and then how pure the colour was INSIDE an outline. A
-- rectangle drawn wholly within an L-shaped flat passes the colour test perfectly
-- and still runs its border through the middle of a bedroom.
--
-- The only question that matters is whether there is a WALL under the border. Asked
-- properly — walk every edge, look for the drawing's own ink within a few pixels —
-- 13 of 30 outlines were under 90%, the worst at 61%.
--
-- scripts/snap-map-shapes-to-walls.js now optimises exactly that: each outline is
-- rectilinear, so every distinct x and y is moved within ±40px to wherever the ink
-- actually runs, weighted by how much edge sits on it; edges still floating free are
-- split so the stepped boundaries gain their real corners (unit 11 went from 4 to 10).
-- Then every outline is inset 1.5px, so two neighbours can never touch — with
-- translucent fills two adjacent units of the same state read as one flat.
--
-- Result: every outline 95-100% on-wall, worst 95% (16, 09), against 61-100% before.
--
-- Applied to BOTH artworks that use this drawing.

BEGIN;

DO $mig$
DECLARE v_art uuid; v_co uuid; v_n int;
BEGIN
  FOR v_art, v_co IN
    SELECT id, company_id FROM public.unit_map_artworks
     WHERE image_path = 'assets/maps/kbh_artwork_A_split_v2.png'
  LOOP
    INSERT INTO public.unit_map_shapes (company_id, artwork_id, slot_code, points, label_x, label_y, zone_group)
    SELECT v_co, v_art, s.slot, s.pts, s.lx, s.ly, s.zone
      FROM (VALUES
  ('11', '[[0.5031,0.3716],[0.5829,0.3716],[0.5829,0.4547],[0.5031,0.4547]]'::jsonb, 0.543, 0.4131, NULL),
  ('12', '[[0.399,0.3722],[0.4773,0.3722],[0.4773,0.4553],[0.4302,0.4553],[0.4302,0.4934],[0.399,0.4934]]'::jsonb, 0.4381, 0.4328, NULL),
  ('13', '[[0.3369,0.5022],[0.424,0.5022],[0.424,0.7509],[0.3369,0.7509]]'::jsonb, 0.3804, 0.6266, NULL),
  ('14', '[[0.4252,0.5259],[0.5085,0.5259],[0.5085,0.7516],[0.4252,0.7516]]'::jsonb, 0.4669, 0.6388, NULL),
  ('15', '[[0.5131,0.5259],[0.5548,0.5259],[0.5548,0.7441],[0.5335,0.7441],[0.5335,0.7522],[0.5131,0.7522]]'::jsonb, 0.534, 0.6391, NULL),
  ('16', '[[0.5569,0.5003],[0.6435,0.5003],[0.6435,0.7509],[0.5569,0.7509]]'::jsonb, 0.6002, 0.6256, NULL),
  ('18', '[[0.1894,0.5059],[0.2773,0.5059],[0.2773,0.7509],[0.1894,0.7509]]'::jsonb, 0.2333, 0.6284, NULL),
  ('19', '[[0.0415,0.6022],[0.1615,0.6022],[0.1615,0.7434],[0.0581,0.7434],[0.0581,0.6722],[0.0415,0.6722]]'::jsonb, 0.1015, 0.6728, NULL),
  ('20', '[[0.0415,0.4434],[0.1615,0.4434],[0.1615,0.6003],[0.0415,0.6003]]'::jsonb, 0.1015, 0.5219, NULL),
  ('21', '[[0.0415,0.3541],[0.1606,0.3541],[0.1606,0.4416],[0.0415,0.4416]]'::jsonb, 0.101, 0.3978, NULL),
  ('22', '[[0.0415,0.2684],[0.1606,0.2684],[0.1606,0.3522],[0.0415,0.3522]]'::jsonb, 0.101, 0.3103, NULL),
  ('23', '[[0.0585,0.1228],[0.1606,0.1228],[0.1606,0.2666],[0.0415,0.2666],[0.0415,0.1591],[0.0585,0.1591]]'::jsonb, 0.101, 0.1947, NULL),
  ('24', '[[0.1898,0.1228],[0.2765,0.1228],[0.2765,0.3209],[0.1898,0.3209]]'::jsonb, 0.2331, 0.2219, NULL),
  ('25', '[[0.2777,0.1228],[0.3394,0.1228],[0.3394,0.3209],[0.2777,0.3209]]'::jsonb, 0.3085, 0.2219, NULL),
  ('26', '[[0.3427,0.1228],[0.4602,0.1228],[0.4602,0.1628],[0.429,0.1628],[0.429,0.3209],[0.3427,0.3209]]'::jsonb, 0.4015, 0.2219, NULL),
  ('09', '[[0.7044,0.5059],[0.7923,0.5059],[0.7923,0.7509],[0.7044,0.7509]]'::jsonb, 0.7483, 0.6284, NULL),
  ('10C', '[[0.3373,0.3722],[0.3977,0.3722],[0.3977,0.4984],[0.319,0.4984],[0.319,0.4384],[0.3373,0.4384]]'::jsonb, 0.3583, 0.4353, '10'),
  ('17B', '[[0.6465,0.3747],[0.7265,0.3747],[0.7265,0.4984],[0.6673,0.4984],[0.6673,0.4309],[0.6465,0.4309]]'::jsonb, 0.6865, 0.4366, '17'),
  ('17C', '[[0.5998,0.3716],[0.6431,0.3716],[0.6431,0.4384],[0.6644,0.4384],[0.6644,0.4984],[0.5848,0.4984],[0.5848,0.4384],[0.5998,0.4384]]'::jsonb, 0.6246, 0.435, '17'),
  ('10B', '[[0.2535,0.3747],[0.3348,0.3747],[0.3348,0.4366],[0.3177,0.4366],[0.3177,0.5034],[0.2535,0.5034]]'::jsonb, 0.2942, 0.4391, '10'),
  ('10A', '[[0.1902,0.3747],[0.2515,0.3747],[0.2515,0.4984],[0.1902,0.4984]]'::jsonb, 0.2208, 0.4366, '10'),
  ('17A', '[[0.7298,0.3716],[0.7935,0.3716],[0.7935,0.5009],[0.7298,0.5009]]'::jsonb, 0.7617, 0.4363, '17'),
  ('08', '[[0.8202,0.6022],[0.9402,0.6022],[0.9402,0.6716],[0.9235,0.6716],[0.9235,0.7422],[0.8202,0.7422]]'::jsonb, 0.8802, 0.6722, NULL),
  ('02', '[[0.6431,0.1228],[0.7052,0.1228],[0.7052,0.3216],[0.6431,0.3216]]'::jsonb, 0.6742, 0.2222, NULL),
  ('06', '[[0.821,0.3541],[0.9402,0.3541],[0.9402,0.4416],[0.821,0.4416]]'::jsonb, 0.8806, 0.3978, NULL),
  ('03', '[[0.7065,0.1228],[0.7923,0.1228],[0.7923,0.3209],[0.7065,0.3209]]'::jsonb, 0.7494, 0.2219, NULL),
  ('01', '[[0.5331,0.1228],[0.6398,0.1228],[0.6398,0.3209],[0.5544,0.3209],[0.5544,0.2022],[0.5331,0.2022]]'::jsonb, 0.5865, 0.2219, NULL),
  ('04', '[[0.821,0.1228],[0.9231,0.1228],[0.9231,0.1591],[0.9402,0.1591],[0.9402,0.2666],[0.821,0.2666]]'::jsonb, 0.8806, 0.1947, NULL),
  ('05', '[[0.821,0.2684],[0.9402,0.2684],[0.9402,0.3522],[0.821,0.3522]]'::jsonb, 0.8806, 0.3103, NULL),
  ('07', '[[0.8202,0.4434],[0.9402,0.4434],[0.9402,0.6003],[0.8202,0.6003]]'::jsonb, 0.8802, 0.5219, NULL)
      ) AS s(slot, pts, lx, ly, zone)
    ON CONFLICT (artwork_id, slot_code) DO UPDATE
      SET points = EXCLUDED.points, label_x = EXCLUDED.label_x,
          label_y = EXCLUDED.label_y, zone_group = EXCLUDED.zone_group, updated_at = now();

    SELECT count(*) INTO v_n FROM public.unit_map_shapes WHERE artwork_id = v_art;
    IF v_n <> 30 THEN RAISE EXCEPTION 'artwork % ended with % outlines', v_art, v_n; END IF;
  END LOOP;
END $mig$;

COMMIT;
