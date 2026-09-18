-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · h · transfer_to_bank: null, not 0
--
-- Found post-apply by verify-nf-golden-ui.js, which drives the real screen:
-- typing "300000" into the transfer-to-bank field sent 3000000 to the
-- server. Root cause, confirmed against js/nf/nf-format.js's own grp():
-- "blank stays blank (blank is never a zero — R8)" is an explicit,
-- documented rule this codebase already has — a transfer input showing "0"
-- is a DIFFERENT state from showing nothing, by design. nf_day_json's
-- 'transfer_to_bank' (20260918c) reads it from nf_position_row's trf_bank,
-- which is COALESCE(sum(...), 0) — correct for the POSITION MATH (a
-- non-existent transfer contributes 0 to close_bank), but wrong for this
-- one DISPLAY field, which the old nf_days.transfer_to_bank column always
-- held as NULL until someone actually typed something (both the old and
-- new nf_set_transfers already do NULLIF(p_to_bank, 0) when SAVING it —
-- only the READ side, nf_day_json, was left returning the raw 0). With the
-- field showing "0" instead of blank, the golden UI test's triple-click-
-- select-then-type sequence left that "0" in place and typed the new
-- digits before it, sending 10x the intended amount — and a real cashier
-- clicking into a field that unexpectedly already reads "0" would be at
-- exactly the same risk in a real browser, not just under Puppeteer.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_day_json(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  d public.nf_days;
  v_checks jsonb;
  r record;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  v_checks := public.nf_checks(p_day_id);
  SELECT * INTO r FROM public.nf_position_row(p_day_id);
  RETURN jsonb_build_object(
    'day', jsonb_build_object(
      'id', d.id, 'company_id', d.company_id, 'business_date', d.business_date, 'closing_no', d.closing_no,
      'status', d.status, 'is_first_day', d.is_first_day,
      'typed_open_cash', d.typed_open_cash, 'typed_open_petty', d.typed_open_petty, 'typed_open_bank', d.typed_open_bank,
      'transfer_to_bank', NULLIF(r.trf_bank, 0), 'transfer_to_petty', NULLIF(r.trf_petty, 0),
      'denominations', d.denominations, 'counted_cash', d.counted_cash, 'remarks', d.remarks,
      'prepared_by_name', d.prepared_by_name,
      'submitted_at', d.submitted_at, 'closed_at', d.closed_at,
      'closed_by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = d.company_id AND m.user_id = d.closed_by),
      'variance', d.variance, 'variance_reason', d.variance_reason,
      'last_return_reason', d.last_return_reason, 'reopen_count', d.reopen_count,
      'is_latest', NOT EXISTS (SELECT 1 FROM public.nf_days x WHERE x.company_id = d.company_id AND x.business_date > d.business_date),
      'version', d.version),
    'position', public.nf_position(p_day_id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'side', l.side, 'voucher_no', l.voucher_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code, 'via', l.via,
               'amount', l.amount, 'sort', l.sort, 'version', l.version) ORDER BY l.sort)
        FROM public.nf_lines l JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'pdcs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'direction', p.direction, 'cheque_no', p.cheque_no, 'party', p.party, 'bank', p.bank,
               'due_date', p.due_date, 'amount', p.amount, 'entered_here', p.entered_day_id = p_day_id,
               'version', p.version))
        FROM public.nf_pdcs_as_of(p_day_id) p), '[]'::jsonb),
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
END
$function$;

COMMIT;
