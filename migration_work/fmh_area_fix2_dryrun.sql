-- FMH unit-area correction, batch 2 (2026-07-29)
-- Owner supplied real surveyed areas for 10 units whose inventory area was
-- mis-keyed during the Plot-List PDF transcription.
--
-- RULE: the PRICE is authoritative, the AREA was wrong.
--   units.base_price      -> UNCHANGED
--   units.area            -> actual
--   features.rate_per_sqft-> base_price / actual_area
--   sales.area_sqft       -> actual
--   sales.price_per_sqft  -> base_price / actual_area
--   sales.discount        -> absorbs the remainder so net_amount is BYTE-IDENTICAL
-- Every one of these units is Sold and has money received, so net_amount and
-- remaining_amount must not move by a single paisa. Same technique as the
-- 2026-07-27 area fix.
--
-- 3-04 is EXCLUDED: its area is already 775.90 and its rate already 9,900.
-- '10-03' does not exist; owner confirmed the target is '10-3' -> 826 sqft.

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND company_code='fmh') THEN
    RAISE EXCEPTION 'guard: not the FMH tenant';
  END IF;
END $guard$;

-- ── backups ────────────────────────────────────────────────────────────────
CREATE TABLE fmh_area_fix2_units_backup_20260729 AS
SELECT u.id, u.unit_no, u.area, u.base_price, u.features
FROM units u
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
  AND u.unit_no IN ('10-09','10-12','10-20','10-19','2-01','3-10','4-01','4-03','8-14','10-3');

CREATE TABLE fmh_area_fix2_sales_backup_20260729 AS
SELECT s.id, s.sale_number, u.unit_no, s.area_sqft, s.price_per_sqft,
       s.discount, s.total_amount, s.net_amount, s.remaining_amount, s.down_payment
FROM sales s JOIN units u ON u.id=s.unit_id
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
  AND u.unit_no IN ('10-09','10-12','10-20','10-19','2-01','3-10','4-01','4-03','8-14','10-3')
  AND s.status <> 'cancelled';

DO $pre$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM fmh_area_fix2_units_backup_20260729;
  IF v <> 10 THEN RAISE EXCEPTION 'pre: expected 10 units, found %', v; END IF;
  SELECT count(*) INTO v FROM fmh_area_fix2_sales_backup_20260729;
  IF v <> 10 THEN RAISE EXCEPTION 'pre: expected 10 live sales, found %', v; END IF;
END $pre$;

-- ── 1. sales: area + rate move, discount absorbs, net_amount frozen ────────
UPDATE sales s
SET area_sqft      = t.actual_area,
    price_per_sqft = round(u.base_price / t.actual_area, 2),
    discount       = round(round(u.base_price / t.actual_area, 2) * t.actual_area, 2) - b.net_amount
FROM units u,
     fmh_area_fix2_sales_backup_20260729 b,
     (VALUES ('10-09',559.00::numeric),('10-12',526.00),('10-20',880.00),('10-19',511.00),
             ('2-01',1636.30),('3-10',1142.82),('4-01',1636.60),('4-03',1652.57),
             ('8-14',485.70),('10-3',826.00)) AS t(unit_no, actual_area)
WHERE s.unit_id = u.id
  AND u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
  AND u.unit_no = t.unit_no
  AND b.id = s.id
  AND s.status <> 'cancelled';

-- ── 2. units: area + displayed rate (base_price deliberately untouched) ────
UPDATE units u
SET area     = t.actual_area,
    features = jsonb_set(u.features, '{rate_per_sqft}',
                         to_jsonb(round(u.base_price / t.actual_area, 2)))
FROM (VALUES ('10-09',559.00::numeric),('10-12',526.00),('10-20',880.00),('10-19',511.00),
             ('2-01',1636.30),('3-10',1142.82),('4-01',1636.60),('4-03',1652.57),
             ('8-14',485.70),('10-3',826.00)) AS t(unit_no, actual_area)
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
  AND u.unit_no = t.unit_no;

