/**
 * Daily Closing — P2 verification: seeds, payee master, invariant 5, the bucket.
 *
 *   node scripts/verify-daily-closing-seed.js                 # dry run: applies the four
 *                                                             # P2 migrations, asserts, rolls back
 *   node scripts/verify-daily-closing-seed.js --against-live  # asserts what is already applied
 *
 * Same shape as verify-daily-closing-schema.js: one statement batch wrapped in
 * BEGIN … ROLLBACK, every assertion raising on failure, so the request failing
 * IS the test failing. Nothing it writes survives.
 *
 * What is different from P1 is that the RPCs are exercised as REAL CALLERS.
 * auth.uid() reads request.jwt.claims, and app_users.auth_user_id carries no
 * foreign key, so the harness can mint throwaway users inside the transaction
 * and become each of them in turn:
 *
 *   owner    — passes _dc_is_cfo, may maintain the master
 *   accounts — the Accountant of §A10, may maintain the master
 *   admin    — may NOT (RULES §0.4: admin is this database's data-entry role)
 *   staff    — the cashier: may read the list, may not change it
 *   nobody   — no session at all
 *
 * That is the RBAC matrix of §A10 for this one surface, proved rather than
 * asserted in a comment. The full role×action suite is still P10's job.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

const UP = [
  '20260904a_the_chart_and_the_people_paid.sql',
  '20260904b_a_head_that_is_not_the_default_needs_a_reason.sql',
  '20260904c_a_private_shelf_for_the_days_documents.sql',
  '20260904d_the_payee_master_opens.sql',
];

const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';   // Awami Market
const PJ = '59ded55b-9bc2-45b2-a372-49fc31807fa9';   // Awami Market (project)

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
  v_owner uuid; v_fin uuid; v_adm uuid; v_cash uuid;   -- app_users.id
  v_o_auth uuid := gen_random_uuid(); v_f_auth uuid := gen_random_uuid();
  v_a_auth uuid := gen_random_uuid(); v_c_auth uuid := gen_random_uuid();
  v_n integer; v_txt text; v_res jsonb; v_id uuid; v_id2 uuid;
  v_2020 uuid; v_6050 uuid; v_4010 uuid;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pj LIMIT 1;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'FIXTURE: pilot project has no units'; END IF;

  -- ═══ SEEDER ═════════════════════════════════════════════════════════════
  -- Run it a second and a third time. The migration already ran it once.
  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  PERFORM public.seed_daily_closing_chart(v_co, v_pj);

  SELECT count(*) INTO v_n FROM public.qb_accounts WHERE company_id = v_co;
  IF v_n <> 53 THEN RAISE EXCEPTION 'FAIL 01: expected 53 qb_accounts after 3 runs, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM (SELECT number FROM public.qb_accounts WHERE company_id=v_co
                                  GROUP BY number HAVING count(*) > 1) d;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 01: % duplicated account number(s)', v_n; END IF;
  RAISE NOTICE 'PASS 01  seeder is idempotent — 53 accounts after three runs, no duplicates';

  SELECT count(*) INTO v_n FROM public.qb_accounts WHERE company_id=v_co AND length(name) > 31;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 02: % account name(s) exceed QuickBooks 31 chars', v_n; END IF;
  SELECT max(length(name)) INTO v_n FROM public.qb_accounts WHERE company_id=v_co;
  RAISE NOTICE 'PASS 02  no account name exceeds 31 characters (longest is %)', v_n;

  -- the numbers themselves, spot-checked at both ends and the awkward middle
  FOREACH v_txt IN ARRAY ARRAY['1010','1030','2020','3010','4010','5030','6040','7020'] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.qb_accounts WHERE company_id=v_co AND number=v_txt) THEN
      RAISE EXCEPTION 'FAIL 03: account % missing', v_txt;
    END IF;
  END LOOP;
  IF (SELECT name FROM public.qb_accounts WHERE company_id=v_co AND number='3010') <> 'Owner''s Capital' THEN
    RAISE EXCEPTION 'FAIL 03: 3010 name is not exactly "Owner''s Capital"'; END IF;
  IF (SELECT name FROM public.qb_accounts WHERE company_id=v_co AND number='5030') <> 'Construction - Development Cost' THEN
    RAISE EXCEPTION 'FAIL 03: 5030 name drifted'; END IF;
  RAISE NOTICE 'PASS 03  account names match the chart character for character';

  -- drift correction: a renamed, deactivated account is put back
  UPDATE public.qb_accounts SET name='WRONG', is_active=false WHERE company_id=v_co AND number='2020';
  PERFORM public.seed_daily_closing_chart(v_co, v_pj);
  IF (SELECT name FROM public.qb_accounts WHERE company_id=v_co AND number='2020') <> 'Advance from Customers'
     OR NOT (SELECT is_active FROM public.qb_accounts WHERE company_id=v_co AND number='2020') THEN
    RAISE EXCEPTION 'FAIL 04: re-seeding did not correct a drifted account'; END IF;
  RAISE NOTICE 'PASS 04  re-seeding corrects a renamed or deactivated account';

  SELECT id INTO v_2020 FROM public.qb_accounts WHERE company_id=v_co AND number='2020';
  SELECT id INTO v_6050 FROM public.qb_accounts WHERE company_id=v_co AND number='6050';
  SELECT id INTO v_4010 FROM public.qb_accounts WHERE company_id=v_co AND number='4010';

  SELECT count(*) INTO v_n FROM public.entry_type_defaults WHERE company_id=v_co;
  IF v_n <> 5 THEN RAISE EXCEPTION 'FAIL 05: expected 5 entry_type_defaults, found %', v_n; END IF;
  IF (SELECT default_qb_account_id FROM public.entry_type_defaults
       WHERE company_id=v_co AND entry_type='CLIENT_RECEIPT') IS DISTINCT FROM v_2020 THEN
    RAISE EXCEPTION 'FAIL 05: CLIENT_RECEIPT does not default to 2020'; END IF;
  IF (SELECT default_qb_account_id FROM public.entry_type_defaults
       WHERE company_id=v_co AND entry_type='EXPENSE') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 05: EXPENSE should have no single default'; END IF;
  RAISE NOTICE 'PASS 05  entry_type_defaults seeded; CLIENT_RECEIPT -> 2020 Advance from Customers';

  SELECT count(*) INTO v_n FROM public.cash_accounts WHERE project_id=v_pj;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 06: expected 2 cash_accounts for the pilot, found %', v_n; END IF;
  IF (SELECT qb_account_id FROM public.cash_accounts WHERE project_id=v_pj AND kind='CASH')
     IS DISTINCT FROM (SELECT id FROM public.qb_accounts WHERE company_id=v_co AND number='1010') THEN
    RAISE EXCEPTION 'FAIL 06: Cash in Hand is not mapped to 1010'; END IF;
  IF (SELECT qb_account_id FROM public.cash_accounts WHERE project_id=v_pj AND kind='BANK')
     IS DISTINCT FROM (SELECT id FROM public.qb_accounts WHERE company_id=v_co AND number='1030') THEN
    RAISE EXCEPTION 'FAIL 06: Bank Al-Habib is not mapped to 1030'; END IF;
  RAISE NOTICE 'PASS 06  pilot cash accounts seeded: CASH->1010, BANK->1030';

  -- ═══ NORMALISATION ══════════════════════════════════════════════════════
  INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, 'Zubair', 'VENDOR');
  BEGIN
    INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, '  zubair  ', 'VENDOR');
    RAISE EXCEPTION 'FAIL 07: "  zubair  " was accepted alongside "Zubair"';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, 'ZUBAIR', 'VENDOR');
    RAISE EXCEPTION 'FAIL 07: "ZUBAIR" was accepted alongside "Zubair"';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'PASS 07  "Zubair" / "  zubair  " / "ZUBAIR" are one payee';

  INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, 'M/s. Ahmed & Sons', 'VENDOR');
  BEGIN
    INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, 'Ms Ahmed   Sons', 'VENDOR');
    RAISE EXCEPTION 'FAIL 08: punctuation and spacing were not normalised away';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'PASS 08  punctuation stripped and whitespace collapsed';

  -- a non-Latin name must survive normalisation, not vanish
  INSERT INTO public.payees (company_id, project_id, name, kind) VALUES (v_co, v_pj, 'ظفر اقبال', 'STAFF');
  IF (SELECT btrim(normalized_name) FROM public.payees WHERE company_id=v_co AND name='ظفر اقبال') = '' THEN
    RAISE EXCEPTION 'FAIL 09: a non-Latin name normalised to the empty string'; END IF;
  RAISE NOTICE 'PASS 09  a non-Latin name survives normalisation';

  -- ═══ THE USERS THE RPCS WILL BE CALLED AS ═══════════════════════════════
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Test Owner','dctestowner','dctestowner@example.invalid','owner','password','active',v_o_auth)
  RETURNING id INTO v_owner;
  -- 'accounts', not 'finance': app_users_role_check permits exactly
  -- owner/admin/manager/recovery/accounts/staff. The code treats 'finance' as a
  -- synonym (js/ui.js:494) but the database has never accepted it. See test 32.
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Test Accountant','dctestfin','dctestfin@example.invalid','accounts','password','active',v_f_auth)
  RETURNING id INTO v_fin;
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Test Admin','dctestadm','dctestadm@example.invalid','admin','password','active',v_a_auth)
  RETURNING id INTO v_adm;
  INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
  VALUES (v_co,'DC Test Cashier','dctestcash','dctestcash@example.invalid','staff','password','active',v_c_auth)
  RETURNING id INTO v_cash;

  -- Invariant 8. Neither the Accountant nor the cashier is admin or CFO, so a
  -- project-scoped read is refused until they are assigned to the project —
  -- which is exactly what RULES §0.9 says both real accounts will carry. The
  -- first run of this suite failed here, and the fixture was wrong, not the
  -- guard. access_level is unconstrained and this module never reads it.
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co, v_fin,  v_pj, 'edit', true),
         (v_co, v_cash, v_pj, 'edit', true);

  -- ═══ PAYEE RPCS, AS REAL CALLERS ════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_o_auth)::text, true);

  v_res := public.create_payee(v_co, '  PESCO  ', 'VENDOR', v_pj);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 10: owner could not create a payee: %', v_res; END IF;
  v_id := (v_res->>'payee_id')::uuid;
  IF (SELECT name FROM public.payees WHERE id=v_id) <> 'PESCO' THEN
    RAISE EXCEPTION 'FAIL 10: the name was not trimmed on the way in'; END IF;
  RAISE NOTICE 'PASS 10  create_payee works for the owner and trims the name';

  v_res := public.create_payee(v_co, 'pesco', 'VENDOR', v_pj);
  IF (v_res->>'error') <> 'PAYEE_DUPLICATE' THEN
    RAISE EXCEPTION 'FAIL 11: a duplicate did not return PAYEE_DUPLICATE: %', v_res; END IF;
  IF (v_res->>'existing_name') <> 'PESCO' THEN
    RAISE EXCEPTION 'FAIL 11: PAYEE_DUPLICATE did not name the existing spelling: %', v_res; END IF;
  RAISE NOTICE 'PASS 11  PAYEE_DUPLICATE names the spelling already on the list (%)', v_res->>'existing_name';

  v_res := public.rename_payee(v_id, v_co, 'Peshawar Electric Supply Co');
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 12: rename failed: %', v_res; END IF;
  IF (SELECT name FROM public.payees WHERE id=v_id) <> 'Peshawar Electric Supply Co' THEN
    RAISE EXCEPTION 'FAIL 12: rename did not take'; END IF;
  RAISE NOTICE 'PASS 12  rename_payee keeps the id and changes the name';

  v_res := public.create_payee(v_co, 'K-Electric', 'VENDOR', v_pj);
  v_id2 := (v_res->>'payee_id')::uuid;
  v_res := public.rename_payee(v_id2, v_co, 'peshawar electric supply co');
  IF (v_res->>'error') <> 'PAYEE_DUPLICATE' THEN
    RAISE EXCEPTION 'FAIL 13: renaming onto an existing name was allowed: %', v_res; END IF;
  RAISE NOTICE 'PASS 13  renaming onto an existing name is refused';

  v_res := public.set_payee_active(v_id2, v_co, false);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 14: deactivate failed: %', v_res; END IF;
  IF (SELECT is_active FROM public.payees WHERE id=v_id2) THEN
    RAISE EXCEPTION 'FAIL 14: payee is still active'; END IF;
  IF EXISTS (SELECT 1 FROM public.payees WHERE id=v_id2 AND is_active) THEN
    RAISE EXCEPTION 'FAIL 14: deactivate should not delete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payees WHERE id=v_id2) THEN
    RAISE EXCEPTION 'FAIL 14: the row was deleted rather than deactivated'; END IF;
  RAISE NOTICE 'PASS 14  set_payee_active deactivates and never deletes';

  v_res := public.list_payees(v_co, v_pj);
  IF NOT (v_res->>'success')::boolean THEN RAISE EXCEPTION 'FAIL 15: list_payees failed: %', v_res; END IF;
  IF (v_res->'payees') @> jsonb_build_array(jsonb_build_object('id', v_id2)) THEN
    RAISE EXCEPTION 'FAIL 15: an inactive payee appeared in the default list'; END IF;
  v_res := public.list_payees(v_co, v_pj, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'payees') e WHERE (e->>'id')::uuid = v_id2) THEN
    RAISE EXCEPTION 'FAIL 15: include_inactive did not return the deactivated payee'; END IF;
  RAISE NOTICE 'PASS 15  list_payees hides inactive by default and shows them on request';

  -- ═══ §A10 RBAC ON THIS SURFACE ══════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_f_auth)::text, true);
  v_res := public.create_payee(v_co, 'Sui Northern Gas', 'VENDOR', v_pj);
  IF NOT (v_res->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL 16: the Accountant (accounts) was refused: %', v_res; END IF;
  RAISE NOTICE 'PASS 16  accounts (the Accountant) may maintain the master';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a_auth)::text, true);
  v_res := public.create_payee(v_co, 'Some Vendor By Admin', 'VENDOR', v_pj);
  IF (v_res->>'error') <> 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 17: a plain admin was allowed to maintain the payee master: %', v_res; END IF;
  RAISE NOTICE 'PASS 17  plain admin may NOT maintain the master (RULES 0.4)';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_c_auth)::text, true);
  v_res := public.create_payee(v_co, 'Some Vendor By Cashier', 'VENDOR', v_pj);
  IF (v_res->>'error') <> 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 18: the cashier was allowed to create a payee: %', v_res; END IF;
  v_res := public.set_payee_active(v_id, v_co, false);
  IF (v_res->>'error') <> 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 18: the cashier was allowed to deactivate a payee: %', v_res; END IF;
  RAISE NOTICE 'PASS 18  the cashier may not create or deactivate';

  v_res := public.list_payees(v_co, v_pj);
  IF NOT (v_res->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL 19: the cashier could not read the list: %', v_res; END IF;
  RAISE NOTICE 'PASS 19  the cashier CAN read the list (they have to pick a payee)';

  PERFORM set_config('request.jwt.claims', '', true);
  v_res := public.create_payee(v_co, 'Anonymous Vendor', 'VENDOR', v_pj);
  IF (v_res->>'error') <> 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 20: an unauthenticated caller created a payee: %', v_res; END IF;
  RAISE NOTICE 'PASS 20  no session, no write';

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('delete_payee','remove_payee')) THEN
    RAISE EXCEPTION 'FAIL 21: a payee delete RPC exists'; END IF;
  RAISE NOTICE 'PASS 21  there is no payee delete RPC, by design';

  -- ═══ INVARIANT 7 · the master is audited ════════════════════════════════
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name='payees' AND record_id = v_id::text AND action='INSERT';
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 22: create wrote no audit row'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name='payees' AND record_id = v_id::text AND action='UPDATE'
     AND 'name' = ANY(changed_fields);
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 22: rename wrote no audit row naming the change'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE table_name='payees' AND record_id = v_id2::text AND action='UPDATE'
     AND 'is_active' = ANY(changed_fields);
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 22: deactivate wrote no audit row'; END IF;
  IF (SELECT project_id FROM public.audit_logs WHERE table_name='payees'
       AND record_id = v_id::text ORDER BY id LIMIT 1) IS DISTINCT FROM v_pj THEN
    RAISE EXCEPTION 'FAIL 22: the payee audit row carries the wrong project'; END IF;
  RAISE NOTICE 'PASS 22  create, rename and deactivate each wrote a project-scoped audit row';

  -- ═══ INVARIANT 5 ════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_o_auth)::text, true);
  INSERT INTO public.cash_days (company_id, project_id, business_date, status, opening_cash, opening_bank)
  VALUES (v_co, v_pj, DATE '2999-05-05', 'OPEN', 0, 0) RETURNING id INTO v_day;

  -- on the default: fine
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status, qb_account_id)
  VALUES (v_co, v_pj, v_day, 1, gen_random_uuid(),
    'CLIENT_RECEIPT','CASH','IN','CRV','P2-0001', 150000.00, v_unit, 'PENDING', v_2020);
  RAISE NOTICE 'PASS 23  a client receipt on 2020 (the default) is accepted';

  -- off the default with no reason: refused
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status, qb_account_id)
    VALUES (v_co, v_pj, v_day, 2, gen_random_uuid(),
      'CLIENT_RECEIPT','CASH','IN','CRV','P2-0002', 1000.00, v_unit, 'PENDING', v_6050);
    RAISE EXCEPTION 'FAIL 24: a client receipt on 6050 with no reason was ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%OVERRIDE_REASON_REQUIRED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 24  off-default with no reason is refused  (%)', left(SQLERRM, 66);
  END;

  -- off the default WITH a reason: allowed
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status,
    qb_account_id, qb_override_reason)
  VALUES (v_co, v_pj, v_day, 3, gen_random_uuid(),
    'CLIENT_RECEIPT','CASH','IN','CRV','P2-0003', 1000.00, v_unit, 'PENDING',
    v_6050, 'client paid the office rent share directly, agreed with CFO');
  RAISE NOTICE 'PASS 25  off-default WITH a written reason is accepted';

  -- whitespace is not a reason
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, unit_id, rms_status,
      qb_account_id, qb_override_reason)
    VALUES (v_co, v_pj, v_day, 4, gen_random_uuid(),
      'CLIENT_RECEIPT','CASH','IN','CRV','P2-0004', 1000.00, v_unit, 'PENDING', v_6050, '   ');
    RAISE EXCEPTION 'FAIL 26: whitespace was accepted as an override reason';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%OVERRIDE_REASON_REQUIRED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 26  a blank reason is not a reason';
  END;

  -- a type with no default needs no reason
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status, qb_account_id)
  VALUES (v_co, v_pj, v_day, 5, gen_random_uuid(),
    'EXPENSE','CASH','OUT','CPV','P2-0005', 77000.00, 'NA', v_6050);
  RAISE NOTICE 'PASS 27  an EXPENSE picking its own head needs no override reason';

  -- 4010 is fenced
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, mode, direction, voucher_type, voucher_no, amount, rms_status,
      qb_account_id, qb_override_reason)
    VALUES (v_co, v_pj, v_day, 6, gen_random_uuid(),
      'OTHER','CASH','IN','CRV','P2-0006', 500.00, 'NA', v_4010, 'trying to book revenue early');
    RAISE EXCEPTION 'FAIL 28: an entry was allowed to credit 4010';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%REVENUE_ACCOUNT_FENCED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 28  4010 Unit - Shop Sales is fenced off from the cash book';
  END;

  -- a JV leg citing 4010 is fenced too
  BEGIN
    INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
      entry_type, voucher_type, voucher_no, amount, rms_status,
      qb_debit_account_id, qb_credit_account_id, is_adjustment, adjustment_reason)
    VALUES (v_co, v_pj, v_day, 7, gen_random_uuid(),
      'OTHER','JV','JV-2026-0009', 500.00, 'NA', v_2020, v_4010, true, 'handover, too early');
    RAISE EXCEPTION 'FAIL 29: a JV leg was allowed to credit 4010';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%REVENUE_ACCOUNT_FENCED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 29  a journal voucher leg cannot cite 4010 either';
  END;

  -- …until Phase 3 opens the gate
  PERFORM set_config('dc.revenue_recognition', 'on', true);
  INSERT INTO public.cash_entries (company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, voucher_type, voucher_no, amount, rms_status,
    qb_debit_account_id, qb_credit_account_id, is_adjustment, adjustment_reason)
  VALUES (v_co, v_pj, v_day, 8, gen_random_uuid(),
    'OTHER','JV','JV-2026-0010', 500.00, 'NA', v_2020, v_4010, true, 'handover journal voucher');
  PERFORM set_config('dc.revenue_recognition', '', true);
  RAISE NOTICE 'PASS 30  the handover JV can reach 4010 when Phase 3 opens the gate';

  -- ═══ THE BUCKET ═════════════════════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='daily-closing') THEN
    RAISE EXCEPTION 'FAIL 31: the daily-closing bucket does not exist'; END IF;
  IF (SELECT public FROM storage.buckets WHERE id='daily-closing') THEN
    RAISE EXCEPTION 'FAIL 31: the daily-closing bucket is PUBLIC'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND qual LIKE '%daily-closing%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL 31: % storage policy/policies grant direct access to the bucket', v_n; END IF;
  RAISE NOTICE 'PASS 31  daily-closing exists, is private, and has no direct-access policy';

  -- ═══ THE 'cfo' ROLE CANNOT YET BE STORED ════════════════════════════════
  -- A tripwire, not a test that preserves a bug. RULES §0.3/§0.4 rest on a
  -- 'cfo' role, and P1 recorded — wrongly — that app_users.role has no CHECK.
  -- It has one, and it does not list 'cfo', so no CFO account can be created
  -- until the owner approves widening it. _dc_is_cfo() itself is correct; it is
  -- the column that will not hold the value.
  --
  -- When the CHECK is widened, THIS TEST GOES RED. That is the point: whoever
  -- widens it must come back here, delete this block, and take the blocker out
  -- of RULES §0.9 and PHASES.md in the same commit.
  IF public._dc_is_cfo(json_populate_record(NULL::public.app_users,
       '{"role":"cfo","is_super_admin":false}'::json)) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 32: _dc_is_cfo does not admit a role=cfo user'; END IF;
  IF public._dc_is_cfo(json_populate_record(NULL::public.app_users,
       '{"role":"admin","is_super_admin":false}'::json)) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL 32: _dc_is_cfo admits a plain admin'; END IF;
  RAISE NOTICE 'PASS 32  _dc_is_cfo admits cfo and refuses plain admin';

  BEGIN
    INSERT INTO public.app_users (company_id, full_name, username, email, role, auth_provider, status)
    VALUES (v_co,'DC Test CFO','dctestcfo','dctestcfo@example.invalid','cfo','password','active');
    RAISE EXCEPTION 'FAIL 33: role=cfo is now storable — widen was done. Remove this tripwire, and clear the blocker from RULES 0.9 and PHASES.md.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'BLOCKER 33  app_users_role_check still refuses role=cfo — no CFO account can exist yet';
  END;

  RAISE NOTICE '--- P2: ALL 33 ASSERTIONS PASSED ---';
END
$test$;
`;

(async () => {
  console.log(`[verify-daily-closing-seed] project ${REF}`);
  if (AGAINST_LIVE) {
    console.log('  mode: --against-live — asserting the schema that is already applied.');
  } else {
    console.log('  up: ' + UP.join('\n      '));
  }
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p2_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  console.log('✅ PASS — 33 assertions held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   Seeder run 4x, payee RPCs called as owner / accounts / admin / cashier /');
  console.log('   nobody, invariant 5 proved in both directions. Nothing was committed.');
})();
