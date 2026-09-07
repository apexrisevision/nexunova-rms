-- ═══════════════════════════════════════════════════════════════════════════
-- THE PUBLIC LINK STOPS CARRYING THE PRICE LIST
--
-- This link is pinned in a WhatsApp group of external dealers and will be
-- forwarded onward. Whoever ends up holding it should learn what is free, not
-- what everything costs. Price is removed from the payload, not from the page:
-- it must not leave the server, so no amount of reading the network tab gets it
-- back. The budget filter, the price bands, "Cheapest" and the PKR/sq ft line
-- all go with it, and that is the intent rather than a side effect.
--
-- Measured on Awami before writing this, through the real function inside a
-- rolled-back transaction — 1,467 units across 7 floors:
--
--     today, with price and unit type       124,622 bytes
--     without them, area_unit per unit       90,903 bytes
--     without them, area_unit hoisted        70,365 bytes   <- this
--
-- FOUR CHANGES.
--
-- 1. `p` (price) and `t` (unit type) leave the wire. Type was never asked for
--    by the page being built and is 17 KB of "Shop" repeated.
--
-- 2. area_unit is returned ONCE for the project instead of on all 1,467 units.
--    Twenty kilobytes to repeat "sqft" is waste. But a page that quietly labels
--    units in the wrong unit is worse than one that fails, so if a project ever
--    holds more than one area_unit this RAISES rather than picking one. There is
--    no silent branch: either every unit is measured the same way, or nobody
--    gets a page.
--
-- 3. 'taken' becomes 'not_available'. "Taken" reads to a dealer as "someone has
--    it, it may come back". Confirmed before renaming that the string is
--    consumed in exactly three places, all of them being rewritten with this:
--    availability.html, scripts/verify-public-availability.js, and an untracked
--    concept file under migration_work/.
--
-- 4. Per-floor `available` and `total` counts, so a browser never tallies 1,467
--    rows to draw a chip that says "167 available".
--
-- What does NOT change: the function still never reads clients, payments or
-- installments; reserved and sold are still indistinguishable; anon still
-- executes this one function and nothing else. No grants are touched.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb; v_floors jsonb;
        v_units text[]; v_unit text;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- missing, revoked and expired answer identically: probing teaches nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  UPDATE public.availability_links
     SET views = views + 1, last_viewed_at = now()
   WHERE id = v_link.id;

  /* ONE UNIT OF MEASURE, OR NONE.
     area_unit is sent once for the whole project rather than on every unit —
     1,467 copies of 'sqft' is 20 KB of nothing. That is only safe while the
     project really does have one. If it ever has two, this raises: a page that
     labels half its units in the wrong unit is worse than a page that does not
     load, and the person who mixed them needs to hear about it. */
  SELECT array_agg(DISTINCT COALESCE(u.area_unit, 'sqft'))
    INTO v_units
    FROM public.units u
   WHERE u.project_id = v_link.project_id
     AND public._map_unit_state(u.id) <> 'retired';

  IF v_units IS NOT NULL AND array_length(v_units, 1) > 1 THEN
    RAISE EXCEPTION
      'project % mixes area units (%) — the public availability page cannot label them',
      v_link.project_id, array_to_string(v_units, ', ')
      USING ERRCODE = 'data_exception';
  END IF;
  v_unit := COALESCE(v_units[1], 'sqft');

  SELECT jsonb_agg(f ORDER BY (f->>'floor_no')::int, f->>'floor_label') INTO v_floors
  FROM (
    SELECT jsonb_build_object(
             'floor_no', u.floor_no,
             'floor_label', COALESCE(u.floor_label, '—'),
             /* Counted here so the browser never walks 1,467 rows to put a
                number on a floor chip. */
             'available', count(*) FILTER (WHERE st.state = 'available'),
             'total',     count(*),
             'units', jsonb_agg(jsonb_build_object(
                        'n', u.unit_no,
                        /* TWO states, and neither of them says who has it.
                           reserved and sold are the same answer to a dealer:
                           you cannot have this one. */
                        's', CASE WHEN st.state = 'available'
                                  THEN 'available' ELSE 'not_available' END,
                        'a', u.area
                      )
                      /* Unit-wise, not alphabetical. A plain ORDER BY unit_no
                         puts SF-100 immediately after SF-10, so a dealer
                         scanning for SF-15 walks through a hundred others to
                         reach it. Read every digit in the code as one number and
                         fall back to the code for ties, which is the same rule
                         the daybook uses — they must not disagree about the
                         order of the same building. */
                      ORDER BY COALESCE(NULLIF(regexp_replace(u.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0),
                               u.unit_no)
           ) AS f
      FROM public.units u
      CROSS JOIN LATERAL (SELECT public._map_unit_state(u.id) AS state) st
     WHERE u.project_id = v_link.project_id
       AND st.state <> 'retired'
     GROUP BY u.floor_no, COALESCE(u.floor_label, '—')
  ) q;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', v_unit,
    'floors',  COALESCE(v_floors, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$;

COMMIT;
