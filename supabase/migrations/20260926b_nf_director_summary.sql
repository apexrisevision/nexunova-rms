-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — the director summary on the daily report.
--
-- ALREADY APPLIED TO THE LIVE DATABASE before this file was written; it is
-- here so the repo matches live. Every body below is the live definition,
-- copied verbatim.
--
-- 1. New nf_director_summary(company, as_of): spent_on_project (+ breakdown by
--    5xxxx head), office_expenses, money_with_us, owed_to_group,
--    due_from_directors, tokens {held, buyers, unit_bookings, refunded} and
--    month {from, to, received, paid}. Money moved only between our own
--    cash/bank accounts is a transfer and is left out of received/paid.
-- 2. nf_get_report(uuid) is renamed nf_get_report_day, body untouched (it is
--    20260921m's exactly). A thin nf_get_report with the same name and
--    signature returns that day report plus a 'director' key, so every caller
--    is unchanged.
-- Grants: authenticated only; PUBLIC and anon revoked.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_director_summary(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_m_from date := date_trunc('month', p_as_of)::date;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH posted AS (
    SELECT l.voucher_id, l.account_code, l.party_id, l.debit, l.credit, v.voucher_date
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id
       AND v.status = 'POSTED'
       AND v.voucher_date <= p_as_of
  ),
  -- a voucher that only moves money between our own cash/bank accounts is a
  -- transfer, not money coming in or going out
  moneybox AS (
    SELECT code FROM public.nf_accounts
     WHERE company_id = p_company_id AND via IS NOT NULL
  ),
  transfers AS (
    SELECT voucher_id FROM posted
     GROUP BY voucher_id
    HAVING bool_and(account_code IN (SELECT code FROM moneybox))
  ),
  cost AS (
    SELECT a.parent_code, a.code, a.name, sum(p.debit - p.credit) AS amount
      FROM posted p JOIN public.nf_accounts a
        ON a.company_id = p_company_id AND a.code = p.account_code
     WHERE left(a.code, 1) = '5'
     GROUP BY a.parent_code, a.code, a.name
    HAVING sum(p.debit - p.credit) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,

    'spent_on_project', COALESCE((SELECT sum(amount) FROM cost), 0),
    'spent_breakdown', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('code', code, 'label', name, 'amount', amount)
                        ORDER BY amount DESC) FROM cost), '[]'::jsonb),
    'office_expenses', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE left(a.code, 1) IN ('6','7','8')), 0),

    'money_with_us', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        WHERE p.account_code IN (SELECT code FROM moneybox)), 0),
    'owed_to_group', COALESCE((
       SELECT sum(p.credit - p.debit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '22000'), 0),
    'due_from_directors', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '12600'), 0),

    'tokens', jsonb_build_object(
       'held', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code = '21100'), 0),
       'buyers', (SELECT count(DISTINCT p.party_id) FROM posted p
                   WHERE p.account_code = '21100' AND p.party_id IS NOT NULL),
       'unit_bookings', (SELECT count(*) FROM posted p
                          WHERE p.account_code = '21100' AND p.credit > 0),
       'refunded', COALESCE((SELECT sum(p.debit) FROM posted p
                              WHERE p.account_code = '21100'), 0)),

    'month', jsonb_build_object(
       'from', v_m_from, 'to', p_as_of,
       'received', COALESCE((SELECT sum(p.debit) FROM posted p
                              WHERE p.account_code IN (SELECT code FROM moneybox)
                                AND p.voucher_date >= v_m_from
                                AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0),
       'paid', COALESCE((SELECT sum(p.credit) FROM posted p
                          WHERE p.account_code IN (SELECT code FROM moneybox)
                            AND p.voucher_date >= v_m_from
                            AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_director_summary(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_director_summary(uuid, date) TO authenticated;

-- The day report keeps its body and its grants; only the name moves.
ALTER FUNCTION public.nf_get_report(uuid) RENAME TO nf_get_report_day;

CREATE OR REPLACE FUNCTION public.nf_get_report(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.nf_get_report_day(p_day_id)
         || jsonb_build_object('director',
              public.nf_director_summary(d.company_id, d.business_date))
    FROM public.nf_days d
   WHERE d.id = p_day_id;
$function$;

REVOKE ALL ON FUNCTION public.nf_get_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_get_report(uuid) TO authenticated;

COMMIT;
