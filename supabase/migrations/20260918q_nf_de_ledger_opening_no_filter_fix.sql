-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · q · fix nf_get_ledger's opening
-- balance when no date filter is applied
--
-- Real bug, found by verify-nf-general-ledger.js's own L-03/L-04, not
-- assumed correct from reading the SQL: 20260918p's opening-balance query
-- used `(p_from IS NULL OR v.voucher_date < p_from)`. Postgres's OR
-- short-circuits that to TRUE for every row whenever p_from IS NULL — so
-- with no date filter ("all time", the default view), the opening balance
-- silently summed EVERY voucher on the account, the exact same set the
-- `entries` CTE was already showing (its own `(p_from IS NULL OR
-- v.voucher_date >= p_from)` has the identical shape). Every voucher got
-- counted twice: once as "opening", again as an entry. Confirmed exactly:
-- account 22100's real net was -75000; the screen showed a closing balance
-- of -150000 — precisely double.
--
-- Fix: with no filter there is no "period start" to have an opening
-- balance as of, so it must be exactly 0, not "everything".
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_get_ledger(p_company_id uuid, p_account_code text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_account public.nf_accounts;
  v_opening numeric;
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT * INTO v_account FROM public.nf_accounts WHERE company_id = p_company_id AND code = p_account_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:ACCOUNT_NOT_FOUND' USING DETAIL = p_account_code; END IF;

  v_opening := CASE WHEN p_from IS NULL THEN 0 ELSE (
    SELECT COALESCE(sum(l.debit - l.credit), 0)
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code = p_account_code
       AND v.status = 'POSTED' AND v.voucher_date < p_from) END;

  WITH entries AS (
    SELECT v.voucher_date, v.voucher_no, v.narration, l.floor_code, f.qb_class AS floor_name,
           pt.name AS party, l.debit, l.credit, l.line_no,
           v_opening + sum(l.debit - l.credit) OVER (ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
                                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code = p_account_code AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
     ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no
  )
  SELECT jsonb_build_object(
    'account', jsonb_build_object('code', v_account.code, 'name', v_account.name, 'qb_type', v_account.qb_type),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'closing', v_opening + COALESCE((SELECT sum(debit - credit) FROM entries), 0),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'voucher_date', voucher_date, 'voucher_no', voucher_no, 'narration', narration,
                 'floor_code', floor_code, 'floor_name', floor_name, 'party', party,
                 'debit', debit, 'credit', credit, 'running_balance', running_balance) ORDER BY voucher_date, line_no)
               FROM entries), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

COMMIT;
