-- ══ NexuFinance: cash deposited in the bank, from a cash box (20261119f) ══
-- APPLIED 19-Nov-2026 as 20261119102542, on the owner's yes (rules suite 81/81, browser checks 38/38 first).
--
-- Owner, 19-Nov: "jab Sharose cash ko bank mai deposit karta hai to us k pass cash payment mai head mai BOP ya bank
-- nahi aa raha". A deposit is a transfer (cash box → bank), not an expense, so the bank was never a head — and the
-- site login had no way to record one at all. Added:
--   * nf_save_deposit(day, paper no., from 'Cash' | 'Petty', amount, slip / reference, description, real date):
--     the caller's OWN box only (a director: either); a CPV (cash out), Dr bank / Cr box; the slip is required and
--     goes into the narration so the duplicate guard can read it; the same deposit by the other login is refused.
--     The screen offers it as "Cash deposited in BOP (bank)" in the Cash payment popup; "Cash withdrawn from BOP
--     (bank)" in the Cash receipt popup uses the existing nf_save_withdrawal.
--   * nf_day_json: the day's transfers (cash ↔ bank, cash box ↔ cash box), each with who entered it — they are not
--     cash-book lines, so they had no place on the sheet. The site box gets only its own (Head Office's remain in
--     "site", date and amount).
--   * NF:DUPLICATE_CHEQUE tells the site box only "Head Office".

CREATE OR REPLACE FUNCTION public.nf_save_deposit(p_day_id uuid, p_voucher_no text, p_from text, p_amount numeric,
  p_reference text, p_description text, p_real_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_ref text := btrim(COALESCE(p_reference, ''));
  v_bank text; v_box text; v_label text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
  v_narr text; v_used public.nf_vouchers; v_dup jsonb;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box(v_company, p_from);
  IF p_from IS NULL OR p_from NOT IN ('Cash', 'Petty') THEN RAISE EXCEPTION 'NF:DEPOSIT_FROM_CASH_OR_PETTY' USING DETAIL = COALESCE(p_from, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF length(regexp_replace(v_ref, '[^A-Za-z0-9]', '', 'g')) < 3 THEN RAISE EXCEPTION 'NF:REFERENCE_REQUIRED'; END IF;
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ '^(S-)?CPV-?$' THEN v_manual := NULL; END IF;

  SELECT code INTO v_bank FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code, COALESCE(via_label, name) INTO v_box, v_label FROM public.nf_accounts WHERE company_id = v_company AND via = p_from;
  IF v_bank IS NULL OR v_box IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''), 'Cash deposited in BOP from ' || v_label);
  -- the slip as letters and digits only, so the duplicate guard reads it as one reference (DS-77123 → DS77123)
  v_narr := v_narr || ' — slip ' || regexp_replace(v_ref, '[^A-Za-z0-9]', '', 'g');
  -- the same deposit, already booked by the other login
  v_dup := public.nf_dup_check(v_company, 'DEP', 'Bank', NULL, p_amount, v_narr, NULL, p_real_date, NULL);
  IF jsonb_array_length(v_dup->'block') > 0 THEN
    RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
  END IF;
  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = 'CPV' LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid()
        THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text
        ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);
    END IF;
  END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY (code = 'P-W') DESC, sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, 'CPV');
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_bank, 'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_box,  'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END $f$;
REVOKE ALL ON FUNCTION public.nf_save_deposit(uuid, text, text, numeric, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_save_deposit(uuid, text, text, numeric, text, text, date) TO authenticated;

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
  v_out jsonb;  -- 20261119e
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  v_checks := public.nf_checks(p_day_id);
  SELECT * INTO r FROM public.nf_position_row(p_day_id);
  v_out := jsonb_build_object(
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
               'party_id', vl.party_id, 'party_name', pt.name,
               'voucher_id', vv.id, 'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL,
               'by_name', bm.display_name, 'by_box', bm.cash_via, 'mine', l.created_by = auth.uid()) ORDER BY l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id
        LEFT JOIN public.nf_members bm ON bm.company_id = l.company_id AND bm.user_id = l.created_by
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'jvs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'number_pending', v.manual_no IS NULL,
               'narration', v.narration, 'version', v.version, 'mine', v.created_by = auth.uid(),
               'by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'by_box', (SELECT m.cash_via FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'total', (SELECT COALESCE(sum(l.debit), 0) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id))
             ORDER BY v.created_at)
        FROM public.nf_vouchers v
       WHERE v.company_id = d.company_id AND v.day_id IS NULL AND v.source = 'JV'
         AND v.status = 'POSTED' AND v.voucher_date = d.business_date), '[]'::jsonb),
    'pdcs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'direction', p.direction, 'cheque_no', p.cheque_no, 'party', p.party, 'bank', p.bank,
               'due_date', p.due_date, 'amount', p.amount, 'entered_here', p.entered_day_id = p_day_id,
               'version', p.version))
        FROM public.nf_pdcs_as_of(p_day_id) p), '[]'::jsonb),
    -- the day's transfers between a cash box and the bank or the other box (they are not cash-book lines) (20261119f)
    'transfers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'voucher_id', v.id, 'line_id', (SELECT g.id FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id AND g.line_no = 1),
               'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'number_pending', v.manual_no IS NULL,
               'narration', v.narration, 'real_date', COALESCE(v.real_date, v.voucher_date), 'version', v.version,
               'amount', (SELECT sum(g.debit) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id),
               'from', (SELECT COALESCE(a.via_label, a.name) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                         WHERE g.voucher_id = v.id AND g.credit > 0 ORDER BY g.line_no LIMIT 1),
               'to', (SELECT COALESCE(a.via_label, a.name) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                       WHERE g.voucher_id = v.id AND g.debit > 0 ORDER BY g.line_no LIMIT 1),
               'by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'by_box', (SELECT m.cash_via FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
               'mine', v.created_by = auth.uid()) ORDER BY v.sort)
        FROM public.nf_vouchers v
       WHERE v.day_id = p_day_id AND v.status = 'POSTED'
         AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                          WHERE g.voucher_id = v.id AND a.via IS NULL)), '[]'::jsonb),
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
  RETURN public._nf_site_view_day(v_out, d.company_id, p_day_id);  -- the site box sees its own (20261119e)
