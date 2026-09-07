-- ════════════════════════════════════════════════════════════════════════
-- INVARIANT 9 and the day-ordering guard — the callers
-- ────────────────────────────────────────────────────────────────────────
-- record_cash_entry gains INSUFFICIENT_CASH in the §A9 shape, refusing a cash
-- payment that would take the drawer below zero, and accepting a CFO reason
-- that overrides it. The trigger in 20260907d is still the floor; this is the
-- message a person can act on.
--
-- A reason supplied on an entry that does NOT need one is dropped rather than
-- stored, so the Director's sheet never carries an explanation for nothing.
--
-- open_cash_day gains DAY_OUT_OF_ORDER: a day may not be opened behind one
-- that is already closed.
--
-- get_cash_day_pdf_data carries insufficient_cash_reason onto the sheet. An
-- override that is allowed but invisible is worse than no override at all.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_cash_entry(p_company_id uuid, p_cash_day_id uuid, p_idempotency_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_existing public.cash_entries;
  v_type text; v_mode text; v_dir text; v_vt text; v_no text;
  v_amount numeric(18,2); v_payee uuid; v_unit uuid; v_sale uuid; v_party text;
  v_head uuid; v_reason text; v_rms text; v_seq integer; v_cash_why text; v_pos numeric;
  v_id uuid; v_id_b uuid; v_grp uuid; v_clash date; v_active boolean;
  v_src uuid; v_dst uuid; v_src_acc public.cash_accounts; v_dst_acc public.cash_accounts;
  v_expected numeric(18,2); v_vtag text;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'An idempotency key is required so a retry cannot double-record.');
  END IF;

  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN', 'message', 'No such day.');
  END IF;
  IF NOT public._dc_may_record(v_me, p_company_id, v_day.project_id)
     OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- ── IDEMPOTENCY, before anything else ────────────────────────────────────
  -- A replay is not an error. It returns what the first call produced, so a
  -- cashier whose phone lost the response can press Save again without fear.
  SELECT * INTO v_existing FROM public.cash_entries
   WHERE company_id = p_company_id AND project_id = v_day.project_id
     AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
      'replayed', true, 'entry_id', v_existing.id, 'seq_no', v_existing.seq_no,
      'voucher_type', v_existing.voucher_type, 'voucher_no', v_existing.voucher_no,
      'transfer_group_id', v_existing.transfer_group_id);
  END IF;

  IF v_day.status <> 'OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_LOCKED',
      'message', 'This day is closed. A post-close change is an adjustment.');
  END IF;

  -- ── payload ──────────────────────────────────────────────────────────────
  v_type   := COALESCE(NULLIF(p_payload->>'entry_type',''), 'OTHER');
  v_mode   := NULLIF(p_payload->>'mode','');
  v_dir    := NULLIF(p_payload->>'direction','');
  v_no     := NULLIF(btrim(COALESCE(p_payload->>'voucher_no','')),'');
  v_amount := round(NULLIF(p_payload->>'amount','')::numeric, 2);
  v_payee  := NULLIF(p_payload->>'payee_id','')::uuid;
  v_unit   := NULLIF(p_payload->>'unit_id','')::uuid;
  v_sale   := NULLIF(p_payload->>'sale_id','')::uuid;
  -- Phase 2 cancelled 2026-09-07: the name replaces the key.
  v_party  := NULLIF(btrim(p_payload->>'party_label'),'');
  v_head   := NULLIF(p_payload->>'qb_account_id','')::uuid;
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'qb_override_reason','')),'');
  -- Invariant 9's override. Same shape as the QB head's reason above it.
  v_cash_why := NULLIF(btrim(COALESCE(p_payload->>'insufficient_cash_reason','')),'');
  v_expected := round(NULLIF(p_payload->>'expected_amount','')::numeric, 2);
  v_vtag   := NULLIF(p_payload->>'variance_tag','');

  IF v_type NOT IN ('CLIENT_RECEIPT','EXPENSE','TRANSFER','LOAN_CAPITAL','OTHER') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Unknown entry type.');
  END IF;

  -- §A12: the voucher type is DERIVED. A caller trying to set it is a caller
  -- who could make the chip disagree with the row, so it is refused outright
  -- rather than quietly ignored.
  IF p_payload ? 'voucher_type' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'voucher_type is derived from mode and direction and cannot be supplied.');
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'An entry needs a positive amount.');
  END IF;
  IF v_no IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'The voucher number from the book is required.');
  END IF;

  -- Invariant 6: the payee is chosen from the master and must still be active.
  IF v_payee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A payee is required; choose one from the list.');
  END IF;
  SELECT is_active INTO v_active FROM public.payees
   WHERE id = v_payee AND company_id = p_company_id;
  IF v_active IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'That payee does not belong to this company.');
  END IF;
  IF NOT v_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_INACTIVE',
      'message', 'That payee has been deactivated. Choose another.');
  END IF;

  IF v_type = 'CLIENT_RECEIPT' THEN
    -- A receipt still may not be anonymous. What changed is that the payer is
    -- a NAME rather than a foreign key: there is no unit master to select from
    -- any more, and inventing one here would be Phase 2 wearing a hat.
    IF v_party IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PARTY_REQUIRED',
        'message', 'Client money is always for somebody. Type the unit or party it is for.');
    END IF;
    -- Nothing is pending any more: there is no allocation waiting to happen.
    v_rms := 'NA';
  ELSE
    v_rms := 'NA';
  END IF;

  IF v_expected IS NOT NULL AND v_expected <> v_amount AND v_vtag IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'VARIANCE_TAG_REQUIRED',
      'message', 'The amount differs from what was expected — say which kind of difference it is.');
  END IF;

  -- ── TRANSFER: two rows, one act ──────────────────────────────────────────
  IF v_type = 'TRANSFER' THEN
    v_src := NULLIF(p_payload->>'from_cash_account_id','')::uuid;
    v_dst := NULLIF(p_payload->>'to_cash_account_id','')::uuid;
    IF v_src IS NULL OR v_dst IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'A transfer names the account it leaves and the account it reaches.');
    END IF;
    IF v_src = v_dst THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'A transfer cannot leave and reach the same account.');
    END IF;
    SELECT * INTO v_src_acc FROM public.cash_accounts WHERE id = v_src AND project_id = v_day.project_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
      'message', 'The source account is not one of this project''s.'); END IF;
    SELECT * INTO v_dst_acc FROM public.cash_accounts WHERE id = v_dst AND project_id = v_day.project_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
      'message', 'The destination account is not one of this project''s.'); END IF;
    IF NOT v_src_acc.is_active OR NOT v_dst_acc.is_active THEN
      RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
        'message', 'One of those accounts has been deactivated.'); END IF;

    -- Both legs' voucher numbers are checked BEFORE either is written, so the
    -- ordinary duplicate is a clean 409 and not a rolled-back half-transfer.
    FOR v_vt, v_clash IN
      SELECT x.vt, (SELECT e.created_at::date FROM public.cash_entries e
                     WHERE e.project_id = v_day.project_id AND e.voucher_type = x.vt
                       AND e.voucher_no = x.no AND NOT e.is_adjustment LIMIT 1)
      FROM (VALUES
        (public._dc_voucher_for(v_src_acc.kind, 'OUT'), v_no || '-A'),
        (public._dc_voucher_for(v_dst_acc.kind, 'IN'),  v_no || '-B')
      ) AS x(vt, no)
    LOOP
      IF v_clash IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
          'message', format('%s %s was already used on %s.', v_vt, v_no, v_clash),
          'conflicting_date', v_clash);
      END IF;
    END LOOP;

    -- ── INVARIANT 9, ON THE TRANSFER'S OUT LEG ─────────────────────────
    -- A transfer is TWO rows with real modes, so cash->bank is a genuine cash
    -- out. The single-movement guard above never sees it, because a transfer
    -- carries no mode in its payload — the modes come from the two accounts.
    -- Without this the trigger still refuses it, but as a raw database error
    -- instead of a message under a field. The test caught exactly that.
    IF v_src_acc.kind = 'CASH' THEN
      v_pos := public._dc_cash_position(v_day.id) - v_amount;
      IF v_pos < 0 THEN
        IF v_cash_why IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CASH',
            'message', format('This transfer would leave the drawer at %s. A drawer cannot move money it does not hold.',
                              to_char(v_pos, 'FM999,999,999,990.00')),
            'position_after', v_pos);
        END IF;
        IF NOT public._dc_is_cfo(v_me) THEN
          RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CASH',
            'message', 'Only the CFO may move cash the drawer does not hold.',
            'position_after', v_pos);
        END IF;
      ELSE
        v_cash_why := NULL;
      END IF;
    END IF;

    v_grp := gen_random_uuid();
    SELECT COALESCE(MAX(seq_no), 0) INTO v_seq FROM public.cash_entries WHERE cash_day_id = v_day.id;

    PERFORM set_config('rms.audit_reason',
      format('transfer %s from %s to %s', v_amount, v_src_acc.name, v_dst_acc.name), true);

    -- Leg A — money leaves the source. §A14: OUT debits the QB head and credits
    -- the mode account, so the head on this leg is the DESTINATION's.
    INSERT INTO public.cash_entries (
      company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
      mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
      cash_account_id, qb_account_id, rms_status, transfer_group_id, created_by)
    VALUES (
      p_company_id, v_day.project_id, v_day.id, v_seq + 1, p_idempotency_key, 'TRANSFER',
      v_src_acc.kind, 'OUT', public._dc_voucher_for(v_src_acc.kind,'OUT'), v_no || '-A',
      v_amount, NULLIF(p_payload->>'narration',''), v_payee,
      v_src, v_dst_acc.qb_account_id, 'NA', v_grp, v_me.id)
    RETURNING id INTO v_id;

    -- Leg B — money reaches the destination. No exception handler wraps these
    -- two inserts: if this one fails, leg A goes with it.
    INSERT INTO public.cash_entries (
      company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
      mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
      cash_account_id, qb_account_id, rms_status, transfer_group_id, created_by)
    VALUES (
      p_company_id, v_day.project_id, v_day.id, v_seq + 2, gen_random_uuid(), 'TRANSFER',
      v_dst_acc.kind, 'IN', public._dc_voucher_for(v_dst_acc.kind,'IN'), v_no || '-B',
      v_amount, NULLIF(p_payload->>'narration',''), v_payee,
      v_dst, v_src_acc.qb_account_id, 'NA', v_grp, v_me.id)
    RETURNING id INTO v_id_b;

    RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
      'replayed', false, 'transfer_group_id', v_grp,
      'entry_id', v_id, 'entry_id_b', v_id_b,
      'seq_no', v_seq + 1, 'seq_no_b', v_seq + 2);
  END IF;

  -- ── single movement ──────────────────────────────────────────────────────
  v_vt := public._dc_voucher_for(v_mode, v_dir);
  IF v_vt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'mode must be CASH or BANK and direction IN or OUT.');
  END IF;

  SELECT created_at::date INTO v_clash FROM public.cash_entries
   WHERE project_id = v_day.project_id AND voucher_type = v_vt
     AND voucher_no = v_no AND NOT is_adjustment LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
      'message', format('%s %s was already used on %s.', v_vt, v_no, v_clash),
      'conflicting_date', v_clash);
  END IF;

  BEGIN
    v_head := public._dc_resolve_head(p_company_id, v_type, v_head, v_reason);
  EXCEPTION WHEN restrict_violation THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM,
      'message', CASE SQLERRM
        WHEN 'OVERRIDE_REASON_REQUIRED' THEN 'That is not the usual account for this kind of entry — say why.'
        WHEN 'ACCOUNT_INACTIVE'  THEN 'That QuickBooks account has been deactivated.'
        WHEN 'ACCOUNT_REQUIRED'  THEN 'Choose a QuickBooks account for this entry.'
        ELSE 'That QuickBooks account does not belong to this company.' END);
  END;

  SELECT COALESCE(MAX(seq_no), 0) + 1 INTO v_seq FROM public.cash_entries WHERE cash_day_id = v_day.id;

  PERFORM set_config('rms.audit_reason', format('%s %s recorded', v_vt, v_no), true);

  -- ── INVARIANT 9 ────────────────────────────────────────────────────────
  -- The trigger enforces this whatever the path; this exists so a person sees
  -- it under the amount instead of a database error. Two layers on purpose,
  -- and both are tested (SR-12).
  IF v_mode = 'CASH' AND v_dir = 'OUT' THEN
    v_pos := public._dc_cash_position(v_day.id) - v_amount;
    IF v_pos < 0 THEN
      IF v_cash_why IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CASH',
          'message', format('This would leave the drawer at %s. A drawer cannot pay out money it does not hold.',
                            to_char(v_pos, 'FM999,999,999,990.00')),
          'position_after', v_pos);
      END IF;
      IF NOT public._dc_is_cfo(v_me) THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CASH',
          'message', 'Only the CFO may record an entry that takes the drawer below zero.',
          'position_after', v_pos);
      END IF;
    ELSE
      -- A reason on an entry that does not need one is dropped, not stored.
      -- Otherwise the sheet would carry an explanation for nothing.
      v_cash_why := NULL;
    END IF;
  ELSE
    v_cash_why := NULL;
  END IF;

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
    mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
    unit_id, sale_id, party_label, cash_account_id, qb_account_id, qb_override_reason,
    insufficient_cash_reason,
    allocation_kind, allocation_ref, expected_amount, variance_tag, variance_note,
    rms_status, created_by)
  VALUES (
    p_company_id, v_day.project_id, v_day.id, v_seq, p_idempotency_key, v_type,
    v_mode, v_dir, v_vt, v_no, v_amount, NULLIF(p_payload->>'narration',''), v_payee,
    -- unit_id and sale_id are FROZEN: never written again, kept for the rows
    -- that already carry them. See migration 20260907a.
    NULL, NULL, v_party, NULLIF(p_payload->>'cash_account_id','')::uuid, v_head, v_reason,
    v_cash_why,
    NULLIF(p_payload->>'allocation_kind',''), NULLIF(p_payload->>'allocation_ref',''),
    v_expected, v_vtag, NULLIF(p_payload->>'variance_note',''),
    v_rms, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
    'replayed', false, 'entry_id', v_id, 'seq_no', v_seq,
    'voucher_type', v_vt, 'voucher_no', v_no, 'rms_status', v_rms);
