/**
 * Daily Closing — P1 schema verification.
 *
 *   node scripts/verify-daily-closing-schema.js
 *
 * There is no local Postgres on this machine and the Supabase org is on a plan
 * without database branches, so the only real engine available is production.
 * That is fine, because Postgres has transactional DDL: this script sends the
 * up migrations, the assertions and the down migration as ONE statement batch
 * wrapped in BEGIN … ROLLBACK. Nothing it creates survives the request, and if
 * anything raises, the transaction aborts and rolls back for the same reason.
 *
 * It proves the Definition of Done for P1:
 *   · 20260903e / f / g apply cleanly to a database that does not have them
 *   · UPDATE of cash_entries.amount is REJECTED
 *   · UPDATE of cash_entries.rms_status is ALLOWED
 *   · DELETE of a cash_entries row is REJECTED
 *   · 20260903r takes the database back to exactly where it started
 *
 * …plus the constraints that carry the blueprint's invariants, which are worth
 * a test each because every one of them is a rule somebody will otherwise have
 * to remember.
 *
 * Read-only in effect. It writes nothing that is ever committed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

const UP = [
  '20260903e_a_day_of_cash_has_a_shape.sql',
  '20260903f_a_saved_entry_is_a_fact.sql',
  '20260903g_closing_the_day_is_not_an_everyday_permission.sql',
];
const DOWN = '20260903r_rollback_the_cash_book.sql';

// The pilot. Only used as a source of valid foreign keys; every row written
// against it is rolled back.
const PILOT_COMPANY = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const PILOT_PROJECT = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

/**
 * Each migration file is its own transaction. Nested inside our outer one, an
 * inner COMMIT would end it early and make the "rollback" a no-op that had
 * already written to production — so the outer BEGIN/COMMIT lines are stripped
 * and their absence is asserted, loudly, rather than assumed.
 */
function body(file) {
  const raw = fs.readFileSync(path.join(MIG, file), 'utf8');
  const stripped = raw.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped)) {
    throw new Error(`${file}: a BEGIN/COMMIT survived stripping — refusing to run`);
  }
  return `\n-- ══════ ${file} ══════\n${stripped}\n`;
}

