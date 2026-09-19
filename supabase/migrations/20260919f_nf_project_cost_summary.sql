-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19f · Project Cost Summary
--
-- Applied under the read-only-additive auto-apply carve-out (§18 in
-- docs/PLAN.md).
--
-- nf_get_project_cost_summary(company, from, to) — cost rolled up by
-- CATEGORY (Land Cost, Construction Cost, Project Development Cost,
-- Selling Cost, Marketing & Sales, Payroll, Administrative, Utilities,
-- Other Operating, Financial Charges), one level coarser than the P&L's
-- own full account-level detail and orthogonal to the Floor Summary's
-- floor-wise view — this is "where is project cost actually going,
-- by category," not by floor and not the full chart.
--
-- Category = the leaf account's own direct parent (e.g. 51100 Land
-- Purchase Cost's parent 51000 Land Cost), NOT a walk to the ultimate
-- root (50000 Cost of Sales is too coarse to be useful — every COGS
-- account would show under one bucket). Checked directly before writing
-- this: every real postable COGS/Expense leaf account in this chart has
-- a parent one level up that IS the right category granularity (Land/
-- Construction/Development/Selling under Cost of Sales; Marketing/
-- Payroll/Administrative/Utilities/Other/Financial directly), except
-- 66000 Payroll Expenses, which has no parent at all (it is itself
-- both a leaf and its own top-level category) — handled with
-- COALESCE(parent.code, a.code) rather than assumed away.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_project_cost_summary(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH tagged AS (
    SELECT COALESCE(pa.code, a.code) AS category_code, COALESCE(pa.name, a.name) AS category_name,
           a.qb_type, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      LEFT JOIN public.nf_accounts pa ON pa.company_id = a.company_id AND pa.code = a.parent_code
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND a.qb_type IN ('Cost of Goods Sold', 'Expense')
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ), bycat AS (
    SELECT category_code, category_name, max(qb_type) AS qb_type, COALESCE(sum(debit - credit), 0) AS cost
      FROM tagged
     GROUP BY category_code, category_name
    HAVING COALESCE(sum(debit - credit), 0) <> 0
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'category_code', category_code, 'category_name', category_name, 'qb_type', qb_type, 'cost', cost)
                    ORDER BY cost DESC) FROM bycat), '[]'::jsonb),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM bycat))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_project_cost_summary(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_project_cost_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_project_cost_summary(uuid, date, date) TO authenticated;

COMMIT;
