-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — nf_other_balances ignored p_as_of.
--
-- ALREADY APPLIED TO THE LIVE DATABASE before this file was written; it is
-- here so the repo matches live. The body below is the live definition,
-- copied verbatim.
--
-- The date/status filter sat on the LEFT JOIN to nf_vouchers, so legs whose
-- voucher failed the test still had their debit and credit summed, and every
-- day's report showed today's balances. The legs are now filtered (POSTED,
-- voucher_date <= p_as_of) in a CTE before they are aggregated.
-- Proof given with the fix: nf_other_balances(company, '2026-01-01') returned
-- today's balances before and returns [] after.
--
-- Same signature, so the grants from 20260918n (internal only — no PUBLIC,
-- anon or authenticated) are kept.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_other_balances(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  WITH posted AS (
    SELECT l.account_code, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id
       AND v.status = 'POSTED'
       AND v.voucher_date <= p_as_of
  ), bal AS (
    SELECT a.code, a.name, a.parent_code,
           COALESCE(sum(p.debit - p.credit), 0) AS net_debit
      FROM public.nf_accounts a
      LEFT JOIN posted p ON p.account_code = a.code
     WHERE a.company_id = p_company_id
       AND a.code IN ('12610','12620','22100','22200','22300','22400','21100')
     GROUP BY a.code, a.name, a.parent_code
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY grp, code), '[]'::jsonb) INTO v_out
  FROM (
    SELECT 1 AS grp, code,
           jsonb_build_object('code', code,
             'label', 'Owed to ' || name || ' (payable)',
             'amount', -net_debit) AS row
      FROM bal WHERE parent_code = '22000' AND net_debit <> 0
    UNION ALL
    SELECT 2, code,
           jsonb_build_object('code', code,
             'label', 'Due from ' || name || ' — given by Awami, to be recovered',
             'amount', net_debit)
      FROM bal WHERE parent_code = '12600' AND net_debit <> 0
    UNION ALL
    SELECT 3, code,
           jsonb_build_object('code', code,
             'label', 'Customer token money held — refundable if a deal is cancelled',
             'amount', -net_debit)
      FROM bal WHERE code = '21100' AND net_debit <> 0
  ) x;
  RETURN v_out;
END
$function$;

COMMIT;
