-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19b · Party-wise statement
--
-- NOT YET APPLIED — awaiting explicit go-ahead, same reasoning as
-- 20260918u/20260919a: touches the ledger tables, purely additive.
--
-- Two new read-only RPCs, same pattern as nf_get_ledger/nf_list_all_accounts:
--
-- nf_list_all_parties(company) — every active party, for the picker.
--
-- nf_get_party_statement(company, party_id, from, to) — every voucher leg
-- for one party, across ALL accounts (unlike nf_get_ledger, which is
-- scoped to one account) — a party like FMH or a token-money customer can
-- appear on legs against several different accounts (22100, 12610, etc.),
-- and this report follows the PARTY, not the account. Same running-
-- balance shape as nf_get_ledger otherwise: opening balance before
-- p_from, then a running total in voucher/line order, each entry showing
-- its own account code/name so the account is still visible even though
-- it isn't the grouping key.
--
-- Grants: explicit REVOKE FROM PUBLIC/anon + GRANT TO authenticated on
-- both, from the start this time — 20260919a shipped without this and
-- came up anon-executable by default, caught only after applying and
-- checking has_function_privilege() directly. Not repeating that here.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_list_all_parties(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind) ORDER BY p.name), '[]'::jsonb)
    INTO v_out
    FROM public.nf_parties p
   WHERE p.company_id = p_company_id AND p.is_active;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_list_all_parties(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_list_all_parties(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_list_all_parties(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.nf_get_party_statement(p_company_id uuid, p_party_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_party public.nf_parties;
  v_opening numeric;
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT * INTO v_party FROM public.nf_parties WHERE company_id = p_company_id AND id = p_party_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PARTY_NOT_FOUND' USING DETAIL = p_party_id::text; END IF;

  v_opening := CASE WHEN p_from IS NULL THEN 0 ELSE (
    SELECT COALESCE(sum(l.debit - l.credit), 0)
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.party_id = p_party_id
       AND v.status = 'POSTED' AND v.voucher_date < p_from) END;

  WITH entries AS (
    SELECT v.voucher_date, v.voucher_no, v.narration, l.memo, l.account_code, a.name AS account_name,
           l.floor_code, f.qb_class AS floor_name, l.debit, l.credit, l.line_no,
           v_opening + sum(l.debit - l.credit) OVER (ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
                                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
     WHERE l.company_id = p_company_id AND l.party_id = p_party_id AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
  )
  SELECT jsonb_build_object(
    'party', jsonb_build_object('id', v_party.id, 'name', v_party.name, 'kind', v_party.kind),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'closing', v_opening + COALESCE((SELECT sum(debit - credit) FROM entries), 0),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'voucher_date', voucher_date, 'voucher_no', voucher_no, 'narration', narration, 'memo', memo,
                 'account_code', account_code, 'account_name', account_name,
                 'floor_code', floor_code, 'floor_name', floor_name,
                 'debit', debit, 'credit', credit, 'running_balance', running_balance) ORDER BY voucher_date, line_no)
               FROM entries), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.nf_get_party_statement(uuid, uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nf_get_party_statement(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.nf_get_party_statement(uuid, uuid, date, date) TO authenticated;

COMMIT;
