-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · c · RPCs, nf_lines compatibility view
--
-- nf_lines is reborn as a VIEW so js/nf/nf-sheet.js and js/nf/nf-api.js do
-- not change: nf_save_line/nf_delete_line keep their exact signatures and
-- returned shape (nf_day_json), but now write nf_vouchers/nf_voucher_legs
-- underneath. Every 2-leg cash-book voucher stores its head leg at line_no=1
-- and its via leg at line_no=2 — that convention is what lets the view (and
-- nf_save_line's UPDATE path) find "the other leg" without extra lookups.
--
-- nf_post_voucher is the general N-leg poster, callable directly for a
-- voucher that has no via leg at all (e.g. debit Cost of Sales, credit an
-- FMH payable, when a sister company pays an Awami cost directly — no
-- Awami cash moves, so nf_save_line's via-based UI has nothing to enter).
-- No screen calls it that way yet; it exists so the schema is proven to
-- support the real pattern the owner described, ahead of that screen being
-- built.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── generic N-leg atomic poster ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_post_voucher(
  p_company_id  uuid,
  p_day_id      uuid,
  p_voucher_no  text,
  p_voucher_date date,
  p_narration   text,
  p_sort        integer,
  p_legs        jsonb   -- [{account_code, floor_code, party_id, debit, credit, memo}, ...]
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  v_status text;
  v_id     uuid;
  v_leg    jsonb;
  v_n      integer := 0;
  v_debit  numeric := 0;
  v_credit numeric := 0;
  v_used   date;
BEGIN
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_voucher_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) < 2 THEN
    RAISE EXCEPTION 'NF:VOUCHER_NEEDS_TWO_LEGS';
  END IF;

  IF p_day_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.nf_days WHERE id = p_day_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
  END IF;

  -- validate every leg and the balance BEFORE writing anything — the
  -- atomic half of the enforcement strategy described in 20260918b.
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    IF NULLIF(btrim(v_leg->>'account_code'), '') IS NULL THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED'; END IF;
    IF NULLIF(btrim(v_leg->>'floor_code'), '') IS NULL THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
    PERFORM public.nf_check_amount(COALESCE((v_leg->>'debit')::numeric, 0), 'debit', false);
    PERFORM public.nf_check_amount(COALESCE((v_leg->>'credit')::numeric, 0), 'credit', false);
    IF NOT ((COALESCE((v_leg->>'debit')::numeric,0) > 0) <> (COALESCE((v_leg->>'credit')::numeric,0) > 0)) THEN
      RAISE EXCEPTION 'NF:LEG_ONE_SIDE_ONLY';
    END IF;
    v_debit  := v_debit  + COALESCE((v_leg->>'debit')::numeric, 0);
    v_credit := v_credit + COALESCE((v_leg->>'credit')::numeric, 0);
    v_n := v_n + 1;
  END LOOP;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'NF:VOUCHER_UNBALANCED' USING DETAIL = json_build_object('debit', v_debit, 'credit', v_credit)::text;
  END IF;

  BEGIN
    INSERT INTO public.nf_vouchers (company_id, day_id, voucher_no, voucher_date, narration, status, sort,
                                    created_by, posted_by, posted_at)
    VALUES (p_company_id, p_day_id, upper(btrim(p_voucher_no)), p_voucher_date, NULLIF(btrim(p_narration), ''),
            'POSTED', COALESCE(p_sort, 0), auth.uid(), auth.uid(), now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT v.voucher_date INTO v_used FROM public.nf_vouchers v
     WHERE v.company_id = p_company_id AND v.voucher_key = upper(btrim(p_voucher_no));
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
      USING DETAIL = json_build_object('voucher', upper(btrim(p_voucher_no)), 'used_on', v_used)::text;
  END;

  v_n := 0;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    v_n := v_n + 1;
    INSERT INTO public.nf_voucher_legs (company_id, voucher_id, line_no, account_code, party_id, floor_code,
                                        debit, credit, memo, created_by)
    VALUES (p_company_id, v_id, v_n, btrim(v_leg->>'account_code'),
            NULLIF(v_leg->>'party_id', '')::uuid, btrim(v_leg->>'floor_code'),
            COALESCE((v_leg->>'debit')::numeric, 0), COALESCE((v_leg->>'credit')::numeric, 0),
            NULLIF(btrim(v_leg->>'memo'), ''), auth.uid());
  END LOOP;

  RETURN v_id;
END
$function$;

-- nf_lines itself is not touched here — it is still the live single-entry
-- TABLE at this point in the migration sequence. 20260918d renames it to
-- nf_lines_legacy, migrates its rows into vouchers/legs, verifies the
-- result to the rupee, and only then creates nf_lines as a VIEW with the
-- same name (a CREATE VIEW cannot share a name with an existing table).
-- The functions below already assume the view's final shape — they are
-- inert until 20260918d runs, since nf_lines is still a table until then.

-- ── nf_save_line: signature grows ONE optional parameter, everything else
--    unchanged, still writes a 2-leg voucher ───────────────────────────────
-- p_party_name is new and OPTIONAL (defaults NULL): js/nf/nf-sheet.js's
-- existing calls never send it, so every head that isn't party-required
-- behaves byte-identically to before. It exists because three real,
-- everyday heads (21100 Token Money, 21200 Advertising-unit advances,
-- 21300 Refunds Payable — each pooling many different named customers
-- under one account code, unlike 12610/12620/22100-22400 which are
-- already dedicated per-entity accounts and were correctly left OFF the
-- party-required list, see 20260918a) now require a party to post to.
-- Without this parameter, entering a Token Money receipt — which the
-- persistent ZZTEST-NF-DEMO tenant's own sample data already does — would
-- start failing with NF:PARTY_REQUIRED the moment this migration applies,
-- with no way to satisfy it. A typed name is resolved against an existing
-- party (by name or alias) or a new 'customer' party is created on the
-- spot — the same forgiving behavior a cashier typing a name expects.
-- js/nf/nf-sheet.js does NOT collect this yet — that one small, additive
-- input (shown only when the chosen head is party-required) is flagged as
-- its own named follow-up in docs/PLAN.md §11, not assumed done here.
--
-- A trailing DEFAULT parameter does not make this a "replace" as far as
-- Postgres overload resolution is concerned — a different parameter list
-- is a different function. Without dropping the original 10-parameter
-- signature first, both it and this 11-parameter one would coexist, and
-- every existing 10-argument call (nf-sheet.js's own, and this migration's
-- own rehearsal) would fail as ambiguous. Found by the rehearsal actually
-- running, not assumed safe.
DROP FUNCTION IF EXISTS public.nf_save_line(uuid, uuid, text, text, text, text, text, text, numeric, integer);
CREATE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_via_code text;
  v_voucher_key text := upper(btrim(p_voucher_no));
  v_existing_head public.nf_voucher_legs;
  v_existing_via  public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
  v_bdate date;
  v_sort integer;
  v_party_id uuid;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  IF NULLIF(btrim(p_party_name), '') IS NOT NULL THEN
    v_party_id := public.nf_resolve_party(v_company, p_party_name);
    IF v_party_id IS NULL THEN
      v_party_id := (public.nf_create_party(v_company, p_party_name, 'customer')->>'id')::uuid;
    END IF;
  END IF;

  -- same voucher-numbering conventions the old table CHECKs enforced,
  -- now asserted explicitly since the physical table's constraints no
  -- longer sit directly on what the client calls "nf_lines"
  IF NOT ((p_side = 'IN'  AND v_voucher_key ~ '^(CRV|BRV)-\S+$') OR
          (p_side = 'OUT' AND v_voucher_key ~ '^(CPV|BPV)-\S+$')) THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX';
  END IF;
  IF (left(v_voucher_key, 1) = 'C') <> (p_via IN ('Cash','Petty')) THEN
    RAISE EXCEPTION 'NF:VOUCHER_VIA_MISMATCH';
  END IF;

  SELECT a.code INTO v_via_code FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via = p_via;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED' USING DETAIL = p_via; END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;

  IF p_line_id IS NULL THEN
    SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
    PERFORM public.nf_post_voucher(v_company, p_day_id, p_voucher_no, v_bdate, p_description, v_sort,
      CASE WHEN p_side = 'IN' THEN
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'credit', p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'debit',  p_amount))
      ELSE
        jsonb_build_array(
          jsonb_build_object('account_code', btrim(p_head), 'floor_code', btrim(p_floor), 'party_id', v_party_id::text, 'debit',  p_amount),
          jsonb_build_object('account_code', v_via_code,     'floor_code', btrim(p_floor), 'credit', p_amount))
      END);
  ELSE
    SELECT * INTO v_existing_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_existing_head.voucher_id AND day_id = p_day_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, v_voucher.version);
    SELECT * INTO v_existing_via FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id AND line_no = 2;

    BEGIN
      UPDATE public.nf_vouchers
         SET voucher_no = upper(btrim(p_voucher_no)), narration = NULLIF(btrim(p_description), ''),
             version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = v_voucher.id;
    EXCEPTION WHEN unique_violation THEN
      DECLARE v_used date; BEGIN
        SELECT v.voucher_date INTO v_used FROM public.nf_vouchers v
         WHERE v.company_id = v_company AND v.voucher_key = v_voucher_key AND v.id <> v_voucher.id;
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = json_build_object('voucher', v_voucher_key, 'used_on', v_used)::text;
      END;
    END;

    -- p_party_name NULL (every call today, until nf-sheet.js collects it)
    -- must not erase a party set by an earlier save — only overwrite when
    -- a name was actually sent this time.
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

  RETURN public.nf_day_json(p_day_id);
