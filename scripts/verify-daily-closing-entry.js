/**
 * Daily Closing — P4 verification: RecordEntry, VoidEntry, attachments, ListEntries.
 *
 *   node scripts/verify-daily-closing-entry.js                 # dry run
 *   node scripts/verify-daily-closing-entry.js --against-live  # assert what is applied
 *
 * Runs on ZZTEST Tower — the tenant whose name says it is safe to wipe — inside
 * BEGIN … ROLLBACK. Every assertion raises, so the request failing IS the test
 * failing.
 *
 * ⚠️ WHAT THIS HARNESS CANNOT PROVE, stated plainly rather than glossed:
 * TWO-WRITER CONCURRENCY. Everything here runs on one connection in one
 * transaction, so it cannot make two writers race for a seq_no. What it does
 * prove is (a) sequential numbering is correct, (b) the UNIQUE (cash_day_id,
 * seq_no) constraint rejects a collision if one ever happened, and (c) the
 * SELECT … FOR UPDATE that serialises writers is present in the function body.
 * A real two-session race needs a driver holding two connections and committing
 * — which cannot be undone here, because cash_entries cannot be deleted. That
 * belongs in P10 against a disposable database.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const UP = [
  '20260904h_a_day_opens_and_a_day_closes.sql',
  '20260904j_an_entry_is_recorded_and_an_entry_is_voided.sql',
];

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal — safe to wipe
const PJ = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';   // ZZTEST Tower
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
DO $test$
DECLARE
  v_co uuid := '${CO}';
  v_pj uuid := '${PJ}';
  v_unit uuid; v_day uuid;
  v_cfo uuid; v_acc uuid; v_cash uuid;
  v_cfo_auth uuid := gen_random_uuid(); v_acc_auth uuid := gen_random_uuid();
  v_cash_auth uuid := gen_random_uuid();
  v_res jsonb; v_res2 jsonb; v_n integer; v_txt text;
  v_2020 uuid; v_6050 uuid; v_4010 uuid;
  v_payee uuid; v_dead_payee uuid;
  v_acct_cash uuid; v_acct_bank uuid;
  v_key uuid := gen_random_uuid(); v_e1 uuid; v_e2 uuid; v_grp uuid;
BEGIN
  IF (SELECT company_name FROM public.companies WHERE id = v_co) NOT LIKE 'ZZTEST%' THEN
    RAISE EXCEPTION 'REFUSING TO RUN: this suite wipes cash days and is only for a ZZTEST tenant';
  END IF;
  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pj LIMIT 1;
  DELETE FROM public.cash_entry_attachments WHERE company_id = v_co;
  DELETE FROM public.cash_entries WHERE project_id = v_pj;
  DELETE FROM public.cash_days    WHERE project_id = v_pj;

  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC E CFO','dcecfo','dcecfo@example.invalid','cfo','password','active',v_cfo_auth) RETURNING id INTO v_cfo;
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC E Accountant','dceacc','dceacc@example.invalid','accounts','password','active',v_acc_auth) RETURNING id INTO v_acc;
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC E Cashier','dcecash','dcecash@example.invalid','staff','password','active',v_cash_auth) RETURNING id INTO v_cash;
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co,v_cfo,v_pj,'edit',true),(v_co,v_acc,v_pj,'edit',true),(v_co,v_cash,v_pj,'edit',true);

  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  SELECT id INTO v_2020 FROM public.qb_accounts WHERE company_id=v_co AND number='2020';
  SELECT id INTO v_6050 FROM public.qb_accounts WHERE company_id=v_co AND number='6050';
  SELECT id INTO v_4010 FROM public.qb_accounts WHERE company_id=v_co AND number='4010';
  SELECT id INTO v_acct_cash FROM public.cash_accounts WHERE project_id=v_pj AND kind='CASH';
  SELECT id INTO v_acct_bank FROM public.cash_accounts WHERE project_id=v_pj AND kind='BANK';

  INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co,v_pj,'PESCO','VENDOR') RETURNING id INTO v_payee;
  INSERT INTO public.payees (company_id, project_id, name, kind, is_active)
  VALUES (v_co,v_pj,'Retired Vendor','VENDOR',false) RETURNING id INTO v_dead_payee;

  PERFORM set_config('dc.today', '2026-09-04', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  PERFORM public.setup_cash_opening(v_co, v_pj, 17723, 1000, DATE '2026-09-01');
  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-02');
  v_day := (v_res->>'cash_day_id')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);

  -- ═══ RECORD ═════════════════════════════════════════════════════════════
  v_res := public.record_cash_entry(v_co, v_day, v_key, jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0041',
    'amount',150000,'payee_id',v_payee,'unit_id',v_unit,'narration','Installment #4'));
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 01: record failed: %', v_res; END IF;
  v_e1 := (v_res->>'entry_id')::uuid;
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'CRV' THEN RAISE EXCEPTION 'FAIL 01: CASH/IN must derive CRV'; END IF;
  IF (v_res->>'seq_no')::int <> 1 THEN RAISE EXCEPTION 'FAIL 01: first entry is seq_no 1'; END IF;
  IF (v_res->>'rms_status') IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'FAIL 01: a client receipt starts PENDING'; END IF;
  IF (SELECT qb_account_id FROM public.cash_entries WHERE id=v_e1) <> v_2020 THEN
    RAISE EXCEPTION 'FAIL 01: the 2020 default was not applied'; END IF;
  RAISE NOTICE 'PASS 01  a cashier records a receipt: CRV, seq 1, PENDING, defaulted to 2020';

  -- ── IDEMPOTENCY ──────────────────────────────────────────────────────────
  v_res2 := public.record_cash_entry(v_co, v_day, v_key, jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','9999',
    'amount',999,'payee_id',v_payee,'unit_id',v_unit));
  IF NOT (v_res2->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 02: a replay was an error: %', v_res2; END IF;
  IF NOT (v_res2->>'replayed')::boolean THEN RAISE EXCEPTION 'FAIL 02: the replay was not flagged'; END IF;
  IF (v_res2->>'entry_id')::uuid <> v_e1 THEN RAISE EXCEPTION 'FAIL 02: the replay returned a different id'; END IF;
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE cash_day_id = v_day;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 02: the replay wrote a second row (% rows)', v_n; END IF;
  RAISE NOTICE 'PASS 02  a replay returns the SAME id, success not 409, and writes nothing';

  v_res := public.record_cash_entry(v_co, v_day, NULL, jsonb_build_object(
    'mode','CASH','direction','OUT','voucher_no','X','amount',1,'payee_id',v_payee));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 03: an entry without an idempotency key was accepted: %', v_res; END IF;
  RAISE NOTICE 'PASS 03  no idempotency key, no entry';

  -- ── VALIDATION ───────────────────────────────────────────────────────────
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_type','CRV',
    'voucher_no','0112','amount',77000,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 04: a caller was allowed to set voucher_type: %', v_res; END IF;
  RAISE NOTICE 'PASS 04  voucher_type is derived and cannot be supplied';

  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0112',
    'amount',0,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN RAISE EXCEPTION 'FAIL 05: amount 0 accepted'; END IF;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','WALLET','direction','OUT','voucher_no','0112',
    'amount',5,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN RAISE EXCEPTION 'FAIL 05: mode WALLET accepted'; END IF;
  RAISE NOTICE 'PASS 05  amount must be positive, mode must be CASH or BANK';

  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0042',
    'amount',100,'payee_id',v_payee));
  IF (v_res->>'error') IS DISTINCT FROM 'UNIT_REQUIRED' THEN RAISE EXCEPTION 'FAIL 06: a receipt with no unit: %', v_res; END IF;
  RAISE NOTICE 'PASS 06  UNIT_REQUIRED on a client receipt';

  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0113',
    'amount',100,'payee_id',v_dead_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'PAYEE_INACTIVE' THEN RAISE EXCEPTION 'FAIL 07: a retired payee: %', v_res; END IF;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0113',
    'amount',100,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN RAISE EXCEPTION 'FAIL 07: no payee at all: %', v_res; END IF;
  RAISE NOTICE 'PASS 07  the payee is required, from the master, and must be active';

  -- ── THE QUICKBOOKS HEAD ──────────────────────────────────────────────────
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0043',
    'amount',100,'payee_id',v_payee,'unit_id',v_unit,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'OVERRIDE_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL 08: off-default with no reason: %', v_res; END IF;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0043',
    'amount',100,'payee_id',v_payee,'unit_id',v_unit,'qb_account_id',v_6050,
    'qb_override_reason','client settled the office rent share directly'));
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 08: with a reason: %', v_res; END IF;
  RAISE NOTICE 'PASS 08  OVERRIDE_REASON_REQUIRED off-default; allowed with a reason';

  UPDATE public.qb_accounts SET is_active=false WHERE id=v_6050;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0114',
    'amount',100,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'ACCOUNT_INACTIVE' THEN RAISE EXCEPTION 'FAIL 09: inactive account: %', v_res; END IF;
  UPDATE public.qb_accounts SET is_active=true WHERE id=v_6050;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0114',
    'amount',77000,'payee_id',v_payee));
  IF (v_res->>'error') IS DISTINCT FROM 'ACCOUNT_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL 09: EXPENSE has no default, so an account is required: %', v_res; END IF;
  RAISE NOTICE 'PASS 09  ACCOUNT_INACTIVE, and an account is required where there is no default';

  -- ── DUPLICATE VOUCHER ────────────────────────────────────────────────────
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0041',
    'amount',5,'payee_id',v_payee,'unit_id',v_unit));
  IF (v_res->>'error') IS DISTINCT FROM 'DUPLICATE_VOUCHER' THEN RAISE EXCEPTION 'FAIL 10: duplicate CRV 0041: %', v_res; END IF;
  IF (v_res->>'conflicting_date') IS NULL THEN
    RAISE EXCEPTION 'FAIL 10: DUPLICATE_VOUCHER must name the conflicting date: %', v_res; END IF;
  -- the same number under a DIFFERENT voucher type is a different book
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','0041',
    'amount',10,'payee_id',v_payee,'qb_account_id',v_6050));
  IF NOT (v_res->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL 10: CPV 0041 should not clash with CRV 0041: %', v_res; END IF;
  RAISE NOTICE 'PASS 10  DUPLICATE_VOUCHER names the date; uniqueness is per voucher TYPE';

  -- ── seq_no ───────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE cash_day_id=v_day;
  IF (SELECT count(DISTINCT seq_no) FROM public.cash_entries WHERE cash_day_id=v_day) <> v_n THEN
    RAISE EXCEPTION 'FAIL 11: seq_no is not unique within the day'; END IF;
  IF (SELECT max(seq_no) FROM public.cash_entries WHERE cash_day_id=v_day) <> v_n THEN
    RAISE EXCEPTION 'FAIL 11: seq_no is not contiguous from 1'; END IF;
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id)
    VALUES (v_co, v_pj, v_day, 1, gen_random_uuid(),'EXPENSE','CASH','OUT','CPV','DUPSEQ',1,'NA',v_6050);
    RAISE EXCEPTION 'FAIL 11: a duplicate seq_no was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT prosrc FROM pg_proc WHERE proname='record_cash_entry') NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'FAIL 11: record_cash_entry does not lock the day'; END IF;
  RAISE NOTICE 'PASS 11  seq_no contiguous and unique; the day is locked; a collision is refused';

  -- ═══ TRANSFER ═══════════════════════════════════════════════════════════
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','TRANSFER','voucher_no','TX-1','amount',20000,'payee_id',v_payee,
    'from_cash_account_id',v_acct_cash,'to_cash_account_id',v_acct_cash));
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 12: a transfer to itself was allowed: %', v_res; END IF;
  RAISE NOTICE 'PASS 12  a transfer cannot leave and reach the same account';

  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','TRANSFER','voucher_no','TX-1','amount',20000,'payee_id',v_payee,
    'from_cash_account_id',v_acct_cash,'to_cash_account_id',v_acct_bank));
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 13: transfer failed: %', v_res; END IF;
  v_grp := (v_res->>'transfer_group_id')::uuid;
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE transfer_group_id = v_grp;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 13: a transfer is two rows, found %', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_entries WHERE transfer_group_id=v_grp
                  AND direction='OUT' AND mode='CASH' AND voucher_type='CPV' AND voucher_no='TX-1-A') THEN
    RAISE EXCEPTION 'FAIL 13: leg A is wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_entries WHERE transfer_group_id=v_grp
                  AND direction='IN' AND mode='BANK' AND voucher_type='BRV' AND voucher_no='TX-1-B') THEN
    RAISE EXCEPTION 'FAIL 13: leg B is wrong'; END IF;
  -- §A14: each leg names the OTHER account, so each row is a self-describing
  -- double entry (debit destination, credit source).
  IF (SELECT qb_account_id FROM public.cash_entries WHERE transfer_group_id=v_grp AND direction='OUT')
     IS DISTINCT FROM (SELECT qb_account_id FROM public.cash_accounts WHERE id=v_acct_bank) THEN
    RAISE EXCEPTION 'FAIL 13: the OUT leg should carry the destination''s QB head'; END IF;
  RAISE NOTICE 'PASS 13  a transfer is two linked rows, -A/-B, each naming the other account';

  -- ── TRANSFER ATOMICITY ───────────────────────────────────────────────────
  -- The second leg is made to fail by a trigger installed only for this test,
  -- which is the only way to reach the failure path without breaking the
  -- function's own up-front checks. If leg A survived, atomicity is a fiction.
  CREATE FUNCTION pg_temp_fail_leg_b() RETURNS trigger LANGUAGE plpgsql AS
    $t$ BEGIN IF NEW.voucher_no LIKE '%-B' THEN
      RAISE EXCEPTION 'INJECTED FAILURE ON LEG B'; END IF; RETURN NEW; END $t$;
  CREATE TRIGGER _dc_test_fail_b BEFORE INSERT ON public.cash_entries
    FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_leg_b();
  BEGIN
    PERFORM public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
      'entry_type','TRANSFER','voucher_no','TX-2','amount',500,'payee_id',v_payee,
      'from_cash_account_id',v_acct_cash,'to_cash_account_id',v_acct_bank));
    RAISE EXCEPTION 'FAIL 14: the injected failure did not fire';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INJECTED FAILURE%' THEN RAISE; END IF;
  END;
  DROP TRIGGER _dc_test_fail_b ON public.cash_entries;
  DROP FUNCTION pg_temp_fail_leg_b();
  SELECT count(*) INTO v_n FROM public.cash_entries WHERE voucher_no LIKE 'TX-2%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL 14: leg A survived its transfer failing — % row(s) left behind', v_n; END IF;
  RAISE NOTICE 'PASS 14  when leg B fails, leg A rolls back with it — nothing survives';

  -- ═══ VOID ═══════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.void_cash_entry(v_co, v_e1, 'entered twice');
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 15: the cashier voided an entry: %', v_res; END IF;
  RAISE NOTICE 'PASS 15  a cashier may not void — Accountant and up only';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_acc_auth)::text, true);
  v_res := public.void_cash_entry(v_co, v_e1, '   ');
  IF (v_res->>'error') IS DISTINCT FROM 'OVERRIDE_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL 16: a void with no reason: %', v_res; END IF;

  v_res := public.void_cash_entry(v_co, v_e1, 'receipt entered twice, second one cancelled');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 16: void failed: %', v_res; END IF;
  v_e2 := (v_res->>'reversal_id')::uuid;
  IF (SELECT direction FROM public.cash_entries WHERE id=v_e2) <> 'OUT'
  OR (SELECT voucher_type FROM public.cash_entries WHERE id=v_e2) <> 'CPV'
  OR (SELECT voucher_no FROM public.cash_entries WHERE id=v_e2) <> '0041-VOID'
  OR (SELECT amount FROM public.cash_entries WHERE id=v_e2) <> 150000.00
  OR NOT (SELECT is_adjustment FROM public.cash_entries WHERE id=v_e2)
  OR (SELECT adjusts_entry_id FROM public.cash_entries WHERE id=v_e2) <> v_e1
  OR (SELECT rms_status FROM public.cash_entries WHERE id=v_e2) <> 'NA' THEN
    RAISE EXCEPTION 'FAIL 16: the reversal is not shaped correctly'; END IF;
  RAISE NOTICE 'PASS 16  the reversal is same amount, opposite direction, CPV, 0041-VOID, NA';

  IF (SELECT rms_status FROM public.cash_entries WHERE id=v_e1) <> 'UNAPPLIED'
  OR (SELECT rms_status_reason FROM public.cash_entries WHERE id=v_e1) <> 'Voided' THEN
    RAISE EXCEPTION 'FAIL 17: a voided PENDING receipt must become UNAPPLIED with reason Voided'; END IF;
  IF (SELECT amount FROM public.cash_entries WHERE id=v_e1) <> 150000.00 THEN
    RAISE EXCEPTION 'FAIL 17: invariant 1 — the original amount was altered'; END IF;
  RAISE NOTICE 'PASS 17  the original becomes UNAPPLIED/"Voided" and is otherwise untouched';

  v_res := public.void_cash_entry(v_co, v_e1, 'again');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 18: an entry was voided twice: %', v_res; END IF;
  v_res := public.void_cash_entry(v_co, v_e2, 'voiding the reversal');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 18: a reversal was voided: %', v_res; END IF;
  RAISE NOTICE 'PASS 18  no double void, and a reversal cannot itself be voided';

  -- ═══ ATTACHMENTS ════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.add_cash_entry_attachment(v_co, v_e1, v_pj || '/bills/x.exe', 'application/x-msdownload', 1000);
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN RAISE EXCEPTION 'FAIL 19: an .exe was attached: %', v_res; END IF;
  v_res := public.add_cash_entry_attachment(v_co, v_e1, v_pj || '/bills/x.pdf', 'application/pdf', 10485761);
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN RAISE EXCEPTION 'FAIL 19: an 11 MB file: %', v_res; END IF;
  v_res := public.add_cash_entry_attachment(v_co, v_e1, 'somewhere/else/x.pdf', 'application/pdf', 1000);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 19: a path outside the project was accepted: %', v_res; END IF;
  v_res := public.add_cash_entry_attachment(v_co, v_e1, v_pj || '/bills/x.pdf', 'application/pdf', 204800);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 19: a valid PDF: %', v_res; END IF;
  RAISE NOTICE 'PASS 19  type, size and project-scoped path are all enforced';

  v_res := public.authorize_cash_attachment(v_co, (v_res->>'attachment_id')::uuid);
  IF NOT (v_res->>'success')::boolean OR (v_res->>'bucket') IS DISTINCT FROM 'daily-closing' THEN
    RAISE EXCEPTION 'FAIL 20: the attachment could not be authorised: %', v_res; END IF;
  RAISE NOTICE 'PASS 20  an attachment authorises to the private bucket (signing is P6 — see the note)';

  -- ═══ LIST ═══════════════════════════════════════════════════════════════
  v_res := public.list_cash_entries(v_co, v_day);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 21: list failed: %', v_res; END IF;
  IF jsonb_array_length(v_res->'entries') < 6 THEN
    RAISE EXCEPTION 'FAIL 21: too few entries listed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'entries') e
                  WHERE (e->>'id')::uuid = v_e1 AND (e->>'is_voided')::boolean
                    AND (e->>'payee_name') = 'PESCO' AND (e->>'qb_number') IS NOT NULL
                    AND (e->>'attachments')::int = 1) THEN
    RAISE EXCEPTION 'FAIL 21: the voided row is not flagged, or names are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'entries') e
                  WHERE (e->>'id')::uuid = v_e2 AND (e->>'is_reversal')::boolean) THEN
    RAISE EXCEPTION 'FAIL 21: the reversal is not flagged'; END IF;
  SELECT string_agg(e->>'seq_no', ',' ORDER BY (e->>'seq_no')::int) INTO v_txt
    FROM jsonb_array_elements(v_res->'entries') e;
  RAISE NOTICE 'PASS 21  the ledger lists by seq_no (%) with payee and account names and flags', v_txt;

  -- ═══ INVARIANT 7 AND 8 ══════════════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE table_name='cash_entries'
                  AND record_id=v_e2::text AND action='INSERT' AND project_id=v_pj
                  AND reason='receipt entered twice, second one cancelled') THEN
    RAISE EXCEPTION 'FAIL 22: the void reason did not reach the audit'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE table_name='cash_entries'
                  AND record_id=v_e1::text AND action='UPDATE'
                  AND 'rms_status' = ANY(changed_fields)) THEN
    RAISE EXCEPTION 'FAIL 22: the UNAPPLIED transition was not audited'; END IF;
  RAISE NOTICE 'PASS 22  recording, voiding and the status change are all audited';

  PERFORM set_config('request.jwt.claims', '', true);
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','ANON',
    'amount',1,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN RAISE EXCEPTION 'FAIL 23: anon recorded: %', v_res; END IF;
  v_res := public.list_cash_entries(v_co, v_day);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN RAISE EXCEPTION 'FAIL 23: anon listed: %', v_res; END IF;
  RAISE NOTICE 'PASS 23  no session, no recording and no reading';

  -- ═══ DAY_LOCKED ═════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  -- The 150,000 receipt was voided above and never re-entered, which leaves the
  -- drawer at MINUS 2,187 — impossible in life, and close_cash_day rightly
  -- refuses a negative count. Re-enter it properly, which is what would have
  -- happened at the desk, and the day closes on a real figure.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','0041R',
    'amount',150000,'payee_id',v_payee,'unit_id',v_unit,'narration','re-entry after void'));
  IF NOT (v_res->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL 24: the corrected re-entry failed: %', v_res; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);

  -- Assigned, not PERFORMed: PERFORM throws the result away, so a close that
  -- failed would look exactly like one that worked and the DAY_LOCKED test
  -- below would be testing an open day. That is how this bug hid.
  v_res := public.close_cash_day(v_co, v_day,
    (public.get_cash_day_summary(v_co, v_pj, DATE '2026-09-02')->>'closing_cash')::numeric,
    NULL, NULL, (SELECT version FROM public.cash_days WHERE id=v_day));
  IF NOT (v_res->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL 24: the close that this test depends on failed: %', v_res; END IF;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','LATE',
    'amount',1,'payee_id',v_payee,'qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'DAY_LOCKED' THEN RAISE EXCEPTION 'FAIL 24: recorded onto a closed day: %', v_res; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_acc_auth)::text, true);
  v_res := public.void_cash_entry(v_co, (SELECT id FROM public.cash_entries
             WHERE cash_day_id=v_day AND voucher_no='0041' AND NOT is_adjustment LIMIT 1), 'too late');
  IF COALESCE(v_res->>'error','(none)') NOT IN ('DAY_LOCKED','INVALID_TRANSITION') THEN
    RAISE EXCEPTION 'FAIL 24: voided on a closed day: %', v_res; END IF;
  RAISE NOTICE 'PASS 24  DAY_LOCKED for both recording and voiding once the day is closed';

  RAISE NOTICE '--- P4: ALL 24 ASSERTIONS PASSED ---';
END
$test$;
`;

(async () => {
  console.log(`[verify-daily-closing-entry] project ${REF}`);
  if (AGAINST_LIVE) console.log('  mode: --against-live — asserting the applied schema.');
  else console.log('  up: ' + UP.join('\n      '));
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p4_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  console.log('✅ PASS — 24 assertions held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   Idempotent replay, derived voucher, DUPLICATE_VOUCHER, payee and account');
  console.log('   guards, transfer atomicity under an injected failure, void → UNAPPLIED,');
  console.log('   attachments, ListEntries flags. Nothing was committed.');
  console.log('\n   NOT proved here: two-writer seq_no concurrency — see the header.');
})();
