-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · s · Trial Balance (report 3 of 3
-- before the Awami import — Journal and Ledger done)
--
-- nf_get_trial_balance(company, as_of): every account with a non-zero net
-- balance as of a date (or all time if NULL), each net split into its
-- natural debit or credit column — the classic proof that the whole
-- ledger balances, not just one voucher or one account. Because every
-- voucher this schema will ever accept is itself balanced (the deferred
-- constraint trigger + nf_post_voucher's own pre-check, both from
-- 20260918a/b), summing every account's own net and splitting it by sign
-- must always tie exactly — this report doesn't just show the numbers,
-- it re-proves the double-entry invariant across the whole company at
-- once. This is the instrument the owner's own QuickBooks checksum
-- (12610/22100/22200/21100/15300/16100/70100) gets checked against once
-- the Awami history is imported.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.nf_get_trial_balance(p_company_id uuid, p_as_of date)
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
           COALESCE(sum(l.debit - l.credit), 0) AS net
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'
                                     AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
     WHERE a.company_id = p_company_id
     GROUP BY a.code, a.name, a.qb_type, a.parent_code
    HAVING COALESCE(sum(l.debit - l.credit), 0) <> 0
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

REVOKE ALL ON FUNCTION public.nf_get_trial_balance(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_get_trial_balance(uuid, date) TO authenticated;

COMMIT;
