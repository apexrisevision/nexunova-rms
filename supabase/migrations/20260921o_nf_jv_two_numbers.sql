-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — Stage B of the voucher-popup work (owner, 2026-09-21).
-- docs/PLAN.md §45. Stage A (20260921m/n) gave every daily-closing
-- receipt/payment two numbers. This extends the same rule to JOURNAL
-- VOUCHERS, now also entered from a popup on the closing sheet.
--
-- 1. nf_jv_save: p_voucher_no is now the MANUAL (paper) number, optional
--    (blank, or only "JV-", means not written yet).
--    - The SYSTEM number JV-000001 is given here, from the same counter as
--      the cash-book types.
--    - The manual number is never repeated within JV, and still may not look
--      like a cash-book number (NF:VOUCHER_PREFIX_IS_CASHBOOK).
--    - Existing JVs (test tenants only; Awami's nf_jv_list is empty) had
--      their typed number as their only number, so it becomes their manual
--      number too.
--    - Imported history (source IMPORT, Awami's 64) is untouched: no manual
--      number, never exportable, never on a closing.
--
-- 2. nf_days_numbers_guard also refuses to close a day while a JV DATED
--    that day has no manual number. The owner's rule is about every voucher
--    of the day, not only the cash book.
--
-- 3. nf_set_manual_no(voucher, manual, version) is new: it sets ONLY the
--    manual number, on a day receipt/payment or a JV. The Close day dialog
--    fills the missing numbers through it. It is gated like the edit paths
--    it stands beside:
--    - accountant/director;
--    - not exported;
--    - a day voucher's day still OPEN;
--    - a JV's date after the latest CLOSED day;
--    - version-checked.
--
-- 4. nf_day_json returns 'jvs': the JVs dated that day, so the sheet can
--    show them and the Close day dialog can list those still missing a
--    number.
--
-- 5. nf_jv_list returns each JV's manual_no. next_voucher_no is kept for any
--    caller still reading it, but is now NULL: the system number is not the
--    screen's to suggest any more.
--
-- nf_jv_save, nf_jv_list and nf_day_json keep their argument lists, so their
-- grants are kept. nf_set_manual_no is new: EXECUTE is REVOKEd from
-- PUBLIC/anon and GRANTed to authenticated, the same as every other
-- screen-callable nf_ RPC.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;

-- existing JVs: the typed number was the paper number
UPDATE public.nf_vouchers
   SET manual_no = upper(btrim(voucher_no))
 WHERE manual_no IS NULL AND day_id IS NULL AND source = 'JV';

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
    IF p_voucher_date > CURRENT_DATE THEN
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
        USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;
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
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

-- Only the manual number, on a day receipt/payment or a JV — what the Close
-- day dialog uses to fill the missing ones in.
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
        USING DETAIL = json_build_object('voucher', v_manual, 'used_on', v_used.voucher_date, 'system_no', v_used.voucher_no)::text;
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
REVOKE ALL ON FUNCTION public.nf_set_manual_no(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_set_manual_no(uuid, text, integer) TO authenticated;

-- the Close day guard now covers the day's JVs as well
CREATE OR REPLACE FUNCTION public.nf_days_numbers_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_list jsonb;
BEGIN
  IF public.nf_purging(NEW.company_id) THEN RETURN NEW; END IF;
  IF NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' THEN
    SELECT jsonb_agg(jsonb_build_object('voucher_no', v.voucher_no, 'narration', v.narration)
                     ORDER BY (v.day_id IS NULL), v.sort, v.voucher_no)
      INTO v_list
      FROM public.nf_vouchers v
     WHERE v.company_id = NEW.company_id AND v.status = 'POSTED' AND v.manual_no IS NULL
       AND ((v.day_id = NEW.id AND upper(split_part(v.voucher_no, '-', 1)) IN ('CRV','BRV','CPV','BPV'))
         OR (v.day_id IS NULL AND v.source = 'JV' AND v.voucher_date = NEW.business_date));
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'NF:VOUCHER_NUMBERS_PENDING'
        USING DETAIL = v_list::text,
              HINT   = 'Enter the manual voucher number of every voucher listed, then close the day.';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

-- nf_day_json: + 'jvs', the journal vouchers dated this day
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
               'party_id', vl.party_id, 'party_name', pt.name,
               'voucher_id', vv.id, 'manual_no', vv.manual_no, 'number_pending', vv.manual_no IS NULL) ORDER BY l.sort)
        FROM public.nf_lines l
        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
        LEFT JOIN public.nf_voucher_legs vl ON vl.id = l.id
        LEFT JOIN public.nf_vouchers vv ON vv.id = vl.voucher_id
        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = vl.party_id
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'jvs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'number_pending', v.manual_no IS NULL,
               'narration', v.narration, 'version', v.version,
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
END
$function$;

COMMIT;
