-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19c · Token Money Register
--
-- Applied under the read-only-additive auto-apply carve-out (see the
-- nexufinance_migration_autoapply_rule memory, refined 2026-09-19): only
-- creates one new read-only function, grant-locked from the start,
-- carries the membership check, cross-checked against a known-correct
-- figure before applying (see the apply script's own console output).
--
-- nf_get_token_register(company, from, to) — one row per unit that has
-- ever had token money moved against it (21100 Token Money - Units is
-- the only such account in this chart, confirmed by checking every
-- other account's qb_type before writing this).
--
-- There is no structured "unit" column anywhere in this schema — units
-- only exist as free text inside each leg's own memo, e.g. "Token 114 -
-- unit LG-10". Checked directly before relying on it, not assumed: every
-- one of the 42 real 21100 legs imported from QuickBooks history matches
-- 'unit ([A-Za-z0-9-]+)' and 'Token ([0-9]+)' cleanly (0 misses). Postgres's
-- advanced-regex substring() does NOT accept \s/\d shortcuts inside a
-- plain '...' string literal the way a quick first draft assumed —
-- confirmed directly (returned NULL for every row) before shipping a
-- version that silently produced empty registers; a literal space and
-- [0-9] work correctly and are used throughout instead.
--
-- The floor itself is NOT extracted from memo text — l.floor_code is
-- already correct, structured data per leg (confirmed: every 21100 leg's
-- floor_code already matches the unit code's own prefix, e.g. LG-10 →
-- floor_code 'LG'), so the report joins nf_floors normally rather than
-- re-deriving something that already exists.
--
-- A register, not a full transaction log — one row per unit with its
-- token number(s), party name(s), first/last activity date, total
-- received, total returned and net outstanding. Full per-voucher detail
-- for any given unit's party is already available via the Party
-- Statement or the General Ledger for 21100 — this report's job is the
-- unit-wise index, not a second copy of either.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_token_register(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH tagged AS (
    SELECT l.debit, l.credit, v.voucher_date, l.floor_code, f.qb_class AS floor_name,
           pt.name AS party_name,
           substring(l.memo from 'unit ([A-Za-z0-9-]+)') AS unit_code,
           substring(l.memo from 'Token ([0-9]+)') AS token_no
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100' AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
       AND substring(l.memo from 'unit ([A-Za-z0-9-]+)') IS NOT NULL
  ), units AS (
    SELECT unit_code, floor_code, max(floor_name) AS floor_name,
           string_agg(DISTINCT party_name, ', ' ORDER BY party_name) FILTER (WHERE party_name IS NOT NULL) AS parties,
           string_agg(DISTINCT token_no, ', ' ORDER BY token_no) AS tokens,
           min(voucher_date) AS first_date, max(voucher_date) AS last_date,
           COALESCE(sum(credit), 0) AS total_received, COALESCE(sum(debit), 0) AS total_returned,
           COALESCE(sum(credit - debit), 0) AS net
      FROM tagged
     GROUP BY unit_code, floor_code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'unit_code', unit_code, 'floor_code', floor_code, 'floor_name', floor_name,
               'parties', parties, 'tokens', tokens, 'first_date', first_date, 'last_date', last_date,
               'total_received', total_received, 'total_returned', total_returned, 'net', net,
               'status', CASE WHEN net = 0 THEN 'Returned' ELSE 'Active' END)
               ORDER BY floor_code, unit_code) FROM units), '[]'::jsonb),
    'total_units', (SELECT count(*) FROM units),
    'total_received', (SELECT COALESCE(sum(total_received), 0) FROM units),
    'total_returned', (SELECT COALESCE(sum(total_returned), 0) FROM units),
    'net_outstanding', (SELECT COALESCE(sum(net), 0) FROM units))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_token_register(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_token_register(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_token_register(uuid, date, date) TO authenticated;

COMMIT;
