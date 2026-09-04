#!/usr/bin/env node
/**
 * Daily Closing — P10: two writers, one sequence.
 *
 *   node scripts/verify-daily-closing-concurrency.js
 *
 * The thing P4 deferred and said so plainly:
 *
 *   "Everything there runs on one connection in one transaction, so it cannot
 *    make two writers race for a seq_no. A real race needs a driver holding two
 *    connections and committing — which cannot be undone, because cash_entries
 *    cannot be deleted."
 *
 * This is that driver. Every call to the Management API is its own connection,
 * its own transaction and its own COMMIT, so N calls fired together are N real
 * writers racing — not one session pretending.
 *
 * ⚠️ THE ROWS ARE PERMANENT. Invariant 1 forbids deleting a cash entry, so the
 * winners of this race stay on the books for ever. They live on **ZZ Map
 * Tower** (SR-1: a project holding permanent fixtures hosts no suite that wipes
 * entries), on a business date of their own, and every run adds one more batch
 * to that same day — which is fine, because what is asserted is a property of
 * the sequence, not a row count.
 *
 * WHAT IS BEING PROVED. record_cash_entry takes SELECT … FOR UPDATE on the
 * cash_days row before it reads max(seq_no), so writers serialise on the day.
 * If that lock were removed, two writers would read the same max and one of two
 * things would happen: a duplicate seq_no, or — because UNIQUE (cash_day_id,
 * seq_no) is underneath — a raw constraint violation reaching the user instead
 * of a voucher. Both are asserted against.
 */
'use strict';
const { q, REF } = require('./_sbq');

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';   // ZZ Map Tower — P10 fixtures
const WRITERS = 12;

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);
const one = r => (Array.isArray(r) ? r[0] : r) || {};