EXCEPTION
  WHEN unique_violation THEN
    -- Two replays racing, or a voucher that slipped between check and insert.
    SELECT * INTO v_existing FROM public.cash_entries
     WHERE company_id = p_company_id AND project_id = v_day.project_id
       AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
        'replayed', true, 'entry_id', v_existing.id, 'seq_no', v_existing.seq_no);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
      'message', 'That voucher number is already used.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_cash_day(p_company_id uuid, p_project_id uuid, p_business_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_date date; v_prev public.cash_days; v_id uuid;
  v_open_date date; v_o_cash numeric(18,2); v_o_bank numeric(18,2);
BEGIN
  IF NOT public._dc_may_record(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_date := COALESCE(p_business_date, public._dc_today());
  IF v_date > public._dc_today() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A day cannot be opened in the future.');
  END IF;

  -- At most one OPEN day per project (§A4). The partial unique index enforces
  -- it; this returns the blueprint's code and says which day is in the way.
  SELECT business_date INTO v_open_date FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'OPEN' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
      'message', format('%s is still open. Close it before opening another day.', v_open_date));
  END IF;

  -- The ledger reads forward. A day appearing BEHIND one already closed leaves
  -- a hole nobody notices: on 2026-09-05 the pilot closed 06 Sep and then
  -- opened 03 Sep, so 03 Sep's closing carried nowhere. Invariant 2 does not
  -- catch it — it only says 'the previous CLOSED day' — so this does.
  DECLARE v_after date;
  BEGIN
    v_after := public._dc_day_out_of_order(p_project_id, v_date);
    IF v_after IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'DAY_OUT_OF_ORDER',
        'message', format('%s is already closed. A day cannot be opened behind one that is closed.', v_after),
        'blocking_date', v_after);
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.cash_days
              WHERE project_id = p_project_id AND business_date = v_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', format('%s has already been opened and closed.', v_date));
  END IF;

  -- Invariant 2: opening is DERIVED. There is no parameter for it.
  SELECT * INTO v_prev FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'CLOSED'
   ORDER BY business_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SETUP_OPENING_REQUIRED',
      'message', 'Set the opening cash and bank balance before opening the first day.');
  END IF;
  v_o_cash := v_prev.closing_cash;
  v_o_bank := v_prev.closing_bank;

  PERFORM set_config('rms.audit_reason',
    format('opened %s; brought forward from %s', v_date, v_prev.business_date), true);

  INSERT INTO public.cash_days (company_id, project_id, business_date, status,
                                opening_cash, opening_bank, created_by)
  VALUES (p_company_id, p_project_id, v_date, 'OPEN', v_o_cash, v_o_bank, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'DayOpened',
    'cash_day_id', v_id, 'business_date', v_date,
    'opening_cash', v_o_cash, 'opening_bank', v_o_bank,
    'brought_forward_from', v_prev.business_date);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
    'message', 'Another day is already open for this project.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_day_pdf_data(p_company_id uuid, p_cash_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_proj text; v_t record;
  v_receipts jsonb; v_payments jsonb; v_adj jsonb; v_pdc jsonb;
  v_prepared text; v_closer text; v_next int;
