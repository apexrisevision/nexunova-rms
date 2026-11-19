-- ══ NexuFinance Awami: delete token #317 (Riaz Ahmad, SF-208, 1,00,000, 18-Nov) completely (20261119i) ══
-- Applied 19-Nov-2026 (20261119114013) on the owner's yes.
--
-- Owner, 19-Nov: "remove token 317 100000 receiving in 18-11-2026 Delete it completly."
-- The voucher: S-CRV-0003 (system CRV-000062), 18-Nov, DC-009 (closed), entered by Sharose:
--   "Token #317 — Riaz Ahmad, Unit SF-208 (site cash, Sharose, 18-Nov)" — Dr 10200 Site Cash / Cr 21100 Token Money 1,00,000.
-- Done the way the screen deletes a line, as the director. Only one day may be unclosed, and DC-010 (19-Nov) is
-- open, so in this one transaction: close DC-010 (its three vouchers all have their paper numbers), reopen DC-009,
-- nf_delete_line (which also takes the 1,00,000 back off the SF-208 hold's token in RMS through the token sync,
-- 20261119b), close DC-009 again, reopen DC-010. DC-010 ends open, its entries untouched.
-- The SF-208 hold itself stays (only the owner reserves / releases). The audit trail keeps the record of the
-- delete. Site Cash from 18-Nov on is 1,00,000 lower.

DO $m$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  dc9 uuid; dc10 uuid; ver int; v uuid; lid uuid; lver int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '315f2852-852f-4653-9253-a5a27a7828c8', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '315f2852-852f-4653-9253-a5a27a7828c8', true);

  SELECT id INTO v FROM public.nf_vouchers
   WHERE company_id = co AND voucher_no = 'CRV-000062' AND manual_no = 'S-CRV-0003' AND voucher_date = DATE '2026-11-18'
     AND narration LIKE 'Token #317 — Riaz Ahmad, Unit SF-208%';
  IF v IS NULL THEN RAISE EXCEPTION 'token #317 voucher (S-CRV-0003 / CRV-000062) not found as expected'; END IF;
  IF (SELECT sum(credit) FROM public.nf_voucher_legs WHERE voucher_id = v AND account_code = '21100') <> 100000 THEN
    RAISE EXCEPTION 'token #317 voucher is not 1,00,000 Token Money';
  END IF;
  SELECT id INTO lid FROM public.nf_voucher_legs WHERE voucher_id = v AND line_no = 1 AND account_code = '21100';
  IF lid IS NULL THEN RAISE EXCEPTION 'token #317 voucher: first leg is not Token Money'; END IF;

  SELECT id, version INTO dc9, ver FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-18' AND status = 'CLOSED';
  IF dc9 IS NULL THEN RAISE EXCEPTION 'DC-009 (18-Nov) is not closed as expected'; END IF;
  SELECT id, version INTO dc10, lver FROM public.nf_days WHERE company_id = co AND business_date = DATE '2026-11-19' AND status = 'OPEN';
  IF dc10 IS NULL THEN RAISE EXCEPTION 'DC-010 (19-Nov) is not open as expected'; END IF;
  PERFORM public.nf_close_day(dc10, lver, NULL);
  SELECT version INTO ver FROM public.nf_days WHERE id = dc9;
  PERFORM public.nf_reopen_day(dc9, 'Owner: delete token #317 (Riaz Ahmad, SF-208, 1,00,000) completely', ver);

  SELECT version INTO lver FROM public.nf_vouchers WHERE id = v;
  PERFORM public.nf_delete_line(lid, lver);

  SELECT version INTO ver FROM public.nf_days WHERE id = dc9;
  PERFORM public.nf_close_day(dc9, ver, NULL);

  SELECT version INTO ver FROM public.nf_days WHERE id = dc10;
  PERFORM public.nf_reopen_day(dc10, 'Closed for a moment only so DC-009 could be corrected (token #317 deleted); entries untouched', ver);
END $m$;
