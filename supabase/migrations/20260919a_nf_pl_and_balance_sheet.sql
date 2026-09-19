-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19a · P&L and Balance Sheet
--
-- NOT YET APPLIED — awaiting explicit go-ahead, same as 20260918u: Awami
-- holds real data, so per the conditional auto-apply rule's own sunset,
-- anything touching the ledger tables stops for a decision rather than
-- applying itself, even when (as here) it's purely additive — two new
-- functions, nothing altered, nothing dropped.
--
-- Two new read-only reporting RPCs, same shape/security pattern as the
-- existing nf_get_trial_balance (STABLE SECURITY DEFINER, nf_require_role
-- gated to accountant/director/viewer, SET search_path).
--
-- nf_get_pl(company, from, to) — Income, Cost of Goods Sold and Expense
-- accounts for a date range. Income accounts are naturally credit-balance
-- (amount = credit - debit); COGS and Expense are naturally debit-balance
-- (amount = debit - credit). gross_profit = total_income - total_cogs;
-- net_income = gross_profit - total_expense.
--
-- nf_get_balance_sheet(company, as_of) — Asset (Bank, Accounts Receivable,
-- Other Current Asset, Fixed Asset, Other Asset), Liability (Accounts
-- Payable, Other Current Liability, Long Term Liability) and Equity
-- accounts as of a point in time, plus one computed line that is NOT a
-- posted account: "Current Earnings" = the same net-income calculation
-- nf_get_pl would return for p_from=NULL..p_as_of, added into the equity
-- total. This is standard practice (QuickBooks does the same) for a
-- business that has never run a formal period-end closing entry — Awami
-- hasn't, so without this line the sheet would never balance. It is
-- clearly labelled as computed, not stored, in the returned JSON
-- ('is_computed': true) so the frontend can say so rather than implying
-- it's a real account. total_assets and (total_liabilities + total_equity)
-- are both returned so the frontend/report can show the balance check
-- directly, the same way nf_get_trial_balance exposes total_debit/
-- total_credit rather than asserting balance itself.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_pl(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS amount
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id AND a.qb_type IN ('Income', 'Cost of Goods Sold', 'Expense')
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) <> 0
  ), totals AS (
    SELECT
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Income'), 0) AS total_income,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Cost of Goods Sold'), 0) AS total_cogs,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Expense'), 0) AS total_expense
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income',   COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Income'), '[]'::jsonb),
    'cogs',     COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Cost of Goods Sold'), '[]'::jsonb),
    'expense',  COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Expense'), '[]'::jsonb),
    'total_income',  (SELECT total_income FROM totals),
    'total_cogs',    (SELECT total_cogs FROM totals),
    'gross_profit',  (SELECT total_income - total_cogs FROM totals),
    'total_expense', (SELECT total_expense FROM totals),
    'net_income',    (SELECT (total_income - total_cogs) - total_expense FROM totals))
    INTO v_out;
  RETURN v_out;
END
$function$;

-- Found applying this migration, not caught by the earlier rehearsal (a
-- rehearsal in a rolled-back transaction never queries pg_proc's real
-- grants against a real session): CREATE FUNCTION on a name that didn't
-- exist before granted PUBLIC/anon EXECUTE by default, unlike every
-- existing nf_ report RPC (nf_get_trial_balance, etc.), which are all
-- correctly anon:false. Whatever ALTER DEFAULT PRIVILEGES revocation
-- locked those down originally did not carry forward here — explicit
-- REVOKE/GRANT per function from now on, not relying on a session-scoped
-- default surviving across migrations.
REVOKE ALL ON FUNCTION public.nf_get_pl(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_pl(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_pl(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.nf_get_balance_sheet(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_current_earnings numeric;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  -- Same net-income calculation as nf_get_pl, from inception (no p_from)
  -- through p_as_of — the plug that makes the sheet balance without a
  -- formal period-end closing entry ever having been posted.
  SELECT COALESCE(sum(CASE WHEN a.qb_type = 'Income' THEN l.credit - l.debit
                           WHEN a.qb_type IN ('Cost of Goods Sold', 'Expense') THEN -(l.debit - l.credit)
                           ELSE 0 END), 0)
    INTO v_current_earnings
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
    JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
   WHERE l.company_id = p_company_id AND v.status = 'POSTED'
     AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
     AND a.qb_type IN ('Income', 'Cost of Goods Sold', 'Expense');

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(CASE WHEN a.qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability','Equity')
                              THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) AS amount
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id
       AND a.qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset',
                          'Accounts Payable','Other Current Liability','Long Term Liability','Equity')
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(CASE WHEN a.qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability','Equity')
                              THEN l.credit - l.debit ELSE l.debit - l.credit END) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) <> 0
  ), totals AS (
    SELECT
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset')), 0) AS total_assets,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability')), 0) AS total_liabilities,
      COALESCE((SELECT sum(amount) FROM bal WHERE qb_type = 'Equity'), 0) AS total_posted_equity
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'assets',      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type IN ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset')), '[]'::jsonb),
    'liabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type IN ('Accounts Payable','Other Current Liability','Long Term Liability')), '[]'::jsonb),
    'equity',      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent_code', parent_code, 'amount', amount) ORDER BY code) FROM bal WHERE qb_type = 'Equity'), '[]'::jsonb),
    'current_earnings', jsonb_build_object('name', 'Current Earnings', 'amount', v_current_earnings, 'is_computed', true),
    'total_assets',      (SELECT total_assets FROM totals),
    'total_liabilities', (SELECT total_liabilities FROM totals),
    'total_equity',      (SELECT total_posted_equity FROM totals) + v_current_earnings,
    'total_liabilities_and_equity', (SELECT total_liabilities + total_posted_equity FROM totals) + v_current_earnings)
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_balance_sheet(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_balance_sheet(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_balance_sheet(uuid, date) TO authenticated;

COMMIT;
