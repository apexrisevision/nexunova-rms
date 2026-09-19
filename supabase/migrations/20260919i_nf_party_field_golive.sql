-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19i · Party field for the
-- daily-closing entry rows (go-live blocker #1)
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Not covered by the read-
-- only-additive auto-apply carve-out: both functions already exist and
-- other code already calls them; this changes their OUTPUT shape (adds
-- fields, changes nothing existing), one of the standing always-ask
-- conditions on its own.
--
-- Found during the go-live readiness pass: the backend already supports
-- an unregistered party (nf_save_line's own p_party_name resolve-or-
-- create path, and nf_voucher_legs_guard's requires_party enforcement),
-- but the daily-closing SCREEN has no party input field at all, and no
-- way to see one it already has — because neither nf_day_json (the
-- day's own read RPC) nor nf_list_heads (the account picker's own read
-- RPC) ever returned that information to the client. A token receipt
-- from an unregistered customer is refused (NF:PARTY_REQUIRED, raised
-- by the nf_voucher_legs_guard trigger) with no field on the screen to
-- fix it from — confirmed by reading nf_save_line's real body, not
-- assumed from the symptom.
--
-- nf_lines (the view nf_day_json already reads from) confirmed to be a
-- VIEW directly over nf_voucher_legs/nf_vouchers, not a separate table
-- — checked with pg_get_viewdef before touching anything, since a wrong
-- assumption here would have meant chasing the wrong bug entirely. Its
-- own SELECT list has no party columns, so nf_day_json is extended to
-- join nf_voucher_legs/nf_parties directly using l.id (nf_lines.id IS
-- the head leg's own nf_voucher_legs.id, per the view's own definition
-- — "hl.id" is the first column), rather than modifying the view.
--
-- Two changes only:
--   nf_day_json — each line now also carries party_id/party_name.
--   nf_list_heads — each account now also carries requires_party.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_day_json(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
               'amount', l.amount, 'sort', l.sort, 'version', l.version,
               'party_id', vl.party_id, 'party_name', pt.name) ORDER BY l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id
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

CREATE OR REPLACE FUNCTION public.nf_list_heads(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'requires_party', a.requires_party) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active), '[]'::jsonb);
END
$function$;

COMMIT;
