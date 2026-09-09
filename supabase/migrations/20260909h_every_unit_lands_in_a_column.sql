-- ═══════════════════════════════════════════════════════════════════════════
-- EVERY UNIT LANDS IN A COLUMN.
--
-- The daybook's floor table sorts each unit into one of six buckets — reserved,
-- on hold, booked, sold, other, available — and prints a footed Total beside
-- them. On Awami it printed:
--
--     on hold 110 · reserved 0 · booked 0 · sold 0 · available 1,326 · TOTAL 1,467
--
-- which is 1,436 against 1,467. Thirty-one units were counted in the total and
-- in nothing else, and the same array feeds the PROJECT POSITION line at the
-- top of the board report, so the headline figures did not add up either.
--
-- WHY. Five buckets are exhaustive between them and the sixth, `other`, was
-- written as "no reservation, and the unit's status is not an available one".
-- That catches a Dead or Mortgaged unit nobody has booked. It does not catch a
-- unit that IS held under a tag this project invented: Awami's Sold - Entry
-- Pending, Pagri and Landowner match none of RESERVED, HOLD or BOOKED, so the
-- three named buckets refused them — and `other` refused them too, for the
-- crime of having a reservation at all.
--
-- Twelve of the thirty-one are units Rashid has marked Sold - Entry Pending.
-- The report he prints for the board said SOLD 0.
--
-- THE FIX makes `other` mean what its name says: off the market, not one of
-- the three named holds, not a recorded sale. The six buckets are then
-- exhaustive AND disjoint by construction:
--
--     sold                    a sale exists as at the period end
--     reserved / hold / booked  held, under one of those three tags
--     other                   held under any other tag, OR not held and not available
--     available               not held, not sold, and the status says available
--
-- NOT CHANGED: `sold` still means a row in `sales`. Sold - Entry Pending is a
-- unit somebody has agreed to buy with no sale recorded against it; counting it
-- as sold would put revenue on a board report that exists nowhere in the books
-- and would disagree with every financial report in the system. It is off the
-- market, and the page says so under "of which".
--
-- HOW. get_reservation_daybook is 250 lines and this changes two of them, so
-- the patch is applied to the function's own source rather than by retyping it:
-- the old text must be found exactly or the migration raises and changes
-- nothing. There is no second copy of the function in this file to drift.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_reservation_daybook';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_reservation_daybook is not there to patch';
  END IF;

  v_old :=
    '             count(*) FILTER (WHERE h.unit_id IS NULL AND sl.id IS NULL' || E'\n' ||
    '                                AND NOT COALESCE(st.is_available,false))        AS other,';

  v_new :=
    '             /* OFF THE MARKET FOR ANY OTHER REASON, and there are two shapes' || E'\n' ||
    '                of it. The second was the bug: a unit HELD under a tag this' || E'\n' ||
    '                project invented - Pagri, Landowner, Sold - Entry Pending -' || E'\n' ||
    '                matched none of the three named holds and was refused here for' || E'\n' ||
    '                having a reservation, so it landed in no column at all and the' || E'\n' ||
    '                floor table stopped adding up to its own total. */' || E'\n' ||
    '             count(*) FILTER (WHERE sl.id IS NULL' || E'\n' ||
    '                                AND ( (h.unit_id IS NOT NULL' || E'\n' ||
    '                                       AND h.tag_code NOT IN (''RESERVED'',''HOLD'',''BOOKED''))' || E'\n' ||
    '                                   OR (h.unit_id IS NULL' || E'\n' ||
    '                                       AND NOT COALESCE(st.is_available,false)) )) AS other,';

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'the other-bucket expression is not the one this migration was written against';
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
END $mig$;

COMMIT;