END
$function$;

-- ── nf_delete_line: unchanged signature, removes the whole voucher ─────────
CREATE OR REPLACE FUNCTION public.nf_delete_line(p_line_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_head public.nf_voucher_legs;
  v_voucher public.nf_vouchers;
BEGIN
  SELECT * INTO v_head FROM public.nf_voucher_legs WHERE id = p_line_id AND line_no = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = v_head.voucher_id FOR UPDATE;
  PERFORM public.nf_require_role(v_voucher.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_check_version(p_version, v_voucher.version);
  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN public.nf_day_json(v_voucher.day_id);
END
$function$;

-- ── transfers: no longer a special case on nf_days, just an ordinary
--    2-leg voucher between two via-accounts (owner decision, 2026-09-18) ──
-- nf_set_transfers keeps its exact external signature (cash-outbound only,
-- matching js/nf/nf-sheet.js's two input fields) and its nf_days.version
-- optimistic-lock semantics — every day-level save (transfer, count,
-- close) shares that one counter, which is what stops two near-simultaneous
-- saves from silently losing one to a stale NF:VERSION_CONFLICT (see the
-- comment in nf-sheet.js above saveTransfers()). Since the transfer amount
-- itself no longer lives on nf_days, this still needs a real UPDATE to
-- bump that shared version — `remarks = remarks` is the touch, chosen
-- because it is a genuinely mutable, non-immutable column with no side
-- effect of its own.
--
-- The underlying poster (nf__upsert_transfer_voucher) works in EITHER
-- direction — Cash→Bank, Bank→Cash, Cash→Petty, Petty→Cash — because it is
-- just nf_post_voucher with two via-account legs; nf_set_transfers only
-- ever calls it Cash-outbound because that is all the current screen
-- collects. Proven both-directions in scripts/nf/verify-nf-de-migration.js.
CREATE OR REPLACE FUNCTION public.nf__upsert_transfer_voucher(
  p_company_id uuid, p_day_id uuid, p_voucher_date date, p_voucher_no text,
  p_to_code text, p_from_code text, p_floor_code text, p_amount numeric
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_existing public.nf_vouchers;
BEGIN
  SELECT * INTO v_existing FROM public.nf_vouchers
   WHERE company_id = p_company_id AND voucher_key = upper(btrim(p_voucher_no));

  IF p_amount IS NULL OR p_amount = 0 THEN
    IF FOUND THEN
      DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_existing.id;
      DELETE FROM public.nf_vouchers WHERE id = v_existing.id;
    END IF;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.nf_voucher_legs SET debit = p_amount, credit = 0
     WHERE voucher_id = v_existing.id AND account_code = p_to_code;
    UPDATE public.nf_voucher_legs SET debit = 0, credit = p_amount
     WHERE voucher_id = v_existing.id AND account_code = p_from_code;
  ELSE
    PERFORM public.nf_post_voucher(p_company_id, p_day_id, p_voucher_no, p_voucher_date, 'Transfer', 0,
      jsonb_build_array(
        jsonb_build_object('account_code', p_to_code,   'floor_code', p_floor_code, 'debit',  p_amount),
        jsonb_build_object('account_code', p_from_code, 'floor_code', p_floor_code, 'credit', p_amount)));
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_transfers(p_day_id uuid, p_to_bank numeric, p_to_petty numeric, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  v_cash_code text; v_bank_code text; v_petty_code text; v_floor text;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  PERFORM public.nf_check_amount(p_to_bank,  'transfer_to_bank',  true);
  PERFORM public.nf_check_amount(p_to_petty, 'transfer_to_petty', true);
  IF p_to_bank < 0 OR p_to_petty < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  SELECT code INTO v_cash_code  FROM public.nf_accounts WHERE company_id = v_company AND via = 'Cash';
  SELECT code INTO v_bank_code  FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code INTO v_petty_code FROM public.nf_accounts WHERE company_id = v_company AND via = 'Petty';
  -- a transfer has no natural floor (moving cash between tills is not a
  -- floor's activity) and the single-entry model never captured one
  -- either; the company's first floor by sort order is the fixed,
  -- disclosed convention — same one 20260918d uses migrating the one real
  -- transfer that exists live today.
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY sort LIMIT 1;

  PERFORM public.nf__upsert_transfer_voucher(v_company, p_day_id, d.business_date,
    'XFR-BANK-'  || p_day_id::text, v_bank_code,  v_cash_code, v_floor, p_to_bank);
  PERFORM public.nf__upsert_transfer_voucher(v_company, p_day_id, d.business_date,
    'XFR-PETTY-' || p_day_id::text, v_petty_code, v_cash_code, v_floor, p_to_petty);

  UPDATE public.nf_days SET remarks = remarks WHERE id = p_day_id;  -- bump the shared version, see header note
  RETURN public.nf_day_json(p_day_id);
END
$function$;

-- nf_day_json: only the transfer_to_bank/transfer_to_petty source changes
-- — computed fresh from nf_position_row (which now sums the transfer
-- vouchers above) instead of read from columns that no longer exist.
-- Everything else is byte-identical to the pre-double-entry function.
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
      'transfer_to_bank', r.trf_bank, 'transfer_to_petty', r.trf_petty,
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

-- ── party master RPCs ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_create_party(p_company_id uuid, p_name text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'NF:NAME_REQUIRED'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('customer','supplier','director','sister_company','staff','other') THEN
    RAISE EXCEPTION 'NF:PARTY_KIND_UNKNOWN' USING DETAIL = p_kind;
  END IF;
  BEGIN
    INSERT INTO public.nf_parties (company_id, name, kind, created_by)
    VALUES (p_company_id, btrim(p_name), p_kind, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:PARTY_NAME_EXISTS' USING DETAIL = btrim(p_name);
  END;
  RETURN jsonb_build_object('id', v_id, 'name', btrim(p_name), 'kind', p_kind);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_add_party_alias(p_company_id uuid, p_party_id uuid, p_alias text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  IF p_alias IS NULL OR btrim(p_alias) = '' THEN RAISE EXCEPTION 'NF:ALIAS_REQUIRED'; END IF;
  BEGIN
    INSERT INTO public.nf_party_aliases (company_id, party_id, alias, created_by)
    VALUES (p_company_id, p_party_id, btrim(p_alias), auth.uid());
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:ALIAS_EXISTS' USING DETAIL = btrim(p_alias);
  END;
END
$function$;

-- Resolves a typed name to a party the same way a person means it: an exact
-- name match, then an alias match — used by the migration's importer and
-- by any future entry screen that wants "type a name, get a party_id".
CREATE OR REPLACE FUNCTION public.nf_resolve_party(p_company_id uuid, p_text text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT id FROM public.nf_parties WHERE company_id = p_company_id
      AND normalized_name = lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'))),
    (SELECT party_id FROM public.nf_party_aliases WHERE company_id = p_company_id
      AND normalized_alias = lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'))));
$function$;

CREATE OR REPLACE FUNCTION public.nf_list_parties(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'kind', p.kind, 'is_active', p.is_active,
           'aliases', COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM public.nf_party_aliases a
                                  WHERE a.party_id = p.id), '[]'::jsonb))
         ORDER BY p.name), '[]'::jsonb)
    FROM public.nf_parties p
   WHERE p.company_id = p_company_id AND public.nf_is_member(p_company_id, false);
$function$;

COMMIT;
