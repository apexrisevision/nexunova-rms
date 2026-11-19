-- ══ NexuFinance: the site cash box sees its own closing only (20261119e) ══
-- NOT APPLIED until the owner says yes.
--
-- Brief of 19-Nov (closes handover item #8). A member whose cash box is Site Cash (via Petty) — today Sharose:
--   * TABLES (row security): reads only the vouchers and legs HE entered; no direct read of day sheets, PDCs,
--     the audit trail, the combined closings or the retired site-closing tables. The nf_lines view follows
--     (security_invoker). Master data stays readable: accounts, floors, members, settings and the party list
--     (the party picker needs the names; no amounts are on it).
--   * RPCs: nf_day_json gives him his own lines and JVs, the Site Cash row only, no checks / PDCs / remarks /
--     Head Office figures, plus "site": transfers from / to Head Office (date and amount) and the lines Head
--     Office entered on Site Cash as two totals. nf_list_days gives Site Cash totals only; nf_jv_list his own;
--     the printed day report, the unallocated tokens and every retired nf_site_* function are Head Office only.
--   * nf_dup_check, NF:DUPLICATE_ENTRY / NF:DUPLICATE_VOUCHER / NF:NOT_YOUR_ENTRY tell him only
--     "entered by Head Office" — no voucher number, date, reference, amount or name.
--   * nf_day_report (his WhatsApp report, Site only): Head Office's lines on Site Cash as amount only.
-- Head office and the director see everything as before.

CREATE OR REPLACE FUNCTION public._nf_site_view_day(p_json jsonb, p_company_id uuid, p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
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
         'pdcs', '[]'::jsonb, 'checks', '[]'::jsonb, 'balanced', true,
         'position', jsonb_build_object(
            'rows', CASE WHEN v_row IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_row) END,
            'total', COALESCE(v_row, '{}'::jsonb) - 'via' - 'code' - 'label',
            'net', COALESCE((v_row->>'received')::numeric, 0) - COALESCE((v_row->>'paid')::numeric, 0),
            'receipts', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'IN'),
            'payments', (SELECT count(*) FROM jsonb_array_elements(v_lines) x WHERE x->>'side' = 'OUT')),
         'site', v_extra);