const ASSERT_UP = `
DO $test$
DECLARE
  v_co   uuid := '${PILOT_COMPANY}';
  v_pj   uuid := '${PILOT_PROJECT}';
  v_unit uuid;
  v_user uuid;
  v_day  uuid;
  v_entry uuid;
  v_n    integer;
  v_txt  text;
  v_2020 uuid;
BEGIN
  ---------------------------------------------------------------- fixtures --
  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pj LIMIT 1;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'FIXTURE: pilot project has no units'; END IF;
  SELECT id INTO v_user FROM public.app_users WHERE company_id = v_co LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'FIXTURE: pilot tenant has no users'; END IF;
  -- Since P2, invariant 5 requires a client receipt to carry its default head
  -- (2020 Advance from Customers) or a written override reason. These fixtures
  -- predate that trigger; they now do what a real receipt does. NULL until P2's
  -- seeder has run, which is fine — the guard only fires when a default exists.
  SELECT id INTO v_2020 FROM public.qb_accounts WHERE company_id = v_co AND number = '2020';

  ------------------------------------------------------- tables and indexes --
  FOREACH v_txt IN ARRAY ARRAY[
    'qb_accounts','cash_accounts','payees','entry_type_defaults','cash_days',
    'qb_exports','cash_entries','cash_entry_attachments','receipt_counters',
    'client_receipts','day_documents','reconciliations'
  ] LOOP
    IF to_regclass('public.' || v_txt) IS NULL THEN
      RAISE EXCEPTION 'FAIL: table % was not created', v_txt;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=v_txt AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS not enabled on %', v_txt;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename=v_txt AND policyname='deny_all_anon') THEN
      RAISE EXCEPTION 'FAIL: deny_all_anon policy missing on %', v_txt;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 01  12 tables created, each RLS-enabled with deny_all_anon';

  FOREACH v_txt IN ARRAY ARRAY[
    'cash_entries_day_seq_idx','cash_entries_qb_status_idx','cash_entries_rms_status_idx',
    'cash_days_project_date_idx',
    'cash_entries_voucher_unique','cash_days_one_open_per_project',
    'cash_days_setup_opening_once','payees_name_unique','audit_logs_project_idx'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=v_txt) THEN
      RAISE EXCEPTION 'FAIL: index % missing', v_txt;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 02  every index in the P1 brief exists';

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='audit_logs' AND column_name='project_id') THEN
    RAISE EXCEPTION 'FAIL: audit_logs.project_id missing';
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('cash_days','cash_entries','qb_exports','reconciliations')
     AND data_type='numeric' AND (numeric_precision <> 18 OR numeric_scale <> 2);
  IF v_n > 0 THEN RAISE EXCEPTION 'FAIL: % money column(s) are not numeric(18,2)', v_n; END IF;
  RAISE NOTICE 'PASS 03  every money column is numeric(18,2)';

  ------------------------------------------------------------- a live entry --
  INSERT INTO public.cash_days (company_id, project_id, business_date, status, opening_cash, opening_bank, created_by)
  VALUES (v_co, v_pj, DATE '2999-01-01', 'OPEN', 17723.00, 1000.00, v_user)
  RETURNING id INTO v_day;

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount,
    narration, unit_id, rms_status, created_by, qb_account_id)
  VALUES (v_co, v_pj, v_day, 1, gen_random_uuid(),
    'CLIENT_RECEIPT','CASH','IN','CRV','TEST-0041', 150000.00,
    'Installment #4', v_unit, 'PENDING', v_user, v_2020)
  RETURNING id INTO v_entry;
  RAISE NOTICE 'PASS 04  a cash entry can be recorded';

  --------------------------------------------- DoD · UPDATE amount rejected --
  BEGIN
    UPDATE public.cash_entries SET amount = 1.00 WHERE id = v_entry;
    RAISE EXCEPTION 'FAIL 05: UPDATE of cash_entries.amount was ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 05  UPDATE of amount is rejected  (%)', left(SQLERRM, 70);
  END;

  ------------------------------------------ DoD · UPDATE rms_status allowed --
  UPDATE public.cash_entries
     SET rms_status = 'POSTED', rms_receipt_ref = 'PRV-2627-00001', rms_status_reason = NULL
   WHERE id = v_entry;
  IF (SELECT rms_status FROM public.cash_entries WHERE id = v_entry) <> 'POSTED' THEN
    RAISE EXCEPTION 'FAIL 06: rms_status did not change';
  END IF;
  RAISE NOTICE 'PASS 06  UPDATE of rms_status / rms_receipt_ref is allowed';

  -- and the other three whitelisted columns move together with an export
  UPDATE public.cash_entries SET qb_status = 'NOT_EXPORTED' WHERE id = v_entry;
  RAISE NOTICE 'PASS 07  UPDATE of qb_status is allowed';

  ---------------------------------------------------- DoD · DELETE rejected --
  BEGIN
    DELETE FROM public.cash_entries WHERE id = v_entry;
    RAISE EXCEPTION 'FAIL 08: DELETE of a cash_entries row was ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot be deleted%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 08  DELETE is rejected  (%)', left(SQLERRM, 70);
  END;

  ------------------------------------------------- the constraints, briefly --
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status, qb_account_id)
    VALUES (v_co, v_pj, v_day, 2, gen_random_uuid(),
      'CLIENT_RECEIPT','CASH','IN','BPV','TEST-0042', 100.00, v_unit, 'PENDING', v_2020);
    RAISE EXCEPTION 'FAIL 09: CASH/IN was accepted as a BPV';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 09  voucher type must match mode + direction';
  END;

  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id)
    VALUES (v_co, v_pj, v_day, 2, gen_random_uuid(),
      'CLIENT_RECEIPT','CASH','IN','CRV','TEST-0043', 100.00, 'PENDING', v_2020);
    RAISE EXCEPTION 'FAIL 10: a client receipt was accepted with no unit';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 10  UNIT_REQUIRED on a client receipt';
  END;

  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status,
      expected_amount, qb_account_id)
    VALUES (v_co, v_pj, v_day, 2, gen_random_uuid(),
      'CLIENT_RECEIPT','CASH','IN','CRV','TEST-0044', 100.00, v_unit, 'PENDING', 200.00, v_2020);
    RAISE EXCEPTION 'FAIL 11: a short payment was accepted with no variance tag';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 11  VARIANCE_TAG_REQUIRED when amount <> expected';
  END;

  BEGIN
    INSERT INTO public.cash_days (company_id, project_id, business_date, status, opening_cash, opening_bank)
    VALUES (v_co, v_pj, DATE '2999-01-02', 'OPEN', 0, 0);
    RAISE EXCEPTION 'FAIL 12: a second OPEN day was accepted for the same project';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 12  at most one OPEN day per project';
  END;

  BEGIN
    UPDATE public.cash_days
       SET status='CLOSED', closing_cash=90723.00, closing_bank=51000.00,
           counted_cash=90720.00, variance=-3.00, variance_note=NULL,
           closed_by=v_user, closed_at=now()
     WHERE id = v_day;
    RAISE EXCEPTION 'FAIL 13: a day closed with an unexplained variance';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 13  VARIANCE_UNEXPLAINED blocks the close';
  END;

  UPDATE public.cash_days
     SET status='CLOSED', closing_cash=90723.00, closing_bank=51000.00,
         counted_cash=90720.00, variance=-3.00, variance_note='short 3, cashier',
         closed_by=v_user, closed_at=now(), version=version+1
   WHERE id = v_day;
  RAISE NOTICE 'PASS 14  a day closes once the variance is explained';

  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status)
    VALUES (v_co, v_pj, v_day, 3, gen_random_uuid(),
      'EXPENSE','CASH','OUT','CPV','TEST-0045', 500.00, 'NA');
    RAISE EXCEPTION 'FAIL 15: an ordinary entry was accepted into a CLOSED day';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%DAY_LOCKED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 15  DAY_LOCKED after close';
  END;

  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status,
    is_adjustment, adjusts_entry_id, adjustment_reason)
  VALUES (v_co, v_pj, v_day, 4, gen_random_uuid(),
    'OTHER','CASH','OUT','CPV','JV-2026-0001', 3.00, 'NA',
    true, v_entry, 'cashier short by 3, corrected next morning');
  RAISE NOTICE 'PASS 16  an adjustment with a reason IS accepted into a CLOSED day';

  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, is_adjustment)
    VALUES (v_co, v_pj, v_day, 5, gen_random_uuid(),
      'OTHER','CASH','OUT','CPV','JV-2026-0002', 3.00, 'NA', true);
    RAISE EXCEPTION 'FAIL 17: an adjustment was accepted with no reason';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 17  an adjustment without a reason is refused';
  END;

  ------------------------------------------------------- invariant 7 and 8 --
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name = 'cash_entries' AND project_id = v_pj;
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 18: no audit row carried project_id'; END IF;
  RAISE NOTICE 'PASS 18  audit rows written and scoped to the project (% rows)', v_n;

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name = 'cash_entries' AND is_sensitive
     AND reason = 'cashier short by 3, corrected next morning';
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 19: the adjustment reason did not reach the audit'; END IF;
  RAISE NOTICE 'PASS 19  an adjustment is flagged sensitive and carries its reason';

  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, is_adjustment, adjustment_reason)
    VALUES (v_co, '00000000-0000-0000-0000-000000000000'::uuid, v_day, 6, gen_random_uuid(),
      'OTHER','CASH','OUT','CPV','JV-2026-0003', 1.00, 'NA', true, 'wrong project on purpose');
    RAISE EXCEPTION 'FAIL 20: an entry was accepted against another project''s day';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%does not belong to its day%'
       AND SQLERRM NOT LIKE '%foreign key%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 20  an entry cannot belong to another project''s day';
  END;

  ----------------------------------------------------------- the CFO gate --
  IF public._dc_is_cfo((SELECT u FROM public.app_users u WHERE u.role='admin' LIMIT 1)) THEN
    RAISE EXCEPTION 'FAIL 21: a plain admin passed the CFO gate';
  END IF;
  RAISE NOTICE 'PASS 21  role=admin does NOT pass _dc_is_cfo';

  IF NOT public._dc_is_cfo((SELECT u FROM public.app_users u WHERE u.role='owner' LIMIT 1)) THEN
    RAISE EXCEPTION 'FAIL 22: an owner did not pass the CFO gate';
  END IF;
  RAISE NOTICE 'PASS 22  role=owner passes _dc_is_cfo (account of last resort)';

  RAISE NOTICE '--- UP MIGRATION: ALL ASSERTIONS PASSED ---';
END
$test$;
`;

