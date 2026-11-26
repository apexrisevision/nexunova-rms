-- ══ Awami Market: holds tidied before the expo (20261126a) ══
-- APPLIED 26-Nov-2026 as 20261126084838, on the owner's yes. Owner, 26-Nov-2026: "reservation link pe jis jis unit mai token aaya hai osay sold kar do ... jin units pe
-- token nahi aaya unhe open kar do magar record rakhna un ka ... waqar k unit hold ya reserve units pe token nahi aaya
-- unhe open nahi karna hai unhe rhne do". The expo is on 27-Nov and the link must show these units as sold.
--
-- Only units on Hold or Reserved are touched. Real sales, Sold - Entry Pending, Pagri and Landowner are left as they are.
--   1. SOLD (17): a hold with a token on it moves to "Sold - Entry Pending" (public label "Sold", permanent). The hold
--      stays ACTIVE with its token, buyer and requester (the unit trigger moves its tag and drops the expiry), so the
--      tokens on holds and the later convert-to-sale both keep working. No sale is made; SOLD itself comes only from a sale.
--   2. OPEN (35): a hold with no token, not Waqar Landlord's, is released the way the desk releases it: the hold is
--      cancelled (cancelled_by = Rashid) and the unit goes back to Available. The record is the cancelled hold row
--      itself — requester, dates and tag stay on it — and its note gets "[Opened 26-Nov-2026 before the expo, no token]".
--   3. KEEP (30): Waqar Landlord's holds with no token are not touched.
-- Each list below is asserted against the live rule before anything changes; any difference stops the whole migration.

