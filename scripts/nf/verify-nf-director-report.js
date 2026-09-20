#!/usr/bin/env node
/**
 * NexuFinance — the director report, driven for real: nexufinance.html
 * over real HTTP, a real Supabase session, the real "Director report"
 * button, then print() captured as an actual PDF and its page count
 * measured (not assumed) — the exact discipline docs/PLAN.md §10.3
 * documents this project got burned skipping once already.
 *
 *   node scripts/nf/verify-nf-director-report.js > "$SCRATCH/nf-report.log" 2>&1
 *
 * Fixture: a fresh ZZTEST-NF-<run> company, the same golden day sample
 * gen-seed's reference already provides, entered through nf_save_line/
 * nf_set_transfers/nf_save_count directly (typing-simulation is already
 * proven by verify-nf-golden-ui.js — this script's job is the REPORT, not
 * re-proving entry). Awami is never touched; cleanup is verified by query.
 *
 * Exit (via process.exitCode): 0 held · 1 something failed · 2 could not run.
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
const PORT = 4491;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = `https://${REF}.supabase.co`;

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(28)} ${pass ? '' : String(detail).slice(0, 300)}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'nexufinance.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

async function keys() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const list = await r.json();
  const anon = list.find(k => k.name === 'anon'), svc = list.find(k => k.name === 'service_role');
  if (!anon || !svc) throw new Error('anon or service_role key not found');
  return { anon: anon.api_key, svc: svc.api_key };
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

function countPdfPages(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (m) return Number(m[1]);
  return (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

async function injectSession(page, ref, jwt, userId, email) {
  await page.evaluateOnNewDocument((ref, jwt, userId, email) => {
    try { localStorage.clear(); } catch (e) {}
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
      access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
    }));
    window.print = function () {};
  }, ref, jwt, userId, email);
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-director-report] project ${REF} · run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — the nf_ migrations are not applied.'); process.exitCode = 2; return; }
    K = await keys();
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
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFREP${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    for (const who of ['D']) {
      const email = `nf-rep-${who.toLowerCase()}-${run}@zztest-nf.invalid`;
      const password = crypto.randomBytes(18).toString('base64url');
      const r = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
      if (r.status >= 300) throw new Error(`create user ${who}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
      users[who] = { id: r.json.id, email, password };
    }
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}', '${users.D.id}', 'director', 'Report Test Director', true)`);
    const login = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email: users.D.email, password: users.D.password } });
    if (login.status !== 200) throw new Error(`sign-in: HTTP ${login.status}`);
    users.D.jwt = login.json.access_token;

    // register the Token Money buyer ahead of time — 20260918i's own
    // requirement, matching what an accountant would have done before
    // the receipt is entered
    const tokenLine = s.in.find(x => x.h === '21100');
    if (tokenLine) {
      await q(`insert into nf_parties (company_id, name, kind, created_by) values
        ('${C}', '${tokenLine.d.replace(/'/g, "''")}', 'customer', '${users.D.id}'::uuid)`);
    }

    // ── enter the golden day directly through the real RPCs ────────────────
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
    const den = Object.fromEntries(Object.entries(s.den).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    r = await rpc('nf_save_count', { p_day_id: dayId, p_denoms: den, p_version: r.json.day.version });
    if (r.status !== 200) throw new Error('nf_save_count: ' + JSON.stringify(r.json));
    console.log('  fixtures: company, seed, golden day entered, 1 director signed in\n');

    // a real inter-company movement, so "Other Balances" has something
    // besides Token Money to show — a real, direct nf_post_voucher call
    // (the pattern the owner asked be proven, no via leg at all)
    const floor = built.seed.floors[0].code;
    // nf_jv_save, the public path for a day-less voucher. This used to call
    // nf_post_voucher directly; 20260920c revoked EXECUTE on that internal
    // primitive from `authenticated` (AUDIT_REPORT.md R-2), so a signed-in
    // session is refused now — correctly. Same voucher and legs, and it goes
    // through the path a real user takes instead of an internal one.
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-REPORT-1',
      p_voucher_date: s.date, p_narration: 'FMH paid a project cost directly, rehearsal',
      p_legs: [
        { account_code: '53100', floor_code: floor, debit: 75000 },
        { account_code: '22100', floor_code: floor, credit: 75000 },
      ] });
    if (r.status !== 200) throw new Error('nf_jv_save (FMH): ' + JSON.stringify(r.json));

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    await injectSession(page, REF, users.D.jwt, users.D.id, users.D.email);
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.pos-grid', { timeout: 15000 });
    ok('R-00 closing sheet loaded', true, '');

    await page.click('#nf-toDir');
    await page.waitForSelector('.rsheet', { timeout: 10000 });
    ok('R-01 report opened', true, '');

    const tiles = await page.evaluate(() => [...document.querySelectorAll('.rtile b')].map(el => el.textContent.trim()));
    ok('R-02 four tiles present', tiles.length === 4, JSON.stringify(tiles));
    // the FMH voucher below has no via leg at all — it must NOT move any of
    // these four (they come from the cash-book/nf_lines side only), proving
    // the "no Awami cash moved" pattern stays genuinely invisible here
    ok('R-02 opening tile = Rs 1,770,000', tiles[0] === 'Rs 1,770,000', tiles[0]);
    ok('R-02 in tile = Rs 865,000', tiles[1] === 'Rs 865,000', tiles[1]);
    ok('R-02 out tile = Rs 199,540', tiles[2] === 'Rs 199,540', tiles[2]);
    ok('R-02 closing tile = Rs 2,435,460', tiles[3] === 'Rs 2,435,460', tiles[3]);

    const banner = await page.evaluate(() => document.querySelector('.rbanner').textContent.trim());
    ok('R-03 banner: Everything Matches', /Everything Matches/.test(banner), banner);

    // 3 via rows + the Total row, which is inside the same <tbody> — matches
    // the reference tab exactly, where row 14 "Total" is part of the same
    // table, not a separate footer
    const cashBankRows = await page.evaluate(() =>
      [...document.querySelectorAll('.rsec .rtab')][0].querySelectorAll('tbody tr').length);
    ok('R-04 Cash & Bank has 3 via rows + Total', cashBankRows === 4, String(cashBankRows));

    const receivedRows = await page.evaluate(() => document.querySelectorAll('.rsec .rtab')[1].querySelectorAll('tbody tr').length);
    const paidRows = await page.evaluate(() => document.querySelectorAll('.rsec .rtab')[2].querySelectorAll('tbody tr').length);
    ok('R-05 Money Received row count', receivedRows === s.in.filter(x => Number(x.a)).length, String(receivedRows));
    ok('R-05 Money Paid row count', paidRows === s.out.filter(x => Number(x.a)).length, String(paidRows));

    const otherBal = await page.evaluate(() => [...document.querySelectorAll('.obl li')].map(li => li.textContent.trim()));
    ok('R-06 Other Balances shows Token Money', otherBal.some(t => /Customer token money held/.test(t) && /500,000/.test(t)), JSON.stringify(otherBal));
    ok('R-06 Other Balances shows FMH payable', otherBal.some(t => /Owed to FMH/.test(t) && /75,000/.test(t)), JSON.stringify(otherBal));

    const sigCount = await page.evaluate(() => document.querySelectorAll('.rsig > div').length);
    ok('R-07 three signature blocks', sigCount === 3, String(sigCount));

    // ── print: real PDF, real page count ────────────────────────────────
    await page.emulateMediaType('print');
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    const pages = countPdfPages(pdf);
    if (pages !== 1) {
      fs.mkdirSync(path.join(ROOT, 'docs', 'nexufinance', 'v1', 'design'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'docs', 'nexufinance', 'v1', 'design', `director-report-overflow-${run}.pdf`), pdf);
    }
    ok('R-08 print is one A4 page', pages === 1, `counted ${pages} page(s)`);
    await page.emulateMediaType('screen');

    // ── back to the closing sheet: proves the re-mount fix, not the old
    //    detached-#nf-sheet path ─────────────────────────────────────────
    await page.click('#nf-rep-back');
    await page.waitForSelector('.pos-grid', { timeout: 10000 });
    const backOk = await page.evaluate(() => !!document.querySelector('#nf-sheet') && !document.querySelector('.rsheet'));
    ok('R-09 back to closing sheet, cleanly', backOk, '');

    ok('R-10 no console/page errors', !consoleErrors.length, JSON.stringify(consoleErrors));
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge FAILED:', e.message); }
    for (const who of Object.keys(users)) {
      try {
        const r = await http_('DELETE', `/auth/v1/admin/users/${users[who].id}`, { key: K.svc, jwt: K.svc });
        console.log(`  delete user ${who}: HTTP ${r.status}`);
      } catch (e) { console.log(`  delete user ${who} FAILED:`, e.message); }
    }
    const [chk] = await q(`select json_build_object('company', (select count(*) from companies where id='${C}'),
        'auth_users', (select count(*) from auth.users where email like 'nf-rep-%-${run}@zztest-nf.invalid'),
        'nf_rows', (select count(*) from nf_days where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(chk.j));
    ok('CLEANUP', Object.values(chk.j).every(n => n === 0), JSON.stringify(chk.j));
    if (browser) await browser.close();
    if (srv) srv.close();
  }

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length} checks · ${results.length - failed} passed · ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