const ASSERT_DOWN = `
DO $down$
DECLARE v_txt text;
BEGIN
  FOREACH v_txt IN ARRAY ARRAY[
    'qb_accounts','cash_accounts','payees','entry_type_defaults','cash_days',
    'qb_exports','cash_entries','cash_entry_attachments','receipt_counters',
    'client_receipts','day_documents','reconciliations'
  ] LOOP
    IF to_regclass('public.' || v_txt) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL: rollback left table % behind', v_txt;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='audit_logs' AND column_name='project_id') THEN
    RAISE EXCEPTION 'FAIL: rollback left audit_logs.project_id behind';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN
                ('_dc_is_cfo','cash_entries_immutable','cash_entries_day_guard','cash_entries_no_truncate')) THEN
    RAISE EXCEPTION 'FAIL: rollback left a module function behind';
  END IF;

  -- audit_trigger_function must be back, and must be the version WITHOUT project_id
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='audit_trigger_function') LIKE '%v_project_id%' THEN
    RAISE EXCEPTION 'FAIL: rollback left the modified audit_trigger_function in place';
  END IF;

  RAISE NOTICE '--- DOWN MIGRATION: DATABASE IS BACK WHERE IT STARTED ---';
END
$down$;
`;

// --against-live : the migrations are already applied. Run ONLY the assertions,
// against the schema that is really there, and do not send the rollback — a
// down migration inside a transaction on a live database is a correct but
// alarming thing to do, and once the cash book carries real rows it stops being
// merely alarming. Fixture rows still roll back.
const AGAINST_LIVE = process.argv.includes('--against-live');

