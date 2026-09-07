#!/usr/bin/env node
/**
 * Invariant 9 — a drawer cannot pay out money it does not hold.
 *
 *   node scripts/verify-daily-closing-cashfloor.js                 # rehearsal
 *   node scripts/verify-daily-closing-cashfloor.js --against-live  # applied schema
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * This is the first rule in the module that can REFUSE A CASHIER'S ENTRY. Every
 * other guard refuses a malformed request; this one refuses a well-formed one
 * because of the state of the drawer. Getting the predicate wrong does not lose
 * data — it stops somebody doing their job, which is why the owner asked for it
 * to ship late rather than wrong.
 *
 * It was written because the pilot's FIRST REAL DAY closed with a negative
 * drawer: opening zero, one 100,000 expense out, counted 5,000, closing
 * (100,000). Nothing was broken — there was no rule to violate. Eighteen suites
 * and 1609 mutants could not see it, because an instrument tests what was
 * written and only use tests what was meant.
 *
 * ── THE FOUR PROOFS THE OWNER ASKED FOR ────────────────────────────────────
 *   1 · an entry that MUST be refused        — the guard fires
 *   2 · an entry that MUST be allowed        — the paired positive, so a guard
 *                                              that refuses everything is not
 *                                              mistaken for a working one (SR-2)
 *   3 · a CFO override that MUST succeed     — and is RECORDED on the row
 *   4 · the override MUST appear on the PDF  — "an override that is allowed but
 *                                              invisible is worse than no
 *                                              override at all"
 *
 * ── AND THE PARTS THAT ARE EASY TO GET WRONG ───────────────────────────────
 * Bank is exempt: an overdraft is real. A transfer's OUT leg is NOT exempt: a
 * transfer is stored as two rows with real modes, so cash→bank is a genuine
 * cash out. A non-CFO supplying a reason must be refused exactly as if none
 * were given, or the override is a text box anybody can type in. And the rule
 * lives in TWO layers (SR-12) — the trigger is the floor and the RPC is the
 * message — so both are made to fire.
 *
 * Everything runs inside BEGIN … ROLLBACK on ZZTEST. Nothing is committed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const AGAINST_LIVE = process.argv.includes('--against-live');

const UP = [
  '20260907d_a_drawer_cannot_pay_out_what_it_does_not_hold.sql',
  '20260907e_insufficient_cash_and_day_order.sql',
];
const body = f => fs.readFileSync(path.join(MIG, f), 'utf8');

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '2da565ca-2b83-44bf-b4de-2cae762571df';   // ZZTEST Garden

const ASSERT = `
DO $test$
DECLARE
  v_co uuid := '${CO}';
  v_pj uuid := '${PJ}';
  v_cfo uuid; v_cash uuid;
  v_cfo_auth uuid := gen_random_uuid(); v_cash_auth uuid := gen_random_uuid();
  v_day uuid; v_res jsonb; v_payee uuid; v_2020 uuid; v_6050 uuid;
  v_acct_cash uuid; v_acct_bank uuid; v_pdf jsonb; v_txt text; v_n int;
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  -- ══ REFUSE TO RUN ANYWHERE BUT ZZTEST ══════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM public.companies
                  WHERE id = v_co AND company_name LIKE 'ZZTEST%') THEN
    RAISE EXCEPTION 'REFUSING: % is not a ZZTEST company', v_co;
  END IF;

  -- ── people ────────────────────────────────────────────────────────────
  -- Same shape as the P4 suite: a project assignment is what makes a role
  -- able to record, not the role string on its own.
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Floor CFO','dcfloorcfo','dcfloorcfo@example.invalid','cfo','password','active',v_cfo_auth)
  RETURNING id INTO v_cfo;
  -- staff becomes CASHIER only with the dailyclosing module grant (_dc_role).
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id, module_permissions)
  VALUES (v_co,'DC Floor Cashier','dcfloorcash','dcfloorcash@example.invalid','staff','password','active',v_cash_auth,
          '{"dailyclosing": true}'::jsonb)
  RETURNING id INTO v_cash;
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co,v_cfo,v_pj,'edit',true),(v_co,v_cash,v_pj,'edit',true);

  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  -- ── masters ───────────────────────────────────────────────────────────
  SELECT id INTO v_2020 FROM public.qb_accounts WHERE company_id = v_co AND number = '2020' LIMIT 1;
  SELECT id INTO v_6050 FROM public.qb_accounts WHERE company_id = v_co AND number = '6050' LIMIT 1;
  IF v_2020 IS NULL OR v_6050 IS NULL THEN RAISE EXCEPTION 'FIXTURE: the QB chart is missing'; END IF;

  SELECT id INTO v_acct_cash FROM public.cash_accounts
   WHERE project_id = v_pj AND kind = 'CASH' AND is_active LIMIT 1;
  SELECT id INTO v_acct_bank FROM public.cash_accounts
   WHERE project_id = v_pj AND kind = 'BANK' AND is_active LIMIT 1;
  IF v_acct_cash IS NULL THEN
    INSERT INTO public.cash_accounts (company_id, project_id, name, kind, qb_account_id, is_active, created_by)
    VALUES (v_co, v_pj, 'Floor Cash', 'CASH', v_2020, true, v_cfo) RETURNING id INTO v_acct_cash;
  END IF;
  IF v_acct_bank IS NULL THEN
    INSERT INTO public.cash_accounts (company_id, project_id, name, kind, qb_account_id, is_active, created_by)
    VALUES (v_co, v_pj, 'Floor Bank', 'BANK', v_2020, true, v_cfo) RETURNING id INTO v_acct_bank;
  END IF;

  INSERT INTO public.payees (company_id, project_id, name, kind, is_active, created_by)
  VALUES (v_co, v_pj, 'Floor Vendor', 'VENDOR', true, v_cfo) RETURNING id INTO v_payee;

  -- ── a day that starts with exactly 10,000 in the drawer ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  -- setup_cash_opening anchors carry-forward by writing a CLOSED day on its
  -- effective date, so the opening goes on yesterday and today is opened from
  -- it. Setting it on today would leave today already closed.
  v_res := public.setup_cash_opening(v_co, v_pj, 10000, 0, public._dc_today() - 1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: setup opening: %', v_res; END IF;
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today());
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: open day: %', v_res; END IF;
  v_day := (v_res->>'cash_day_id')::uuid;

  IF public._dc_cash_position(v_day) <> 10000 THEN
    RAISE EXCEPTION 'FIXTURE: the drawer should hold 10,000, holds %',
      public._dc_cash_position(v_day); END IF;
  RAISE NOTICE 'PASS 00  the drawer opens holding 10,000';

  -- ══ 1 · AN ENTRY THAT MUST BE ALLOWED (the paired positive first) ══════
  -- Done BEFORE the refusal on purpose: a guard that refuses everything looks
  -- exactly like a working guard until something is asked to succeed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0001','amount',9999,
    'payee_id',v_payee,'mode','CASH','direction','OUT','qb_account_id',v_6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 01: 9,999 out of 10,000 must be allowed: %', v_res; END IF;
  IF public._dc_cash_position(v_day) <> 1 THEN
    RAISE EXCEPTION 'FAIL 01: the drawer should hold 1, holds %',
      public._dc_cash_position(v_day); END IF;
  RAISE NOTICE 'PASS 01  9,999 out of 10,000 is allowed, and the drawer holds 1';

  -- ══ 2 · AN ENTRY THAT MUST BE REFUSED ═════════════════════════════════
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0002','amount',2,
    'payee_id',v_payee,'mode','CASH','direction','OUT','qb_account_id',v_6050));
  IF (v_res->>'error') IS DISTINCT FROM 'INSUFFICIENT_CASH' THEN
    RAISE EXCEPTION 'FAIL 02: 2 out of 1 must be refused, got %', v_res; END IF;
  IF (v_res->>'position_after')::numeric <> -1 THEN
    RAISE EXCEPTION 'FAIL 02: the message must say where it lands (-1), said %',
      v_res->>'position_after'; END IF;
  RAISE NOTICE 'PASS 02  2 out of 1 is refused, and the refusal says the drawer would land at -1';

  -- exact zero is NOT below zero
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0003','amount',1,
    'payee_id',v_payee,'mode','CASH','direction','OUT','qb_account_id',v_6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 03: emptying the drawer exactly is allowed: %', v_res; END IF;
  IF public._dc_cash_position(v_day) <> 0 THEN
    RAISE EXCEPTION 'FAIL 03: the drawer should be empty, holds %',
      public._dc_cash_position(v_day); END IF;
  RAISE NOTICE 'PASS 03  emptying the drawer to exactly zero is allowed — the boundary is < 0, not <= 0';

  -- ══ 3 · BANK IS EXEMPT ════════════════════════════════════════════════
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0004','amount',75000,
    'payee_id',v_payee,'mode','BANK','direction','OUT','qb_account_id',v_6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 04: bank may be overdrawn: %', v_res; END IF;
  RAISE NOTICE 'PASS 04  the bank goes 75,000 overdrawn without complaint — overdrafts are real';

  -- ══ 4 · A NON-CFO CANNOT OVERRIDE, EVEN WITH A REASON ════════════════
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0005','amount',500,
    'payee_id',v_payee,'mode','CASH','direction','OUT','qb_account_id',v_6050,
    'insufficient_cash_reason','the cashier says it is fine'));
  IF (v_res->>'error') IS DISTINCT FROM 'INSUFFICIENT_CASH' THEN
    RAISE EXCEPTION 'FAIL 05: a cashier must not override, got %', v_res; END IF;
  RAISE NOTICE 'PASS 05  a cashier writing a reason is refused exactly as if none were given';

  -- ══ 5 · A CFO OVERRIDE SUCCEEDS AND IS RECORDED ══════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','voucher_no','F-0006','amount',500,
    'payee_id',v_payee,'mode','CASH','direction','OUT','qb_account_id',v_6050,
    'insufficient_cash_reason','receipt of 20,000 is on the way from site, entered out of order'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 06: the CFO override must succeed: %', v_res; END IF;
  SELECT insufficient_cash_reason INTO v_txt FROM public.cash_entries
   WHERE id = (v_res->>'entry_id')::uuid;
  IF v_txt IS DISTINCT FROM 'receipt of 20,000 is on the way from site, entered out of order' THEN
    RAISE EXCEPTION 'FAIL 06: the reason was not stored on the row, got %', COALESCE(v_txt,'(null)'); END IF;
  IF public._dc_cash_position(v_day) <> -500 THEN
    RAISE EXCEPTION 'FAIL 06: the drawer should be at -500, is %',
      public._dc_cash_position(v_day); END IF;
  RAISE NOTICE 'PASS 06  the CFO override succeeds, the reason is on the row, the drawer is at -500';

  -- a reason on an entry that does NOT need one is dropped, not stored
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','voucher_no','F-0007','amount',30000,
    'payee_id',v_payee,'party_label','G-04','mode','CASH','direction','IN',
    'qb_account_id',v_2020,'insufficient_cash_reason','not needed here'));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 07: the receipt should record: %', v_res; END IF;
  SELECT insufficient_cash_reason INTO v_txt FROM public.cash_entries
   WHERE id = (v_res->>'entry_id')::uuid;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 07: a reason was stored on an entry that never needed one: %', v_txt; END IF;
  RAISE NOTICE 'PASS 07  a reason on an entry that does not need one is dropped, not stored';

  -- ══ 6 · THE OVERRIDE APPEARS ON THE DIRECTOR''S SHEET ════════════════
  v_pdf := public.get_cash_day_pdf_data(v_co, v_day);
  IF (v_pdf->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 08: the sheet was refused: %', v_pdf; END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_pdf->'payments') p
   WHERE p->>'insufficient_cash_reason' = 'receipt of 20,000 is on the way from site, entered out of order';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL 08: the override is not on the sheet (found % of 1): %',
      v_n, v_pdf->'payments'; END IF;
  RAISE NOTICE 'PASS 08  the override reason is on the Director sheet — allowed AND visible';

  -- ══ 7 · THE TRIGGER IS THE FLOOR, NOT THE RPC (SR-12) ════════════════
  -- A direct insert bypasses record_cash_entry entirely. If only the RPC
  -- checked, this would succeed and the rule would be advisory.
  BEGIN
    INSERT INTO public.cash_entries (
      company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
      mode, direction, voucher_type, voucher_no, amount, payee_id, qb_account_id,
      rms_status, created_by)
    VALUES (v_co, v_pj, v_day, 8001, gen_random_uuid(), 'EXPENSE',
      'CASH', 'OUT', 'CPV', 'F-8001', 999999, v_payee, v_6050, 'NA', v_cfo);
    RAISE EXCEPTION 'FAIL 09: a direct insert walked straight past the floor';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'FAIL 09%' THEN RAISE; END IF;
      RAISE EXCEPTION 'FAIL 09: refused, but not by the floor: %', SQLERRM;
    WHEN sqlstate '23514' THEN
      IF SQLERRM NOT LIKE '%INSUFFICIENT_CASH%' THEN
        RAISE EXCEPTION 'FAIL 09: refused by something else: %', SQLERRM; END IF;
  END;
  RAISE NOTICE 'PASS 09  a direct insert is refused by the trigger — the floor is the table, not the caller';

  -- ══ 8 · A TRANSFER''S OUT LEG IS NOT EXEMPT ══════════════════════════
  -- A transfer is TWO rows with real modes, so cash->bank is a genuine cash out.
  -- Easy to miss, because the composer hides mode and direction for a transfer.
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','TRANSFER','voucher_no','F-0009','amount',999999,
    'payee_id',v_payee,
    'from_cash_account_id',v_acct_cash,'to_cash_account_id',v_acct_bank));
  IF (v_res->>'success')::boolean IS true THEN
    RAISE EXCEPTION 'FAIL 10: a transfer emptied a drawer that could not fund it: %', v_res; END IF;
  RAISE NOTICE 'PASS 10  a cash->bank transfer larger than the drawer is refused too';

  -- ══ 9 · A DAY MAY NOT BE OPENED BEHIND ONE ALREADY CLOSED ════════════
  -- The ledger reads forward. On 2026-09-05 the pilot closed 06 Sep and then
  -- opened 03 Sep, so 03 Sep's closing of (100,000) carried nowhere and the
  -- book acquired a discontinuity. Invariant 2 does not catch it: it only says
  -- "the previous CLOSED day", and 03 Sep had none before it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.close_cash_day(v_co, v_day, public._dc_cash_position(v_day),
    NULL, 'floor rehearsal', (SELECT version FROM public.cash_days WHERE id = v_day));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: could not close today: %', v_res; END IF;

  -- today is closed; yesterday already exists as the setup anchor, so reach
  -- further back for a date that is genuinely free AND behind a closed day
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today() - 5);
  IF (v_res->>'error') IS DISTINCT FROM 'DAY_OUT_OF_ORDER' THEN
    RAISE EXCEPTION 'FAIL 11: a day behind a closed day must be refused, got %', v_res; END IF;
  IF (v_res->>'blocking_date') IS NULL THEN
    RAISE EXCEPTION 'FAIL 11: the refusal must name the day in the way'; END IF;
  RAISE NOTICE 'PASS 11  a day behind an already-closed day is refused, and the refusal names it';

  -- THE PAIRED POSITIVE, and it is not contrived: this very fixture opened
  -- today FORWARD of the setup anchor on today-1, and it succeeded — that is
  -- assertion 00 above. A guard that refused every open would have failed
  -- there before reaching here. Opening a future day is refused by a
  -- different and older rule ('a day cannot be opened in the future'), so it
  -- is not the positive to use.
  v_res := public.open_cash_day(v_co, v_pj, public._dc_today() + 1);
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 12: a future day is refused by the older rule, not this one: %', v_res; END IF;
  RAISE NOTICE 'PASS 12  and the new guard did not swallow the older future-date rule';

  RAISE NOTICE '--- INVARIANT 9 + DAY ORDER: ALL 13 ASSERTIONS PASSED ---';
END
$test$;
`;

(async () => {
  console.log(`[verify-daily-closing-cashfloor] project ${REF}`);
  if (!AGAINST_LIVE) UP.forEach(f => console.log('  up: ' + f));
  else console.log('  --against-live: asserting the APPLIED schema, no migrations replayed');
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  try {
    await q(sql);
    console.log('✅ PASS — 13 assertions held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
    console.log('   The floor refuses and allows, the boundary is < 0 rather than <= 0, bank is');
    console.log('   exempt, a cashier cannot override, a CFO can and it is recorded and printed,');
    console.log('   a direct insert cannot bypass the trigger, a transfer is not a loophole,');
    console.log('   and a day cannot be opened behind one already closed.');
    console.log('   Nothing was committed.');
  } catch (e) {
    console.log('❌ FAILED\n');
    console.log(String(e.message).slice(0, 700));
    console.log('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
  }
})();
