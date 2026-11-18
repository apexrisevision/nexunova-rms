-- ══ NexuFinance Awami: the site accountant's entries 05-18 Nov, site cash box (20261118h) ══
-- APPLIED 18-Nov-2026 as 20261118113819, on the owner's yes.
--
-- Owner's option A (18-Nov). Source: "Awami Daily Entry - Accountant (4).xlsx" (Sharose), matched against head
-- office's books (scripts/nf/plan-site-nov-posting.js; list D:\Claude Cowork\Site entries plan 05-18 Nov.csv):
-- 62 lines posted, 12 skipped (already in head office's books), 2 held (Sakhi Jan 30,011 by JazzCash and
-- chq 6292 5,00,000 to Osama bin Yousaf — not in head office's books, owner to confirm on the BOP statement).
--
-- Site cash box = 10200 (via Petty), starting at 0. It received:
--   * 05-Nov 1,50,000 — BOP chq 1313825996 (BPV-0026), booked as "office supplies" expense: now into the site box;
--   * 16-Nov 3,00,000 — BOP chq 1313826265 (BPV-0046), booked into head office cash: now into the site box,
--     and the three payments made from it (CPV-0170 Naeem Meta 1,50,000, CPV-0171 piling 59,000, CPV-0172
--     Zia ul Haq 50,000) are now paid from the site box. Amounts unchanged; head office cash falls by 41,000.
-- The 05-16 Nov lines go into DC-007 (where head office's entries for those dates are), each dated its real
-- day; a separate sheet for a date head office already posted in DC-007 would miss those postings in its
-- opening. 17-Nov gets its own sheet (closed); 18-Nov its own sheet, left OPEN (today).
-- Runs as the director, through nf_reopen_day / nf_save_line / nf_close_day / nf_start_next_day.

DO $m$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  dc7 uuid; d17 uuid; d18 uuid; ver int; n_posted int := 0; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '315f2852-852f-4653-9253-a5a27a7828c8', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '315f2852-852f-4653-9253-a5a27a7828c8', true);

  -- 1. reopen DC-007
  SELECT id, version INTO dc7, ver FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-10-05' AND status = 'CLOSED';
  IF dc7 IS NULL THEN RAISE EXCEPTION 'DC-007 is not closed — stop'; END IF;
  PERFORM public.nf_reopen_day(dc7, 'Site cash box (Sharose): BPV-0026 and BPV-0046 cash went to the site; post the site''s 05-16 Nov entries', ver);

  -- 2. the site box gets the two cheques' cash and pays the three 16-Nov payments
  UPDATE public.nf_voucher_legs l SET account_code = '10200'
    FROM public.nf_vouchers v
   WHERE v.id = l.voucher_id AND v.company_id = co AND v.day_id = dc7
     AND ((v.manual_no = 'BPV-0026' AND l.account_code = '70950' AND l.debit = 150000)
       OR (v.manual_no = 'BPV-0046' AND l.account_code = '10100' AND l.debit = 300000)
       OR (v.manual_no = 'CPV-0170' AND l.account_code = '10100' AND l.credit = 150000)
       OR (v.manual_no = 'CPV-0171' AND l.account_code = '10100' AND l.credit = 59000)
       OR (v.manual_no = 'CPV-0172' AND l.account_code = '10100' AND l.credit = 50000));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 legs to move to the site cash box, % matched', n; END IF;
  UPDATE public.nf_vouchers SET narration = narration || ' — cash went to the site cash box (Sharose)'
   WHERE company_id = co AND day_id = dc7 AND manual_no IN ('BPV-0026','BPV-0046');
  UPDATE public.nf_vouchers SET narration = narration || ' — paid from the site cash box (Sharose)'
   WHERE company_id = co AND day_id = dc7 AND manual_no IN ('CPV-0170','CPV-0171','CPV-0172');

  -- 3. the site's 05-16 Nov entries, each on its real date
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0001', '3 Calculator (site cash, Sharose, 05-Nov)', '70500', 'P-W', 'Petty', 2550, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0002', 'Pads & Pen (site cash, Sharose, 05-Nov)', '70500', 'P-W', 'Petty', 340, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0003', 'Food (site cash, Sharose, 05-Nov)', '60400', 'P-W', 'Petty', 2400, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0004', 'Tea (site cash, Sharose, 05-Nov)', '60400', 'P-W', 'Petty', 600, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0005', 'Misc (site cash, Sharose, 05-Nov)', '81300', 'P-W', 'Petty', 10, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0006', 'Tissue (site cash, Sharose, 05-Nov)', '70500', 'P-W', 'Petty', 2400, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0007', 'Coracory (site cash, Sharose, 05-Nov)', '70950', 'P-W', 'Petty', 13000, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0008', 'Dustbin + Brush (site cash, Sharose, 05-Nov)', '70950', 'P-W', 'Petty', 1700, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0009', 'Tea (site cash, Sharose, 05-Nov)', '60400', 'P-W', 'Petty', 550, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0010', 'Food (site cash, Sharose, 05-Nov)', '60400', 'P-W', 'Petty', 1200, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0011', '50 Inch Tv — Nasir Khan (site cash, Sharose, site voucher #201, 05-Nov)', '15200', 'P-W', 'Petty', 70000, NULL, 'Nasir Khan');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-05' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0012', 'Milk+Sugar+Tea+Water (site cash, Sharose, 06-Nov)', '60400', 'P-W', 'Petty', 3900, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-06' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0013', 'Water (site cash, Sharose, 06-Nov)', '60400', 'P-W', 'Petty', 100, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-06' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0014', 'Cleaning Clothes (site cash, Sharose, 06-Nov)', '52900', 'P-W', 'Petty', 300, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-06' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0015', 'Food (site cash, Sharose, 06-Nov)', '60400', 'P-W', 'Petty', 700, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-06' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0016', 'Tv Stand (site cash, Sharose, 07-Nov)', '52900', 'P-W', 'Petty', 1500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0017', 'Screw+ Screw Driver (site cash, Sharose, 07-Nov)', '52900', 'P-W', 'Petty', 200, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0018', 'Cell (site cash, Sharose, 07-Nov)', '52900', 'P-W', 'Petty', 100, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0019', 'Food (site cash, Sharose, 07-Nov)', '60400', 'P-W', 'Petty', 500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0020', 'Water Bottles+Juice (site cash, Sharose, 07-Nov)', '60400', 'P-W', 'Petty', 830, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0021', 'Ptcl (site cash, Sharose, 07-Nov)', '70600', 'P-W', 'Petty', 5000, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0022', 'Food (site cash, Sharose, 07-Nov)', '60400', 'P-W', 'Petty', 700, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-07' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0023', 'Food (site cash, Sharose, 08-Nov)', '60400', 'P-W', 'Petty', 1260, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-08' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0024', 'Water (site cash, Sharose, 09-Nov)', '60400', 'P-W', 'Petty', 80, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-09' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0025', 'Food (site cash, Sharose, 09-Nov)', '60400', 'P-W', 'Petty', 1500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-09' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0026', 'Tea (site cash, Sharose, 09-Nov)', '60400', 'P-W', 'Petty', 340, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-09' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0027', 'Tea (site cash, Sharose, 10-Nov)', '60400', 'P-W', 'Petty', 100, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-10' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0028', 'Usb 64 Gb (site cash, Sharose, 10-Nov)', '52900', 'P-W', 'Petty', 1500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-10' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0029', 'Food (site cash, Sharose, 10-Nov)', '60400', 'P-W', 'Petty', 450, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-10' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0030', 'Food (site cash, Sharose, 10-Nov)', '60400', 'P-W', 'Petty', 300, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-10' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'IN', 'S-CRV-0001', 'Token #205 — Muhammad Tahir (site cash, Sharose, 11-Nov)', '21100', 'P-W', 'Petty', 10000, NULL, 'Muhammad Tahir');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-11' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0031', 'Food (site cash, Sharose, 11-Nov)', '60400', 'P-W', 'Petty', 400, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-11' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0032', 'Table (site cash, Sharose, 11-Nov)', '15100', 'P-W', 'Petty', 12000, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-11' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0033', 'Switch Board (site cash, Sharose, 11-Nov)', '52900', 'P-W', 'Petty', 570, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-11' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0034', 'Tea (site cash, Sharose, 11-Nov)', '60400', 'P-W', 'Petty', 500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-11' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0035', 'Mobile Package — Fayyaz (site cash, Sharose, 12-Nov)', '70600', 'P-W', 'Petty', 1500, NULL, 'Fayyaz');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-12' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0036', 'Food (site cash, Sharose, 12-Nov)', '60400', 'P-W', 'Petty', 300, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-12' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0037', 'Water (site cash, Sharose, 12-Nov)', '60400', 'P-W', 'Petty', 50, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-12' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0038', 'Bucket (site cash, Sharose, 12-Nov)', '52900', 'P-W', 'Petty', 600, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-12' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0039', 'Garbage Bag (site cash, Sharose, 12-Nov)', '52900', 'P-W', 'Petty', 200, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-12' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'IN', 'S-CRV-0002', 'Token #207 — Tehseen Ullah, Unit FF-196 (site cash, Sharose, site voucher #207, 13-Nov)', '21100', 'FF', 'Petty', 5000, NULL, 'Tehseen Ullah');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-13' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0040', 'Petrol For Meeting — Naeem (site cash, Sharose, 13-Nov)', '70700', 'P-W', 'Petty', 10000, NULL, 'Naeem');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-13' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0041', 'Food (site cash, Sharose, 13-Nov)', '60400', 'P-W', 'Petty', 500, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-13' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0042', 'Food (site cash, Sharose, 13-Nov)', '60400', 'P-W', 'Petty', 320, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-13' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0043', 'Token #207 returned — Tehseen Ullah (site cash, Sharose, site voucher #207, 14-Nov)', '21100', 'FF', 'Petty', 5000, NULL, 'Tehseen Ullah');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-14' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0044', 'Food (site cash, Sharose, 14-Nov)', '60400', 'P-W', 'Petty', 2100, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-14' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0045', 'For Taxi — Sajawal (site cash, Sharose, 14-Nov)', '70700', 'P-W', 'Petty', 500, NULL, 'Sajawal');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-14' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0046', 'Green Tea + Milk (site cash, Sharose, 14-Nov)', '60400', 'P-W', 'Petty', 300, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-14' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0047', 'Broom For Cleaning (site cash, Sharose, 14-Nov)', '52900', 'P-W', 'Petty', 700, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-14' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0048', 'Green Tea + Milk (site cash, Sharose, 15-Nov)', '60400', 'P-W', 'Petty', 1210, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-15' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0049', 'Card Holder + Stamp Pad (site cash, Sharose, 16-Nov)', '70500', 'P-W', 'Petty', 400, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-16' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(dc7, NULL, 'OUT', 'S-CPV-0050', 'Food (site cash, Sharose, 16-Nov)', '60400', 'P-W', 'Petty', 1540, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-16' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = dc7 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;

  -- 4. close DC-007 again
  SELECT version INTO ver FROM public.nf_days WHERE id = dc7;
  PERFORM public.nf_close_day(dc7, ver, NULL);

  -- 5. 17-Nov (closed) and 18-Nov (left open)
  PERFORM public.nf_start_next_day(co, DATE '2026-11-17');
  SELECT id INTO d17 FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-17';
  PERFORM public.nf_save_line(d17, NULL, 'OUT', 'S-CPV-0051', 'Steel Weight — Nasir Khan (site cash, Sharose, site voucher #212, 17-Nov)', '52500', 'P-W', 'Petty', 2000, NULL, 'Nasir Khan');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-17' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d17 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d17, NULL, 'OUT', 'S-CPV-0052', 'Speed Money Traffic — Nasir Khan (site cash, Sharose, site voucher #212, 17-Nov)', '70950', 'P-W', 'Petty', 500, NULL, 'Nasir Khan');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-17' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d17 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d17, NULL, 'OUT', 'S-CPV-0053', 'Awami — Sajawal (site cash, Sharose, 17-Nov)', '70700', 'P-W', 'Petty', 1000, NULL, 'Sajawal');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-17' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d17 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d17, NULL, 'OUT', 'S-CPV-0054', 'Food (site cash, Sharose, 17-Nov)', '60400', 'P-W', 'Petty', 450, NULL, NULL);
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-17' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d17 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d17, NULL, 'OUT', 'S-CPV-0055', 'Jazz Cash — Hira Ateeq (site cash, Sharose, 17-Nov)', '60100', 'P-W', 'Petty', 10000, NULL, 'Hira Ateeq');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-17' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d17 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  SELECT version INTO ver FROM public.nf_days WHERE id = d17;
  PERFORM public.nf_close_day(d17, ver, NULL);
  PERFORM public.nf_start_next_day(co, DATE '2026-11-18');
  SELECT id INTO d18 FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-18';
  PERFORM public.nf_save_line(d18, NULL, 'IN', 'S-CRV-0003', 'Token #317 — Riaz Ahmad, Unit SF-208 (site cash, Sharose, 18-Nov)', '21100', 'SF', 'Petty', 100000, NULL, 'Riaz Ahmad');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-18' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d18 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d18, NULL, 'IN', 'S-CRV-0004', 'Token #210 — Ali Haider, Unit GF-250-251 (site cash, Sharose, 18-Nov)', '21100', 'GF', 'Petty', 50000, NULL, 'Ali Haider');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-18' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d18 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d18, NULL, 'OUT', 'S-CPV-0056', 'Bending Wire — Ahmad Shah (site cash, Sharose, 18-Nov)', '52500', 'P-W', 'Petty', 10000, NULL, 'Ahmad Shah');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-18' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d18 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d18, NULL, 'OUT', 'S-CPV-0057', 'Steel Offloading — Muhammad Ijaz (site cash, Sharose, 18-Nov)', '52600', 'P-W', 'Petty', 22800, NULL, 'Muhammad Ijaz');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-18' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d18 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;
  PERFORM public.nf_save_line(d18, NULL, 'OUT', 'S-CPV-0058', 'Software — Rahid (site cash, Sharose, 18-Nov)', '16100', 'P-W', 'Petty', 10000, NULL, 'Rahid');
  UPDATE public.nf_vouchers SET voucher_date = DATE '2026-11-18' WHERE id = (SELECT id FROM public.nf_vouchers WHERE day_id = d18 ORDER BY sort DESC LIMIT 1);
  n_posted := n_posted + 1;

  IF n_posted <> 62 THEN RAISE EXCEPTION 'expected 62 site lines, posted %', n_posted; END IF;
END $m$;
