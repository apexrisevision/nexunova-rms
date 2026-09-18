-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · u · nf_get_ledger: return each
-- leg's own memo, not just the voucher's narration
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Awami now holds real
-- data, so per the conditional auto-apply rule's own stated sunset
-- condition, and separately because this changes the behaviour of an
-- existing function the Ledger screen already calls (one of the
-- standing "always ask" conditions on its own), this stops for a
-- decision rather than applying itself.
--
-- Found reviewing the real Awami PDFs: every leg imported from
-- QuickBooks history carries its own real, distinct memo (checked
-- directly against nf_voucher_legs — e.g. "Token 102 - unit GF-129" —
-- nothing was lost), but nf_get_ledger never selected l.memo at all, so
-- the Ledger screen had nothing but the voucher's narration to show —
-- which for an imported voucher is the same "Imported from QuickBooks
-- history" marker on every single line. The General Journal's own
-- RPC (nf_get_journal) already returned memo; this one never did — a
-- narrower gap than the frontend fix in nf-journal.js/nf-ledger.js
-- alone can close, since the field was never sent from the server at
-- all for the Ledger specifically.
--
-- Only change: l.memo added to the entries CTE and the returned
-- jsonb_build_object, in the same position pattern nf_get_journal
-- already uses. Nothing else in this function changes.
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
    SELECT v.voucher_date, v.voucher_no, v.narration, l.memo, l.floor_code, f.qb_class AS floor_name,
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
                 'voucher_date', voucher_date, 'voucher_no', voucher_no, 'narration', narration, 'memo', memo,
                 'floor_code', floor_code, 'floor_name', floor_name, 'party', party,
                 'debit', debit, 'credit', credit, 'running_balance', running_balance) ORDER BY voucher_date, line_no)
               FROM entries), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$function$;

COMMIT;
