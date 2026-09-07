-- ════════════════════════════════════════════════════════════════════════
-- SEPARATION · step 2 — the two functions that knew about units
-- ────────────────────────────────────────────────────────────────────────
-- record_cash_entry stops writing unit_id and sale_id, and stops demanding a
-- unit for a client receipt. UNIT_REQUIRED becomes PARTY_REQUIRED, in the same
-- §A9 shape and on its own field: a receipt still may not be anonymous, but the
-- payer is now a typed name. rms_status stops reaching PENDING, because there
-- is no allocation left to be pending for.
--
-- get_cash_day_pdf_data reads party_label — and STILL falls back to the units
-- join for rows written before today.
--
-- ⚠️ THAT FALLBACK IS A DELIBERATE RESIDUE, AND IT IS NOT WHAT THE PLAN SAID.
-- The plan said "stop joining units". Doing that outright would blank the unit
-- number on 98 historical rows if their day were ever re-rendered, one of which
-- sits in the permanent golden-PDF fixture — so it would also force that golden
-- file to be re-baselined inside a cleanup migration. Re-approving a golden
-- artefact as a side effect of housekeeping is the quiet kind of weakening this
-- module has spent a week learning to refuse.
--
-- So the join stays as a READ-ONLY fallback for frozen rows. Nothing new is
-- ever written to unit_id, and nothing selects a unit any more. All 98 rows are
-- on ZZTEST; Awami has none. REMOVAL CONDITION: drop the join when identity and
-- tenancy are replaced in the standalone blueprint, at which point those rows
-- are gone with the tenant.
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
    unit_id, sale_id, party_label, cash_account_id, qb_account_id, qb_override_reason,
    allocation_kind, allocation_ref, expected_amount, variance_tag, variance_note,
    rms_status, created_by)
  VALUES (
    p_company_id, v_day.project_id, v_day.id, v_seq, p_idempotency_key, v_type,
    v_mode, v_dir, v_vt, v_no, v_amount, NULLIF(p_payload->>'narration',''), v_payee,
    -- unit_id and sale_id are FROZEN: never written again, kept for the rows
    -- that already carry them. See migration 20260907a.
    NULL, NULL, v_party, NULLIF(p_payload->>'cash_account_id','')::uuid, v_head, v_reason,
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
           p.name AS payee, COALESCE(e.party_label, u.unit_no) AS unit_no, e.narration
      FROM public.cash_entries e
      LEFT JOIN public.payees p ON p.id = e.payee_id
      LEFT JOIN public.units  u ON u.id = e.unit_id
     WHERE e.cash_day_id = v_day.id AND e.direction = 'IN'
       AND NOT (e.is_adjustment AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_payments FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           p.name AS payee, COALESCE(e.party_label, u.unit_no) AS unit_no, e.narration
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

-- ── void_cash_entry: the reversal must not carry a frozen column ────────
-- Found by the P4 rehearsal, and it is a defect the freeze itself introduced:
-- the reversing entry copied unit_id and sale_id from the original, so the new
-- trigger would have refused every void of a historical receipt. 98 such rows
-- exist on ZZTEST. Awami has none, which is exactly why this had to be caught
-- by a test and not by a user.

CREATE OR REPLACE FUNCTION public.void_cash_entry(p_company_id uuid, p_entry_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    unit_id, sale_id, party_label, cash_account_id, qb_account_id, rms_status,
    is_adjustment, adjusts_entry_id, adjustment_reason, created_by)
  VALUES (
    p_company_id, v_e.project_id, v_day.id, v_seq, gen_random_uuid(), 'OTHER',
    v_e.mode, v_dir, v_vt, v_e.voucher_no || '-VOID', v_e.amount,
    left('Void of ' || v_e.voucher_type || '-' || v_e.voucher_no ||
         COALESCE(' — ' || v_e.narration, ''), 500), v_e.payee_id,
    -- The reversal copied unit_id and sale_id from the original. Those columns
    -- froze on 2026-09-07 and _trg_cash_entries_frozen refuses any new row that
    -- carries them — so voiding one of the 98 historical receipts that DO carry
    -- a unit would have failed outright. The reversal carries the NAME across
    -- instead, which is what the original would carry if it were written today.
    NULL, NULL, COALESCE(v_e.party_label, v_e.unit_id::text), v_e.cash_account_id, v_e.qb_account_id, 'NA',
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
$function$;