BEGIN
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id;
  IF NOT FOUND OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT project_name INTO v_proj FROM public.projects WHERE id = v_day.project_id;
  SELECT * INTO v_t FROM public._dc_day_totals(v_day.id);

  -- A post-close adjustment is what was written AFTER closed_at — the same
  -- boundary screen S1 uses, and what §A13's ADJUSTMENTS block means. A void
  -- made while the day was open belongs in Payments/Receipts with the rest.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_receipts FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           p.name AS payee, COALESCE(e.party_label, u.unit_no) AS unit_no, e.narration,
           e.insufficient_cash_reason
      FROM public.cash_entries e
      LEFT JOIN public.payees p ON p.id = e.payee_id
      LEFT JOIN public.units  u ON u.id = e.unit_id
     WHERE e.cash_day_id = v_day.id AND e.direction = 'IN'
       AND NOT (e.is_adjustment AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_payments FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           p.name AS payee, COALESCE(e.party_label, u.unit_no) AS unit_no, e.narration,
           e.insufficient_cash_reason
      FROM public.cash_entries e
      LEFT JOIN public.payees p ON p.id = e.payee_id
      LEFT JOIN public.units  u ON u.id = e.unit_id
     WHERE e.cash_day_id = v_day.id AND e.direction = 'OUT'
       AND NOT (e.is_adjustment AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_adj FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           e.direction, e.adjustment_reason AS reason
      FROM public.cash_entries e
     WHERE e.cash_day_id = v_day.id AND e.is_adjustment
       AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at
  ) x;

  -- Cheques still out, for the project, as of this day. pdc_cheques is the one
  -- register (PDC_DECISION.md) — no phone number is read here either.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.due_date), '[]'::jsonb) INTO v_pdc FROM (
    SELECT c.cheque_no, c.amount, c.cheque_date AS due_date, c.status
      FROM public.pdc_cheques c
     WHERE c.company_id = p_company_id AND c.project_id = v_day.project_id
       AND c.status IN ('pending', 'deposited', 'bounced')
     LIMIT 12
  ) x;

  SELECT full_name INTO v_closer FROM public.app_users WHERE id = v_day.closed_by;
  SELECT u.full_name INTO v_prepared
    FROM public.cash_entries e JOIN public.app_users u ON u.id = e.created_by
   WHERE e.cash_day_id = v_day.id ORDER BY e.seq_no LIMIT 1;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM public.day_documents WHERE cash_day_id = v_day.id AND kind = 'DIRECTOR_PDF';

  RETURN jsonb_build_object(
    'success', true,
    'project_id', v_day.project_id, 'project_name', v_proj,
    'business_date', v_day.business_date, 'status', v_day.status,
    'opening_cash', v_day.opening_cash, 'opening_bank', v_day.opening_bank,
    'in_cash', v_t.in_cash, 'out_cash', v_t.out_cash,
    'in_bank', v_t.in_bank, 'out_bank', v_t.out_bank,
    'closing_cash', COALESCE(v_day.closing_cash, v_day.opening_cash + v_t.in_cash - v_t.out_cash),
    'closing_bank', COALESCE(v_day.closing_bank, v_day.opening_bank + v_t.in_bank - v_t.out_bank),
    'counted_cash', v_day.counted_cash, 'variance', v_day.variance,
    'variance_note', v_day.variance_note,
    'closed_at', v_day.closed_at, 'closed_by_name', v_closer, 'prepared_by', v_prepared,
    'receipts', v_receipts, 'payments', v_payments,
    'adjustments', v_adj, 'pdc_pending', v_pdc,
    'next_version', v_next);
END;
$function$;
