-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · t · fix nf_get_trial_balance's
-- "as of" date filter — it had no effect at all
--
-- Real bug, found by verify-nf-trial-balance.js's own T-05 (an as-of date
-- before the golden day still showed the full, unfiltered total), not
-- assumed correct from reading the SQL. 20260918s joined nf_voucher_legs
-- (l) to nf_accounts UNCONDITIONALLY, then left-joined nf_vouchers (v) to
-- l with the date/status condition attached to v's join — but the
-- aggregate summed l.debit/l.credit directly, columns that were already
-- populated from the first, unconditional join regardless of whether v
-- matched. Nulling out v's own columns when the date condition failed had
-- no effect on l's columns at all, so the filter did nothing for any
-- p_as_of value, not just NULL.
--
-- Fixed with FILTER (WHERE ...) on the aggregate itself — the same
-- pattern nf_position_row already uses correctly elsewhere in this
-- schema (`sum(amount) FILTER (WHERE side = 'IN' AND via = 'Cash')`) —
-- rather than relying on a join's null-propagation to gate an aggregate
-- that doesn't reference the joined table's own columns.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_trial_balance(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH bal AS (
    SELECT a.code, a.name, a.qb_type, a.parent_code,
           COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) AS net
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE a.company_id = p_company_id
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)), 0) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'code', code, 'name', name, 'qb_type', qb_type, 'parent_code', parent_code,
               'debit', GREATEST(net, 0), 'credit', GREATEST(-net, 0)) ORDER BY code)
             FROM bal), '[]'::jsonb),
    'total_debit',  (SELECT COALESCE(sum(GREATEST(net, 0)), 0) FROM bal),
    'total_credit', (SELECT COALESCE(sum(GREATEST(-net, 0)), 0) FROM bal))
    INTO v_out;
  RETURN v_out;
END
$function$;

COMMIT;