END $f$;
REVOKE ALL ON FUNCTION public._nf_site_view_day(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- row security: the site cash box reads only what it entered, and none of the day sheets, PDCs or the audit trail.
-- The policies run as the signed-in role, so it may ask its own cash box (the answer is only ever its own).
GRANT EXECUTE ON FUNCTION public.nf_member_cash_box(uuid) TO authenticated;
ALTER POLICY nf_vouchers_read ON public.nf_vouchers USING (public.nf_is_member(company_id, false)
  AND (public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty' OR created_by = auth.uid()));
ALTER POLICY nf_voucher_legs_read ON public.nf_voucher_legs USING (public.nf_is_member(company_id, false)
  AND (public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty'
       OR EXISTS (SELECT 1 FROM public.nf_vouchers v WHERE v.id = voucher_id AND v.created_by = auth.uid())));
ALTER POLICY nf_days_read ON public.nf_days USING (public.nf_is_member(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_pdcs_read ON public.nf_pdcs USING (public.nf_is_member(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_audit_read ON public.nf_audit USING (public.nf_is_member(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_combined_closings_read ON public.nf_combined_closings USING (public.nf_site_reader(company_id, false) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_site_days_read ON public.nf_site_days USING (public.nf_site_reader(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');
ALTER POLICY nf_site_lines_read ON public.nf_site_lines USING (public.nf_site_reader(company_id, true) AND public.nf_member_cash_box(company_id) IS DISTINCT FROM 'Petty');

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
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
  RETURN public._nf_site_view_day(v_out, d.company_id, p_day_id);  -- the site box sees its own (20261119e)
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_list_days(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', d.id, 'business_date', d.business_date, 'closing_no', d.closing_no,
                            'status', d.status, 'close_total', CASE WHEN public.nf_member_cash_box(p_company_id) = 'Petty' THEN d.close_petty ELSE d.close_cash + d.close_petty + d.close_bank END,
                            'variance', CASE WHEN public.nf_member_cash_box(p_company_id) = 'Petty' THEN NULL ELSE d.variance END) ORDER BY d.business_date DESC)
                     FROM public.nf_days d
                    WHERE d.company_id = p_company_id
                      AND (p_from IS NULL OR d.business_date >= p_from)
                      AND (p_to   IS NULL OR d.business_date <= p_to)), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_jv_list(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    -- The system number is given on save now (docs/PLAN.md §45); nothing for
    -- the screen to suggest. Kept, NULL, for any caller still reading it.
    'next_voucher_no', NULL,
    'vouchers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'voucher_date', v.voucher_date,
               'narration', v.narration, 'version', v.version,
               'exported', EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b WHERE b.voucher_id = v.id),
               'total', (SELECT COALESCE(sum(l.debit), 0) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id),
               'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                          'floor_code', l.floor_code, 'party', pt.name,
                          'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                        FROM public.nf_voucher_legs l
                        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                       WHERE l.voucher_id = v.id), '[]'::jsonb))
             ORDER BY v.voucher_date DESC, v.voucher_no DESC)
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.day_id IS NULL AND v.status = 'POSTED'
         AND v.source = 'JV'
         AND (public.nf_member_cash_box(p_company_id) IS DISTINCT FROM 'Petty' OR v.created_by = auth.uid())  -- 20261119e
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_report_day(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  s public.nf_settings;
  pos jsonb;
  v_checks jsonb;
  v_counted boolean;
  v_diff numeric;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(v_company);  -- not the site cash box (20261119e)
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  SELECT * INTO s FROM public.nf_settings WHERE company_id = v_company;
  IF s.company_id IS NULL THEN RAISE EXCEPTION 'NF:NOT_SEEDED'; END IF;
  pos := public.nf_position(p_day_id);
  v_checks := public.nf_checks(p_day_id);
  v_counted := d.denominations IS NOT NULL;
  v_diff := CASE WHEN v_counted THEN (SELECT (x->>'closing')::numeric FROM jsonb_array_elements(pos->'rows') x
                                      WHERE x->>'via' = 'Cash') - d.counted_cash END;

  RETURN jsonb_build_object(
    'business_date', d.business_date,
    'day_name',      to_char(d.business_date, 'FMDay'),
    'closing_no',    d.closing_no,
    'status',        d.status,
    'balanced',      jsonb_array_length(v_checks) = 0,
    'checks',        v_checks,
    'company_line',  s.company_line,
    'report_title',  s.report_title,
    'mark',          s.mark,
    'accounts', (SELECT jsonb_agg(jsonb_build_object('via', x->>'via', 'label', x->>'label',
                                                     'opening', (x->>'opening')::numeric,
                                                     'received', (x->>'received')::numeric,
                                                     'paid', (x->>'paid')::numeric,
                                                     'transfers', (x->>'transfers')::numeric,
                                                     'closing', (x->>'closing')::numeric) ORDER BY o)
                   FROM jsonb_array_elements(pos->'rows') WITH ORDINALITY AS t(x, o)),
    'total_open',  (pos->'total'->>'opening')::numeric,
    'total_close', (pos->'total'->>'closing')::numeric,
    'total_in',    (pos->'total'->>'received')::numeric,
    'total_out',   (pos->'total'->>'paid')::numeric,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'side', l.side, 'voucher_no', l.voucher_no, 'manual_no', vv.manual_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code,
               'floor_name', f.qb_class, 'via', l.via,
               'amount', l.amount, 'sort', l.sort) ORDER BY l.side, l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        JOIN public.nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'other_balances', public.nf_other_balances(v_company, d.business_date),
    'in_categories',  public.nf_report_groups(p_day_id, 'IN'),
    'out_categories', public.nf_report_groups(p_day_id, 'OUT'),
    'large_threshold', s.large_payment_threshold,
    'large_payments', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'description', l.description,
                'category', public.nf_category(v_company, 'OUT', l.head_code),
                'by', CASE WHEN l.via = 'Bank' THEN 'bank' ELSE 'cash' END,
                'amount', l.amount) ORDER BY l.amount DESC, l.sort)
         FROM public.nf_lines l
        WHERE l.day_id = p_day_id AND l.side = 'OUT' AND l.amount >= s.large_payment_threshold), '[]'::jsonb),
    'counted', v_counted,
    'count_diff', v_diff,
    'variance_reason', d.variance_reason,
    'negatives', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', x->>'label', 'amount', (x->>'closing')::numeric))
                             FROM jsonb_array_elements(pos->'rows') x WHERE (x->>'closing')::numeric < 0), '[]'::jsonb),
    'transfer_to_bank', (SELECT (x->>'transfers')::numeric FROM jsonb_array_elements(pos->'rows') x WHERE x->>'via' = 'Bank'),
    'bank_label', (SELECT via_label FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank'),
    'other_issue_count', (SELECT count(*) FROM jsonb_array_elements(v_checks) c
                           WHERE c->>'key' NOT IN ('negative','not_counted','count_mismatch')),
    'pdc_due_days', s.pdc_due_days,
    'pdc_due', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('direction', p.direction, 'amount', p.amount, 'party', p.party,
                                           'due_date', p.due_date)
                        ORDER BY CASE p.direction WHEN 'RECEIVED' THEN 1 ELSE 2 END, p.created_at, p.id)
         FROM public.nf_pdcs_as_of(p_day_id) p
        WHERE p.due_date BETWEEN d.business_date AND d.business_date + s.pdc_due_days), '[]'::jsonb),
    'pdc_pending', jsonb_build_object(
       'received', (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'RECEIVED'),
       'issued',   (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'ISSUED')),
    'prepared_by_name', d.prepared_by_name);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_unallocated_tokens(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN public._nf_unallocated_tokens_body(p_company_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  PERFORM public._nf_site_accept_one(l, p_head_code, p_party_name);
  UPDATE public.nf_site_lines SET version = version + 1, updated_at = now() WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_accept_new(p_site_day_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; l public.nf_site_lines;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  FOR l IN SELECT * FROM public.nf_site_lines
            WHERE site_day_id = d.id AND match_status = 'NEW' AND resolved_by IS NULL AND posted_voucher_id IS NULL
            ORDER BY (side = 'IN') DESC, line_no FOR UPDATE LOOP
    PERFORM public._nf_site_accept_one(l, NULL, NULL);
    UPDATE public.nf_site_lines SET version = version + 1, updated_at = now() WHERE id = l.id;
  END LOOP;
  UPDATE public.nf_site_days SET version = version + 1, updated_at = now() WHERE id = d.id;
  RETURN public.nf_site_review(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_delete_line(p_line_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; d public.nf_site_days;
BEGIN
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(l.company_id, ARRAY['site']);
  PERFORM public.nf_assert_head_office(l.company_id);  -- not the site cash box (20261119e)
  SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, l.version);
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;
  IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
  IF l.resolved_by IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
  DELETE FROM public.nf_site_lines WHERE id = l.id;
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(l.company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  SELECT id INTO v_id FROM public.nf_site_days WHERE company_id = p_company_id AND business_date = p_business_date;
  IF v_id IS NULL THEN
    -- no day yet: say what its opening would be, so the screen can show it
    RETURN jsonb_build_object('exists', false, 'business_date', p_business_date,
      'has_first_day', EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = p_company_id AND is_first_day),
      'opening', public._nf_site_book(p_company_id, p_business_date));
  END IF;
  RETURN jsonb_build_object('exists', true) || public.nf_site_day_json(v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; v public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id AND company_id = l.company_id AND status = 'POSTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  UPDATE public.nf_site_lines
     SET match_status = 'LINKED', matched_voucher_id = v.id, resolved_by = auth.uid(), resolved_at = now(),
         resolution = COALESCE(NULLIF(btrim(p_reason), ''), 'Linked by HO to ' || COALESCE(v.manual_no, v.voucher_no)),
         version = version + 1, updated_at = now()
   WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_list_days(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'business_date', d.business_date, 'status', d.status, 'version', d.version,
            'counted_cash', d.counted_cash, 'book_closing', d.book_closing, 'variance', d.variance,
            'returned_reason', d.returned_reason, 'submitted_at', d.submitted_at,
            'lines', (SELECT count(*) FROM public.nf_site_lines l WHERE l.site_day_id = d.id),
            'open_issues', (SELECT count(*) FROM public.nf_site_lines l WHERE l.site_day_id = d.id
                              AND l.match_status IN ('CONFLICT','POSSIBLE')))
          ORDER BY d.business_date DESC)
     FROM public.nf_site_days d
    WHERE d.company_id = p_company_id
      AND (p_from IS NULL OR d.business_date >= p_from) AND (p_to IS NULL OR d.business_date <= p_to)), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_list_heads(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'requires_party', a.requires_party) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active AND a.via IS NULL), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_list_units(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit_no, 'floor', u.floor_label)
                                    ORDER BY u.floor_no, u.unit_no)
                     FROM public.units u JOIN public.projects p ON p.id = u.project_id
                    WHERE p.company_id = p_company_id), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; v public.nf_vouchers; c_cash text; c_petty text; c_bank text;
        cash_leg boolean; bank_leg boolean; v_amt numeric; v_prop jsonb; v_head text;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id AND company_id = l.company_id AND status = 'POSTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  SELECT code INTO c_cash  FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Cash';
  SELECT code INTO c_petty FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Petty';
  SELECT code INTO c_bank  FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Bank';
  SELECT COALESCE(sum(debit), 0), bool_or(account_code = c_cash), bool_or(account_code = c_bank)
    INTO v_amt, cash_leg, bank_leg FROM public.nf_voucher_legs WHERE voucher_id = v.id;
  IF v_amt <> l.amount THEN
    RAISE EXCEPTION 'NF:LINK_AMOUNT_DIFFERS' USING DETAIL = json_build_object('site', l.amount, 'ho', v_amt)::text;
  END IF;
  SELECT account_code INTO v_head FROM public.nf_voucher_legs g JOIN public.nf_accounts a
    ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL LIMIT 1;
  v_prop := CASE
    WHEN l.via = 'SITE_CASH' AND l.head_code = c_bank AND cash_leg
      THEN jsonb_build_object('action', 'transfer', 'amount', l.amount,
             'from', CASE l.side WHEN 'IN' THEN 'Cash' ELSE 'Petty' END, 'to', CASE l.side WHEN 'IN' THEN 'Petty' ELSE 'Cash' END)
    WHEN l.via = 'SITE_CASH' AND l.head_code <> c_bank AND cash_leg AND v_head IS NOT NULL
      THEN jsonb_build_object('action', 'reroute', 'from', 'Cash', 'to', 'Petty')
    ELSE jsonb_build_object('action', 'link') END || jsonb_build_object('voucher_id', v.id);
  UPDATE public.nf_site_lines
     SET match_status = 'DUPLICATE', matched_voucher_id = v.id, proposal = v_prop, ho_head_code = v_head,
         match_reason = 'Marked duplicate of HO voucher ' || COALESCE(v.manual_no, v.voucher_no) || ' by HO',
         matched_at = now(), version = version + 1, updated_at = now()
   WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_match(p_site_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  PERFORM public._nf_site_match(d.id);
  RETURN public.nf_site_review(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; d date;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  UPDATE public.nf_site_lines
     SET match_status = 'REJECTED', resolved_by = auth.uid(), resolved_at = now(), resolution = btrim(p_reason),
         version = version + 1, updated_at = now()
   WHERE id = l.id;
  SELECT business_date INTO d FROM public.nf_site_days WHERE id = l.site_day_id;
  PERFORM public._nf_site_assert_not_negative(l.company_id, d);
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_cc text;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['site','director']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);

  IF d.status = 'SUBMITTED' THEN
    -- withdrawing his own submission is the site accountant's act; HO returns instead
    PERFORM public.nf_require_role(d.company_id, ARRAY['site']);
    IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
                AND business_date > d.business_date AND status IN ('SUBMITTED','MERGED')) THEN
      RAISE EXCEPTION 'NF:SITE_LATER_DAY_SUBMITTED' USING HINT = 'Reopen the latest submitted day first.';
    END IF;
    UPDATE public.nf_site_days
       SET status = 'DRAFT', reopen_reason = NULLIF(btrim(p_reason), ''),
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = d.id;
  ELSIF d.status = 'MERGED' THEN
    PERFORM public.nf_require_role(d.company_id, ARRAY['director']);
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
    SELECT status INTO v_cc FROM public.nf_combined_closings WHERE id = d.combined_closing_id;
    IF v_cc = 'CLOSED' THEN RAISE EXCEPTION 'NF:SITE_COMBINED_CLOSED'; END IF;
    IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
                AND business_date > d.business_date AND status = 'MERGED') THEN
      RAISE EXCEPTION 'NF:SITE_LATER_DAY_MERGED';
    END IF;
    UPDATE public.nf_site_days
       SET status = 'RETURNED', reopen_reason = btrim(p_reason), returned_reason = btrim(p_reason),
           merged_by = NULL, merged_at = NULL,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = d.id;
  ELSE
    RAISE EXCEPTION 'NF:SITE_NOTHING_TO_REOPEN' USING DETAIL = d.status;
  END IF;
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
              AND business_date > d.business_date AND status = 'MERGED') THEN
    RAISE EXCEPTION 'NF:SITE_LATER_DAY_MERGED';
  END IF;
  UPDATE public.nf_site_days
     SET status = 'RETURNED', returned_reason = btrim(p_reason), returned_by = auth.uid(), returned_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE id = d.id;
  -- a later submitted day opens from this one's closing, which may now change
  UPDATE public.nf_site_days
     SET status = 'RETURNED', returned_reason = 'Returned with ' || to_char(d.business_date, 'DD-Mon') || ': ' || btrim(p_reason),
         returned_by = auth.uid(), returned_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE company_id = d.company_id AND business_date > d.business_date AND status = 'SUBMITTED';
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_site_days;
  l public.nf_site_lines;
  v_head public.nf_accounts;
  v_id uuid;
  v_doc text := NULLIF(upper(btrim(p_doc_no)), '');
  v_other date;
