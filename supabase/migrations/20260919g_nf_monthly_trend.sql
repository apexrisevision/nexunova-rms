-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19g · Month-wise Expense
-- Trend
--
-- Applied under the read-only-additive auto-apply carve-out (§18 in
-- docs/PLAN.md).
--
-- nf_get_monthly_trend(company, from, to) — cost, income and token money
-- collected per calendar month, so the owner can see spending trend over
-- time rather than only a point-in-time or all-time total. Same three
-- figures as the Floor Summary (§22), bucketed by month instead of by
-- floor — deliberately consistent shape across both, since both answer
-- "where/when did cost happen," just sliced on a different axis.
--
-- Month key is YYYY-MM (to_char(voucher_date,'YYYY-MM')), sorted
-- chronologically — checked directly against Awami's real spread before
-- writing this: 8 real months, February through September 2026, 1 to 19
-- vouchers per month, matching the business's actual pace to date.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_monthly_trend(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH tagged AS (
    SELECT to_char(v.voucher_date, 'YYYY-MM') AS ym, a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), bymonth AS (
    SELECT ym,
           COALESCE(sum(debit - credit) FILTER (WHERE qb_type IN ('Cost of Goods Sold', 'Expense')), 0) AS cost,
           COALESCE(sum(credit - debit) FILTER (WHERE qb_type = 'Income'), 0) AS income
      FROM tagged
     GROUP BY ym
  ), token AS (
    SELECT to_char(v.voucher_date, 'YYYY-MM') AS ym, COALESCE(sum(l.credit - l.debit), 0) AS token_collected
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100' AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     GROUP BY ym
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'months', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'ym', b.ym, 'cost', b.cost, 'income', b.income, 'token_collected', COALESCE(t.token_collected, 0))
                ORDER BY b.ym)
              FROM bymonth b LEFT JOIN token t ON t.ym = b.ym), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM bymonth),
    'total_income', (SELECT COALESCE(sum(income), 0) FROM bymonth),
    'total_token_collected', (SELECT COALESCE(sum(token_collected), 0) FROM token))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_monthly_trend(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_monthly_trend(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_monthly_trend(uuid, date, date) TO authenticated;

COMMIT;
