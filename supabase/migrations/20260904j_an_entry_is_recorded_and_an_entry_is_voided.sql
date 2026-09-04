-- ═══════════════════════════════════════════════════════════════════════════
-- An entry is recorded, and an entry is voided
-- ───────────────────────────────────────────────────────────────────────────
-- P4: RecordEntry, VoidEntry, attachments, ListEntries. A separate prompt from
-- P3 on purpose — idempotency, seq_no locking and transfer atomicity are three
-- of the hardest rules in §A7, and in a combined services commit they get
-- skimmed.
--
-- THE THREE HARD ONES, and how each is actually held:
--
--   IDEMPOTENCY. The key is checked FIRST, before any validation, so a replay
--   returns the original entry and a success — never a 409, never a second row.
--   The UNIQUE (company_id, project_id, idempotency_key) index is the backstop
--   if two replays race.
--
--   seq_no. Assigned after SELECT … FOR UPDATE on the cash_days row, so two
--   writers on one day serialise. UNIQUE (cash_day_id, seq_no) is the backstop.
--   ⚠️ This file cannot prove two-writer concurrency — see the note in the test
--   suite. What it proves is the lock is taken and the constraint holds.
--
--   TRANSFER ATOMICITY. Both legs are inserted in one function with NO
--   exception handler around them, so a failure on the second leg takes the
--   first with it. That is Postgres, not hope — and the suite proves it by
--   making the second leg fail on purpose.
--
-- Invariant 1 is why VoidEntry writes a reversing ROW instead of touching the
-- original: the only thing it changes on the original is rms_status, which is
-- one of the five whitelisted routing columns.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Who may void ───────────────────────────────────────────────────────────
-- §A10: "Void entry, payees CRUD" sits at Accountant and CFO — not Cashier,
-- not Director. Same set as payee maintenance, named for what it is.
CREATE OR REPLACE FUNCTION public._dc_is_accountant_plus(p_user public.app_users)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT p_user.role IN ('finance', 'accounts') OR public._dc_is_cfo(p_user);
$fn$;

-- P2's payee gate is the same rule; point it at the shared definition rather
-- than let two copies drift.
CREATE OR REPLACE FUNCTION public._dc_can_manage_payees(p_user public.app_users)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT public._dc_is_accountant_plus(p_user);
$fn$;

REVOKE ALL ON FUNCTION public._dc_is_accountant_plus(public.app_users) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_is_accountant_plus(public.app_users) TO service_role;

