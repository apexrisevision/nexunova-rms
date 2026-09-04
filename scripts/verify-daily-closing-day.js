/**
 * Daily Closing — P3 verification: the CashDay state machine.
 *
 *   node scripts/verify-daily-closing-day.js                 # dry run
 *   node scripts/verify-daily-closing-day.js --against-live  # assert what is applied
 *
 * Same shape as P1 and P2: one statement batch inside BEGIN … ROLLBACK, every
 * assertion raising, so the request failing IS the test failing.
 *
 * It runs on ZZTEST Tower, in the tenant whose name says it is safe to wipe —
 * not on the pilot. Awami will carry real days, and "once per project, ever"
 * has to stay testable after its opening has been set. A paying tenant's
 * plan-limit trigger also refuses a new project, correctly.
 *
 * The clock is injected: dc.today is set per test, so "a day cannot be opened
 * in the future" is provable without waiting for tomorrow.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const UP = ['20260904h_a_day_opens_and_a_day_closes.sql'];

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal — safe to wipe
const PJ = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';   // ZZTEST Tower (21 units, 0 cash_days)
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
  v_unit uuid;
  v_cfo uuid; v_cash uuid;
  v_cfo_auth uuid := gen_random_uuid(); v_cash_auth uuid := gen_random_uuid();
  v_res jsonb; v_day uuid; v_day2 uuid; v_n numeric; v_v integer;
  v_2020 uuid; v_6050 uuid; v_1010 uuid;
BEGIN
  ---------------------------------------------------------------- fixtures --
  -- ZZTEST Tower, the sanctioned throwaway tenant. NOT the pilot: "once per
  -- project, ever" has to stay testable after Awami's real opening is set, and
  -- a paying tenant's plan-limit trigger rightly refuses a new project anyway.
  -- This suite deletes cash days to get a clean slate. Everything is inside
  -- BEGIN … ROLLBACK so it can never commit — but a DELETE aimed at a project
  -- id should not rely on that alone, so it refuses to run anywhere but the
  -- tenant whose name says it is safe to wipe.
  IF (SELECT company_name FROM public.companies WHERE id = v_co) NOT LIKE 'ZZTEST%' THEN
    RAISE EXCEPTION 'REFUSING TO RUN: this suite wipes cash days and is only for a ZZTEST tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pj AND company_id = v_co) THEN
    RAISE EXCEPTION 'FIXTURE: project % is not in the ZZTEST tenant', v_pj;
  END IF;

  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pj LIMIT 1;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'FIXTURE: ZZTEST Tower has no units'; END IF;
  DELETE FROM public.cash_entries WHERE project_id = v_pj;
  DELETE FROM public.cash_days    WHERE project_id = v_pj;

  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Day CFO','dcdaycfo','dcdaycfo@example.invalid','cfo','password','active',v_cfo_auth)
  RETURNING id INTO v_cfo;
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Day Cashier','dcdaycash','dcdaycash@example.invalid','staff','password','active',v_cash_auth)
  RETURNING id INTO v_cash;
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co, v_cfo, v_pj, 'edit', true), (v_co, v_cash, v_pj, 'edit', true);

  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  SELECT id INTO v_2020 FROM public.qb_accounts WHERE company_id=v_co AND number='2020';
  SELECT id INTO v_6050 FROM public.qb_accounts WHERE company_id=v_co AND number='6050';
  SELECT id INTO v_1010 FROM public.qb_accounts WHERE company_id=v_co AND number='1010';

  PERFORM set_config('dc.today', '2026-09-04', true);

  -- ═══ THE PURE DOMAIN ════════════════════════════════════════════════════
  IF public._dc_voucher_for('CASH','IN')  <> 'CRV' OR public._dc_voucher_for('CASH','OUT') <> 'CPV'
  OR public._dc_voucher_for('BANK','IN')  <> 'BRV' OR public._dc_voucher_for('BANK','OUT') <> 'BPV'
  OR public._dc_voucher_for('CASH',NULL)  IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 01: the voucher derivation is wrong'; END IF;
  IF public._dc_variance(90720, 90723) <> -3.00 THEN
    RAISE EXCEPTION 'FAIL 01: variance should be counted minus closing'; END IF;
  IF public._dc_jv_number(2026, 7) <> 'JV-2026-0007' THEN
    RAISE EXCEPTION 'FAIL 01: JV numbering is wrong'; END IF;
  IF public._dc_may_close('CLOSED') OR NOT public._dc_may_close('OPEN')
  OR public._dc_may_adjust('OPEN')  OR NOT public._dc_may_adjust('CLOSED') THEN
    RAISE EXCEPTION 'FAIL 01: the state predicates are wrong'; END IF;
  RAISE NOTICE 'PASS 01  the pure domain rules hold with no fixture at all';

  IF public._dc_today() <> DATE '2026-09-04' THEN
    RAISE EXCEPTION 'FAIL 02: the injected clock was ignored'; END IF;
  PERFORM set_config('dc.today', '', true);
  IF public._dc_today() <> (now() AT TIME ZONE 'Asia/Karachi')::date THEN
    RAISE EXCEPTION 'FAIL 02: the real clock is not Asia/Karachi'; END IF;
  PERFORM set_config('dc.today', '2026-09-04', true);
  RAISE NOTICE 'PASS 02  the clock is Karachi, and injectable';

  -- ═══ SETUP OPENING ══════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.setup_cash_opening(v_co, v_pj, 17723, 1000, DATE '2026-09-01');
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 03: the cashier was allowed to set the opening balance: %', v_res; END IF;
  RAISE NOTICE 'PASS 03  the cashier may not set the opening balance';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);

  -- SETUP_OPENING_REQUIRED before any opening exists
  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-02');
  IF (v_res->>'error') IS DISTINCT FROM 'SETUP_OPENING_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL 04: opening the first day without a setup opening was allowed: %', v_res; END IF;
  RAISE NOTICE 'PASS 04  SETUP_OPENING_REQUIRED before the first day';

  v_res := public.setup_cash_opening(v_co, v_pj, 17723, 1000, DATE '2026-09-01');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 05: setup opening failed: %', v_res; END IF;
  RAISE NOTICE 'PASS 05  the CFO sets the opening balance';

  v_res := public.setup_cash_opening(v_co, v_pj, 999, 999, DATE '2026-09-01');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 06: a second setup opening was allowed: %', v_res; END IF;
  RAISE NOTICE 'PASS 06  the opening balance can only be set once, ever';

  -- ═══ OPEN DAY ═══════════════════════════════════════════════════════════
  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-30');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 07: a day was opened in the future: %', v_res; END IF;
  RAISE NOTICE 'PASS 07  a day cannot be opened in the future';

  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-02');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 08: open failed: %', v_res; END IF;
  v_day := (v_res->>'cash_day_id')::uuid;
  IF (v_res->>'opening_cash')::numeric <> 17723.00 OR (v_res->>'opening_bank')::numeric <> 1000.00 THEN
    RAISE EXCEPTION 'FAIL 08: the opening was not carried forward: %', v_res; END IF;
  IF (v_res->>'event') IS DISTINCT FROM 'DayOpened' THEN RAISE EXCEPTION 'FAIL 08: no DayOpened event'; END IF;
  RAISE NOTICE 'PASS 08  carry-forward from the latest CLOSED day (17,723 / 1,000)';

  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-03');
  IF (v_res->>'error') IS DISTINCT FROM 'PREVIOUS_DAY_OPEN' THEN
    RAISE EXCEPTION 'FAIL 09: a second day was opened while one was open: %', v_res; END IF;
  RAISE NOTICE 'PASS 09  PREVIOUS_DAY_OPEN while a day is still open';

  -- ═══ ENTRIES, AND WHAT THE SUMMARY DOES WITH THEM ═══════════════════════
  -- P4 owns RecordEntry; these go in directly, which is all P3 needs.
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status, qb_account_id, created_by)
  VALUES (v_co, v_pj, v_day, 1, gen_random_uuid(),
    'CLIENT_RECEIPT','CASH','IN','CRV','P3-0001', 150000.00, v_unit, 'PENDING', v_2020, v_cfo);
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id, created_by)
  VALUES (v_co, v_pj, v_day, 2, gen_random_uuid(),
    'EXPENSE','CASH','OUT','CPV','P3-0002', 77000.00, 'NA', v_6050, v_cfo);
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id, created_by)
  VALUES (v_co, v_pj, v_day, 3, gen_random_uuid(),
    'OTHER','BANK','IN','BRV','P3-0003', 50000.00, 'NA', v_2020, v_cfo);

  -- a JV with NULL mode must NOT move the cash or bank position
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, voucher_type, voucher_no, amount, rms_status,
    qb_debit_account_id, qb_credit_account_id, is_adjustment, adjustment_reason, created_by)
  VALUES (v_co, v_pj, v_day, 4, gen_random_uuid(),
    'OTHER','JV','P3-JV-1', 999999.00, 'NA', v_6050, v_2020, true, 'reclassification, no cash', v_cfo);

  -- a void: the reversing row nets the original out (invariant 1 — the original
  -- is never touched, so the summary must arrive at the right answer anyway)
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id,
    is_adjustment, adjustment_reason, created_by)
  VALUES (v_co, v_pj, v_day, 5, gen_random_uuid(),
    'OTHER','CASH','IN','CRV','P3-0004', 500.00, 'NA', v_2020, false, NULL, v_cfo);
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id,
    is_adjustment, adjustment_reason, created_by)
  VALUES (v_co, v_pj, v_day, 6, gen_random_uuid(),
    'OTHER','CASH','OUT','CPV','P3-0004R', 500.00, 'NA', v_2020, true, 'voided: entered twice', v_cfo);

  v_res := public.get_cash_day_summary(v_co, v_pj, DATE '2026-09-02');
  IF (v_res->>'in_cash')::numeric  <> 150500.00 THEN RAISE EXCEPTION 'FAIL 10: in_cash %', v_res->>'in_cash'; END IF;
  IF (v_res->>'out_cash')::numeric <> 77500.00  THEN RAISE EXCEPTION 'FAIL 10: out_cash %', v_res->>'out_cash'; END IF;
  IF (v_res->>'in_bank')::numeric  <> 50000.00  THEN RAISE EXCEPTION 'FAIL 10: in_bank %', v_res->>'in_bank'; END IF;
  IF (v_res->>'closing_cash')::numeric <> 90723.00 THEN
    RAISE EXCEPTION 'FAIL 10: closing_cash should be 17723 + 150500 - 77500 = 90723, got %', v_res->>'closing_cash'; END IF;
  IF (v_res->>'closing_bank')::numeric <> 51000.00 THEN
    RAISE EXCEPTION 'FAIL 10: closing_bank should be 51000, got %', v_res->>'closing_bank'; END IF;
  RAISE NOTICE 'PASS 10  summary: the JV with NULL mode is excluded and the void nets out';
  RAISE NOTICE '         cash 17,723 + 150,500 - 77,500 = 90,723   bank 1,000 + 50,000 = 51,000';

  -- ═══ CLOSE DAY ══════════════════════════════════════════════════════════
  SELECT version INTO v_v FROM public.cash_days WHERE id = v_day;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.close_cash_day(v_co, v_day, 90723, NULL, NULL, v_v);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 11: the cashier closed the day: %', v_res; END IF;
  RAISE NOTICE 'PASS 11  the cashier may not close the day';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);

  v_res := public.close_cash_day(v_co, v_day, 90720, NULL, NULL, v_v);
  IF (v_res->>'error') IS DISTINCT FROM 'VARIANCE_UNEXPLAINED' THEN
    RAISE EXCEPTION 'FAIL 12: a 3-rupee short close was allowed with no note: %', v_res; END IF;
  IF (v_res->>'variance')::numeric <> -3.00 THEN
    RAISE EXCEPTION 'FAIL 12: variance should be -3, got %', v_res->>'variance'; END IF;
  RAISE NOTICE 'PASS 12  VARIANCE_UNEXPLAINED blocks a short close  (%)', v_res->>'message';

  v_res := public.close_cash_day(v_co, v_day, 90720, NULL, '   ', v_v);
  IF (v_res->>'error') IS DISTINCT FROM 'VARIANCE_UNEXPLAINED' THEN
    RAISE EXCEPTION 'FAIL 13: whitespace was accepted as a variance note: %', v_res; END IF;
  RAISE NOTICE 'PASS 13  a blank note is not an explanation';

  v_res := public.close_cash_day(v_co, v_day, 90720, NULL, 'short 3, cashier', v_v + 5);
  IF (v_res->>'error') IS DISTINCT FROM 'VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'FAIL 14: a stale version was accepted: %', v_res; END IF;
  RAISE NOTICE 'PASS 14  VERSION_CONFLICT on a stale version';

  v_res := public.close_cash_day(v_co, v_day, 90720,
             '{"5000":18,"500":1,"100":2,"20":1}'::jsonb, 'short 3, cashier', v_v);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 15: close failed: %', v_res; END IF;
  IF (v_res->>'event') IS DISTINCT FROM 'DayClosed' THEN RAISE EXCEPTION 'FAIL 15: no DayClosed event'; END IF;
  IF (v_res->>'closing_cash')::numeric <> 90723.00 OR (v_res->>'variance')::numeric <> -3.00 THEN
    RAISE EXCEPTION 'FAIL 15: wrong figures persisted: %', v_res; END IF;
  IF (v_res->>'denominations_total')::numeric <> 90720.00
     OR NOT (v_res->>'denominations_match')::boolean THEN
    RAISE EXCEPTION 'FAIL 15: the denomination count does not reconcile: %', v_res; END IF;
  RAISE NOTICE 'PASS 15  close succeeds with a note; denominations total 90,720 and match';

  IF (SELECT status FROM public.cash_days WHERE id=v_day) <> 'CLOSED'
     OR (SELECT closed_by FROM public.cash_days WHERE id=v_day) <> v_cfo
     OR (SELECT version FROM public.cash_days WHERE id=v_day) <> v_v + 1 THEN
    RAISE EXCEPTION 'FAIL 16: the close did not persist correctly'; END IF;
  -- the stored figure and the live computation must agree
  v_res := public.get_cash_day_summary(v_co, v_pj, DATE '2026-09-02');
  IF (v_res->>'closing_cash')::numeric <> 90723.00 THEN
    RAISE EXCEPTION 'FAIL 16: stored closing disagrees with the live sum: %', v_res; END IF;
  RAISE NOTICE 'PASS 16  status CLOSED, closed_by set, version bumped, figures agree';

  v_res := public.close_cash_day(v_co, v_day, 90723, NULL, NULL, NULL);
  IF (v_res->>'error') IS DISTINCT FROM 'DAY_LOCKED' THEN
    RAISE EXCEPTION 'FAIL 17: a closed day was closed again: %', v_res; END IF;
  RAISE NOTICE 'PASS 17  a closed day cannot be closed twice';

  -- ═══ DAY_LOCKED FOR A NORMAL ENTRY ══════════════════════════════════════
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id)
    VALUES (v_co, v_pj, v_day, 90, gen_random_uuid(),
      'EXPENSE','CASH','OUT','CPV','P3-LATE', 100.00, 'NA', v_6050);
    RAISE EXCEPTION 'FAIL 18: a normal entry was accepted onto a CLOSED day';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%DAY_LOCKED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 18  DAY_LOCKED for a normal entry on a closed day';
  END;

  -- ═══ ADJUSTMENTS ════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.post_cash_adjustment(v_co, v_day,
             jsonb_build_object('mode','CASH','direction','OUT','amount',3,'qb_account_id',v_6050),
             'cashier trying to adjust');
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 19: the cashier posted an adjustment: %', v_res; END IF;
  RAISE NOTICE 'PASS 19  only the CFO may adjust';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  v_res := public.post_cash_adjustment(v_co, v_day,
             jsonb_build_object('mode','CASH','direction','OUT','amount',3,'qb_account_id',v_6050), '  ');
  IF (v_res->>'error') IS DISTINCT FROM 'OVERRIDE_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL 20: an adjustment with no reason was accepted: %', v_res; END IF;
  RAISE NOTICE 'PASS 20  an adjustment always carries a reason';

  v_res := public.post_cash_adjustment(v_co, v_day,
             jsonb_build_object('mode','CASH','direction','OUT','amount',3,'qb_account_id',v_6050),
             'cashier was short by 3, corrected next morning');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 21: adjustment failed: %', v_res; END IF;
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'CPV' THEN
    RAISE EXCEPTION 'FAIL 21: a cash-affecting adjustment must derive CPV, not JV, got %', v_res->>'voucher_type'; END IF;
  IF (v_res->>'voucher_no') !~ '^JV-2026-[0-9]{4}$' THEN
    RAISE EXCEPTION 'FAIL 21: voucher_no is not JV-YYYY-nnnn: %', v_res->>'voucher_no'; END IF;
  IF NOT (v_res->>'affects_cash')::boolean OR (v_res->>'event') IS DISTINCT FROM 'AdjustmentPosted' THEN
    RAISE EXCEPTION 'FAIL 21: wrong result shape: %', v_res; END IF;
  RAISE NOTICE 'PASS 21  a cash-affecting adjustment is a CPV numbered % (see the deviation note)', v_res->>'voucher_no';

  -- it moved the closed day's live position; the stored closing stays as locked
  v_res := public.get_cash_day_summary(v_co, v_pj, DATE '2026-09-02');
  IF (v_res->>'out_cash')::numeric <> 77503.00 THEN
    RAISE EXCEPTION 'FAIL 22: the adjustment did not reach the day totals: %', v_res->>'out_cash'; END IF;
  IF (v_res->>'closing_cash')::numeric <> 90723.00 THEN
    RAISE EXCEPTION 'FAIL 22: a closed day must still report the figure it was locked at'; END IF;
  RAISE NOTICE 'PASS 22  the adjustment shows in the totals; the locked closing figure is unchanged';

  v_res := public.post_cash_adjustment(v_co, v_day,
             jsonb_build_object('amount',1200,'qb_debit_account_id',v_6050,'qb_credit_account_id',v_2020),
             'posted to the wrong head, reclassified');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 23: reclassification failed: %', v_res; END IF;
  IF (v_res->>'voucher_type') IS DISTINCT FROM 'JV' OR (v_res->>'affects_cash')::boolean THEN
    RAISE EXCEPTION 'FAIL 23: a reclassification must be a JV that moves no cash: %', v_res; END IF;
  RAISE NOTICE 'PASS 23  a pure reclassification IS a JV, and moves no cash';

  v_res := public.post_cash_adjustment(v_co, v_day,
             jsonb_build_object('amount',5,'qb_debit_account_id',v_6050,'qb_credit_account_id',v_6050),
             'same account both sides');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 24: a JV debited and credited the same account: %', v_res; END IF;
  RAISE NOTICE 'PASS 24  a JV cannot name the same account twice';

  -- an OPEN day is not adjusted; it is recorded on
  v_res := public.open_cash_day(v_co, v_pj, DATE '2026-09-03');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 25: could not open the next day: %', v_res; END IF;
  v_day2 := (v_res->>'cash_day_id')::uuid;
  IF (v_res->>'opening_cash')::numeric <> 90723.00 THEN
    RAISE EXCEPTION 'FAIL 25: the next day did not carry 90,723 forward: %', v_res; END IF;
  RAISE NOTICE 'PASS 25  the next day carries forward the CLOSED day''s closing (90,723)';

  v_res := public.post_cash_adjustment(v_co, v_day2,
             jsonb_build_object('mode','CASH','direction','OUT','amount',1,'qb_account_id',v_6050),
             'trying to adjust an open day');
  IF (v_res->>'error') IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'FAIL 26: an OPEN day was adjusted: %', v_res; END IF;
  RAISE NOTICE 'PASS 26  an OPEN day is recorded on, not adjusted';

  -- ═══ AUDIT (invariant 7) ════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name='cash_days' AND record_id = v_day::text AND project_id = v_pj;
  IF v_n < 2 THEN RAISE EXCEPTION 'FAIL 27: the day was not audited on open and close (% rows)', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE table_name='cash_days' AND record_id = v_day::text
                    AND action='UPDATE' AND is_sensitive AND reason = 'short 3, cashier') THEN
    RAISE EXCEPTION 'FAIL 27: the close was not flagged sensitive with its variance note'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE table_name='cash_entries' AND action='INSERT' AND is_sensitive
                    AND reason = 'cashier was short by 3, corrected next morning') THEN
    RAISE EXCEPTION 'FAIL 27: the adjustment reason did not reach the audit'; END IF;
  RAISE NOTICE 'PASS 27  open, close and adjust are all audited, scoped and reasoned';

  -- ═══ SCOPE (invariant 8) ════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', '', true);
  v_res := public.get_cash_day_summary(v_co, v_pj, DATE '2026-09-02');
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 28: an unauthenticated caller read the day: %', v_res; END IF;
  RAISE NOTICE 'PASS 28  no session, no day';

  RAISE NOTICE '--- P3: ALL 28 ASSERTIONS PASSED ---';
END
$test$;
`;

(async () => {
  console.log(`[verify-daily-closing-day] project ${REF}`);
  if (AGAINST_LIVE) console.log('  mode: --against-live — asserting the applied schema.');
  else console.log('  up: ' + UP.join('\n      '));
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p3_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  console.log('✅ PASS — 28 assertions held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   Carry-forward, SETUP_OPENING_REQUIRED, PREVIOUS_DAY_OPEN, VARIANCE_UNEXPLAINED,');
  console.log('   VERSION_CONFLICT, DAY_LOCKED, CFO-only adjustments, JV exclusion and void netting.');
  console.log('   Nothing was committed.');
})();