(async () => {
  const guard = one(await q(`select company_name n from public.companies where id='${CO}'`)).n;
  if (!/^ZZTEST/.test(guard || '')) {
    console.error('REFUSING TO RUN: this suite COMMITS cash entries; ZZTEST only.');
    process.exit(1);
  }

  head('a committed day, and a caller to race as');
  await q(`select public.seed_daily_closing_chart('${CO}','${PJ}')`);
  const auth = one(await q(
    `select auth_user_id::text id from public.app_users
      where company_id='${CO}' and email='dc-att-owner@zztest.invalid'`)).id;
  if (!auth) {
    console.error('FIXTURE: run scripts/verify-daily-closing-attachment.js first — it creates the user.');
    process.exit(1);
  }
  const uid = one(await q(`select id::text id from public.app_users
                            where auth_user_id='${auth}'`)).id;
  const acct = one(await q(`select id::text id from public.qb_accounts
                             where company_id='${CO}' and number='6050'`)).id;
  let payee = one(await q(`select id::text id from public.payees
                            where company_id='${CO}' and name='P10 Vendor'`)).id;
  if (!payee) {
    payee = one(await q(`insert into public.payees (company_id,project_id,name,kind)
      values ('${CO}','${PJ}','P10 Vendor','VENDOR') returning id::text id`)).id;
  }

  // THE project's open day, whichever it is — `cash_days_one_open_per_project`
  // means there can only be one, so this suite takes the one that exists
  // rather than trying to add a second (which is what the constraint is for).
  let day = one(await q(`select id::text id from public.cash_days
    where project_id='${PJ}' and status='OPEN' limit 1`)).id;
  if (!day) {
    day = one(await q(`insert into public.cash_days
      (company_id, project_id, business_date, status, opening_cash, opening_bank, created_by)
      values ('${CO}','${PJ}', current_date, 'OPEN', 0, 0, '${uid}') returning id::text id`)).id;
  }
  const before = Number(one(await q(
    `select count(*) n from public.cash_entries where cash_day_id='${day}'`)).n);
  ok(`day ${day.slice(0, 8)}… on ZZ Map Tower, holding ${before} entries before the race`);

  head(`${WRITERS} writers, fired together, each its own connection and COMMIT`);
  const tag = Date.now().toString().slice(-6);
  const call = i => q(
    `select set_config('request.jwt.claims',
       json_build_object('sub','${auth}')::text, true);
     select public.record_cash_entry('${CO}','${day}', gen_random_uuid(), jsonb_build_object(
       'entry_type','EXPENSE','mode','CASH','direction','OUT',
       'voucher_no','R${tag}${String(i).padStart(2, '0')}',
       'amount', ${100 + i}, 'payee_id','${payee}', 'qb_account_id','${acct}',
       'narration','concurrency probe')) r;`, 1);

  const t0 = Date.now();
  const settled = await Promise.allSettled(
    Array.from({ length: WRITERS }, (_, i) => call(i)));
  const ms = Date.now() - t0;

  const results = settled.map(s => s.status === 'fulfilled' ? one(s.value).r : { _rejected: s.reason.message });
  const okRows = results.filter(r => r && r.success === true);
  const errs   = results.filter(r => !r || r.success !== true);

  ok(`${WRITERS} concurrent calls settled in ${ms} ms`);
  okRows.length === WRITERS
    ? ok(`all ${WRITERS} were accepted — none was lost to the race`)
    : bad(`only ${okRows.length} of ${WRITERS} succeeded: ` +
          JSON.stringify(errs.slice(0, 3)).slice(0, 300));

  // ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────
  head('what the sequence looks like afterwards');
  const rows = await q(`select seq_no, voucher_no from public.cash_entries
                         where cash_day_id='${day}' order by seq_no`);
  const seqs = rows.map(r => Number(r.seq_no));
  const dupes = seqs.filter((s, i) => seqs.indexOf(s) !== i);

  dupes.length === 0
    ? ok(`no duplicate seq_no across ${seqs.length} committed rows`)
    : bad(`DUPLICATE seq_no: ${[...new Set(dupes)].join(', ')} — the FOR UPDATE lock is not holding`);

  const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
  seqs.join(',') === expected.join(',')
    ? ok(`and the sequence is 1..${seqs.length} with no gap`)
    : bad(`the sequence has gaps or is out of order: ${seqs.join(',')}`);

  const mine = rows.filter(r => String(r.voucher_no).startsWith('R' + tag));
  mine.length === WRITERS
    ? ok(`this run's ${WRITERS} rows are all present and each has its own number`)
    : bad(`this run wrote ${mine.length} rows, expected ${WRITERS}`);

  // A raw constraint violation must never reach the caller as a 500 — the
  // point of the lock is that the user never meets the unique index.
  const raw = errs.filter(r => r && r._rejected && /duplicate key|unique/i.test(r._rejected));
  raw.length === 0
    ? ok('and no writer met the UNIQUE index — they queued, they did not collide')
    : bad(`${raw.length} writer(s) hit the raw unique constraint: ${raw[0]._rejected.slice(0, 160)}`);

  // ── SR-2: the race must be a race ───────────────────────────────────────
  // If the calls had run one after another this would all pass and prove
  // nothing. Twelve serial round trips to this API take well over a second;
  // twelve concurrent ones take about one round trip plus the lock queue.
  head('and it really was concurrent');
  const t1 = Date.now();
  await q(`select 1`);
  const rtt = Date.now() - t1;
  console.log(`     one round trip to this API: ${rtt} ms`);
  ms < rtt * WRITERS * 0.8
    ? ok(`${ms} ms for ${WRITERS} writers is well under ${WRITERS} serial round trips ` +
         `(~${rtt * WRITERS} ms) — they overlapped`)
    : bad(`${ms} ms is close to ${WRITERS} serial round trips (~${rtt * WRITERS} ms); ` +
          'these may not have overlapped, so the race proves nothing');

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0
    ? `✅ PASS  (${pass} assertions, 0 failed)\n` +
      `   ${WRITERS} real writers, ${WRITERS} commits, one unbroken sequence.\n` +
      `   ⚠️ Those rows are permanent — invariant 1 — and stay on ZZ Map Tower.`
    : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });
