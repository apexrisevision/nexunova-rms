-- ══ NexuFinance Awami: CRV-0027 and CPV-0062 back on their sheet's date (20261118g) ══
-- APPLIED 18-Nov-2026 as 20261118112106, on the owner's yes. DC-007 then closed by the director at 4,56,250.
--
-- 20261118f dated these two 03-Oct (their Excel tab). But they sit in the 05-Oct day sheet (DC-007), and a
-- sheet's opening is every voucher dated BEFORE its date (nf_ledger_position), while its movement is every
-- voucher IN the sheet (nf_position_row). Dated 03-Oct, both counted twice: DC-007's opening cash became
-- 17,64,150 instead of DC-006's 14,14,150, and its closing 8,06,250 instead of the ledger's 4,56,250.
-- (Vouchers moved LATER than 05-Oct are fine: they are after the opening's cut-off.)
--
-- Fix: voucher_date back to 05-Oct; the real date 03-Oct goes in real_date, the column kept for exactly
-- this. Nothing else changes.

DO $m$
DECLARE n int;
BEGIN
  UPDATE public.nf_vouchers v SET voucher_date = DATE '2026-10-05', real_date = DATE '2026-10-03', updated_at = now()
  WHERE v.company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'
    AND v.voucher_no IN ('CRV-000027', 'CPV-000062') AND v.voucher_date = DATE '2026-10-03'
    AND v.day_id = (SELECT id FROM public.nf_days WHERE company_id = v.company_id AND business_date = DATE '2026-10-05');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 vouchers, % matched', n; END IF;
END $m$;
