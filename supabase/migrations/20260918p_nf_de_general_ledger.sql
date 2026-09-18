-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · p · General Ledger (report 2 of 3
-- before the Awami import — Journal done, this is the per-account running
-- balance; Trial Balance is next)
--
-- nf_list_all_accounts(company): every account (all 110 for Awami-shaped
-- seeds), for the ledger's own account picker — nf_list_heads only returns
-- is_head accounts (the cashier's "postable leaf" set), which would hide
-- structural/parent codes and via-accounts a JV can still post straight to
-- (nf_post_voucher validates none of that — only that the code exists).
--
-- nf_get_ledger(company, account_code, from, to): opening balance as of
-- `from` (every POSTED leg on that account dated before it, netted
-- debit-credit — same raw convention the Journal already shows, no sign
-- flip by account-type family, so this stays mathematically consistent
-- with everything already built rather than introducing a second
-- convention), then every entry in range with a running balance, then the
-- closing balance.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.nf_list_all_accounts(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', a.code, 'name', a.name, 'qb_type', a.qb_type, 'parent_code', a.parent_code,
           'is_head', a.is_head, 'via', a.via) ORDER BY a.code), '[]'::jsonb)
    INTO v_out
    FROM public.nf_accounts a
   WHERE a.company_id = p_company_id AND a.active;
  RETURN v_out;
END
$function$;

CREATE FUNCTION public.nf_get_ledger(p_company_id uuid, p_account_code text, p_from date, p_to date)
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

  SELECT COALESCE(sum(l.debit - l.credit), 0) INTO v_opening
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
   WHERE l.company_id = p_company_id AND l.account_code = p_account_code
     AND v.status = 'POSTED' AND (p_from IS NULL OR v.voucher_date < p_from);

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

REVOKE ALL ON FUNCTION public.nf_list_all_accounts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_list_all_accounts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.nf_get_ledger(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_get_ledger(uuid, text, date, date) TO authenticated;

COMMIT;
