#!/usr/bin/env node
/**
 * NexuFinance v1 — Trial Balance, real HTTP/browser/session, against a
 * fresh ZZTEST-NF-<run> company. Same golden-day + real inter-company-
 * voucher fixture as verify-nf-general-journal.js / verify-nf-general-ledger.js.
 *
 *   node scripts/nf/verify-nf-trial-balance.js > "$SCRATCH/nf-tb.log" 2>&1
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
const PORT = 4497;
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
  console.log(`[verify-nf-trial-balance] project ${REF} · run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regprocedure('public.nf_get_trial_balance(uuid,date)') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — nf_get_trial_balance is not applied. Nothing was verified.'); process.exitCode = 2; return; }
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
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFTB${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-tb-${run}@zztest-nf.invalid`;
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
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-TB-1',
      p_voucher_date: s.date, p_narration: 'FMH paid a project cost directly, rehearsal',
      p_legs: [
        { account_code: '53100', floor_code: floor, debit: 75000 },
        { account_code: '22100', floor_code: floor, credit: 75000 },
      ] });
    if (r.status !== 200) throw new Error('nf_jv_save (FMH): ' + JSON.stringify(r.json));
    console.log('  fixture ready: golden day entered, transfer posted, FMH inter-company voucher posted\n');

    // ── ground truth, straight from the tables ──────────────────────────────
    const [truth] = await q(`
      WITH bal AS (
        SELECT a.code, COALESCE(sum(l.debit - l.credit), 0) AS net
          FROM nf_accounts a
          LEFT JOIN nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
          LEFT JOIN nf_vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'
         WHERE a.company_id = '${C}'
         GROUP BY a.code
        HAVING COALESCE(sum(l.debit - l.credit), 0) <> 0
      )
      SELECT count(*) AS row_count,
             coalesce(sum(greatest(net,0)),0) AS total_debit,
             coalesce(sum(greatest(-net,0)),0) AS total_credit,
             (select net from bal where code='22100') AS fmh_net
        FROM bal`);
    console.log('  ground truth:', JSON.stringify(truth));

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    const consoleErrors = [];
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
    // #nf-toTB no longer exists — the header consolidated to a shared
    // Reports dropdown (docs/PLAN.md §23, 2026-09-19). T-01 now checks
    // the dropdown itself carries the Trial Balance entry, not a
    // dedicated button.
    ok('T-01 nav button present', await page.$('#nf-rpm-toggle') !== null, 'no #nf-rpm-toggle (Reports menu) on the closing sheet');
    await page.click('#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    await page.click('[data-goto="tb"]');
    await page.waitForSelector('.tsheet', { timeout: 10000 });

    const settled = () => page.waitForFunction(() => {
      var b = document.querySelector('#nf-tb-body');
      return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    await settled();

    const rowCount = await page.$$eval('.ttab tbody tr', els => els.length);
    ok('T-02 row count matches ground truth', rowCount === Number(truth.row_count), `journal shows ${rowCount} rows, table has ${truth.row_count}`);

    const footText = await page.$eval('.ttab tfoot', el => el.innerText);
    const expDebit = Number(truth.total_debit).toLocaleString('en-US');
    ok('T-03 total debit = total credit, matches ground truth (self-proving identity)',
      footText.includes(expDebit) && !/DOES NOT BALANCE/.test(footText),
      `footer: ${footText.replace(/\s+/g, ' ')} · expected ${expDebit}`);

    // 22100 is a pure credit balance (the FMH voucher's only leg on that
    // account) — must show in the Credit column, Debit column blank.
    const rowText = await page.$$eval('.ttab tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
    const fmhRow = rowText.find(c => c[0] === '22100');
    const fmhCredit = Math.abs(Number(truth.fmh_net)).toLocaleString('en-US');
    ok('T-04 22100 shows as a pure credit balance (correct debit/credit split)',
      !!fmhRow && fmhRow[2] === '' && fmhRow[3] === fmhCredit,
      `row: ${JSON.stringify(fmhRow)}, expected debit blank, credit ${fmhCredit}`);

    // as-of a date before the golden day: nothing posted yet
    await page.evaluate(() => { document.querySelector('#nf-tb-asof').value = '2000-01-01'; });
    await page.click('#nf-tb-apply');
    await settled();
    const emptyCount = await page.$$eval('.ttab tbody tr', els => els.length);
    const emptyText = await page.$eval('.ttab tbody', el => el.innerText);
    ok('T-05 as-of a date before any posting shows nothing', emptyCount === 0 || /No activity/.test(emptyText),
      `expected 0 rows, got ${emptyCount}: ${emptyText.slice(0, 80)}`);

    await page.click('#nf-tb-clear');
    await settled();
    const restoredCount = await page.$$eval('.ttab tbody tr', els => els.length);
    ok('T-06 clearing the date restores the full list', restoredCount === Number(truth.row_count),
      `expected ${truth.row_count}, got ${restoredCount}`);

    // race: apply a narrow as-of then clear back to back, no wait — the
    // later click (Clear, all postings) must win
    await page.evaluate(() => { document.querySelector('#nf-tb-asof').value = '2000-01-01'; });
    await page.click('#nf-tb-apply');
    await page.click('#nf-tb-clear');
    await settled();
    await new Promise(res => setTimeout(res, 500));
    const raceCount = await page.$$eval('.ttab tbody tr', els => els.length);
    ok('T-07 last click wins under a real race (no stale overwrite)', raceCount === Number(truth.row_count),
      `expected ${truth.row_count} (the later, all-postings click) got ${raceCount}`);

    await page.click('#nf-tb-back');
    await page.waitForSelector('#nf-sheet', { timeout: 10000 });
    await new Promise(res => setTimeout(res, 500));
    ok('T-08 back to closing sheet, cleanly', await page.$('#nf-sheet') !== null && await page.$('.tsheet') === null,
      '#nf-sheet missing or .tsheet still present after Back');

    ok('T-09 no console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
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
