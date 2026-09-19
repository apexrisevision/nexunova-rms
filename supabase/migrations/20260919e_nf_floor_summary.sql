-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19e · Floor/Class Cost &
-- Collection Summary
--
-- Applied under the read-only-additive auto-apply carve-out (§18 in
-- docs/PLAN.md).
--
-- nf_get_floor_summary(company, from, to) — for each floor (including
-- "Project-wide", a real floor_code in this chart for costs that aren't
-- allocated to a specific floor yet — most of Awami's real cost to date
-- is exactly this, checked directly: 112 of 154 real legs are P-W),
-- three figures: cost (Cost of Goods Sold + Expense accounts tagged to
-- that floor), income (real recognised sales, qb_type='Income' — zero
-- everywhere today, same reason as the P&L/Balance Sheet), and token
-- money collected (21100's own credit-debit for that floor — the real
-- "collection" figure this business actually has today, even though
-- 21100 is accounted for as a liability, not income, until a unit is
-- formally sold). Keeping token collection as its own field rather than
-- folding it into "income" avoids silently overstating recognised
-- revenue — the owner's own accounting-policy boundary from §17.2/17.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_floor_summary(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH tagged AS (
    SELECT l.floor_code, f.qb_class AS floor_name, a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), byfloor AS (
    SELECT floor_code, max(floor_name) AS floor_name,
           COALESCE(sum(debit - credit) FILTER (WHERE qb_type IN ('Cost of Goods Sold', 'Expense')), 0) AS cost,
           COALESCE(sum(credit - debit) FILTER (WHERE qb_type = 'Income'), 0) AS income
      FROM tagged
     GROUP BY floor_code
  ), token AS (
    SELECT l.floor_code, COALESCE(sum(l.credit - l.debit), 0) AS token_collected
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100' AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     GROUP BY l.floor_code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'floors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'floor_code', b.floor_code, 'floor_name', b.floor_name, 'cost', b.cost, 'income', b.income,
                 'token_collected', COALESCE(t.token_collected, 0))
                 ORDER BY (b.floor_code = 'P-W'), b.floor_code)
               FROM byfloor b LEFT JOIN token t ON t.floor_code = b.floor_code), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM byfloor),
    'total_income', (SELECT COALESCE(sum(income), 0) FROM byfloor),
    'total_token_collected', (SELECT COALESCE(sum(token_collected), 0) FROM token))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_floor_summary(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_floor_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_floor_summary(uuid, date, date) TO authenticated;

COMMIT;
