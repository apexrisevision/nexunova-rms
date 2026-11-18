-- ══ NexuFinance: one date's cash & bank book, for the director's Excel download (20261119c) ══
-- NOT APPLIED until the owner says yes.
--
-- Owner, 19-Nov: the Excel layout of "D:\Claude Cowork\Daily closing.xlsx" (sample approved), title "AWAMI MARKET
-- KARKHANO — DAILY CASH & BANK BOOK", downloaded by date by a director from the Daily Closing screen.
-- By DATE (a voucher's real_date, else voucher_date), not by day sheet: DC-007 holds 05-Oct to 16-Nov.
-- Read-only. The screen builds the .xlsx from what this returns (js/nf/nf-day-excel.js).

ALTER TABLE public.nf_settings ADD COLUMN book_title text;
UPDATE public.nf_settings SET book_title = 'AWAMI MARKET KARKHANO — DAILY CASH & BANK BOOK'
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';

CREATE OR REPLACE FUNCTION public.nf_day_book(p_company_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['director']);
  IF p_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  RETURN jsonb_build_object(
    'date', p_date,
    'title', COALESCE((SELECT s.book_title FROM public.nf_settings s WHERE s.company_id = p_company_id),
                      (SELECT upper(COALESCE(c.display_name, c.company_name)) FROM public.companies c WHERE c.id = p_company_id) || ' — DAILY CASH & BANK BOOK'),
    -- each cash box and the bank: balance before the date
    'boxes', (SELECT jsonb_agg(jsonb_build_object('via', a.via, 'code', a.code, 'label', a.via_label,
                'opening', COALESCE((SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_vouchers v ON v.id = g.voucher_id
                                      WHERE g.company_id = p_company_id AND g.account_code = a.code AND v.status = 'POSTED'
                                        AND COALESCE(v.real_date, v.voucher_date) < p_date), 0)) ORDER BY a.code)
                FROM public.nf_accounts a WHERE a.company_id = p_company_id AND a.via IS NOT NULL),
    -- every posted voucher of the date, its legs, and who entered it
    'vouchers', COALESCE((SELECT jsonb_agg(x.j ORDER BY x.created_at, x.sort) FROM (
        SELECT v.created_at, v.sort, jsonb_build_object(
                 'no', COALESCE(v.manual_no, v.voucher_no), 'voucher_no', v.voucher_no, 'narration', v.narration, 'source', v.source,
                 'by_name', m.display_name, 'by_box', m.cash_via,
                 'legs', (SELECT jsonb_agg(jsonb_build_object('acc', g.account_code, 'name', a.name, 'via', a.via, 'label', a.via_label,
                                   'dr', g.debit, 'cr', g.credit, 'party', p.name) ORDER BY g.line_no)
                            FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                            LEFT JOIN public.nf_parties p ON p.id = g.party_id WHERE g.voucher_id = v.id)) AS j
          FROM public.nf_vouchers v
          LEFT JOIN public.nf_members m ON m.company_id = v.company_id AND m.user_id = v.created_by
         WHERE v.company_id = p_company_id AND v.status = 'POSTED' AND COALESCE(v.real_date, v.voucher_date) = p_date) x), '[]'));
END $f$;
REVOKE ALL ON FUNCTION public.nf_day_book(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_day_book(uuid, date) TO authenticated;
