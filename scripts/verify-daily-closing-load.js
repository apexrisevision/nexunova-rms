#!/usr/bin/env node
/**
 * Daily Closing — P10: 500 entries on one day, and what it costs.
 *
 *   node scripts/verify-daily-closing-load.js
 *
 * The budgets P10 sets, and what each one actually covers:
 *
 *   S1 first paint        < 1500 ms   the screen drawn with 500 rows on it
 *   day summary           <  200 ms   get_cash_day_summary, server side
 *   Director PDF          < 2000 ms   a real render of the 500-entry day
 *
 * ⚠️ WHAT THE NUMBERS INCLUDE, because a performance number without its
 * boundaries is a rumour. The server figures are measured INSIDE Postgres
 * (`EXPLAIN ANALYZE`-grade `clock_timestamp()` around the call), so they are the
 * query's own cost and not the round trip from this laptop to a Supabase region
 * — that round trip is reported separately and is about 1.7 s from here, which
 * would swamp every budget and tell you nothing about the code. The paint figure
 * is measured in Chrome against scripted answers, so it is the SCREEN's cost
 * with 500 rows and not the network's.
 *
 * ⚠️ SR-1. The 500 rows are permanent — invariant 1 — and live on ZZ Map Tower,
 * which hosts no suite that wipes entries. Re-running tops the day back up to
 * 500 rather than adding another 500.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { q, REF, TOKEN } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4477;
const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';   // ZZ Map Tower — P10 fixtures
const URL_BASE = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';
const TARGET = 500;

const BUDGET = { paint: 1500, summary: 200, pdf: 2000 };

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);
const one = r => (Array.isArray(r) ? r[0] : r) || {};
const NUMBERS = {};

function budget(name, got, limit, what) {
  NUMBERS[name] = got;
  got <= limit ? ok(`${what.padEnd(34)} ${String(got).padStart(6)} ms   (budget ${limit} ms)`)
               : bad(`${what} took ${got} ms, over the ${limit} ms budget`);
}

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((rq, r) => {
      const p = decodeURIComponent(rq.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'daily-closing.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  const k = (await r.json() || []).find(x => x.name === 'service_role' || x.type === 'secret');
  return k && k.api_key;
}

(async () => {
  const guard = one(await q(`select company_name n from public.companies where id='${CO}'`)).n;
  if (!/^ZZTEST/.test(guard || '')) {
    console.error('REFUSING TO RUN: this suite COMMITS 500 cash entries; ZZTEST only.');
    process.exit(1);
  }

  // ══ THE DAY ══════════════════════════════════════════════════════════════
  head(`a committed day carrying ${TARGET} entries`);
  await q(`select public.seed_daily_closing_chart('${CO}','${PJ}')`);
  const auth = one(await q(`select auth_user_id::text id from public.app_users
                             where company_id='${CO}' and email='dc-att-owner@zztest.invalid'`)).id;
  if (!auth) {
    console.error('FIXTURE: run scripts/verify-daily-closing-attachment.js first.');
    process.exit(1);
  }
  const uid = one(await q(`select id::text id from public.app_users where auth_user_id='${auth}'`)).id;
  const acct = one(await q(`select id::text id from public.qb_accounts
                             where company_id='${CO}' and number='6050'`)).id;
  let payee = one(await q(`select id::text id from public.payees
                            where company_id='${CO}' and name='P10 Vendor'`)).id;
  if (!payee) {
    payee = one(await q(`insert into public.payees (company_id,project_id,name,kind)
      values ('${CO}','${PJ}','P10 Vendor','VENDOR') returning id::text id`)).id;
  }
  let day = one(await q(`select id::text id from public.cash_days
                          where project_id='${PJ}' and status='OPEN' limit 1`)).id;
  if (!day) {
    day = one(await q(`insert into public.cash_days
      (company_id, project_id, business_date, status, opening_cash, opening_bank, created_by)
      values ('${CO}','${PJ}', current_date, 'OPEN', 0, 0, '${uid}') returning id::text id`)).id;
  }

  let have = Number(one(await q(`select count(*) n from public.cash_entries
                                  where cash_day_id='${day}'`)).n);
  if (have < TARGET) {
    // Inserted directly, in ONE statement, not through record_cash_entry:
    // 487 round trips would take twenty minutes and this suite measures READS,
    // not the write path. The write path is proved by the P4 and E2E suites and
    // raced by the concurrency suite.
    const need = TARGET - have;
    const t = Date.now();
    await q(`
      insert into public.cash_entries
        (company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type, mode,
         direction, voucher_type, voucher_no, amount, narration, payee_id, unit_id, rms_status,
         qb_account_id, created_by)
      select '${CO}','${PJ}','${day}',
             ${have} + g,
             gen_random_uuid(),
             case when g % 5 = 0 then 'CLIENT_RECEIPT' else 'EXPENSE' end,
             'CASH',
             case when g % 5 = 0 then 'IN' else 'OUT' end,
             case when g % 5 = 0 then 'CRV' else 'CPV' end,
             'L' || to_char(${have} + g, 'FM000000'),
             ((g * 37) % 9000) + 100,
             'Load fixture ' || g,
             '${payee}',
             -- a CLIENT_RECEIPT must name a unit (cash_entries_client_receipt_unit)
             case when g % 5 = 0 then '${one(await q(`select id::text id from public.units where project_id='${PJ}' limit 1`)).id}'::uuid else null end,
             case when g % 5 = 0 then 'PENDING' else 'NA' end,
             -- and it must sit on 2020 unless a reason is given (invariant 5,
             -- enforced by cash_entries_qb_head_guard — which caught the first
             -- version of this insert putting receipts on 6050)
             case when g % 5 = 0
                  then '${one(await q(`select id::text id from public.qb_accounts where company_id='${CO}' and number='2020'`)).id}'::uuid
                  else '${acct}'::uuid end,
             '${uid}'
        from generate_series(1, ${need}) g`);
    console.log(`     inserted ${need} rows in ${Date.now() - t} ms`);
    have = Number(one(await q(`select count(*) n from public.cash_entries
                                where cash_day_id='${day}'`)).n);
  }
  have >= TARGET ? ok(`the day holds ${have} entries`)
                 : bad(`the day holds only ${have} entries`);

  // ══ SERVER ═══════════════════════════════════════════════════════════════
  // Timed INSIDE Postgres. From this laptop one round trip to the Supabase
  // region is ~1.7 s, which would drown every budget and measure the Arabian
  // Sea rather than the code.
  head('server: measured inside Postgres, not across the ocean');
  // ⚠️ MEASURED WITH EXPLAIN ANALYZE, not with clock_timestamp() either side.
  // The first version of this wrapped the call in
  // `(select clock_timestamp() t0), lateral (select fn(...))` and every figure
  // came back 0.0 ms — the planner is under no obligation to evaluate those in
  // the order they are written, so the subtraction measured nothing. A timing
  // that always reads zero is a check that cannot fail (SR-2), and it very
  // nearly shipped as four green lines. EXPLAIN ANALYZE reports the executor's
  // own Execution Time, which is the number being claimed.
  const timed = async (sql) => {
    const r = await q(
      `select set_config('request.jwt.claims', json_build_object('sub','${auth}')::text, true);
       explain (analyze, timing on, costs off) select ${sql};`);
    const text = r.map(x => Object.values(x)[0]).join('\n');
    const m = /Execution Time: ([\d.]+) ms/.exec(text);
    if (!m) throw new Error('EXPLAIN ANALYZE reported no Execution Time:\n' + text);
    return Math.round(Number(m[1]) * 10) / 10;
  };

  const summaryMs = await timed(
    `public.get_cash_day_summary('${CO}','${PJ}', (select business_date from public.cash_days where id='${day}'))`,
    'summary');
  budget('summary_ms', summaryMs, BUDGET.summary, 'get_cash_day_summary');

  const listMs = await timed(`public.list_cash_entries('${CO}','${day}')`, 'list');
  NUMBERS.list_ms = listMs;
  console.log(`     ${'list_cash_entries'.padEnd(34)} ${String(listMs).padStart(6)} ms   (no budget set; reported)`);

  const tileMs = await timed(`public.get_daily_closing_tile('${CO}','${PJ}')`, 'tile');
  NUMBERS.tile_ms = tileMs;
  console.log(`     ${'get_daily_closing_tile'.padEnd(34)} ${String(tileMs).padStart(6)} ms   (no budget set; reported)`);

  const auditMs = await timed(`public.list_cash_day_audit('${CO}','${day}', 200)`, 'audit');
  NUMBERS.audit_ms = auditMs;
  console.log(`     ${'list_cash_day_audit'.padEnd(34)} ${String(auditMs).padStart(6)} ms   (no budget set; reported)`);

  // ══ THE PDF ══════════════════════════════════════════════════════════════
  head('the Director sheet for a 500-entry day, rendered for real');
  const SERVICE = await serviceKey();
  const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dc-att-owner@zztest.invalid',
                           password: 'dc-att-' + REF.slice(0, 8) + '-Aa1!' }),
  }).then(r => r.json());

  if (!tok.access_token) {
    bad('could not sign in to render the PDF — is verify-daily-closing-attachment.js green?');
  } else {
    const t = Date.now();
    const r = await fetch(`${URL_BASE}/functions/v1/daily-closing-pdf`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${tok.access_token}`,
                 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: CO, cash_day_id: day }),
    });
    const wall = Date.now() - t;
    const j = await r.json().catch(() => null);
    if (!j || j.success !== true) {
      bad(`the render failed: ${JSON.stringify(j).slice(0, 200)}`);
    } else {
      // The function reports its own phase timings, so the budget is checked
      // against the FUNCTION's total — not the wall clock from this laptop,
      // which carries ~1.9 s of ocean with it.
      const t9 = j.timings || {};
      NUMBERS.pdf_ms = t9.total ?? wall;
      NUMBERS.pdf_wall_ms = wall;
      NUMBERS.pdf_phases = t9;
      NUMBERS.pdf_bytes = j.bytes;

      console.log(`     phases: payload ${t9.payload} · fonts ${t9.fonts} · draw ${t9.draw} ` +
                  `· save ${t9.save} · total ${t9.total} ms   (wall from here ${wall} ms)`);
      budget('pdf_total_ms', NUMBERS.pdf_ms, BUDGET.pdf,
        `Director PDF (${j.bytes} bytes, v${j.version})`);

      if (NUMBERS.pdf_ms > BUDGET.pdf) {
        console.log('');
        console.log('     ⚠️ THIS IS THE ONE BUDGET PHASE 1 DOES NOT MEET, and the breakdown');
        console.log('        says why rather than leaving it to be guessed at:');
        console.log(`        · embedding Inter costs ~${(t9.fonts ?? 0) - (t9.payload ?? 0)} ms of it, on every`);
        console.log('          render, whatever the day holds — pdf-lib parses and subsets both');
        console.log('          weights per document and there is nothing to cache;');
        console.log(`        · drawing ${have} rows costs ~${(t9.draw ?? 0) - (t9.fonts ?? 0)} ms;`);
        console.log('        · the rest is four HTTP hops the function makes for itself.');
        console.log('        Rendering in Helvetica instead brings it inside 2 s and loses Inter.');
        console.log('        That trade is the owner\'s, so nothing has been changed to hide it.');
      }
    }
  }

  // ══ THE SCREEN ═══════════════════════════════════════════════════════════
  head(`S1 first paint with ${TARGET} rows`);
  if (!puppeteer || !CHROME) {
    console.log('  ⏭  SKIPPED — puppeteer-core or Chrome not found. This is a skip, not a pass.');
  } else {
    const srv = await serve();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${PORT}/daily-closing.html?stub=1&state=open&entries=${TARGET}`,
        { waitUntil: 'domcontentloaded' });
      // First paint = the ledger's last row on screen, measured from the moment
      // the page started mounting. Not "the HTTP request finished".
      await page.waitForFunction(
        n => document.querySelectorAll('.dc-ledger tbody tr').length >= n, { timeout: 20000 }, TARGET);
      const paint = await page.evaluate(() => Math.round(performance.now() - window.__dcPaintStart));
      const rows = await page.$$eval('.dc-ledger tbody tr', r => r.length);
      rows >= TARGET ? ok(`${rows} rows really drew`) : bad(`only ${rows} rows drew`);
      budget('paint_ms', paint, BUDGET.paint, 'S1 first paint');
      errors.length === 0 ? ok('and no console error while drawing them')
                          : bad(`console errors: ${errors[0]}`);
      await page.close();
    } finally { await browser.close(); srv.close(); }
  }

  // ── the round trip, for context ──────────────────────────────────────────
  const t1 = Date.now(); await q('select 1'); NUMBERS.rtt_ms = Date.now() - t1;
  console.log(`\n     For scale: one round trip from this laptop to ${REF} is ${NUMBERS.rtt_ms} ms.`);
  console.log('     That is the network, not the module, and it is why the server figures');
  console.log('     above are measured inside Postgres.');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p10_numbers.json'),
    JSON.stringify({ at: new Date().toISOString(), entries: have, ...NUMBERS }, null, 2));

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                         : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  console.log('   Numbers written to migration_work/_dc_p10_numbers.json for RUNBOOK.md.');
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });
