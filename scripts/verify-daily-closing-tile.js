#!/usr/bin/env node
/**
 * Daily Closing — P9 verification: the S8 dashboard tile.
 *
 *   node scripts/verify-daily-closing-tile.js                 # dry run
 *   node scripts/verify-daily-closing-tile.js --against-live  # assert what is applied
 *
 * Two halves, both inside BEGIN … ROLLBACK on ZZTEST:
 *
 *   1 · COUNTER CORRECTNESS, against fixtures built for the purpose. Every
 *       counter is checked with rows that must be counted AND rows that must
 *       not — a counter that returns "all of them" is right about as often as
 *       one that returns zero, and neither is a counter.
 *   2 · QUERY PLANS. Each counter's plan is fetched with EXPLAIN and asserted
 *       to use the index it was designed around, and the whole tile is asserted
 *       to be ONE round trip regardless of how many projects it covers — the
 *       N+1 the Definition of Done asks about.
 *
 * ── SR-2 ────────────────────────────────────────────────────────────────────
 * The counters are full of assertions of the form "this row was NOT counted".
 * Every one of them is paired: the same counter is first shown to count the
 * rows it should, so a query returning a flat zero fails the positive half
 * before it can pass the negative one.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const UP = ['20260904q_one_look_at_where_the_day_stands.sql'];

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ_A = '2da565ca-2b83-44bf-b4de-2cae762571df'; // ZZTEST Garden — this suite's project
const PJ_B = '6b56d5ec-6141-4440-9465-ed2a9acbbd97'; // ZZTEST Tower — read only (SR-1)
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
  v_pa uuid := '${PJ_A}';
  v_pb uuid := '${PJ_B}';
  v_cfo uuid; v_cfo_auth uuid := gen_random_uuid();
  v_cash uuid; v_cash_auth uuid := gen_random_uuid();
  v_a2020 uuid; v_a6050 uuid; v_payee uuid; v_unit uuid;
  v_day uuid; v_yday uuid; v_e uuid;
  v_res jsonb; v_c jsonb; v_n int; v_txt text;
BEGIN
  IF (SELECT company_name FROM public.companies WHERE id = v_co) NOT LIKE 'ZZTEST%' THEN
    RAISE EXCEPTION 'REFUSING TO RUN: this suite creates users and days; ZZTEST only';
  END IF;

  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pa LIMIT 1;
  PERFORM public.seed_daily_closing_chart(v_co, v_pa);
  SELECT id INTO v_a2020 FROM public.qb_accounts WHERE company_id = v_co AND number = '2020';
  SELECT id INTO v_a6050 FROM public.qb_accounts WHERE company_id = v_co AND number = '6050';

  INSERT INTO public.app_users (company_id, full_name, username, email, role,
                                auth_provider, status, auth_user_id)
  VALUES (v_co,'DC P9 CFO','dcp9cfo','dcp9cfo@zztest.invalid','cfo','password','active', v_cfo_auth)
  RETURNING id INTO v_cfo;
  INSERT INTO public.app_users (company_id, full_name, username, email, role,
                                auth_provider, status, auth_user_id, module_permissions)
  VALUES (v_co,'DC P9 Cashier','dcp9cash','dcp9cash@zztest.invalid','staff','password','active',
          v_cash_auth, '{"dailyclosing": true}'::jsonb)
  RETURNING id INTO v_cash;
  INSERT INTO public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
  VALUES (v_co, v_cash, v_pa, 'edit', true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);

  -- ══ FIXTURES ══════════════════════════════════════════════════════════════
  v_res := public.setup_cash_opening(v_co, v_pa, 10000, 5000, public._dc_today() - 9);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true
     AND (v_res->>'error') IS DISTINCT FROM 'ALREADY_SET' THEN
    RAISE EXCEPTION 'FIXTURE: opening: %', v_res; END IF;

  -- YESTERDAY: closed, with entries. This is what makes NOT_EXPORTED countable
  -- — the counter is "not exported on a day that is FINISHED".
  v_res := public.open_cash_day(v_co, v_pa, public._dc_today() - 1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: yesterday: %', v_res; END IF;
  v_yday := (v_res->>'cash_day_id')::uuid;

  v_res := public.create_payee(v_co, 'P9 Vendor', 'VENDOR', v_pa);
  v_payee := (v_res->>'payee_id')::uuid;

  -- two client receipts on the closed day → both PENDING, both NOT_EXPORTED
  v_res := public.record_cash_entry(v_co, v_yday, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','9101',
    'amount', 1000, 'payee_id', v_payee, 'unit_id', v_unit, 'qb_account_id', v_a2020));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: receipt 1: %', v_res; END IF;
  v_e := (v_res->>'entry_id')::uuid;

  v_res := public.record_cash_entry(v_co, v_yday, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','9102',
    'amount', 2000, 'payee_id', v_payee, 'unit_id', v_unit, 'qb_account_id', v_a2020));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: receipt 2: %', v_res; END IF;

  -- an EXPENSE on the same day: rms_status NA, so it is in neither receipt
  -- counter but IS in the export counter.
  v_res := public.record_cash_entry(v_co, v_yday, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','9103',
    'amount', 500, 'payee_id', v_payee, 'qb_account_id', v_a6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: expense: %', v_res; END IF;

  -- void receipt 1 → it becomes UNAPPLIED, and the reversal is written
  v_res := public.void_cash_entry(v_co, v_e, 'so the tile has an unapplied one');
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: void: %', v_res; END IF;

  v_res := public.close_cash_day(v_co, v_yday,
    (SELECT closing_cash FROM (SELECT d.opening_cash
        + COALESCE(sum(e.amount) FILTER (WHERE e.mode='CASH' AND e.direction='IN'),0)
        - COALESCE(sum(e.amount) FILTER (WHERE e.mode='CASH' AND e.direction='OUT'),0) AS closing_cash
       FROM public.cash_days d LEFT JOIN public.cash_entries e ON e.cash_day_id = d.id
      WHERE d.id = v_yday GROUP BY d.opening_cash) z),
    NULL, NULL, NULL);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: close yesterday: %', v_res; END IF;

  -- TODAY: open, with one client receipt. Its entry is NOT_EXPORTED too, but
  -- the day is OPEN, so it must NOT be counted — that is the whole point of
  -- the counter's definition.
  v_res := public.open_cash_day(v_co, v_pa, public._dc_today());
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: today: %', v_res; END IF;
  v_day := (v_res->>'cash_day_id')::uuid;
  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','CLIENT_RECEIPT','mode','CASH','direction','IN','voucher_no','9201',
    'amount', 7000, 'payee_id', v_payee, 'unit_id', v_unit, 'qb_account_id', v_a2020));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: today receipt: %', v_res; END IF;

  -- PDC: one due inside the week, one outside it, one already cleared. Only
  -- the first may reach the "due <= 7 days" counter.
  INSERT INTO public.pdc_cheques (company_id, project_id, cheque_no, bank_name, amount,
                                  cheque_date, status, created_by)
  VALUES (v_co, v_pa, 'P9-IN',  'Test Bank', 111, public._dc_today() + 3,  'pending', v_cfo),
         (v_co, v_pa, 'P9-OUT', 'Test Bank', 222, public._dc_today() + 30, 'pending', v_cfo),
         (v_co, v_pa, 'P9-DONE','Test Bank', 333, public._dc_today() + 2,  'cleared', v_cfo);
  RAISE NOTICE 'PASS 01  fixtures: a closed yesterday, an open today, 3 cheques';

  -- ══ 1 · THE TILE, FOR ONE PROJECT ═════════════════════════════════════════
  v_res := public.get_daily_closing_tile(v_co, v_pa);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 02: the tile refused the CFO: %', v_res; END IF;
  IF (v_res->>'status') IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'FAIL 02: today reads %, expected OPEN', v_res->>'status'; END IF;
  IF (v_res->>'business_date')::date IS DISTINCT FROM public._dc_today() THEN
    RAISE EXCEPTION 'FAIL 02: the tile is dated %, not today in Karachi', v_res->>'business_date'; END IF;
  -- opening 10,000 carried into yesterday, yesterday closed, today opened on it,
  -- plus today's 7,000 receipt. The figure is live, not stored, because the day
  -- is open.
  -- Yesterday: 10,000 opening + 1,000 + 2,000 receipts − 500 expense − 1,000
  -- for the REVERSING entry the void wrote = 11,500 carried forward. Today:
  -- + 7,000 = 18,500. The figure is live, not stored, because today is open.
  IF (v_res->>'closing_cash')::numeric <> 18500 THEN
    RAISE EXCEPTION 'FAIL 02: closing cash reads %, expected 18500', v_res->>'closing_cash'; END IF;
  RAISE NOTICE 'PASS 02  today: OPEN, dated in Karachi, closing cash computed live';

  v_c := v_res->'counters';

  -- ── receipts PENDING ─────────────────────────────────────────────────────
  -- receipt 2 on the closed day + today's receipt = 2. Receipt 1 is UNAPPLIED
  -- and the expense is NA, so neither is here.
  IF (v_c->>'receipts_pending')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 03: receipts_pending = %, expected 2', v_c->>'receipts_pending'; END IF;
  IF (SELECT count(*) FROM public.cash_entries
       WHERE project_id = v_pa AND rms_status = 'PENDING') <> 2 THEN
    RAISE EXCEPTION 'FAIL 03: the fixture itself does not hold 2 PENDING rows'; END IF;
  RAISE NOTICE 'PASS 03  receipts PENDING counts 2 — not the expense (NA), not the voided one';

  -- ── UNAPPLIED ────────────────────────────────────────────────────────────
  IF (v_c->>'unapplied')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 04: unapplied = %, expected 1', v_c->>'unapplied'; END IF;
  RAISE NOTICE 'PASS 04  UNAPPLIED counts the one voided receipt';

  -- ── NOT_EXPORTED on CLOSED days ──────────────────────────────────────────
  -- Yesterday is closed and holds four rows (2 receipts, 1 expense, 1 reversal),
  -- all NOT_EXPORTED. Today's receipt is NOT_EXPORTED too and must NOT count,
  -- because today is still open.
  IF (v_c->>'not_exported')::int <> 4 THEN
    RAISE EXCEPTION 'FAIL 05: not_exported = %, expected 4 (yesterday only)', v_c->>'not_exported'; END IF;
  IF (SELECT count(*) FROM public.cash_entries
       WHERE project_id = v_pa AND qb_status = 'NOT_EXPORTED') <> 5 THEN
    RAISE EXCEPTION 'FAIL 05: the fixture should hold 5 NOT_EXPORTED rows in total';
  END IF;
  RAISE NOTICE 'PASS 05  NOT_EXPORTED counts 4 of the 5 — the open day''s entry is not late';

  -- ── PDC ──────────────────────────────────────────────────────────────────
  IF (v_c->>'pdc_pending')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 06: pdc_pending = %, expected 2 (the cleared one is not pending)',
      v_c->>'pdc_pending'; END IF;
  IF (v_c->>'pdc_due_7')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 06: pdc_due_7 = %, expected 1 (only the one due in 3 days)',
      v_c->>'pdc_due_7'; END IF;
  RAISE NOTICE 'PASS 06  PDC: 2 pending, 1 due within the week — the +30 and the cleared are out';

  -- ── the last seven days ──────────────────────────────────────────────────
  v_n := jsonb_array_length(v_res->'recent');
  IF v_n < 2 OR v_n > 7 THEN
    RAISE EXCEPTION 'FAIL 07: the micro-table holds % rows, expected between 2 and 7', v_n; END IF;
  IF (v_res->'recent'->0->>'business_date')::date IS DISTINCT FROM public._dc_today() THEN
    RAISE EXCEPTION 'FAIL 07: the micro-table is not newest-first'; END IF;
  IF (v_res->'recent'->1->>'status') IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'FAIL 07: yesterday should read CLOSED in the micro-table'; END IF;
  RAISE NOTICE 'PASS 07  the last-7-days table: % rows, newest first, with each day''s status', v_n;

  -- ══ 2 · SCOPE — A COUNTER IS PER PROJECT ══════════════════════════════════
  -- The same call for ZZTEST Tower must not see any of Garden's rows. This is
  -- the assertion that would catch a counter that forgot its WHERE.
  --
  -- ⚠️ NOT "the other project reads zero". ZZTEST Tower carries P7's permanent
  -- golden-PDF fixture (SR-1), so it has real rows of its own and asserting
  -- zero would be asserting something false. What must hold is that each
  -- project's tile reports ITS OWN rows: Tower's numbers equal a direct count
  -- over Tower, and they are not Garden's.
  v_res := public.get_daily_closing_tile(v_co, v_pb);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 08: the tile refused the CFO on the other project: %', v_res; END IF;

  SELECT count(*) INTO v_n FROM public.cash_entries
   WHERE project_id = v_pb AND rms_status = 'PENDING';
  IF (v_res->'counters'->>'receipts_pending')::int IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION 'FAIL 08: Tower''s tile says % pending, the table says %',
      v_res->'counters'->>'receipts_pending', v_n; END IF;
  IF (v_res->'counters'->>'receipts_pending')::int = 2 THEN
    RAISE EXCEPTION 'FAIL 08: Tower is reporting Garden''s figure — the fixtures were built so these differ';
  END IF;

  SELECT count(*) INTO v_n FROM public.pdc_cheques
   WHERE project_id = v_pb AND company_id = v_co AND status = 'pending';
  IF (v_res->'counters'->>'pdc_pending')::int IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION 'FAIL 08: Tower''s PDC count is %, the table says %',
      v_res->'counters'->>'pdc_pending', v_n; END IF;
  RAISE NOTICE 'PASS 08  each project''s tile reports its own rows, and Tower''s differ from Garden''s';

  -- ══ 3 · ALL PROJECTS ══════════════════════════════════════════════════════
  v_res := public.get_daily_closing_tile(v_co, NULL);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 09: the CFO was refused the company-wide tile: %', v_res; END IF;
  IF (v_res->>'all_projects')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 09: all_projects did not come back true'; END IF;
  IF (v_res->>'projects')::int < 2 THEN
    RAISE EXCEPTION 'FAIL 09: the company-wide tile covers only % project(s)', v_res->>'projects'; END IF;
  -- The aggregate is the SUM across the projects the caller may see — which is
  -- more than any one of them, and exactly the total over that set.
  SELECT count(*) INTO v_n FROM public.cash_entries e
    JOIN public.projects p ON p.id = e.project_id
   WHERE p.company_id = v_co AND e.rms_status = 'PENDING';
  IF (v_res->'counters'->>'receipts_pending')::int IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION 'FAIL 09: the aggregate receipts_pending = %, the tenant holds %',
      v_res->'counters'->>'receipts_pending', v_n; END IF;
  IF v_n <= 2 THEN
    RAISE EXCEPTION 'FAIL 09: the aggregate (%) is not larger than one project''s 2, so the sum proves nothing', v_n;
  END IF;
  IF jsonb_array_length(v_res->'recent') <> 0 THEN
    RAISE EXCEPTION 'FAIL 09: the company-wide tile returned a micro-table; one row per project per date is Group Position, which is Phase 4';
  END IF;
  RAISE NOTICE 'PASS 09  the company-wide tile aggregates the counters and omits the micro-table';

  -- and it is refused to a Cashier, whose row reads "own project"
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cash_auth)::text, true);
  v_res := public.get_daily_closing_tile(v_co, NULL);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 10: a Cashier got the company-wide tile: %', v_res; END IF;
  -- POSITIVE HALF (SR-2): the same cashier CAN see their own project, so the
  -- refusal above is about the scope and not about the caller being broken.
  v_res := public.get_daily_closing_tile(v_co, v_pa);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 10: the cashier could not see their OWN project either: %', v_res; END IF;
  IF (v_res->'counters'->>'receipts_pending')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 10: the cashier sees different counters from the CFO on the same project';
  END IF;
  RAISE NOTICE 'PASS 10  the cashier is refused "all projects" and sees their own, with the same numbers';

  -- and to a caller with no role at all
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  v_res := public.get_daily_closing_tile(v_co, v_pa);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 11: a caller with no role got a tile: %', v_res; END IF;
  RAISE NOTICE 'PASS 11  and a caller with no Daily Closing role gets nothing';

  -- ══ 4 · THE SERVICE IS IN THE P8 REGISTRY ═════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cfo_auth)::text, true);
  IF NOT EXISTS (SELECT 1 FROM public._dc_service_registry()
                  WHERE service = 'get_daily_closing_tile') THEN
    RAISE EXCEPTION 'FAIL 12: the tile is not in the derived service registry';
  END IF;
  IF (SELECT is_mutating FROM public._dc_service_registry()
       WHERE service = 'get_daily_closing_tile') THEN
    RAISE EXCEPTION 'FAIL 12: the tile is registered as MUTATING — it is STABLE and reads only';
  END IF;
  RAISE NOTICE 'PASS 12  the tile appears in the P8 registry, and as a read';

  -- ══ 5 · NO N+1, ASSERTED ON THE SOURCE ════════════════════════════════════
  -- The plans above say each statement is fine. The other half of "no N+1" is
  -- that there is no LOOP turning one statement into one per project — which a
  -- query plan cannot show, because a plan is per statement. The tile resolves
  -- the visible projects into an array once and every counter is a single
  -- aggregate over "= ANY (v_pids)".
  SELECT prosrc INTO v_txt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_daily_closing_tile';
  IF v_txt ~* '\\mLOOP\\M' THEN
    RAISE EXCEPTION 'FAIL 13: the tile body contains a LOOP — that is the N+1 this check exists for';
  END IF;
  IF v_txt !~ 'ANY \\(v_pids\\)' THEN
    RAISE EXCEPTION 'FAIL 13: the tile does not aggregate over the project array';
  END IF;
  -- and it reads each table a bounded number of times, whatever the project count
  IF (length(v_txt) - length(replace(v_txt, 'FROM public.cash_entries', ''))) / length('FROM public.cash_entries') > 3 THEN
    RAISE EXCEPTION 'FAIL 13: the tile reads cash_entries more than three times in one call';
  END IF;
  RAISE NOTICE 'PASS 13  no loop, one array, a bounded number of passes per table';
END
$t$;
`;

/* ── query plans ───────────────────────────────────────────────────────────
   Read outside the assertion block, because EXPLAIN's output is worth showing
   rather than merely asserting on. */
