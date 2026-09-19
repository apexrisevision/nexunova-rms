-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19d · Cash & Bank Movement
--
-- Applied under the read-only-additive auto-apply carve-out (§18 in
-- docs/PLAN.md / the nexufinance_migration_autoapply_rule memory).
--
-- nf_get_cash_bank_movement(company, from, to) — opening/inflow/outflow/
-- closing for every qb_type='Bank' account that is actually postable
-- (is_head = true; the group header row like "10000 Cash & Bank" is not
-- itself posted to and is excluded — confirmed by checking is_head/
-- parent_code directly, not assumed from the account name).
--
-- Checked before writing this: as of 2026-09-19, none of Awami's three
-- real cash/bank accounts (10100 Cash in Hand, 10200 Petty Cash, 10300
-- Bank Al-Habib) have ANY posted activity — every real imported voucher
-- flows through intercompany (22100/22200) or token-money (21100)
-- accounts instead, not cash/bank directly. So this report will
-- correctly show all zeros for Awami today; that is the true state of
-- the data, not a bug in the report, and is called out explicitly in
-- docs/PLAN.md rather than left to look broken.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_cash_bank_movement(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH accts AS (
    SELECT a.code, a.name FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.qb_type = 'Bank' AND a.is_head AND a.active
  ), opening AS (
    SELECT ac.code,
           CASE WHEN p_from IS NULL THEN 0 ELSE COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND v.voucher_date < p_from), 0) END AS opening
      FROM accts ac
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = p_company_id AND l.account_code = ac.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     GROUP BY ac.code
  ), period AS (
    SELECT ac.code,
           COALESCE(sum(l.debit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_in,
           COALESCE(sum(l.credit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_out
      FROM accts ac
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = p_company_id AND l.account_code = ac.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     GROUP BY ac.code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'code', ac.code, 'name', ac.name, 'opening', o.opening, 'total_in', pd.total_in,
                 'total_out', pd.total_out, 'closing', o.opening + pd.total_in - pd.total_out) ORDER BY ac.code)
               FROM accts ac JOIN opening o ON o.code = ac.code JOIN period pd ON pd.code = ac.code), '[]'::jsonb),
    'total_opening', (SELECT COALESCE(sum(opening), 0) FROM opening),
    'total_in',      (SELECT COALESCE(sum(total_in), 0) FROM period),
    'total_out',     (SELECT COALESCE(sum(total_out), 0) FROM period),
    'total_closing', (SELECT COALESCE(sum(o.opening), 0) FROM opening o) +
                      (SELECT COALESCE(sum(total_in), 0) FROM period) -
                      (SELECT COALESCE(sum(total_out), 0) FROM period))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_cash_bank_movement(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_cash_bank_movement(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_cash_bank_movement(uuid, date, date) TO authenticated;

COMMIT;