-- ── Shared resolution: which QuickBooks head, and is an override explained? ─
-- Returns the head to store, or raises the blueprint's own error code. Kept
-- separate because RecordEntry uses it for one leg and twice for a transfer.
CREATE OR REPLACE FUNCTION public._dc_resolve_head(
  p_company_id uuid, p_entry_type text, p_supplied uuid, p_override_reason text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_default uuid; v_active boolean;
BEGIN
  SELECT default_qb_account_id INTO v_default FROM public.entry_type_defaults
   WHERE company_id = p_company_id AND entry_type = p_entry_type;

  IF p_supplied IS NULL THEN
    IF v_default IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_REQUIRED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN v_default;   -- the default needs no reason; it IS the rule
  END IF;

  IF v_default IS NOT NULL AND p_supplied <> v_default
     AND (p_override_reason IS NULL OR btrim(p_override_reason) = '') THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT is_active INTO v_active FROM public.qb_accounts
   WHERE id = p_supplied AND company_id = p_company_id;
  IF v_active IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN p_supplied;
END;
$fn$;

REVOKE ALL ON FUNCTION public._dc_resolve_head(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_resolve_head(uuid, text, uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RecordEntry (§A4, §A7, §A8)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_cash_entry(
  p_company_id uuid, p_cash_day_id uuid, p_idempotency_key uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_existing public.cash_entries;
  v_type text; v_mode text; v_dir text; v_vt text; v_no text;
  v_amount numeric(18,2); v_payee uuid; v_unit uuid; v_sale uuid;
  v_head uuid; v_reason text; v_rms text; v_seq integer;
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
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id)
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
  v_head   := NULLIF(p_payload->>'qb_account_id','')::uuid;
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'qb_override_reason','')),'');
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
    IF v_unit IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNIT_REQUIRED',
        'message', 'Client money is always against a unit.');
    END IF;
    v_rms := 'PENDING';
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

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
    mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
    unit_id, sale_id, cash_account_id, qb_account_id, qb_override_reason,
    allocation_kind, allocation_ref, expected_amount, variance_tag, variance_note,
    rms_status, created_by)
  VALUES (
    p_company_id, v_day.project_id, v_day.id, v_seq, p_idempotency_key, v_type,
    v_mode, v_dir, v_vt, v_no, v_amount, NULLIF(p_payload->>'narration',''), v_payee,
    v_unit, v_sale, NULLIF(p_payload->>'cash_account_id','')::uuid, v_head, v_reason,
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
$fn$;

REVOKE ALL ON FUNCTION public.record_cash_entry(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_cash_entry(uuid, uuid, uuid, jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- VoidEntry (§A4, invariant 1) — Accountant+, OPEN days only.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.void_cash_entry(
  p_company_id uuid, p_entry_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_e public.cash_entries; v_day public.cash_days;
  v_dir text; v_vt text; v_seq integer; v_id uuid;
BEGIN
  SELECT * INTO v_e FROM public.cash_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION', 'message', 'No such entry.');
  END IF;
  SELECT * INTO v_day FROM public.cash_days WHERE id = v_e.cash_day_id FOR UPDATE;

  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_e.project_id)
     OR v_e.company_id IS DISTINCT FROM p_company_id
     OR NOT public._dc_is_accountant_plus(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF v_day.status <> 'OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_LOCKED',
      'message', 'That day is closed. Post an adjustment instead.');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'OVERRIDE_REASON_REQUIRED',
      'message', 'A void always says why.');
  END IF;
  IF v_e.is_adjustment THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A reversal cannot itself be voided.');
  END IF;
  IF v_e.direction IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A journal voucher has no direction to reverse.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_entries WHERE adjusts_entry_id = v_e.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'That entry has already been voided.');
  END IF;

  v_dir := CASE v_e.direction WHEN 'IN' THEN 'OUT' ELSE 'IN' END;
  v_vt  := public._dc_voucher_for(v_e.mode, v_dir);
  SELECT COALESCE(MAX(seq_no), 0) + 1 INTO v_seq FROM public.cash_entries WHERE cash_day_id = v_day.id;

  PERFORM set_config('rms.audit_reason', btrim(p_reason), true);

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
    mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
    unit_id, sale_id, cash_account_id, qb_account_id, rms_status,
    is_adjustment, adjusts_entry_id, adjustment_reason, created_by)
  VALUES (
    p_company_id, v_e.project_id, v_day.id, v_seq, gen_random_uuid(), 'OTHER',
    v_e.mode, v_dir, v_vt, v_e.voucher_no || '-VOID', v_e.amount,
    left('Void of ' || v_e.voucher_type || '-' || v_e.voucher_no ||
         COALESCE(' — ' || v_e.narration, ''), 500), v_e.payee_id,
    v_e.unit_id, v_e.sale_id, v_e.cash_account_id, v_e.qb_account_id, 'NA',
    true, v_e.id, btrim(p_reason), v_me.id)
  RETURNING id INTO v_id;

  -- Invariant 1: the original is untouched except for its routing status, which
  -- is one of the five columns the immutability trigger allows to move. Money
  -- that was received and then voided was never APPLIED — it is unapplied.
  IF v_e.rms_status = 'PENDING' THEN
    UPDATE public.cash_entries
       SET rms_status = 'UNAPPLIED', rms_status_reason = 'Voided'
     WHERE id = v_e.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'event', 'EntryVoided',
    'reversal_id', v_id, 'voided_entry_id', v_e.id, 'seq_no', v_seq,
    'voucher_type', v_vt, 'voucher_no', v_e.voucher_no || '-VOID',
    'original_rms_status', CASE WHEN v_e.rms_status = 'PENDING' THEN 'UNAPPLIED' ELSE v_e.rms_status END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.void_cash_entry(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_cash_entry(uuid, uuid, text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Attachments (§A7) — the row and the authorisation. See the note below.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.add_cash_entry_attachment(
  p_company_id uuid, p_entry_id uuid, p_storage_key text,
  p_mime text, p_size_bytes bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_e public.cash_entries; v_id uuid;
BEGIN
  SELECT * INTO v_e FROM public.cash_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION', 'message', 'No such entry.');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_e.project_id)
     OR v_e.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- §A7: jpg/png/pdf, 10 MB. Checked here as well as by the CHECK constraints
  -- so the caller gets a sentence instead of a constraint name.
  IF p_mime IS NULL OR p_mime NOT IN ('image/jpeg','image/jpg','image/png','application/pdf') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Attachments must be a JPG, PNG or PDF.');
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Attachments must be larger than nothing and no more than 10 MB.');
  END IF;
  IF p_storage_key IS NULL OR btrim(p_storage_key) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A storage key is required.');
  END IF;
  -- Invariant 8: the path is scoped to the project, so one project's bill can
  -- never be addressed from another's.
  IF p_storage_key NOT LIKE (v_e.project_id::text || '/%') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED',
      'message', 'The storage path must begin with this entry''s project id.');
  END IF;

  INSERT INTO public.cash_entry_attachments (company_id, entry_id, storage_key, mime, size_bytes, uploaded_by)
  VALUES (p_company_id, p_entry_id, btrim(p_storage_key),
          CASE WHEN p_mime = 'image/jpg' THEN 'image/jpeg' ELSE p_mime END,
          p_size_bytes, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'attachment_id', v_id, 'entry_id', p_entry_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.add_cash_entry_attachment(uuid, uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_cash_entry_attachment(uuid, uuid, text, text, bigint) TO authenticated, service_role;

-- The authorisation half of the signed-URL getter.
--
-- ⚠️ Postgres cannot mint a signed URL — that is a Storage API call. This RPC
-- answers "may this caller read this file, and where is it", and the signing is
-- a thin service-key step. The `daily-closing` bucket deliberately has NO
-- policy, so `authenticated` cannot sign for itself; the precedent is the
-- bridge edge function used for employee documents (20260828j). That bridge is
-- NOT built here — it ships with P6, the screen that first needs to show a
-- thumbnail. Until then an attachment can be recorded and authorised but not
-- fetched. Recorded as an open item.
CREATE OR REPLACE FUNCTION public.authorize_cash_attachment(
  p_company_id uuid, p_attachment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_a public.cash_entry_attachments; v_project uuid;
BEGIN
  SELECT * INTO v_a FROM public.cash_entry_attachments
   WHERE id = p_attachment_id AND company_id = p_company_id;
  IF FOUND THEN
    SELECT project_id INTO v_project FROM public.cash_entries WHERE id = v_a.entry_id;
  END IF;
  IF v_a.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION', 'message', 'No such attachment.');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_project) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  RETURN jsonb_build_object('success', true, 'bucket', 'daily-closing',
    'storage_key', v_a.storage_key, 'mime', v_a.mime, 'size_bytes', v_a.size_bytes,
    'expires_in', 600);
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_cash_attachment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_cash_attachment(uuid, uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ListEntries (§A12 S1's ledger)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_cash_entries(
  p_company_id uuid, p_cash_day_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_rows jsonb;
BEGIN
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN', 'message', 'No such day.');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id)
     OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.seq_no), '[]'::jsonb) INTO v_rows FROM (
    SELECT e.id, e.seq_no, e.entry_type, e.mode, e.direction,
           e.voucher_type, e.voucher_no, e.amount, e.narration,
           e.rms_status, e.qb_status, e.is_adjustment, e.adjusts_entry_id,
           e.transfer_group_id, e.unit_id, e.created_at,
           p.name  AS payee_name,
           a.number AS qb_number, a.name AS qb_name,
           ca.name AS cash_account_name,
           -- struck through in the ledger: something reverses this row
           EXISTS (SELECT 1 FROM public.cash_entries v WHERE v.adjusts_entry_id = e.id) AS is_voided,
           (SELECT v.id FROM public.cash_entries v WHERE v.adjusts_entry_id = e.id LIMIT 1) AS reversal_id,
           e.is_adjustment AS is_reversal,
           (SELECT count(*) FROM public.cash_entry_attachments at WHERE at.entry_id = e.id) AS attachments
      FROM public.cash_entries e
      LEFT JOIN public.payees p       ON p.id  = e.payee_id
      LEFT JOIN public.qb_accounts a  ON a.id  = e.qb_account_id
      LEFT JOIN public.cash_accounts ca ON ca.id = e.cash_account_id
     WHERE e.cash_day_id = p_cash_day_id
  ) r;

  RETURN jsonb_build_object('success', true, 'cash_day_id', p_cash_day_id,
    'business_date', v_day.business_date, 'status', v_day.status, 'entries', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_cash_entries(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cash_entries(uuid, uuid) TO authenticated, service_role;

COMMIT;