-- ── 3. verify — any failure aborts everything ──────────────────────────────
DO $ver$
DECLARE v int;
BEGIN
  -- THE money invariant: net + remaining must be byte-identical to the backup
  SELECT count(*) INTO v FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id
   WHERE s.net_amount <> b.net_amount;
  IF v <> 0 THEN RAISE EXCEPTION 'a) % sale(s) had net_amount change', v; END IF;

  SELECT count(*) INTO v FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id
   WHERE s.remaining_amount <> b.remaining_amount;
  IF v <> 0 THEN RAISE EXCEPTION 'b) % sale(s) had remaining_amount change', v; END IF;

  SELECT count(*) INTO v FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id
   WHERE s.down_payment <> b.down_payment;
  IF v <> 0 THEN RAISE EXCEPTION 'c) % sale(s) had down_payment change', v; END IF;

  -- no negative discounts anywhere in FMH
  SELECT count(*) INTO v FROM sales
   WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND discount < 0;
  IF v <> 0 THEN RAISE EXCEPTION 'd) % sale(s) with negative discount', v; END IF;

  -- sale area must equal the unit area for all 10
  SELECT count(*) INTO v FROM sales s JOIN units u ON u.id=s.unit_id
   JOIN fmh_area_fix2_units_backup_20260729 ub ON ub.id=u.id
   WHERE s.status<>'cancelled' AND s.area_sqft <> u.area;
  IF v <> 0 THEN RAISE EXCEPTION 'e) % sale(s) whose area_sqft != units.area', v; END IF;

  -- base_price must NOT have moved
  SELECT count(*) INTO v FROM fmh_area_fix2_units_backup_20260729 ub JOIN units u ON u.id=ub.id
   WHERE u.base_price <> ub.base_price;
  IF v <> 0 THEN RAISE EXCEPTION 'f) % unit(s) had base_price change', v; END IF;

  -- areas must match exactly what the owner supplied
  SELECT count(*) INTO v FROM units u,
    (VALUES ('10-09',559.00::numeric),('10-12',526.00),('10-20',880.00),('10-19',511.00),
            ('2-01',1636.30),('3-10',1142.82),('4-01',1636.60),('4-03',1652.57),
            ('8-14',485.70),('10-3',826.00)) AS t(unit_no, actual_area)
   WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
     AND u.unit_no=t.unit_no AND u.area <> t.actual_area;
  IF v <> 0 THEN RAISE EXCEPTION 'g) % unit(s) whose area != supplied value', v; END IF;

  -- schedules must still reconcile to net across the whole tenant
  SELECT count(*) INTO v FROM (
    SELECT s.id FROM sales s JOIN installments i ON i.sale_id=s.id
     WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.status<>'cancelled'
     GROUP BY s.id, s.net_amount HAVING sum(i.amount_due) <> s.net_amount) x;
  IF v <> 0 THEN RAISE EXCEPTION 'h) % sale(s) whose schedule != net_amount', v; END IF;

  -- no sale left with the old area=1 sentinel
  SELECT count(*) INTO v FROM sales
   WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND area_sqft=1;
  IF v <> 0 THEN RAISE EXCEPTION 'i) % sale(s) still area_sqft=1', v; END IF;

  RAISE NOTICE 'area fix batch 2: all checks passed';
END $ver$;

DO $rep$
DECLARE t text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO t FROM (
    SELECT rpad(b.unit_no,7)||' '||rpad(b.sale_number,8)
        || ' area '||lpad(to_char(b.area_sqft,'FM99,999.99'),9)||' -> '||lpad(to_char(s.area_sqft,'FM99,999.99'),9)
        || '   rate '||lpad(to_char(b.price_per_sqft,'FM99,999.99'),10)||' -> '||lpad(to_char(s.price_per_sqft,'FM99,999.99'),10)
        || '   disc '||lpad(to_char(s.discount,'FM9,999,999.99'),13)
        || '   net '||lpad(to_char(s.net_amount,'FM99,999,999'),11)
        || CASE WHEN s.net_amount=b.net_amount AND s.remaining_amount=b.remaining_amount
                THEN '  NET UNCHANGED' ELSE '  ***MONEY MOVED***' END AS line
    FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id
  ) x;
  RAISE EXCEPTION E'\n%\n\nnet changed=%  remaining changed=%  base_price changed=%  neg_disc(FMH)=%  area1(FMH)=%',
    t,
    (SELECT count(*) FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id WHERE s.net_amount<>b.net_amount),
    (SELECT count(*) FROM fmh_area_fix2_sales_backup_20260729 b JOIN sales s ON s.id=b.id WHERE s.remaining_amount<>b.remaining_amount),
    (SELECT count(*) FROM fmh_area_fix2_units_backup_20260729 ub JOIN units u ON u.id=ub.id WHERE u.base_price<>ub.base_price),
    (SELECT count(*) FROM sales WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND discount<0),
    (SELECT count(*) FROM sales WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND area_sqft=1);
END $rep$;
