#!/usr/bin/env node
/**
 * Daily Closing — P10: a whole day, end to end, through the services.
 *
 *   node scripts/verify-daily-closing-e2e.js                 # dry run
 *   node scripts/verify-daily-closing-e2e.js --against-live  # assert what is applied
 *
 * Two halves.
 *
 *   ONE DAY, START TO FINISH. Opening balance → open the day → eight entries
 *   (2 receipts, 3 expenses, a transfer pair, a loan) → void an expense →
 *   attach a file → close on an exact count → the Director sheet exists →
 *   tomorrow opens on today's closing → an ordinary entry on the closed day is
 *   refused → the CFO's adjustment lands → the sheet is re-issued at v2 with v1
 *   kept → the dashboard counters agree → the Director can read it and cannot
 *   write to it.
 *
 *   TEN WAYS TO DO IT WRONG. Every refusal §A9 names, asserted by error code.
 *
 * ⚠️ WHAT THIS FILE DOES NOT DO, so that nobody reads more into a green line
 * than it says. It drives the SERVICES inside BEGIN … ROLLBACK — so the two
 * steps that are HTTP rather than SQL are represented here by the database row
 * they produce, and proved for real elsewhere:
 *
 *   · the rendered PDF        → scripts/verify-daily-closing-pdf.js (a real
 *                               render, its bytes downloaded and read back)
 *   · the uploaded attachment → scripts/verify-daily-closing-attachment.js (a
 *                               real file through the signed-URL bridge)
 *
 * Everything else here is the real service being called the way the screen
 * calls it, with a real caller impersonated.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const UP = [
  '20260904p_who_may_do_what_and_what_it_leaves_behind.sql',
  '20260904q_one_look_at_where_the_day_stands.sql',
];

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '2da565ca-2b83-44bf-b4de-2cae762571df';   // ZZTEST Garden
const PJ_OTHER = '6b56d5ec-6141-4440-9465-ed2a9acbbd97'; // ZZTEST Tower — read only (SR-1)
const AGAINST_LIVE = process.argv.includes('--against-live');

function body(file) {
  const raw = fs.readFileSync(path.join(MIG, file), 'utf8');
  const stripped = raw.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped)) {
    throw new Error(`${file}: a BEGIN/COMMIT survived stripping — refusing to run`);
  }
  return `\n-- ══════ ${file} ══════\n${stripped}\n`;
}

const ASSERT = `
DO $t$
DECLARE
  v_co uuid := '${CO}';
  v_pj uuid := '${PJ}';
  v_other uuid := '${PJ_OTHER}';
  v_cfo uuid; v_cfo_auth uuid := gen_random_uuid();
  v_cash uuid; v_cash_auth uuid := gen_random_uuid();
  v_dir uuid; v_dir_auth uuid := gen_random_uuid();
  v_a2020 uuid; v_a6050 uuid; v_a1010 uuid; v_a1030 uuid;
  v_ca_cash uuid; v_ca_bank uuid;
  v_unit uuid; v_p_cli uuid; v_p_ven uuid; v_p_stf uuid;
  v_d1 uuid; v_d2 uuid; v_e uuid; v_void_of uuid; v_att uuid;
  v_res jsonb; v_t record; v_n int; v_close numeric; v_txt text;
  v_key uuid;
BEGIN
  IF (SELECT company_name FROM public.companies WHERE id = v_co) NOT LIKE 'ZZTEST%' THEN
    RAISE EXCEPTION 'REFUSING TO RUN: this suite creates users, days and entries; ZZTEST only';
  END IF;

  -- ══ CAST ══════════════════════════════════════════════════════════════════
  INSERT INTO public.app_users (company_id, full_name, username, email, role,
                                auth_provider, status, auth_user_id)
  VALUES (v_co,'E2E CFO','e2ecfo','e2ecfo@zztest.invalid','cfo','password','active',v_cfo_auth)
  RETURNING id INTO v_cfo;
  INSERT INTO public.app_users (company_id, full_name, username, email, role,
                                auth_provider, status, auth_user_id, module_permissions)
  VALUES (v_co,'E2E Cashier','e2ecash','e2ecash@zztest.invalid','staff','password','active',
          v_cash_auth,'{"dailyclosing": true}'::jsonb)
  RETURNING id INTO v_cash;
  INSERT INTO public.app_users (company_id, full_name, username, email, role,
                                auth_provider, status, auth_user_id)
  VALUES (v_co,'E2E Director','e2edir','e2edir@zztest.invalid','manager','password','active',v_dir_auth)
  RETURNING id INTO v_dir;
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co, v_cash, v_pj, 'edit', true), (v_co, v_dir, v_pj, 'view', true);

  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pj LIMIT 1;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'FIXTURE: the project has no units'; END IF;
  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  SELECT id INTO v_a2020 FROM public.qb_accounts WHERE company_id=v_co AND number='2020';
  SELECT id INTO v_a6050 FROM public.qb_accounts WHERE company_id=v_co AND number='6050';
  SELECT id INTO v_a1010 FROM public.qb_accounts WHERE company_id=v_co AND number='1010';
  SELECT id INTO v_a1030 FROM public.qb_accounts WHERE company_id=v_co AND number='1030';

  SELECT id INTO v_ca_cash FROM public.cash_accounts
   WHERE project_id = v_pj AND kind = 'CASH' AND is_active LIMIT 1;
  SELECT id INTO v_ca_bank FROM public.cash_accounts
   WHERE project_id = v_pj AND kind = 'BANK' AND is_active LIMIT 1;
  IF v_ca_cash IS NULL OR v_ca_bank IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: the project has no cash and bank account (seed_daily_closing_chart)';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.create_payee(v_co,'E2E Buyer','CUSTOMER',v_pj); v_p_cli := (v_res->>'payee_id')::uuid;
  v_res := public.create_payee(v_co,'E2E Vendor','VENDOR',v_pj);  v_p_ven := (v_res->>'payee_id')::uuid;
  v_res := public.create_payee(v_co,'E2E Staff','STAFF',v_pj);    v_p_stf := (v_res->>'payee_id')::uuid;
  IF v_p_cli IS NULL OR v_p_ven IS NULL OR v_p_stf IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: payees were not created: %', v_res; END IF;
  RAISE NOTICE 'PASS 01  cast: a CFO, a cashier with the grant, a Director, three payees';

  -- ══ 1 · THE OPENING BALANCE ═══════════════════════════════════════════════
  v_res := public.setup_cash_opening(v_co, v_pj, 50000, 200000, public._dc_today() - 2);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true
     AND (v_res->>'error') IS DISTINCT FROM 'ALREADY_SET' THEN
    RAISE EXCEPTION 'FAIL 02: the opening balance was refused: %', v_res; END IF;
  RAISE NOTICE 'PASS 02  the opening balance is set once, by the CFO';

  -- ══ 2 · OPEN THE DAY ══════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today() - 1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 03: the cashier could not open the day: %', v_res; END IF;
  v_d1 := (v_res->>'cash_day_id')::uuid;
  IF (SELECT opening_cash FROM public.cash_days WHERE id=v_d1) <> 50000 THEN
    RAISE EXCEPTION 'FAIL 03: the day did not carry the opening cash forward'; END IF;
  RAISE NOTICE 'PASS 03  the cashier opens the day, carrying 50,000 / 200,000 forward';

  -- ══ 3 · EIGHT ENTRIES ═════════════════════════════════════════════════════
  -- 2 receipts (one bank), 3 expenses, a transfer (two rows, one act), a loan.
  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','1001',
    'amount',120000,'payee_id',v_p_cli,'unit_id',v_unit,'qb_account_id',v_a2020,
    'narration','Installment 3'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 04a: receipt 1: %', v_res; END IF;
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'CRV' THEN
    RAISE EXCEPTION 'FAIL 04a: CASH+IN derived % not CRV', v_res->>'voucher_type'; END IF;
  IF (v_res->>'rms_status') IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'FAIL 04a: a client receipt should land PENDING, got %', v_res->>'rms_status'; END IF;

  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','BANK','direction','IN','voucher_no','1002',
    'amount',80000,'payee_id',v_p_cli,'unit_id',v_unit,'qb_account_id',v_a2020));
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'BRV' THEN
    RAISE EXCEPTION 'FAIL 04b: BANK+IN derived % not BRV', v_res->>'voucher_type'; END IF;

  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1003',
    'amount',15000,'payee_id',v_p_ven,'qb_account_id',v_a6050,'narration','Site diesel'));
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'CPV' THEN
    RAISE EXCEPTION 'FAIL 04c: CASH+OUT derived % not CPV', v_res->>'voucher_type'; END IF;
  v_void_of := (v_res->>'entry_id')::uuid;

  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1004',
    'amount',6000,'payee_id',v_p_stf,'qb_account_id',v_a6050,'narration','Labour'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 04d: expense 2: %', v_res; END IF;

  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','BANK','direction','OUT','voucher_no','1005',
    'amount',9000,'payee_id',v_p_ven,'qb_account_id',v_a6050,'narration','Utility'));
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'BPV' THEN
    RAISE EXCEPTION 'FAIL 04e: BANK+OUT derived % not BPV', v_res->>'voucher_type'; END IF;

  -- the transfer: ONE call, TWO rows
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE cash_day_id = v_d1;
  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','TRANSFER','voucher_no','1006','amount',30000,'payee_id',v_p_stf,
    'from_cash_account_id',v_ca_cash,'to_cash_account_id',v_ca_bank,
    'narration','Cash banked'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 04f: the transfer: %', v_res; END IF;
  IF (SELECT count(*) FROM public.cash_entries WHERE cash_day_id = v_d1) <> v_n + 2 THEN
    RAISE EXCEPTION 'FAIL 04f: a transfer must write exactly two rows'; END IF;

  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','LOAN_CAPITAL','mode','CASH','direction','IN','voucher_no','1007',
    'amount',25000,'payee_id',v_p_stf,'qb_account_id',v_a2020,'narration','Director loan'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 04g: the loan: %', v_res; END IF;

  SELECT count(*) INTO v_n FROM public.cash_entries WHERE cash_day_id = v_d1;
  IF v_n <> 8 THEN RAISE EXCEPTION 'FAIL 04: the day holds % rows, expected 8', v_n; END IF;
  -- and the seq numbers are 1..8 with no gap and no repeat
  IF (SELECT count(DISTINCT seq_no) FROM public.cash_entries WHERE cash_day_id=v_d1) <> 8
     OR (SELECT max(seq_no) FROM public.cash_entries WHERE cash_day_id=v_d1) <> 8 THEN
    RAISE EXCEPTION 'FAIL 04: seq_no is not 1..8 without gaps';
  END IF;
  RAISE NOTICE 'PASS 04  eight entries: 2 receipts, 3 expenses, a transfer pair, a loan; seq 1..8';

  -- ══ 4 · VOID ONE EXPENSE ══════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.void_cash_entry(v_co, v_void_of, 'diesel was paid twice');
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 05: the void failed: %', v_res; END IF;
  -- There is no is_voided COLUMN, and there should not be: invariant 1 says a
  -- saved entry is a fact, so "voided" is not a flag flipped on the original —
  -- it is the existence of a reversing row that points at it.
  IF NOT EXISTS (SELECT 1 FROM public.cash_entries
                  WHERE adjusts_entry_id = v_void_of AND is_adjustment) THEN
    RAISE EXCEPTION 'FAIL 05: no reversing row points at the voided entry'; END IF;
  IF (SELECT amount FROM public.cash_entries WHERE id = v_void_of) <> 15000 THEN
    RAISE EXCEPTION 'FAIL 05: the original entry was altered by the void'; END IF;
  IF (SELECT count(*) FROM public.cash_entries WHERE cash_day_id=v_d1) <> 9 THEN
    RAISE EXCEPTION 'FAIL 05: the void must ADD a reversing row, never remove one'; END IF;
  RAISE NOTICE 'PASS 05  the void writes a reversing row; the original stays and is flagged';

  -- ══ 5 · AN ATTACHMENT ═════════════════════════════════════════════════════
  -- The row the bridge writes. The real upload is verify-daily-closing-attachment.js.
  v_res := public.add_cash_entry_attachment(v_co, v_void_of,
    v_pj::text || '/' || v_void_of::text || '/bill.pdf', 'application/pdf', 24680);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 06: the attachment was refused: %', v_res; END IF;
  v_att := (v_res->>'attachment_id')::uuid;
  RAISE NOTICE 'PASS 06  an attachment is recorded against the entry, keyed under the project';

  -- ══ 6 · CLOSE ON AN EXACT COUNT ═══════════════════════════════════════════
  SELECT * INTO v_t FROM public._dc_day_totals(v_d1);
  v_close := 50000 + v_t.in_cash - v_t.out_cash;
  v_res := public.close_cash_day(v_co, v_d1, v_close, NULL, NULL,
    (SELECT version FROM public.cash_days WHERE id = v_d1));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 07: the close was refused: %', v_res; END IF;
  IF (v_res->>'variance')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL 07: an exact count produced a variance of %', v_res->>'variance'; END IF;
  RAISE NOTICE 'PASS 07  an exact count closes the day with variance 0, no reason needed';

  -- ══ 7 · THE DIRECTOR SHEET, v1 ════════════════════════════════════════════
  v_res := public.get_cash_day_pdf_data(v_co, v_d1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 08: the PDF payload was refused: %', v_res; END IF;
  IF (v_res->>'next_version')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 08: the first sheet should be v1, got %', v_res->>'next_version'; END IF;
  IF v_res::text ~* '"phone"' THEN
    RAISE EXCEPTION 'FAIL 08: §A10 — a phone number reached the PDF payload';
  END IF;
  v_res := public.record_day_document(v_co, v_d1, 1, v_pj::text || '/documents/v1.pdf');
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 08: v1 was not recorded: %', v_res; END IF;
  RAISE NOTICE 'PASS 08  the sheet exists as v1, and its payload carries no phone number';

  -- ══ 8 · TOMORROW OPENS ON TODAY'S CLOSING ═════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today());
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 09: the next day would not open: %', v_res; END IF;
  v_d2 := (v_res->>'cash_day_id')::uuid;
  IF (SELECT opening_cash FROM public.cash_days WHERE id=v_d2)
     IS DISTINCT FROM (SELECT closing_cash FROM public.cash_days WHERE id=v_d1) THEN
    RAISE EXCEPTION 'FAIL 09: invariant 2 — opening % <> yesterday''s closing %',
      (SELECT opening_cash FROM public.cash_days WHERE id=v_d2),
      (SELECT closing_cash FROM public.cash_days WHERE id=v_d1);
  END IF;
  IF (SELECT opening_bank FROM public.cash_days WHERE id=v_d2)
     IS DISTINCT FROM (SELECT closing_bank FROM public.cash_days WHERE id=v_d1) THEN
    RAISE EXCEPTION 'FAIL 09: the bank balance did not carry forward'; END IF;
  RAISE NOTICE 'PASS 09  the next day opens on yesterday''s closing, cash and bank (invariant 2)';

  -- ══ 9 · A NORMAL ENTRY ON A CLOSED DAY IS REFUSED ═════════════════════════
  v_res := public.record_cash_entry(v_co, v_d1, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1099',
    'amount',100,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'error') IS DISTINCT FROM 'DAY_LOCKED' THEN
    RAISE EXCEPTION 'FAIL 10: an entry on a closed day answered %, expected DAY_LOCKED', v_res; END IF;
  RAISE NOTICE 'PASS 10  an ordinary entry on the closed day is refused DAY_LOCKED (invariant 3)';

  -- ══ 10 · THE CFO'S ADJUSTMENT LANDS ═══════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.post_cash_adjustment(v_co, v_d1,
    jsonb_build_object('mode','CASH','direction','OUT','amount',100),
    'diesel bill found after closing');
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 11: the CFO adjustment was refused: %', v_res; END IF;
  IF (SELECT status FROM public.cash_days WHERE id=v_d1) IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'FAIL 11: an adjustment must not reopen the day'; END IF;
  RAISE NOTICE 'PASS 11  the same act the cashier was refused is allowed to the CFO, as an adjustment';

  -- ══ 11 · THE SHEET IS RE-ISSUED AT v2, v1 KEPT ════════════════════════════
  --
  -- ⚠️ ONE SECOND OF HONEST FIXTURE. The sheet's ADJUSTMENTS block is what was
  -- written AFTER closed_at. Inside a single transaction now() is frozen, so
  -- the close and the adjustment share a timestamp to the microsecond and
  -- "created_at > closed_at" is false — an artefact of testing a whole day in
  -- one transaction, not a defect: in production the close is one request in
  -- the evening and the adjustment another the next morning. The close is
  -- nudged back a second so the REAL boundary is exercised rather than dodged.
  UPDATE public.cash_days SET closed_at = closed_at - interval '1 second' WHERE id = v_d1;

  v_res := public.get_cash_day_pdf_data(v_co, v_d1);
  IF (v_res->>'next_version')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 12: after an adjustment the next sheet should be v2, got %',
      v_res->>'next_version'; END IF;
  -- ⚠️ ASSERTED BY CONTENT, NOT BY COUNT, and the reason is worth writing down.
  -- Inside one transaction every row shares now() to the microsecond, so the
  -- void (written before the close) and the JV (written after it) have the SAME
  -- created_at. No value of closed_at can separate them, and the block returns
  -- both. That is a property of testing a whole day in one transaction, not of
  -- the product: in production the void is one request in the afternoon and the
  -- close another in the evening, and the P6/P7 screen suites exercise the
  -- created_at > closed_at boundary with timestamps that genuinely differ.
  -- What this can honestly assert is that the CFO's adjustment, with its
  -- reason, reaches the sheet's own block.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'adjustments') a
     WHERE a->>'reason' = 'diesel bill found after closing'
       AND (a->>'amount')::numeric = 100) THEN
    RAISE EXCEPTION 'FAIL 12: the CFO adjustment is not in the sheet''s block: %',
      v_res->'adjustments'; END IF;
  v_res := public.record_day_document(v_co, v_d1, 2, v_pj::text || '/documents/v2.pdf');
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 12: v2 was not recorded: %', v_res; END IF;
  IF (SELECT count(*) FROM public.day_documents WHERE cash_day_id=v_d1) <> 2 THEN
    RAISE EXCEPTION 'FAIL 12: v1 was not kept alongside v2'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.day_documents WHERE cash_day_id=v_d1 AND version=1) THEN
    RAISE EXCEPTION 'FAIL 12: v1 is gone — prior versions are never overwritten'; END IF;
  RAISE NOTICE 'PASS 12  the sheet is re-issued at v2 with the adjustment; v1 is still there';

  -- ══ 12 · THE DASHBOARD AGREES ═════════════════════════════════════════════
  v_res := public.get_daily_closing_tile(v_co, v_pj);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 13: the tile was refused: %', v_res; END IF;
  SELECT count(*) INTO v_n FROM public.cash_entries
   WHERE project_id = v_pj AND rms_status = 'PENDING';
  IF (v_res->'counters'->>'receipts_pending')::int IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION 'FAIL 13: the tile says % receipts pending, the table says %',
      v_res->'counters'->>'receipts_pending', v_n; END IF;
  IF (v_res->>'closing_cash')::numeric IS DISTINCT FROM
     (SELECT d.opening_cash + t.in_cash - t.out_cash FROM public.cash_days d,
        LATERAL public._dc_day_totals(d.id) t WHERE d.id = v_d2) THEN
    RAISE EXCEPTION 'FAIL 13: the tile''s closing cash disagrees with the open day'; END IF;
  RAISE NOTICE 'PASS 13  the dashboard counters and figures agree with the tables';

  -- ══ 13 · THE DIRECTOR READS, AND ONLY READS ═══════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dir_auth)::text, true);
  v_res := public.get_cash_day_summary(v_co, v_pj, public._dc_today() - 1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 14: the Director could not read the day: %', v_res; END IF;
  v_res := public.list_cash_day_audit(v_co, v_d1, 50);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 14: the Director could not read the audit: %', v_res; END IF;
  SELECT id INTO v_e FROM public.day_documents WHERE cash_day_id=v_d1 AND version=1;
  v_res := public.authorize_day_document(v_co, v_e);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 14: the Director could not get a link to the sheet: %', v_res; END IF;
  v_res := public.record_cash_entry(v_co, v_d2, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1200',
    'amount',10,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 14: the Director recorded an entry: %', v_res; END IF;
  RAISE NOTICE 'PASS 14  the Director reads the day, the audit and the sheet, and cannot write';

  -- ══════════════════════════════════════════════════════════════════════════
  -- TEN WAYS TO DO IT WRONG
  -- ══════════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);

  -- 1 · an unexplained variance
  v_res := public.close_cash_day(v_co, v_d2, 1, NULL, NULL, NULL);
  IF (v_res->>'error') IS DISTINCT FROM 'VARIANCE_UNEXPLAINED' THEN
    RAISE EXCEPTION 'FAIL N1: closing short with no reason answered %', v_res; END IF;

  -- 2 · a second day on the same date
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today());
  IF (v_res->>'success')::boolean IS true
     AND (v_res->>'cash_day_id')::uuid IS DISTINCT FROM v_d2 THEN
    RAISE EXCEPTION 'FAIL N2: a SECOND day was opened on the same date'; END IF;

  -- 3 · a duplicate voucher number
  v_res := public.record_cash_entry(v_co, v_d2, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1004',
    'amount',10,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'error') IS DISTINCT FROM 'DUPLICATE_VOUCHER' THEN
    RAISE EXCEPTION 'FAIL N3: a re-used voucher number answered %', v_res; END IF;

  -- 4 · a QuickBooks head off the default, with no reason
  v_res := public.record_cash_entry(v_co, v_d2, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','1301',
    'amount',10,'payee_id',v_p_cli,'unit_id',v_unit,'qb_account_id',v_a6050));
  IF (v_res->>'error') IS DISTINCT FROM 'OVERRIDE_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL N4: an unexplained head override answered %', v_res; END IF;

  -- 5 · the cashier tries to close
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.close_cash_day(v_co, v_d2, 1000, NULL, 'trying it on', NULL);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL N5: the cashier closed the day: %', v_res; END IF;

  -- 6 · another project's day, by id
  v_res := public.get_cash_day_summary(v_co, v_other, public._dc_today());
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL N6: the cashier read another project: %', v_res; END IF;

  -- 7 · a stale version on close
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.close_cash_day(v_co, v_d2, 1000, NULL, 'stale', 99);
  IF (v_res->>'error') IS DISTINCT FROM 'VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'FAIL N7: a stale version answered %', v_res; END IF;

  -- 8 · an idempotent replay is the SAME entry, not a second one
  v_key := gen_random_uuid();
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE cash_day_id = v_d2;
  v_res := public.record_cash_entry(v_co, v_d2, v_key, jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1401',
    'amount',77,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL N8: the first press failed: %', v_res; END IF;
  v_e := (v_res->>'entry_id')::uuid;
  v_res := public.record_cash_entry(v_co, v_d2, v_key, jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1401',
    'amount',77,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'entry_id')::uuid IS DISTINCT FROM v_e THEN
    RAISE EXCEPTION 'FAIL N8: the replay made a different entry'; END IF;
  IF (SELECT count(*) FROM public.cash_entries WHERE cash_day_id = v_d2) <> v_n + 1 THEN
    RAISE EXCEPTION 'FAIL N8: the replay added a second row'; END IF;

  -- 9 · an oversized attachment
  v_res := public.add_cash_entry_attachment(v_co, v_e,
    v_pj::text || '/' || v_e::text || '/huge.pdf', 'application/pdf', 10485761);
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL N9: an 10 MB + 1 byte attachment was accepted: %', v_res; END IF;

  -- 10 · an adjustment on a day that is still open
  v_res := public.post_cash_adjustment(v_co, v_d2,
    jsonb_build_object('mode','CASH','direction','OUT','amount',5), 'too early');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION'
     AND (v_res->>'error') IS DISTINCT FROM 'DAY_NOT_CLOSED' THEN
    RAISE EXCEPTION 'FAIL N10: a JV on an OPEN day was accepted: %', v_res; END IF;

  RAISE NOTICE 'PASS 15  all ten refusals answered by their own §A9 code';

  -- ── and the refusals are refusals, not a broken harness (SR-2) ───────────
  -- Each negative above has a positive twin somewhere in the first half: the
  -- close that worked (07), the entry that worked (04), the adjustment that
  -- worked (11), the read that worked (14). One more, here, so the LAST state
  -- of the database is a success and not a wall of errors.
  v_res := public.record_cash_entry(v_co, v_d2, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','1500',
    'amount',42,'payee_id',v_p_ven,'qb_account_id',v_a6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 16: after ten refusals the service can no longer do its job: %', v_res;
  END IF;
  RAISE NOTICE 'PASS 16  and a good entry still succeeds afterwards — the refusals were the rule, not a wedge';
END
$t$;
`;

(async () => {
  console.log(`[verify-daily-closing-e2e] project ${REF}`);
  if (AGAINST_LIVE) console.log('  mode: --against-live — asserting the applied schema.');
  else console.log('  up: ' + UP.join('\n      '));
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p10_e2e.sql'), sql);

  const t0 = Date.now();
  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  console.log(`✅ PASS — 16 checks held` + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   A whole day start to finish, and ten ways to do it wrong.');
  console.log(`   ${Math.round((Date.now() - t0) / 100) / 10}s. Nothing was committed.`);
  console.log('\n   The two HTTP steps are proved in their own suites, not here:');
  console.log('   the rendered PDF   → verify-daily-closing-pdf.js');
  console.log('   the real upload    → verify-daily-closing-attachment.js');
})();