BEGIN
  -- only the site accountant: the site record stays exactly as he entered it.
  -- HO returns the day with a reason, or corrects head/party on the HO
  -- voucher when it accepts the line.
  PERFORM public.nf_require_role(p_company_id, ARRAY['site']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_via  IS NULL OR p_via  NOT IN ('SITE_CASH','BANK') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = COALESCE(p_via, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF NULLIF(btrim(p_head_code), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_HEAD_REQUIRED' USING HINT = 'Choose what this money was for.';
  END IF;
  -- a head HO uses; or, for a site-cash line only, the bank itself: "Bank to Cash"
  -- (IN, a withdrawal into the box) or "Cash to Bank" (OUT, a deposit)
  SELECT * INTO v_head FROM public.nf_accounts
   WHERE company_id = p_company_id AND code = btrim(COALESCE(p_head_code, '')) AND active
     AND ((is_head AND via IS NULL) OR (via = 'Bank' AND p_via = 'SITE_CASH'));
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED' USING DETAIL = COALESCE(p_head_code, '(none)'); END IF;
  IF v_head.code = '21100' AND p_token_no IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_TOKEN_NO_REQUIRED' USING HINT = 'Token money needs the token number.';
  END IF;
  -- every line carries its paper number and a name (owner, 19-Nov). A paper number may still
  -- repeat on lines of the SAME day (one voucher, two heads -> n/1, n/2 when posted).
  IF NULLIF(btrim(p_doc_no), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_DOC_NO_REQUIRED' USING HINT = 'Write the receipt or voucher number from the book.';
  END IF;
  IF NULLIF(btrim(p_party_name), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_PARTY_REQUIRED' USING HINT = 'Write who the money came from or went to.';
  END IF;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, l.version);
    IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
    IF l.resolved_by IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
    SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
    IF d.business_date <> p_business_date THEN RAISE EXCEPTION 'NF:SITE_LINE_OTHER_DAY'; END IF;
  ELSE
    d := public._nf_site_day_for(p_company_id, p_business_date);
  END IF;
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  -- a paper receipt / voucher number belongs to one day: several lines of that
  -- day may carry it (one voucher, two heads), another day may not
  IF v_doc IS NOT NULL THEN
    SELECT sd.business_date INTO v_other
      FROM public.nf_site_lines x JOIN public.nf_site_days sd ON sd.id = x.site_day_id
     WHERE x.company_id = p_company_id AND x.side = p_side AND upper(btrim(x.doc_no)) = v_doc
       AND x.site_day_id <> d.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_DOC_NO'
        USING DETAIL = json_build_object('doc_no', btrim(p_doc_no), 'side', p_side, 'used_on', v_other)::text;
    END IF;
  END IF;

  IF p_line_id IS NULL THEN
    INSERT INTO public.nf_site_lines (company_id, site_day_id, line_no, side, doc_no, party_name, unit_codes,
                                      token_no, head_code, via, amount, bank_ref, remarks, attachment_url,
                                      created_by, updated_by)
    VALUES (p_company_id, d.id,
            (SELECT COALESCE(max(line_no), 0) + 1 FROM public.nf_site_lines WHERE site_day_id = d.id),
            p_side, NULLIF(btrim(p_doc_no), ''), NULLIF(btrim(p_party_name), ''), NULLIF(btrim(p_unit_codes), ''),
            p_token_no, v_head.code, p_via, p_amount, NULLIF(btrim(p_bank_ref), ''), NULLIF(btrim(p_remarks), ''),
            NULLIF(btrim(p_attachment_url), ''), auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    -- a changed line is a new claim: whatever matching said about it is void
    UPDATE public.nf_site_lines
       SET side = p_side, doc_no = NULLIF(btrim(p_doc_no), ''), party_name = NULLIF(btrim(p_party_name), ''),
           unit_codes = NULLIF(btrim(p_unit_codes), ''), token_no = p_token_no, head_code = v_head.code,
           via = p_via, amount = p_amount, bank_ref = NULLIF(btrim(p_bank_ref), ''),
           remarks = NULLIF(btrim(p_remarks), ''), attachment_url = NULLIF(btrim(p_attachment_url), ''),
           match_status = 'NEW', matched_voucher_id = NULL, match_reason = NULL, proposal = NULL,
           ho_head_code = NULL, matched_at = NULL,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = l.id;
  END IF;

  -- the day's version moves with its lines, so a screen that has not seen a
  -- line cannot submit the day
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(p_company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_business_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:SITE_FUTURE_DATE'; END IF;
  PERFORM public.nf_check_amount(p_opening_cash, 'opening_cash', true);
  IF p_opening_cash < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || p_company_id::text));
  IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'NF:SITE_ALREADY_STARTED';
  END IF;
  INSERT INTO public.nf_site_days (company_id, business_date, is_first_day, opening_cash, created_by, updated_by)
  VALUES (p_company_id, p_business_date, true, p_opening_cash, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN public.nf_site_day_json(v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_prev public.nf_site_days; v_counted numeric; v_book numeric;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['site']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  SELECT * INTO v_prev FROM public.nf_site_days
   WHERE company_id = d.company_id AND business_date < d.business_date ORDER BY business_date DESC LIMIT 1;
  IF FOUND AND v_prev.status NOT IN ('SUBMITTED','MERGED') THEN
    RAISE EXCEPTION 'NF:SITE_PREVIOUS_DAY_OPEN' USING DETAIL = json_build_object('date', v_prev.business_date, 'status', v_prev.status)::text;
  END IF;

  IF p_denominations IS NOT NULL THEN
    v_counted := public.nf_count_total(p_denominations);
    IF p_counted_cash IS NOT NULL AND p_counted_cash <> v_counted THEN
      RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = json_build_object('typed', p_counted_cash, 'notes_add_up_to', v_counted)::text;
    END IF;
  ELSE
    v_counted := p_counted_cash;
  END IF;
  IF v_counted IS NULL THEN RAISE EXCEPTION 'NF:SITE_COUNT_REQUIRED' USING HINT = 'Count the cash in the box before submitting.'; END IF;
  PERFORM public.nf_check_amount(v_counted, 'counted_cash', true);

  v_book := public._nf_site_book(d.company_id, d.business_date);
  IF v_counted <> v_book AND NULLIF(btrim(p_variance_reason), '') IS NULL THEN
    RAISE EXCEPTION 'NF:VARIANCE_REASON_REQUIRED'
      USING DETAIL = json_build_object('book', v_book, 'counted', v_counted, 'variance', v_counted - v_book)::text;
  END IF;

  UPDATE public.nf_site_days
     SET status = 'SUBMITTED', counted_cash = v_counted, denominations = p_denominations,
         book_closing = v_book, variance = v_counted - v_book,
         variance_reason = CASE WHEN v_counted <> v_book THEN btrim(p_variance_reason) END,
         submitted_by = auth.uid(), submitted_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE id = d.id;
  PERFORM public._nf_site_match(d.id);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_dup_check(p_company_id uuid, p_kind text, p_via text, p_head text, p_amount numeric, p_description text, p_party_name text, p_date date, p_exclude uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_bank text; v_chqs text[]; v_refs text[]; v_toks int[]; v_party text;
  v_bankish boolean := p_via = 'Bank' OR p_kind IN ('WDL', 'DEP');
  v_block jsonb := '[]'; v_warn jsonb := '[]'; h record; v_key text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  SELECT code INTO c_bank FROM public.nf_accounts WHERE company_id = p_company_id AND via = 'Bank';
  v_chqs := public._nf_cheques(p_description);
  SELECT COALESCE(array_agg(DISTINCT upper(x[1])), '{}') INTO v_refs
    FROM regexp_matches(COALESCE(p_description, ''), '(?:ref|raast|tt|ibft|slip|stan|tid|trx|txn)\s*(?:no\.?)?\s*[:#]?\s*([A-Za-z0-9]{6,})', 'gi') x;
  v_toks := CASE WHEN p_head = '21100' THEN public._nf_receipt_nos(p_description) ELSE '{}' END;
  v_party := public._nf_letters(p_party_name);

  FOR h IN
    WITH v0 AS (
      SELECT v.id, COALESCE(v.manual_no, v.voucher_no) AS no, v.narration, v.created_by,
             COALESCE(v.real_date, v.voucher_date) AS rd
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.status = 'POSTED' AND v.source = 'DAY'
         AND v.id IS DISTINCT FROM p_exclude AND v.created_by IS DISTINCT FROM auth.uid()
         AND COALESCE(v.real_date, v.voucher_date) BETWEEN p_date - 3 AND p_date + 3)
    SELECT v0.*, (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = p_company_id AND m.user_id = v0.created_by) AS by_name,
           COALESCE(sum(g.debit), 0) AS amt,
           COALESCE(sum(g.debit)  FILTER (WHERE g.account_code = c_bank), 0) AS bank_dr,
           COALESCE(sum(g.credit) FILTER (WHERE g.account_code = c_bank), 0) AS bank_cr,
           COALESCE(sum(g.debit)  FILTER (WHERE a.via IS NOT NULL), 0) AS via_dr,
           COALESCE(sum(g.credit) FILTER (WHERE a.via IS NOT NULL), 0) AS via_cr,
           count(*) FILTER (WHERE a.via IS NULL) AS nonvia,
           (array_agg(g.account_code ORDER BY g.line_no) FILTER (WHERE a.via IS NULL))[1] AS head,
           bool_or(g.account_code = '21100') AS has_token,
           string_agg(p.name, ' ') AS parties,
           public._nf_cheques(v0.narration) AS cheques, public._nf_receipt_nos(v0.narration) AS tokens,
           upper(regexp_replace(COALESCE(v0.narration, ''), '[^A-Za-z0-9]', '', 'g')) AS alnum,
           public._nf_letters(v0.narration) AS letters
      FROM v0
      JOIN public.nf_voucher_legs g ON g.voucher_id = v0.id
      JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN public.nf_parties p ON p.id = g.party_id
     GROUP BY v0.id, v0.no, v0.narration, v0.created_by, v0.rd
  LOOP
    v_key := NULL;
    -- the same direction: money in / out of a box or the bank; a withdrawal is bank out, a deposit bank in
    IF NOT (CASE p_kind WHEN 'IN'  THEN h.nonvia > 0 AND h.via_dr > 0
                       WHEN 'OUT' THEN h.nonvia > 0 AND h.via_cr > 0
                       WHEN 'WDL' THEN h.bank_cr > 0
                       WHEN 'DEP' THEN h.bank_dr > 0 ELSE false END) THEN CONTINUE; END IF;
    -- BLOCK: a cheque or a reference is the same bank event only on a voucher that moved the bank
    IF v_bankish AND (h.bank_dr > 0 OR h.bank_cr > 0) THEN
      SELECT 'cheque ' || c INTO v_key FROM unnest(v_chqs) c WHERE public._nf_cheque_hit(c, h.cheques) LIMIT 1;
      IF v_key IS NULL THEN
        SELECT 'reference ' || r INTO v_key FROM unnest(v_refs) r WHERE position(r IN h.alnum) > 0 LIMIT 1;
      END IF;
    END IF;
    IF v_key IS NULL AND h.has_token AND cardinality(v_toks) > 0 THEN
      SELECT 'token #' || t INTO v_key FROM unnest(v_toks) t WHERE t = ANY (h.tokens) LIMIT 1;
    END IF;
    IF v_key IS NOT NULL THEN
      v_block := v_block || jsonb_build_object('voucher', h.no, 'by', h.by_name, 'date', h.rd, 'amount', h.amt, 'key', v_key, 'narration', left(h.narration, 120));
      CONTINUE;
    END IF;
    -- WARN: same amount, near date, same party or same head
    IF h.amt = p_amount AND abs(h.rd - p_date) <= 2
       AND ((length(v_party) >= 4 AND (position(v_party IN h.letters) > 0 OR position(v_party IN public._nf_letters(h.parties)) > 0))
            OR (p_head IS NOT NULL AND h.head = p_head)) THEN
      v_warn := v_warn || jsonb_build_object('voucher', h.no, 'by', h.by_name, 'date', h.rd, 'amount', h.amt,
        'key', CASE WHEN p_head IS NOT NULL AND h.head = p_head THEN 'same amount and head' ELSE 'same amount and party' END,
        'narration', left(h.narration, 120));
    END IF;
  END LOOP;
  -- the site box is told only that Head Office has it (20261119e)
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN
    RETURN jsonb_build_object(
      'block', CASE WHEN jsonb_array_length(v_block) > 0 THEN '[{"by": "Head Office", "hidden": true}]'::jsonb ELSE '[]'::jsonb END,
      'warn',  CASE WHEN jsonb_array_length(v_warn)  > 0 THEN '[{"by": "Head Office", "hidden": true}]'::jsonb ELSE '[]'::jsonb END);
  END IF;
  RETURN jsonb_build_object('block', v_block, 'warn', v_warn);
END $function$;

CREATE OR REPLACE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_via_code text;
  v_type text;
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_system text;
  v_existing_head public.nf_voucher_legs;
  v_existing_via  public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
  v_new_id uuid;
  v_bdate date;
  v_sort integer;
  v_party_id uuid;
  v_requires_party boolean;
  v_exported_at timestamptz;
  v_dup jsonb; v_old_narr text; v_old_amt numeric;  -- 20261119b
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  PERFORM public.nf_assert_cash_box(v_company, p_via);  -- own cash box (20261118i)
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  -- The voucher's TYPE follows from its side and via; the system number
  -- carries it. p_voucher_no is the MANUAL (paper) number: blank, or only
  -- the type prefix the screen pre-fills ("CPV-"), means not written yet.
  v_type := CASE WHEN p_side = 'IN' THEN CASE WHEN p_via = 'Bank' THEN 'BRV' ELSE 'CRV' END
                 ELSE CASE WHEN p_via = 'Bank' THEN 'BPV' ELSE 'CPV' END END;
  IF v_manual = '' OR v_manual ~ '^(CRV|BRV|CPV|BPV)-?$' THEN v_manual := NULL; END IF;

  SELECT requires_party INTO v_requires_party FROM public.nf_accounts WHERE company_id = v_company AND code = btrim(p_head);
  IF NULLIF(btrim(p_party_name), '') IS NOT NULL THEN
    -- an explicit, deliberate choice — resolve an existing party by name/
    -- alias, or create a new one. Applies whether or not the head actually
    -- requires a party: a caller that bothered to pass one meant it.
    v_party_id := public.nf_resolve_party(v_company, p_party_name);
    IF v_party_id IS NULL THEN
      v_party_id := (public.nf_create_party(v_company, p_party_name, 'customer')->>'id')::uuid;
    END IF;
  ELSIF v_requires_party AND NULLIF(btrim(p_description), '') IS NOT NULL THEN
    -- no explicit name — match the description against something already
    -- registered, never mint a new party from unattended free text (see
    -- header). NULL here just means NF:PARTY_REQUIRED fires below, same as
    -- if no description had been typed at all.
    v_party_id := public.nf_resolve_party(v_company, p_description);
  END IF;

  SELECT a.code INTO v_via_code FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via = p_via;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED' USING DETAIL = p_via; END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO v_existing_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_existing_head.voucher_id AND day_id = p_day_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_assert_own_voucher(v_voucher.id);  -- only its own entrant edits it (20261118i)
    -- the system number is permanent and names the type
    IF upper(split_part(v_voucher.voucher_no, '-', 1)) <> v_type THEN
      RAISE EXCEPTION 'NF:VOUCHER_TYPE_FIXED'
        USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'is', upper(split_part(v_voucher.voucher_no, '-', 1)), 'asked', v_type)::text,
              HINT   = 'A saved voucher keeps its type. Delete it and enter it again as the other type.';
    END IF;
  END IF;

  -- the other login may already have booked this (20261119b): refuse the same cheque / reference / token
  v_dup := public.nf_dup_check(v_company, p_side, p_via, btrim(p_head), p_amount, p_description, p_party_name, v_bdate, v_voucher.id);
  IF jsonb_array_length(v_dup->'block') > 0 THEN
    RAISE EXCEPTION 'NF:DUPLICATE_ENTRY' USING DETAIL = (v_dup->'block'->0)::text;
  END IF;
  -- an edited token line first gives back what it had put on the RMS hold (20261119b)
  IF p_line_id IS NOT NULL AND v_existing_head.account_code = '21100' THEN
    v_old_narr := v_voucher.narration; v_old_amt := v_existing_head.debit + v_existing_head.credit;
  END IF;

  -- a manual number is never repeated within its type — checked here for a
  -- clear message; nf_vouchers_manual_unique is the backstop under a race
  IF v_manual IS NOT NULL THEN
    DECLARE v_used public.nf_vouchers; BEGIN
      SELECT * INTO v_used FROM public.nf_vouchers x
       WHERE x.company_id = v_company AND x.manual_no = v_manual
         AND upper(split_part(x.voucher_no, '-', 1)) = v_type
         AND x.id IS DISTINCT FROM v_voucher.id
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = (CASE WHEN public.nf_member_cash_box(v_company) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid() THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no,
            'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v_used.company_id AND m.user_id = v_used.created_by))::text END);
      END IF;
    END;
  END IF;

  IF p_line_id IS NULL THEN
    v_system := public.nf__next_voucher_no(v_company, v_type);
    SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
    v_new_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, p_description, v_sort,
      CASE WHEN p_side = 'IN' THEN
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'credit', p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'debit',  p_amount))
      ELSE
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'debit',  p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'credit', p_amount))
      END);
    IF v_manual IS NOT NULL THEN
      BEGIN
        UPDATE public.nf_vouchers SET manual_no = v_manual WHERE id = v_new_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
      END;
    END IF;
  ELSE
    SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
     WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
    IF v_exported_at IS NOT NULL THEN
      RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
        USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
    END IF;

    PERFORM public.nf_check_version(p_version, v_voucher.version);
    SELECT * INTO v_existing_via FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id AND line_no = 2;

    BEGIN
      UPDATE public.nf_vouchers
         SET manual_no = v_manual, narration = NULLIF(btrim(p_description), ''),
             version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = v_voucher.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
    END;

    -- p_party_name/description NULL, or no match found, must not erase a
    -- party set by an earlier save — only overwrite when this save
    -- actually resolved one.
    IF p_side = 'IN' THEN
      UPDATE public.nf_voucher_legs SET account_code = btrim(p_head), floor_code = btrim(p_floor),
        party_id = COALESCE(v_party_id, v_existing_head.party_id),
        debit = 0, credit = p_amount WHERE id = v_existing_head.id;
      UPDATE public.nf_voucher_legs SET account_code = v_via_code, floor_code = btrim(p_floor),
        debit = p_amount, credit = 0 WHERE id = v_existing_via.id;
    ELSE
      UPDATE public.nf_voucher_legs SET account_code = btrim(p_head), floor_code = btrim(p_floor),
        party_id = COALESCE(v_party_id, v_existing_head.party_id),
        debit = p_amount, credit = 0 WHERE id = v_existing_head.id;
      UPDATE public.nf_voucher_legs SET account_code = v_via_code, floor_code = btrim(p_floor),
        debit = 0, credit = p_amount WHERE id = v_existing_via.id;
    END IF;
  END IF;

  -- RMS token sync (20261119b)
  IF v_old_amt IS NOT NULL THEN
    PERFORM public._nf_rms_token_sync(v_company, v_voucher.id, v_old_narr, p_side, v_old_amt, -1);
  END IF;
  IF btrim(p_head) = '21100' THEN
    PERFORM public._nf_rms_token_sync(v_company, COALESCE(v_new_id, v_voucher.id), p_description, p_side, p_amount, 1);
  END IF;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_jv_save(p_company_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_legs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manual text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_system text;
  v_id    uuid;
  v_leg   jsonb;
  v_legs  jsonb := '[]'::jsonb;
  v_name  text;
  v_party uuid;
  v_latest_closed date;
  v_used  public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  -- p_voucher_no is the MANUAL number (docs/PLAN.md §45); blank or only the
  -- prefix means not written yet.
  IF v_manual = '' OR v_manual ~ '^JV-?$' THEN v_manual := NULL; END IF;
  -- A journal voucher must not look like a cash-book voucher. The daily sheet
  -- owns those four prefixes; claiming one here would put a non-cash entry
  -- under a cash voucher number.
  IF v_manual ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_manual;
  END IF;

  -- Period gate, checked before any party is resolved/created below — a
  -- rejected voucher must not have a side effect. "Latest CLOSED day" is the
  -- boundary of what is already locked (nf_days_one_unclosed guarantees at
  -- most one non-CLOSED day per company, so this needs no separate "period"
  -- concept of its own).
  IF p_voucher_date IS NOT NULL THEN
    -- Pakistan's date, not the server's UTC one: between 00:00 and 05:00 PKT the
    -- two differ, and "today" on the screen was refused as a future date
    -- (docs/findings/2026-09-22-Q-jv-future-date-uses-utc.md).
    IF p_voucher_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
      RAISE EXCEPTION 'NF:DATE_FUTURE' USING DETAIL = p_voucher_date::text;
    END IF;
    SELECT max(business_date) INTO v_latest_closed
      FROM public.nf_days WHERE company_id = p_company_id AND status = 'CLOSED';
    IF v_latest_closed IS NOT NULL AND p_voucher_date <= v_latest_closed THEN
      RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', p_voucher_date, 'latest_closed', v_latest_closed)::text;
    END IF;
  END IF;

  -- a manual number is never repeated within JV — also before any side effect
  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = p_company_id AND x.manual_no = v_manual
       AND upper(split_part(x.voucher_no, '-', 1)) = 'JV'
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
        USING DETAIL = (CASE WHEN public.nf_member_cash_box(p_company_id) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid() THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);
    END IF;
  END IF;

  -- nf_post_voucher takes a party_id; the screen only knows the NAME the
  -- person picked or typed. Resolve each leg the same way nf_save_line
  -- already does (exact match after normalising, else create) so the
  -- search-first field's "add new" path produces a real party-master record
  -- here too, not a second way of spelling one. A leg that already carries a
  -- party_id is left exactly as it is.
  IF p_legs IS NOT NULL AND jsonb_typeof(p_legs) = 'array' THEN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
      v_name := NULLIF(btrim(v_leg->>'party_name'), '');
      IF v_name IS NOT NULL AND NULLIF(v_leg->>'party_id', '') IS NULL THEN
        v_party := public.nf_resolve_party(p_company_id, v_name);
        IF v_party IS NULL THEN
          v_party := (public.nf_create_party(p_company_id, v_name, 'customer')->>'id')::uuid;
        END IF;
        v_leg := (v_leg - 'party_name') || jsonb_build_object('party_id', v_party::text);
      ELSE
        v_leg := v_leg - 'party_name';
      END IF;
      v_legs := v_legs || jsonb_build_array(v_leg);
    END LOOP;
  ELSE
    v_legs := p_legs;
  END IF;

  -- the SYSTEM number (docs/PLAN.md §44/§45)
  v_system := public.nf__next_voucher_no(p_company_id, 'JV');
  -- p_day_id is NULL, always and deliberately: a JV is not a cash-book line.
  v_id := public.nf_post_voucher(p_company_id, NULL, v_system, p_voucher_date, p_narration, 0, v_legs);
  IF v_manual IS NOT NULL THEN
    BEGIN
      UPDATE public.nf_vouchers SET manual_no = v_manual WHERE id = v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
    END;
  END IF;

  RETURN (SELECT jsonb_build_object(
            'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'voucher_date', v.voucher_date,
            'narration', v.narration, 'status', v.status, 'version', v.version,
            'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                       'floor_code', l.floor_code, 'party', pt.name, 'party_id', l.party_id,
                       'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                     FROM public.nf_voucher_legs l
                     JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                     LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                    WHERE l.voucher_id = v.id), '[]'::jsonb))
            FROM public.nf_vouchers v WHERE v.id = v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_manual_no(p_voucher_id uuid, p_manual_no text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.nf_vouchers;
  v_type text;
  v_manual text := upper(btrim(COALESCE(p_manual_no, '')));
  v_status text;
  v_latest_closed date;
  v_used public.nf_vouchers;
BEGIN
  SELECT * INTO v FROM public.nf_vouchers x
   WHERE x.id = p_voucher_id
     AND EXISTS (SELECT 1 FROM public.nf_members m WHERE m.company_id = x.company_id AND m.user_id = auth.uid() AND m.active)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(v.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_own_voucher(v.id);  -- only its own entrant (20261118i)

  v_type := upper(split_part(v.voucher_no, '-', 1));
  IF v.source = 'IMPORT' OR v_type NOT IN ('CRV','BRV','CPV','BPV','JV') THEN
    RAISE EXCEPTION 'NF:IMPORTED_LOCKED' USING DETAIL = v.voucher_no;
  END IF;
  IF v_manual = '' OR v_manual ~ '^(CRV|BRV|CPV|BPV|JV)-?$' THEN v_manual := NULL; END IF;
  IF v_type = 'JV' AND v_manual ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_manual;
  END IF;

  IF EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b WHERE b.voucher_id = v.id) THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED' USING DETAIL = json_build_object('voucher', v.voucher_no)::text;
  END IF;
  IF v.day_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.nf_days WHERE id = v.day_id;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
  ELSE
    SELECT max(business_date) INTO v_latest_closed FROM public.nf_days WHERE company_id = v.company_id AND status = 'CLOSED';
    IF v_latest_closed IS NOT NULL AND v.voucher_date <= v_latest_closed THEN
      RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', v.voucher_date, 'latest_closed', v_latest_closed)::text;
    END IF;
  END IF;
  PERFORM public.nf_check_version(p_version, v.version);

  IF v_manual IS NOT NULL THEN
    SELECT * INTO v_used FROM public.nf_vouchers x
     WHERE x.company_id = v.company_id AND x.manual_no = v_manual
       AND upper(split_part(x.voucher_no, '-', 1)) = v_type AND x.id <> v.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
        USING DETAIL = (CASE WHEN public.nf_member_cash_box(v.company_id) = 'Petty' AND v_used.created_by IS DISTINCT FROM auth.uid() THEN json_build_object('voucher', v_manual, 'by', 'Head Office', 'hidden', true)::text ELSE json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text END);
    END IF;
  END IF;

  BEGIN
    UPDATE public.nf_vouchers
       SET manual_no = v_manual, version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = v.id
    RETURNING * INTO v;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN jsonb_build_object('id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'version', v.version);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_assert_own_voucher(p_voucher_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.nf_vouchers;
BEGIN
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF public.nf_role(v.company_id) = 'director' OR v.created_by = auth.uid() THEN RETURN; END IF;
  IF public.nf_member_cash_box(v.company_id) = 'Petty' THEN RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = '{"by": "Head Office", "hidden": true}'; END IF;  -- 20261119e
  RAISE EXCEPTION 'NF:NOT_YOUR_ENTRY' USING DETAIL = json_build_object('voucher', COALESCE(v.manual_no, v.voucher_no),
    'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by))::text;
END $function$;

CREATE OR REPLACE FUNCTION public.nf_day_report(p_company_id uuid, p_date date, p_view text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_view text := lower(COALESCE(NULLIF(btrim(p_view), ''), 'combined'));
  v_shown text[];
  v record; m record; h record; x record; o record;
  v_rec jsonb := '[]'; v_pay jsonb := '[]'; v_trf jsonb := '[]';
  v_box jsonb := '{}';
  v_for text; v_desc text; v_toks int[]; v_units text[]; v_chq text; v_by text;
  v_title text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  IF p_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN v_view := 'site'; END IF;   -- the site login: always Site
  IF v_view NOT IN ('site', 'ho', 'combined') THEN RAISE EXCEPTION 'NF:VIEW_UNKNOWN' USING DETAIL = v_view; END IF;
  v_shown := CASE v_view WHEN 'site' THEN ARRAY['Petty'] WHEN 'ho' THEN ARRAY['Cash', 'Bank'] ELSE ARRAY['Cash', 'Petty', 'Bank'] END;

  -- each shown box: its name and its balance before the date
  FOR x IN SELECT a.via, a.code, CASE a.via WHEN 'Bank' THEN 'BOP (bank)' ELSE COALESCE(a.via_label, a.name) END AS label,
                  COALESCE((SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_vouchers vv ON vv.id = g.voucher_id
                             WHERE g.company_id = p_company_id AND g.account_code = a.code AND vv.status = 'POSTED'
                               AND COALESCE(vv.real_date, vv.voucher_date) < p_date), 0) AS opening
             FROM public.nf_accounts a WHERE a.company_id = p_company_id AND a.via = ANY (v_shown) LOOP
    v_box := v_box || jsonb_build_object(x.via, jsonb_build_object('via', x.via, 'label', x.label, 'opening', x.opening,
                                                                   'received', 0, 'paid', 0, 'transfers', 0));
  END LOOP;

  FOR v IN SELECT vv.id, COALESCE(vv.manual_no, vv.voucher_no) AS no, vv.narration, mm.display_name AS by_name, mm.cash_via AS by_box
             FROM public.nf_vouchers vv LEFT JOIN public.nf_members mm ON mm.company_id = vv.company_id AND mm.user_id = vv.created_by
            WHERE vv.company_id = p_company_id AND vv.status = 'POSTED' AND COALESCE(vv.real_date, vv.voucher_date) = p_date
            ORDER BY vv.created_at, vv.sort LOOP
    v_by := CASE WHEN v.by_box = 'Petty' THEN v.by_name WHEN v.by_name IS NULL THEN 'Imported' ELSE 'Head Office' END;
    SELECT g.line_no, g.debit, g.credit, a.via, a.via_label INTO m
      FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
     WHERE g.voucher_id = v.id AND a.via IS NOT NULL ORDER BY g.line_no LIMIT 1;
    CONTINUE WHEN m.via IS NULL;                                     -- a JV moves no cash and no bank
    SELECT g.account_code, a.name, p.name AS party INTO h
      FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN public.nf_parties p ON p.id = g.party_id
     WHERE g.voucher_id = v.id AND a.via IS NULL ORDER BY g.line_no LIMIT 1;

    IF h.account_code IS NULL THEN                                   -- a transfer: shown once, from → to
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                                 WHERE g.voucher_id = v.id AND a.via = ANY (v_shown));
      v_chq := (regexp_match(COALESCE(v.narration, ''), 'chq\s*#?\s*([0-9]{4,})', 'i'))[1];
      SELECT
        (SELECT CASE a.via WHEN 'Bank' THEN CASE WHEN v_view = 'site' THEN 'Head Office (BOP)' ELSE 'BOP (bank)' END ELSE COALESCE(a.via_label, a.name) END
           FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
          WHERE g.voucher_id = v.id AND g.credit > 0 ORDER BY g.line_no LIMIT 1) AS fr,
        (SELECT CASE a.via WHEN 'Bank' THEN CASE WHEN v_view = 'site' THEN 'Head Office (BOP)' ELSE 'BOP (bank)' END ELSE COALESCE(a.via_label, a.name) END
           FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
          WHERE g.voucher_id = v.id AND g.debit > 0 ORDER BY g.line_no LIMIT 1) AS too,
        (SELECT sum(g.debit) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id) AS amt
        INTO o;
      v_trf := v_trf || jsonb_build_object('no', v.no, 'by', v_by, 'from', o.fr, 'to', o.too, 'amount', o.amt,
                                           'cheque', CASE WHEN v_chq IS NOT NULL THEN right(v_chq, 4) END);
      FOR x IN SELECT a.via, g.debit - g.credit AS net FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                WHERE g.voucher_id = v.id AND a.via = ANY (v_shown) LOOP
        v_box := jsonb_set(v_box, ARRAY[x.via, 'transfers'], to_jsonb((v_box->x.via->>'transfers')::numeric + x.net));
      END LOOP;
      CONTINUE;
    END IF;

    CONTINUE WHEN NOT (m.via = ANY (v_shown) OR (v_view = 'site' AND m.via = 'Bank' AND v.by_box = 'Petty'));
    IF h.account_code = '21100' THEN                                 -- a token: its number and unit(s)
      v_toks := public._nf_receipt_nos(v.narration);
      v_units := public._nf_units_in(v.narration);
      v_for := 'Token' || CASE WHEN cardinality(v_toks) > 0 THEN ' #' || array_to_string(v_toks, ', #') ELSE '' END
               || CASE WHEN cardinality(v_units) > 0 THEN ' · ' || array_to_string(v_units, ', ') ELSE '' END;
    ELSIF h.party IS NOT NULL AND (h.party = h.name OR position(h.party IN h.name) > 0) THEN
      v_for := split_part(COALESCE(v.narration, h.name), ' — ', 1);  -- the head IS the party (an advance): say what for
    ELSIF h.party IS NULL THEN
      -- no party: the head and a short description from the narration — its first part, without the trailing
      -- "(site cash, Sharose, 16-Nov)" / "(cash, 03-Nov)" and without "BOP chq #…" (owner, 19-Nov)
      v_desc := btrim(regexp_replace(regexp_replace(split_part(COALESCE(v.narration, ''), ' — ', 1),
                  '\s*\([^()]*\)\s*$', ''), ',?\s*(BOP\s+)?chq\.?\s*#?\s*[0-9]+.*$', '', 'i'));
      v_for := h.name || CASE WHEN v_desc <> '' AND lower(v_desc) <> lower(h.name) THEN ' · ' || v_desc ELSE '' END;
    ELSE
      v_for := h.name;
    END IF;
    IF m.debit > 0 THEN
      v_rec := v_rec || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, 'amount', m.debit, 'bank', m.via = 'Bank');
      IF m.via = ANY (v_shown) THEN v_box := jsonb_set(v_box, ARRAY[m.via, 'received'], to_jsonb((v_box->m.via->>'received')::numeric + m.debit)); END IF;
    ELSE
      v_pay := v_pay || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, 'amount', m.credit, 'bank', m.via = 'Bank');
      IF m.via = ANY (v_shown) THEN v_box := jsonb_set(v_box, ARRAY[m.via, 'paid'], to_jsonb((v_box->m.via->>'paid')::numeric + m.credit)); END IF;
    END IF;
  END LOOP;

  -- the site box: a line Head Office entered on Site Cash shows as amount only, a transfer as from / to Head Office (20261119e)
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN
    v_rec := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Received by Head Office into Site Cash', 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_rec) e), '[]');
    v_pay := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Paid by Head Office from Site Cash', 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_pay) e), '[]');
    v_trf := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office',
               'from', CASE WHEN e->>'to' = 'Site Cash' THEN 'Head Office' ELSE 'Site Cash' END,
               'to', CASE WHEN e->>'to' = 'Site Cash' THEN 'Site Cash' ELSE 'Head Office' END, 'amount', e->'amount', 'cheque', NULL) ELSE e END)
               FROM jsonb_array_elements(v_trf) e), '[]');
  END IF;
  SELECT initcap(lower(split_part(COALESCE(s.book_title, COALESCE(c.display_name, c.company_name)), ' — ', 1))) INTO v_title
    FROM public.companies c LEFT JOIN public.nf_settings s ON s.company_id = c.id WHERE c.id = p_company_id;
  RETURN jsonb_build_object(
    'title', v_title || ' — Daily Closing', 'date', p_date, 'view', v_view,
    'view_name', CASE v_view WHEN 'site' THEN 'Site' WHEN 'ho' THEN 'Head Office' ELSE 'Combined' END,
    'boxes', (SELECT jsonb_agg(b || jsonb_build_object('closing', (b->>'opening')::numeric + (b->>'received')::numeric
                                                       - (b->>'paid')::numeric + (b->>'transfers')::numeric)
                               ORDER BY array_position(ARRAY['Cash', 'Petty', 'Bank'], b->>'via'))
                FROM jsonb_each(v_box) e(k, b)),
    'received', v_rec, 'paid', v_pay, 'transfers', v_trf,
    'prepared_by', public.nf_actor_name(p_company_id),
    'generated_at', now());
END $function$;
