#!/usr/bin/env node
/**
 * NexuFinance v1 — General Journal, real HTTP/browser/session, against a
 * fresh ZZTEST-NF-<run> company. Same golden-day + real inter-company-
 * voucher fixture as verify-nf-director-report.js (already proven there),
 * this time checking the journal shows EVERY posted voucher — including
 * the transfer voucher and the no-via-leg FMH voucher, which the daily
 * closing screen's own nf_lines view deliberately excludes/filters.
 *
 *   node scripts/nf/verify-nf-general-journal.js > "$SCRATCH/nf-journal.log" 2>&1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require('./gen-seed');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 4495;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = `https://${REF}.supabase.co`;
const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(28)} ${pass ? '' : detail}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'nexufinance.html' : p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-general-journal] project ${REF} · run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regprocedure('public.nf_get_journal(uuid,date,date)') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — nf_get_journal is not applied. Nothing was verified.'); process.exitCode = 2; return; }
    const keysR = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    K = { anon: keysR.find(k => k.name === 'anon').api_key, svc: keysR.find(k => k.name === 'service_role').api_key };
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const s = built.ref.sample;
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};
  let srv, browser;

  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFJRN${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-journal-${run}@zztest-nf.invalid`;
    const password = crypto.randomBytes(18).toString('base64url');
    const u = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (u.status >= 300) throw new Error('create user: ' + JSON.stringify(u.json));
    users.D = { id: u.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}', '${users.D.id}', 'director', 'Syed Yousaf Shah', true)`);
    const login = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (login.status !== 200) throw new Error('sign-in: HTTP ' + login.status);
    users.D.jwt = login.json.access_token;

    const tokenLine = s.in.find(x => x.h === '21100');
    if (tokenLine) {
      await q(`insert into nf_parties (company_id, name, kind, created_by) values
        ('${C}', '${tokenLine.d.replace(/'/g, "''")}', 'customer', '${users.D.id}'::uuid)`);
    }

    const rpc = (name, args) => http_('POST', `/rest/v1/rpc/${name}`, { key: K.anon, jwt: users.D.jwt, body: args });
    let r = await rpc('nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno,
      p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
    if (r.status !== 200) throw new Error('nf_start_first_day: ' + JSON.stringify(r.json));
    const dayId = r.json.day.id;
    for (const [side, rows] of [['IN', s.in], ['OUT', s.out]]) {
      for (const x of rows.filter(x => Number(x.a))) {
        r = await rpc('nf_save_line', { p_day_id: dayId, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
          p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null });
        if (r.status !== 200) throw new Error(`nf_save_line ${x.v}: ` + JSON.stringify(r.json));
      }
    }
    r = await rpc('nf_set_transfers', { p_day_id: dayId, p_to_bank: Number(s.tBank), p_to_petty: null, p_version: r.json.day.version });
    if (r.status !== 200) throw new Error('nf_set_transfers: ' + JSON.stringify(r.json));

    const floor = built.seed.floors[0].code;
    // nf_jv_save, the public path for a day-less voucher. This used to call
    // nf_post_voucher directly; 20260920c revoked EXECUTE on that internal
    // primitive from `authenticated` (AUDIT_REPORT.md R-2), so a signed-in
    // session is refused now — correctly. Same voucher and legs, and it goes
    // through the path a real user takes instead of an internal one.
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-JRN-1',
      p_voucher_date: s.date, p_narration: 'FMH paid a project cost directly, rehearsal',
      p_legs: [
        { account_code: '53100', floor_code: floor, debit: 75000 },
        { account_code: '22100', floor_code: floor, credit: 75000 },
      ] });
    if (r.status !== 200) throw new Error('nf_jv_save (FMH): ' + JSON.stringify(r.json));
    console.log('  fixture ready: golden day entered, transfer posted, FMH inter-company voucher posted\n');

    // ── ground truth, straight from the tables ──────────────────────────────
    const [truth] = await q(`select
        (select count(*) from nf_vouchers where company_id='${C}' and status='POSTED') as voucher_count,
        (select coalesce(sum(debit),0) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED') as total_debit,
        (select coalesce(sum(credit),0) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED') as total_credit,
        (select count(*) from nf_vouchers v where v.company_id='${C}' and v.status='POSTED'
          and not exists (select 1 from nf_voucher_legs l join nf_accounts a on a.company_id=l.company_id and a.code=l.account_code
                            where l.voucher_id=v.id and a.via is not null)) as no_via_vouchers`);
    console.log('  ground truth (direct query):', JSON.stringify(truth));

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    const consoleErrors = [];
    // "Failed to load resource" (the test harness's tiny static server has
    // no /favicon.ico) is excluded the same way verify-nf-director-report.js
    // already does — a real app error still surfaces as pageerror or any
    // other console.error text.
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push('console: ' + m.text()); });
    await page.evaluateOnNewDocument((ref, jwt, uid, email) => {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
      }));
      window.print = function () {};
    }, REF, users.D.jwt, users.D.id, users.D.email);
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.pos-grid', { timeout: 15000 });
    // #nf-toJrn no longer exists — the header consolidated to a shared
    // Reports dropdown (docs/PLAN.md §23, 2026-09-19). J-01 now checks
    // the dropdown itself carries the Journal entry, not a dedicated button.
    ok('J-01 nav button present', await page.$('#nf-rpm-toggle') !== null, 'no #nf-rpm-toggle (Reports menu) on the closing sheet');
    const settled = () => page.waitForFunction(
      () => { var b = document.querySelector('#nf-jrn-body'); return b && !/Loading…/.test(b.textContent); },
      { timeout: 10000 });

    await page.click('#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    await page.click('[data-goto="journal"]');
    await page.waitForSelector('.jsheet', { timeout: 10000 });
    await settled();

    // §16.7's own TODO, closed 2026-09-19: the journal used to default to
    // "All time" on mount — now it defaults to the current month. Checked
    // directly (not inferred from the row count, which would pass either
    // way here since this fixture's date happens to fall in the same real
    // month the test runs in).
    const today = new Date();
    const pad = x => String(x).padStart(2, '0');
    const expectFrom = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
    const expectTo = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const defaultRange = await page.evaluate(() => ({
      from: document.querySelector('#nf-jrn-from').value, to: document.querySelector('#nf-jrn-to').value,
    }));
    ok('J-00b default range is the current month, not All time', defaultRange.from === expectFrom && defaultRange.to === expectTo,
      `got ${JSON.stringify(defaultRange)}, expected {from:"${expectFrom}", to:"${expectTo}"}`);

    const rowCount = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    ok('J-02 voucher count matches ground truth', rowCount === Number(truth.voucher_count),
      `journal shows ${rowCount} vouchers, table has ${truth.voucher_count}`);

    const footText = await page.$eval('.jtab tfoot', el => el.innerText);
    // matches nf-format.js's own fmt(): en-US grouping, two decimals only
    // when the value carries paisa (this figure doesn't).
    const expDebit = Number(truth.total_debit).toLocaleString('en-US');
    ok('J-03 total debit = total credit, matches ground truth', footText.includes(expDebit) && !/DOES NOT BALANCE/.test(footText),
      `footer: ${footText.replace(/\s+/g, ' ')} · expected ${expDebit}`);

    // floor name spelled out (P-W -> Project-wide), same fix as the director report
    const bodyText = await page.$eval('#nf-jrn-body', el => el.innerText);
    ok('J-04 floor shown as full name, not raw code', bodyText.includes('Project-wide') && !/\bP-W\b/.test(bodyText),
      'expected "Project-wide" present and no bare "P-W"');

    // the no-via FMH voucher must appear here (it is deliberately invisible
    // on the daily closing / director report screens)
    // JV-JRN-1 is its MANUAL number since §45; the journal lists the SYSTEM one
    const [{ voucher_no: jvSys }] = await q(`select voucher_no from nf_vouchers where company_id='${C}' and manual_no='JV-JRN-1'`);
    ok('J-05 no-via-leg voucher included', Number(truth.no_via_vouchers) >= 1 && bodyText.includes(jvSys),
      `no_via_vouchers=${truth.no_via_vouchers}, ${jvSys} (JV-JRN-1) present=${bodyText.includes(jvSys)}`);

    // date filter: a range that excludes everything (a day with no vouchers) must show zero
    await page.evaluate(() => { document.querySelector('#nf-jrn-from').value = '2000-01-01'; document.querySelector('#nf-jrn-to').value = '2000-01-02'; });
    await page.click('#nf-jrn-apply');
    await settled();
    const filteredCount = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    ok('J-06 date filter narrows the result', filteredCount === 0, `expected 0 rows for an out-of-range filter, got ${filteredCount}`);

    await page.click('#nf-jrn-clear');
    await settled();
    const restoredCount = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    ok('J-07 "All time" restores the full list', restoredCount === Number(truth.voucher_count),
      `expected ${truth.voucher_count} after clearing the filter, got ${restoredCount}`);

    // J-08: fire the narrow-range Apply and the All-time Clear back to back,
    // no wait in between — exactly the shape that raced before the
    // generation-guard fix (nf-journal.js). Whichever click was LAST must
    // win, regardless of which network response happens to land first.
    await page.evaluate(() => { document.querySelector('#nf-jrn-from').value = '2000-01-01'; document.querySelector('#nf-jrn-to').value = '2000-01-02'; });
    await page.click('#nf-jrn-apply');
    await page.click('#nf-jrn-clear');
    await settled();
    await new Promise(res => setTimeout(res, 500)); // let a stale in-flight response, if any, arrive and prove it's ignored
    const raceCount = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    ok('J-08 last click wins under a real race (no stale overwrite)', raceCount === Number(truth.voucher_count),
      `expected ${truth.voucher_count} (the later, All-time click) got ${raceCount}`);

    // §16.7: the exported PDF's filename should carry the selected range too.
    // Currently "All time" after J-08's clear.
    await page.click('#nf-jrn-print');
    const printTitleAllTime = await page.evaluate(() => document.title);
    ok('J-08b print filename carries "All time"', printTitleAllTime === 'Awami_General_Journal_All_Time', printTitleAllTime);

    await page.evaluate(() => { document.querySelector('#nf-jrn-from').value = '2026-09-01'; document.querySelector('#nf-jrn-to').value = '2026-09-16'; });
    await page.click('#nf-jrn-apply');
    await settled();
    await page.click('#nf-jrn-print');
    const printTitleRanged = await page.evaluate(() => document.title);
    ok('J-08c print filename carries the selected range', printTitleRanged === 'Awami_General_Journal_01-Sep-2026_to_16-Sep-2026', printTitleRanged);
    await page.click('#nf-jrn-clear');
    await settled();

    await page.click('#nf-jrn-back');
    await page.waitForSelector('#nf-sheet', { timeout: 10000 });
    await new Promise(res => setTimeout(res, 500)); // give any stale journal response a chance to wrongly repaint over it
    ok('J-09 back to closing sheet, cleanly', await page.$('#nf-sheet') !== null && await page.$('.jsheet') === null,
      '#nf-sheet missing or .jsheet still present after Back');

    ok('J-10 no console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge FAILED:', e.message); }
    if (users.D) {
      try {
        const r = await http_('DELETE', `/auth/v1/admin/users/${users.D.id}`, { key: K.svc, jwt: K.svc });
        console.log('  delete user D: HTTP', r.status);
      } catch (e) { console.log('  delete user D FAILED:', e.message); }
    }
    const [chk] = await q(`select json_build_object('company', (select count(*) from companies where id='${C}'),
        'auth_users', (select count(*) from auth.users where id='${users.D ? users.D.id : '00000000-0000-0000-0000-000000000000'}'),
        'nf_rows', (select count(*) from nf_days where company_id='${C}')) j`);
    ok('CLEANUP', chk.j.company === 0 && chk.j.auth_users === 0 && chk.j.nf_rows === 0, JSON.stringify(chk.j));
    if (browser) await browser.close();
    if (srv) srv.close();

    const failed = results.filter(x => !x.pass).length;
    console.log(`\n${results.length} checks · ${results.length - failed} passed · ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