END
$function$;

CREATE OR REPLACE FUNCTION public._nf_site_view_day(p_json jsonb, p_company_id uuid, p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_lines jsonb; v_row jsonb; v_extra jsonb;
BEGIN
  IF public.nf_member_cash_box(p_company_id) IS DISTINCT FROM 'Petty' THEN RETURN p_json; END IF;
  -- his own lines only
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sort')::int), '[]') INTO v_lines FROM jsonb_array_elements(p_json->'lines') x
   WHERE (SELECT v.created_by FROM public.nf_vouchers v WHERE v.id = (x->>'voucher_id')::uuid) = auth.uid();
  -- the Site Cash box only
  SELECT x INTO v_row FROM jsonb_array_elements(p_json->'position'->'rows') x WHERE x->>'via' = 'Petty';
  -- what Head Office did on Site Cash in this sheet: transfers by date and amount, other lines as totals
  SELECT jsonb_build_object(
    'transfers', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', t.rd, 'amount', abs(t.net),
                   'label', CASE WHEN t.net > 0 THEN 'Received from Head Office' ELSE 'Sent to Head Office' END) ORDER BY t.rd)
      FROM (SELECT COALESCE(v.real_date, v.voucher_date) AS rd,
                   (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                     WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
              FROM public.nf_vouchers v
             WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
               AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                                WHERE g.voucher_id = v.id AND a.via IS NULL)
               AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                            WHERE g.voucher_id = v.id AND a.via = 'Petty')) t WHERE t.net <> 0), '[]'),
    'ho_received', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(s.net), 0)) FROM (
        SELECT (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                 WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
          FROM public.nf_vouchers v
         WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
           AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL)) s
       WHERE s.net > 0),
    'ho_paid', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(-sum(s.net), 0)) FROM (
        SELECT (SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                 WHERE g.voucher_id = v.id AND a.via = 'Petty') AS net
          FROM public.nf_vouchers v
         WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND v.created_by IS DISTINCT FROM auth.uid()
           AND EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL)) s
       WHERE s.net < 0)) INTO v_extra;
  RETURN p_json
    || jsonb_build_object(
         'day', (p_json->'day') - ARRAY['typed_open_cash', 'typed_open_bank', 'transfer_to_bank', 'counted_cash', 'denominations',
                                        'variance', 'variance_reason', 'remarks', 'last_return_reason'],
         'lines', v_lines,
         'jvs', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'jvs') x WHERE (x->>'mine')::boolean), '[]'),
         'transfers', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(p_json->'transfers') x WHERE (x->>'mine')::boolean), '[]'),  -- his own (20261119f)
         'pdcs', '[]'::jsonb, 'checks', '[]'::jsonb, 'balanced', true,
         'position', jsonb_build_object(
            'rows', CASE WHEN v_row IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_row) END,
            'total', COALESCE(v_row, '{}'::jsonb) - 'via' - 'code' - 'label',
            'net', COALESCE((v_row->>'received')::numeric, 0) - COALESCE((v_row->>'paid')::numeric, 0),
            'receipts', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'IN'),
            'payments', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'OUT')),
         'site', v_extra);