DO $m$
DECLARE
  v_co   uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  v_waq  uuid := (SELECT id FROM public.agents WHERE agent_code = 'AGT-2026-0019' AND company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce');
  v_me   uuid := '015effd0-7ac7-4939-a1b3-dd2826ab8fba';   -- Rashid's sales_user
  c_sold text[] := ARRAY['5F-501','FF-120','FF-121','FF-196','GF-127','GF-185','GF-187','GF-191','GF-257','LG-119',
                         'LG-125','LG-77','SF-131','SF-166','SF-167','SF-168','SF-208'];
  c_open text[] := ARRAY['FF-279','GF-113','GF-114','GF-115','GF-116','GF-122','GF-125','GF-178','GF-179','GF-180',
                         'GF-181','GF-186','GF-188','GF-189','GF-249','GF-261','LG-107','LG-108','LG-11','LG-112',
                         'LG-113','LG-115','LG-116','LG-12','LG-145','LG-146','LG-147','LG-18','LG-24','LG-25',
                         'LG-26','LG-63','LG-64','LG-65','LG-66'];
  v_sold text[]; v_open text[]; v_keep int; x record; v_st uuid; v_av uuid; n int := 0; m int := 0;
BEGIN
  IF v_waq IS NULL THEN RAISE EXCEPTION 'Waqar Landlord (AGT-2026-0019) not found'; END IF;
  PERFORM public._rms_actor('Rashid Manzoor', 'desk');

  CREATE TEMP TABLE _h ON COMMIT DROP AS
  SELECT u.id unit_id, u.unit_no, u.project_id, r.id res_id,
         CASE WHEN COALESCE(r.token_amount,0) > 0 OR r.token_received THEN 'SOLD'
              WHEN r.requested_by_agent_id = v_waq OR r.requested_by_name ILIKE '%waqar%' THEN 'KEEP'
              ELSE 'OPEN' END act
    FROM public.units u
    JOIN public.projects p ON p.id = u.project_id
    JOIN public.category_unit_statuses cus ON cus.id = u.status_id
    JOIN public.reservations r ON r.unit_id = u.id AND r.status = 'active'
   WHERE p.company_id = v_co AND cus.status_code IN ('HOLD','RESERVED');

  SELECT array_agg(unit_no ORDER BY unit_no) INTO v_sold FROM _h WHERE act = 'SOLD';
  SELECT array_agg(unit_no ORDER BY unit_no) INTO v_open FROM _h WHERE act = 'OPEN';
  SELECT count(*) INTO v_keep FROM _h WHERE act = 'KEEP';
  IF v_sold IS DISTINCT FROM (SELECT array_agg(e ORDER BY e) FROM unnest(c_sold) e) THEN
    RAISE EXCEPTION 'SOLD list changed since it was shown: %', v_sold; END IF;
  IF v_open IS DISTINCT FROM (SELECT array_agg(e ORDER BY e) FROM unnest(c_open) e) THEN
    RAISE EXCEPTION 'OPEN list changed since it was shown: %', v_open; END IF;
  IF v_keep <> 30 THEN RAISE EXCEPTION 'Waqar keep count is %, expected 30', v_keep; END IF;
  IF EXISTS (SELECT 1 FROM _h h JOIN public.sales s ON s.unit_id = h.unit_id AND s.status <> 'cancelled') THEN
    RAISE EXCEPTION 'a held unit already has a sale'; END IF;

  -- 1. token holds -> Sold - Entry Pending; the hold stays active with its token.
  --    _saf_sold_guard wants a buyer AND a linked agent on the hold; 7 of these have a buyer but only a typed requester
  --    (Fawad khanz, Naeem Hussain, Shah Fahad, shahid iqbal, Sultan Zeb). The owner: mark them sold for now even when
  --    details are missing, so the guard is off for these 17 updates only and back on before this block ends.
  ALTER TABLE public.units DISABLE TRIGGER trg_saf_sold_guard;
  FOR x IN SELECT * FROM _h WHERE act = 'SOLD' LOOP
    SELECT id INTO v_st FROM public.category_unit_statuses
     WHERE company_id = v_co AND project_id = x.project_id AND status_code = 'SOLD_ENTRY_PENDING' AND is_active;
    IF v_st IS NULL THEN RAISE EXCEPTION 'no Sold - Entry Pending status for %', x.unit_no; END IF;
    UPDATE public.units SET status_id = v_st, updated_at = now() WHERE id = x.unit_id;
    IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE id = x.res_id AND status = 'active' AND unit_status_id = v_st) THEN
      RAISE EXCEPTION 'hold on % did not follow the unit to Sold - Entry Pending', x.unit_no; END IF;
    n := n + 1;
  END LOOP;
  ALTER TABLE public.units ENABLE TRIGGER trg_saf_sold_guard;

  -- 2. no token, not Waqar -> released; the cancelled hold row is the record
  FOR x IN SELECT * FROM _h WHERE act = 'OPEN' LOOP
    UPDATE public.reservations
       SET status = 'cancelled', cancelled_by = v_me, cancelled_at = now(), updated_at = now(),
           note = concat_ws(' ', NULLIF(btrim(note), ''), '[Opened 26-Nov-2026 before the expo, no token]')
     WHERE id = x.res_id AND status = 'active';
    SELECT id INTO v_av FROM public.category_unit_statuses
     WHERE company_id = v_co AND project_id = x.project_id AND is_available AND is_active ORDER BY sort_order LIMIT 1;
    IF v_av IS NULL THEN RAISE EXCEPTION 'no Available status for %', x.unit_no; END IF;
    UPDATE public.units SET status_id = v_av, updated_at = now() WHERE id = x.unit_id;
    m := m + 1;
  END LOOP;

  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_saf_sold_guard' AND tgrelid = 'public.units'::regclass) <> 'O' THEN
    RAISE EXCEPTION 'trg_saf_sold_guard is not back on'; END IF;
  IF n <> 17 OR m <> 35 THEN RAISE EXCEPTION 'sold % / opened %', n, m; END IF;
  RAISE NOTICE 'sold-entry-pending %, opened %, Waqar kept %', n, m, v_keep;
END $m$;