(async () => {
  console.log(`[verify-daily-closing-schema] project ${REF}`);
  if (AGAINST_LIVE) {
    console.log('  mode: --against-live — asserting the schema that is already applied.');
    console.log('  the up and down migrations are NOT sent.');
  } else {
    console.log('  up:   ' + UP.join('\n        '));
    console.log('  down: ' + DOWN);
  }
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT_UP, 'ROLLBACK;'].join('\n')
    : [
      'BEGIN;',
      ...UP.map(body),
      ASSERT_UP,
      body(DOWN),
      ASSERT_DOWN,
      'ROLLBACK;',
    ].join('\n');

  fs.writeFileSync(path.join(__dirname, '..', 'migration_work', '_dc_p1_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exit(1);
  }

  // The Management API does not return NOTICE output, so the assertions are
  // proved by the request succeeding: every one of them raises on failure, and
  // a raise aborts the batch.
  if (AGAINST_LIVE) {
    console.log('✅ PASS — 22 assertions held against the LIVE applied schema.');
    console.log('   Fixture rows rolled back; nothing was committed.');
  } else {
    console.log('✅ PASS — migrations applied, 22 assertions held, rollback returned the');
    console.log('   database to its starting state. Nothing was committed.');
    console.log('\n   Re-run any time. To apply for real, run the three up migrations');
    console.log('   through apply_migration — this script never does.');
  }
})();