END $function$;

CREATE OR REPLACE FUNCTION public.nf_save_withdrawal(p_day_id uuid, p_voucher_no text, p_from text, p_to text, p_amount numeric, p_cheque_no text, p_description text, p_real_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_manual  text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_cheque  text := regexp_replace(COALESCE(p_cheque_no, ''), '[^0-9]', '', 'g');
  v_bank text; v_to text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
  v_narr text; v_used public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box(v_company, p_to);  -- own cash box (20261118i)
  DECLARE v_dup jsonb; BEGIN  -- 20261119b
    v_dup := public.nf_dup_check(v_company, 'WDL', 'Bank', NULL, p_amount,
      COALESCE(p_description, '') || ' chq #' || regexp_replace(COALESCE(p_cheque_no, ''), '[^0-9]', '', 'g'), NULL, p_real_date, NULL);
    IF jsonb_array_length(v_dup->'block') > 0 THEN
      RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
    END IF;
  END;
  IF p_from IS DISTINCT FROM 'Bank' THEN RAISE EXCEPTION 'NF:WITHDRAWAL_FROM_BANK_ONLY' USING DETAIL = COALESCE(p_from, '(none)'); END IF;
  IF p_to IS NULL OR p_to NOT IN ('Cash','Petty') THEN RAISE EXCEPTION 'NF:WITHDRAWAL_TO_CASH_OR_PETTY' USING DETAIL = COALESCE(p_to, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF length(v_cheque) < 4 THEN RAISE EXCEPTION 'NF:CHEQUE_REQUIRED'; END IF;
  -- the day the cheque was really cashed, not the open day's date
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ '^BPV-?$' THEN v_manual := NULL; END IF;

  SELECT code INTO v_bank FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code INTO v_to   FROM public.nf_accounts WHERE company_id = v_company AND via = p_to;
  IF v_bank IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  -- a cheque is cashed once: refuse a second withdrawal on the same cheque
  SELECT v.* INTO v_used FROM public.nf_vouchers v
   WHERE v.company_id = v_company
     AND regexp_replace(COALESCE(v.narration, ''), '[^0-9#]', '', 'g') ~ ('#' || v_cheque || '($|[^0-9])')
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs a WHERE a.voucher_id = v.id AND a.account_code = v_bank AND a.credit > 0)
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs b JOIN public.nf_accounts x
                   ON x.company_id = b.company_id AND x.code = b.account_code
                  WHERE b.voucher_id = v.id AND b.debit > 0 AND x.via IN ('Cash','Petty'))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'NF:DUPLICATE_CHEQUE'
      USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid()
                           THEN json_build_object('cheque', v_cheque, 'by', 'Head Office', 'hidden', true)::text  -- 20261119f
                           ELSE json_build_object('cheque', v_cheque, 'voucher', COALESCE(v_used.manual_no, v_used.voucher_no))::text END);
  END IF;

  IF v_manual IS NOT NULL AND EXISTS (SELECT 1 FROM public.nf_vouchers x
       WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = 'BPV') THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''),
                     CASE p_to WHEN 'Cash' THEN 'Cash withdrawn from bank into cash in hand'
                               ELSE 'Cash withdrawn from bank into the site cash box' END);
  IF position(v_cheque IN regexp_replace(v_narr, '[^0-9]', '', 'g')) = 0 THEN
    v_narr := v_narr || ' — BOP chq #' || v_cheque;
  END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, 'BPV');
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to,   'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_bank, 'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END
$function$;