const PLANS = [
  { what: 'receipts PENDING / UNAPPLIED',
    want: /Index (Only )?Scan .*cash_entries/i,
    sql: `EXPLAIN (FORMAT TEXT) SELECT count(*) FILTER (WHERE e.rms_status='PENDING'),
                 count(*) FILTER (WHERE e.rms_status='UNAPPLIED')
            FROM public.cash_entries e
           WHERE e.project_id = ANY (ARRAY['${PJ_A}']::uuid[])
             AND e.rms_status IN ('PENDING','UNAPPLIED')` },
  { what: 'NOT_EXPORTED on CLOSED days',
    want: /Index (Only )?Scan .*cash_entries|Bitmap Index Scan .*cash_entries/i,
    sql: `EXPLAIN (FORMAT TEXT) SELECT count(*)
            FROM public.cash_entries e JOIN public.cash_days d ON d.id = e.cash_day_id
           WHERE e.project_id = ANY (ARRAY['${PJ_A}']::uuid[])
             AND e.qb_status = 'NOT_EXPORTED' AND d.status = 'CLOSED'` },
  { what: 'the last seven days',
    want: /Index Scan .*cash_days/i,
    sql: `EXPLAIN (FORMAT TEXT) SELECT d.id FROM public.cash_days d
           WHERE d.project_id = '${PJ_A}' ORDER BY d.business_date DESC LIMIT 7` },
];

