-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · m · General Journal (report 2 of 3
-- before the Awami import — Journal, Ledger, Trial Balance are the
-- instruments the import itself gets verified with, so they come first,
-- against the golden-day fixture; real Awami data follows once imported).
--
-- nf_get_journal(company, from, to): every POSTED voucher in date order,
-- each leg with its account name, floor, and party (when the account
-- requires one) — the same voucher/leg data nf_post_voucher writes and
-- nf_lines reads, just company-wide instead of scoped to one day, and
-- with every leg shown instead of only the via-having pairs nf_lines
-- filters to. Read-only, no new tables.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.nf_get_journal(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0)
    INTO v_total_debit, v_total_credit
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
   WHERE v.company_id = p_company_id AND v.status = 'POSTED'
     AND (p_from IS NULL OR v.voucher_date >= p_from)
     AND (p_to   IS NULL OR v.voucher_date <= p_to);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'vouchers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
               'narration', v.narration,
               'legs', (SELECT jsonb_agg(jsonb_build_object(
                                 'account_code', l.account_code, 'account_name', a.name,
                                 'floor_code', l.floor_code, 'floor_name', f.qb_class,
                                 'party', p.name, 'debit', l.debit, 'credit', l.credit,
                                 'memo', l.memo) ORDER BY l.line_no)
                          FROM public.nf_voucher_legs l
                          JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                          JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
                          LEFT JOIN public.nf_parties p ON p.company_id = l.company_id AND p.id = l.party_id
                         WHERE l.voucher_id = v.id))
             ORDER BY v.voucher_date, v.sort, v.created_at)
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.status = 'POSTED'
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

-- A brand-new function defaults to PUBLIC EXECUTE in Postgres unless
-- revoked — see 20260918n for the wider finding (every nf_ function
-- added since 20260916c's one-time lockdown sweep inherited that same
-- open default). Locking this one down explicitly here rather than
-- leaving it to also be found open.
REVOKE ALL ON FUNCTION public.nf_get_journal(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_get_journal(uuid, date, date) TO authenticated;

COMMIT;
