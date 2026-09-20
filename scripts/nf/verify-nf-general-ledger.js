#!/usr/bin/env node
/**
 * NexuFinance v1 — General Ledger, real HTTP/browser/session, against a
 * fresh ZZTEST-NF-<run> company. Same golden-day + real inter-company-
 * voucher fixture as verify-nf-general-journal.js.
 *
 *   node scripts/nf/verify-nf-general-ledger.js > "$SCRATCH/nf-ledger.log" 2>&1
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
const PORT = 4496;
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

// The account filter is the shared picker (js/nf/nf-pick.js): focus, type the
// code, take the matching row. Typing the CODE also proves the list matches on
// code as well as name.
const BOX = '[data-pick="lgr-acct"]';
// The screen renders once immediately and AGAIN when the chart arrives, which
// replaces the input. Typing into the first one is thrown away, so every
// search here retries until the list actually has rows — otherwise the suite
// reads an empty dropdown and blames the picker for a race of its own making.
async function search(page, text, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const inp = BOX + ' .nfpick-in';
    await page.focus(inp);
    await page.evaluate(s => { const e = document.querySelector(s); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }, inp);
    await page.type(inp, text);
    await page.evaluate(() => new Promise(r => setTimeout(r, 120)));
    const values = await page.$$eval(BOX + ' [data-pick-value]', els => els.map(e => e.getAttribute('data-pick-value')));
    if (values.length) return values;
  }
  return [];
}
async function pickAccount(page, code) {
  const found = await search(page, code);
  if (!found.includes(code)) throw new Error(`account ${code} never appeared in the picker (saw ${JSON.stringify(found)})`);
  await page.click(BOX + ' [data-pick-value="' + code + '"]');
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-general-ledger] project ${REF} · run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regprocedure('public.nf_get_ledger(uuid,text,date,date)') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — nf_get_ledger is not applied. Nothing was verified.'); process.exitCode = 2; return; }
    const keysR = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    K = { anon: keysR.find(k => k.name === 'anon').api_key, svc: keysR.find(k => k.name === 'service_role').api_key };
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const s = built.ref.sample;
  const cashCode = built.seed.accounts.find(a => a.via === 'Cash').code;
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};
  let srv, browser;

  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFLGR${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-ledger-${run}@zztest-nf.invalid`;
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
    r = await rpc('nf_post_voucher', { p_company_id: C, p_day_id: null, p_voucher_no: 'JV-LGR-1',
      p_voucher_date: s.date, p_narration: 'FMH paid a project cost directly, rehearsal', p_sort: 0,
      p_legs: [
        { account_code: '53100', floor_code: floor, debit: 75000 },
        { account_code: '22100', floor_code: floor, credit: 75000 },
      ] });
    if (r.status !== 200) throw new Error('nf_post_voucher (FMH): ' + JSON.stringify(r.json));
    console.log('  fixture ready: golden day entered, transfer posted, FMH inter-company voucher posted\n');

    // ── ground truth for two accounts: 22100 (one entry only, from the FMH
    //    voucher) and the via-Cash account (many entries, a real running
    //    balance to check) ──────────────────────────────────────────────
    const [t22100] = await q(`select
        (select count(*) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED' and l.account_code='22100') as entries,
        (select coalesce(sum(l.debit-l.credit),0) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED' and l.account_code='22100') as net`);
    const [tCash] = await q(`select
        (select count(*) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED' and l.account_code='${cashCode}') as entries,
        (select coalesce(sum(l.debit-l.credit),0) from nf_voucher_legs l join nf_vouchers v on v.id=l.voucher_id
          where v.company_id='${C}' and v.status='POSTED' and l.account_code='${cashCode}') as net`);
    console.log('  ground truth 22100:', JSON.stringify(t22100));
    console.log('  ground truth', cashCode, ':', JSON.stringify(tCash));

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
    // #nf-toLgr no longer exists — the header consolidated to a shared
    // Reports dropdown (docs/PLAN.md §23, 2026-09-19). L-01 now checks
    // the dropdown itself carries the Ledger entry, not a dedicated button.
    ok('L-01 nav button present', await page.$('#nf-rpm-toggle') !== null, 'no #nf-rpm-toggle (Reports menu) on the closing sheet');
    await page.click('#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    await page.click('[data-goto="ledger"]');
    await page.waitForSelector('.lsheet', { timeout: 10000 });
    await page.waitForSelector(BOX + ' .nfpick-in', { timeout: 10000 });
    // The picker builds its list on demand and caps what it SHOWS, so the
    // old "count the options" check cannot work. What matters is that the
    // whole chart is reachable BY SEARCH — so ask for a account by name that
    // a prefix-matching <select> could never have found by typing 'Y'.
    const bySurname = await search(page, 'Yousaf');
    ok('L-02 searching a NAME finds the account (owner: type Y, get Yousaf)',
      bySurname.includes('12610'), JSON.stringify(bySurname));
    await page.keyboard.press('Escape');

    const settled = () => page.waitForFunction(() => {
      var b = document.querySelector('#nf-lgr-body');
      return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });

    // account with exactly one entry
    await pickAccount(page, '22100');
    await settled();
    let tiles = await page.$$eval('.rtile b', els => els.map(e => e.textContent.trim()));
    const fmtNoDec = n => Math.abs(n).toLocaleString('en-US');
    ok('L-03 22100 opening = Rs 0', tiles[0] === 'Rs \u2013' || tiles[0] === 'Rs 0', `opening tile: ${tiles[0]}`);
    ok('L-04 22100 closing matches ground truth', tiles[1] === 'Rs (' + fmtNoDec(t22100.net) + ')',
      `closing tile: ${tiles[1]}, expected Rs (${fmtNoDec(t22100.net)}) for net ${t22100.net}`);
    let rowCount = await page.$$eval('.ltab tbody tr', els => els.length);
    ok('L-05 22100 entry count matches ground truth', rowCount === Number(t22100.entries), `journal shows ${rowCount} rows, table has ${t22100.entries}`);

    // account with many entries — check the running balance arithmetic itself
    await pickAccount(page, cashCode);
    await settled();
    const rows = await page.$$eval('.ltab tbody tr', trs => trs.map(tr => {
      const c = [...tr.children].map(td => td.textContent.trim());
      return { debit: c[5], credit: c[6], balance: c[7] };
    }));
    const num = s => { if (!s || s === '\u2013') return 0; const neg = s.startsWith('('); const v = Number(s.replace(/[(),]/g, '')); return neg ? -v : v; };
    let running = 0; let arithmeticOk = true; let firstBad = '';
    rows.forEach((row, i) => {
      running += num(row.debit) - num(row.credit);
      if (Math.round(running * 100) !== Math.round(num(row.balance) * 100) && !firstBad) firstBad = `row ${i}: expected ${running}, shown ${num(row.balance)}`;
      if (firstBad) arithmeticOk = false;
    });
    ok('L-06 running balance is arithmetically correct, row by row', arithmeticOk, firstBad);
    ok('L-07 last running balance = closing tile', rows.length > 0 && Math.round(running * 100) === Math.round(Number(tCash.net) * 100),
      `computed running total ${running}, ground truth net ${tCash.net}`);
    ok('L-08 Cash account has multiple entries (a real running-balance test)', rows.length === Number(tCash.entries) && rows.length > 1,
      `rows shown ${rows.length}, ground truth ${tCash.entries}`);

    // race: switch accounts twice with no wait — the LAST selection must win
    await pickAccount(page, '22100');
    await pickAccount(page, cashCode);
    await settled();
    await new Promise(res => setTimeout(res, 500));
    const raceRowCount = await page.$$eval('.ltab tbody tr', els => els.length);
    ok('L-09 last account switch wins under a real race', raceRowCount === Number(tCash.entries),
      `expected ${tCash.entries} (the later selection, Cash) got ${raceRowCount}`);

    await page.click('#nf-lgr-back');
    await page.waitForSelector('#nf-sheet', { timeout: 10000 });
    await new Promise(res => setTimeout(res, 500));
    ok('L-10 back to closing sheet, cleanly', await page.$('#nf-sheet') !== null && await page.$('.lsheet') === null,
      '#nf-sheet missing or .lsheet still present after Back');

    ok('L-11 no console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
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