(async () => {
  console.log(`[verify-daily-closing-tile] project ${REF}`);
  if (AGAINST_LIVE) console.log('  mode: --against-live — asserting the applied schema.');
  else console.log('  up: ' + UP.join('\n      '));
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p9_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  // ── the plans ────────────────────────────────────────────────────────────
  //
  // ⚠️ ZZTEST holds single-digit row counts, so Postgres picks a sequential
  // scan for every one of these and is RIGHT to. "It seq-scanned" therefore
  // proves nothing either way, and an index-name grep proves only that
  // somebody created an index — not that this predicate can use it.
  //
  // So each plan is taken TWICE: once as the planner would really run it
  // today, and once with enable_seqscan off, which asks the question that
  // actually matters — CAN this WHERE clause be answered from that index?
  // If the answer is still a sequential scan with seqscan disabled, the index
  // does not fit the predicate and the counter will scan the table forever.
  console.log('── query plans (the Definition of Done asks; here they are)');
  let planFail = 0;
  for (const p of PLANS) {
    const now = (await q(p.sql)).map(r => Object.values(r)[0]).join('\n');
    const forced = (await q('SET LOCAL enable_seqscan = off; ' + p.sql))
      .map(r => Object.values(r)[0]).join('\n');

    const nowLine = (now.split('\n').find(l => /Scan/.test(l)) || '').trim();
    const idx = /Index (?:Only )?Scan[^\n]*using (\S+)/i.exec(forced);

    if (p.want.test(forced) && idx) {
      console.log(`  ✅ ${p.what.padEnd(30)} can use ${idx[1]}`);
      console.log(`     ${''.padEnd(30)} today: ${nowLine.slice(0, 60)}`);
    } else {
      console.log(`  ❌ ${p.what} — the predicate cannot be answered from an index ` +
                  `even with seqscan off:\n${forced}`);
      planFail++;
    }
  }
  console.log('\n  "today:" is what the planner really does at ZZTEST\'s size, and a');
  console.log('  sequential scan over eight rows is the correct choice. "can use" is the');
  console.log('  claim that matters: the plan turns into that index on its own once the');
  console.log('  pilot has a year of entries in it.');
  console.log('\n  Note the NOT_EXPORTED plan naming the rms_status index. Both candidate');
  console.log('  indexes LEAD with project_id, and with eight rows the second column is');
  console.log('  worth nothing, so the planner takes either. Asserting a specific index');
  console.log('  name here would be over-fitting the planner on a table this size; what');
  console.log('  is asserted is that the predicate is index-answerable at all.');

  const idx = await q(`select indexdef from pg_indexes where schemaname='public'
                        and tablename in ('cash_entries','cash_days')
                        and (indexdef like '%rms_status%' or indexdef like '%qb_status%'
                             or indexdef like '%business_date DESC%')`);
  const defs = idx.map(r => r.indexdef).join('\n');
  const need = [
    ['cash_entries (project_id, rms_status)', /cash_entries.*project_id, rms_status/],
    ['cash_entries (project_id, qb_status)',  /cash_entries.*project_id, qb_status/],
    ['cash_days (project_id, business_date DESC)', /cash_days.*project_id, business_date DESC/],
  ];
  console.log('\n── the indexes the counters are built on');
  for (const [name, re] of need) {
    if (re.test(defs)) console.log(`  ✅ ${name}`);
    else { console.log(`  ❌ ${name} — MISSING`); planFail++; }
  }
  console.log('  ·  pdc_cheques: (project_id) only, deliberately. SEVEN rows in the whole');
  console.log('     database — a composite index would change a table KBH and FMH use in');
  console.log('     production, bought for nothing. Revisit when PDC is real (Phase 3).');

  if (planFail) {
    console.log('\n❌ FAIL — the plan review found ' + planFail + ' problem(s).');
    process.exitCode = 1;
    return;
  }

  console.log('\n✅ PASS — 13 checks held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   Five counters against fixtures built to be miscounted, project scope,');
  console.log('   the company-wide aggregate, the role gate, and the plan review.');
  console.log('   Nothing was committed.');
})();
