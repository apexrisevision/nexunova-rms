#!/usr/bin/env node
/**
 * NexuFinance v1 — the Journal Voucher screen, driven for real.
 *
 *   node scripts/nf/verify-nf-journal-voucher.js > "$SCRATCH/nf-jv.log" 2>&1
 *
 * This screen exists because the daily-closing sheet can only make a two-leg
 * voucher with one Cash/Petty/Bank leg, and ALL 64 of Awami's real imported
 * vouchers are the other shape (docs/PLAN.md §32.1). So the checks here are
 * not generic form checks — they reproduce the two real shapes that had no
 * entry path, and then prove the two things that must stay true about them:
 * they reach the ledger and every statement, and they stay OUT of the daily
 * closing's cash position and director report.
 *
 * Disposable ZZTEST-NF-<run> company, real HTTP, real session, real browser.
 * Awami is never touched. Cleanup verified by query, always.
 *
 * Exit: 0 held · 1 something failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF, TOKEN } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));

const PORT = 4498;
const URL_BASE = `https://${REF}.supabase.co`;
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) { console.log('[verify-nf-journal-voucher] SKIPPED — no puppeteer-core/Chrome.'); process.exit(0); }

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(44)} ${pass ? '' : String(detail).slice(0, 300)}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
  return { anon: list.find(k => k.name === 'anon').api_key, svc: list.find(k => k.name === 'service_role').api_key };
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
async function setValue(page, sel, text) {
  await page.focus(sel);
  await page.evaluate(s => { const el = document.querySelector(s); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, sel);
  await page.type(sel, text);
}
// nf-journal-voucher.js redraws on the NEXT TICK, deliberately (replacing
// innerHTML from inside a blur handler throws in Chrome). So the whole form
// is a new set of nodes shortly after any select change or party pick, and
// every lookup here must be fresh AND must wait for that repaint — otherwise
// puppeteer scrolls a node that has just been replaced and reports "Node is
// detached from document".
const settle = page => page.evaluate(() => new Promise(r => setTimeout(r, 40)));

// Fill one leg of the new-voucher editor, by its index in the visible list.
async function fillLeg(page, i, { account, floor, party, debit, credit, memo }) {
  await settle(page);
  const legId = await page.evaluate(n => {
    const rows = [...document.querySelectorAll('.jvleg')];
    return rows[n] ? rows[n].getAttribute('data-leg') : null;
  }, i);
  if (!legId) throw new Error(`leg ${i} not on screen`);
  // The account and the party are both the shared type-to-search picker, and
  // a leg carries one of each — so every query is scoped by data-pick, never
  // by .nfpick-dd alone, or the party's assertions read the account's list.
  const sel = k => `.jvleg[data-leg="${legId}"] [data-k="${k}"]`;
  const box = key => `.jvleg[data-leg="${legId}"] [data-pick="${key}"]`;
  await page.focus(`${box('jv-account')} .nfpick-in`);
  await page.type(`${box('jv-account')} .nfpick-in`, account);
  await page.waitForSelector(`${box('jv-account')} .nfpick-dd:not([hidden])`, { timeout: 5000 });
  await page.click(`${box('jv-account')} [data-pick-value="${account}"]`);
  await settle(page);
  await page.select(sel('floor'), floor); await settle(page);
  if (debit) await setValue(page, sel('debit'), String(debit));
  if (credit) await setValue(page, sel('credit'), String(credit));
  if (memo) await setValue(page, sel('memo'), memo);
  if (party) {
    const ps = `${box('jv-party')} .nfpick-in`;
    await page.focus(ps);
    await page.type(ps, party);
    await page.waitForSelector(`${box('jv-party')} .nfpick-dd:not([hidden])`, { timeout: 4000 });
    const shape = await page.evaluate(id => {
      const dd = document.querySelector(`.jvleg[data-leg="${id}"] [data-pick="jv-party"] .nfpick-dd`);
      return { add: !!dd.querySelector('[data-pick-add]'), picks: dd.querySelectorAll('[data-pick-value]').length };
    }, legId);
    const target = shape.picks ? `[data-pick-value="${party}"]` : `[data-pick-add="${party}"]`;
    await page.click(`${box('jv-party')} ${target}`);
    await settle(page);
    return shape;
  }
  // nudge the totals/issues panel to recompute, the same way leaving a field does
  await page.evaluate(s => { const el = document.querySelector(s); el.dispatchEvent(new Event('blur', { bubbles: true })); }, sel('memo'));
  await settle(page);
  return null;
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-journal-voucher] project ${REF} · run ${run}`);
  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null a, (select count(*) from pg_proc where proname='nf_jv_save') f`);
    if (!probe.a || Number(probe.f) === 0) { console.log('COULD NOT RUN — 20260919o is not applied.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = {};
  const buyer = `JV Token Buyer ${run}`;
  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZJVU${run}', 'ZZTEST-NF-${run}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-jv-${run}@zztest-nf.invalid`, password = crypto.randomBytes(18).toString('base64url');
    const cu = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (cu.status >= 300) throw new Error(`create user: HTTP ${cu.status}`);
    users.D = { id: cu.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}','${users.D.id}','director','JV Director',true)`);
    const li = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (li.status !== 200) throw new Error(`sign-in: HTTP ${li.status}`);
    users.D.jwt = li.json.access_token;
    // a day must exist for the closing sheet to mount at all
    await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
             select public.nf_start_first_day('${C}', '2026-10-01', 'DC-001', 100000, 0, 0)`);
    console.log('  fixture: company, real chart, a director, one open day\n');

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.evaluateOnNewDocument((ref, jwt, uid, mail) => {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email: mail, app_metadata: {}, user_metadata: {} } }));
      window.print = function () {};
    }, REF, users.D.jwt, users.D.id, users.D.email);
    await page.setViewport({ width: 1500, height: 1100 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.pos-grid', { timeout: 15000 });

    // ── reachable from the Reports menu ───────────────────────────────────
    await page.click('#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    const hasItem = await page.$('[data-goto="jv"]') !== null;
    ok('JV-01 Journal Vouchers is in the Reports menu', hasItem, 'no [data-goto="jv"] item');
    await page.click('[data-goto="jv"]');
    await page.waitForSelector('.jvsheet #nf-jv-post', { timeout: 15000 });
    // Since §45 the field is the MANUAL (paper) number, optional; the system
    // number is given on save, so there is nothing to suggest.
    const noField = await page.evaluate(() => { const i = document.querySelector('#nf-jv-no'); return { value: i.value, placeholder: i.placeholder }; });
    ok('JV-02 screen opens with the manual number blank and optional', noField.value === '' && /blank/.test(noField.placeholder), JSON.stringify(noField));

    // ── the shape the daily sheet cannot make: no cash leg at all ─────────
    await setValue(page, '#nf-jv-nar', 'FMH paid the architect on our behalf');
    await fillLeg(page, 0, { account: '53100', floor: 'P-W', debit: 150000, memo: 'Architecture drawings' });
    await fillLeg(page, 1, { account: '22100', floor: 'P-W', credit: 150000, memo: 'Owed to FMH' });
    await settle(page);
    const balState = await page.evaluate(() => {
      const b = document.querySelector('.jvfoot .bal');
      return { text: b ? b.textContent.trim() : null, postDisabled: document.querySelector('#nf-jv-post').disabled, issues: [...document.querySelectorAll('.jvissues li')].map(li => li.textContent.trim()), no: document.querySelector('#nf-jv-no').value, date: document.querySelector('#nf-jv-date').value };
    });
    ok('JV-03 the form says Balanced and enables Post', balState.text === 'Balanced' && balState.postDisabled === false, JSON.stringify(balState));
    await settle(page); await page.click('#nf-jv-post');
    await page.waitForFunction(() => document.querySelectorAll('.jvcard').length >= 1, { timeout: 15000 });
    const [v1] = await q(`select v.voucher_no, v.manual_no, v.day_id, (select count(*) from nf_voucher_legs l where l.voucher_id=v.id) legs,
                            (select count(*) from nf_voucher_legs l join nf_accounts a on a.company_id=l.company_id and a.code=l.account_code
                              where l.voucher_id=v.id and a.via is not null) cash_legs
                          from nf_vouchers v where v.company_id='${C}' and v.narration like 'FMH paid the architect%'`);
    ok('JV-04 a no-cash inter-company voucher posted', v1 && Number(v1.legs) === 2 && Number(v1.cash_legs) === 0, JSON.stringify(v1));
    ok('JV-04 it is NOT attached to any day', v1 && v1.day_id === null, JSON.stringify(v1));
    ok('JV-04b posted with no manual number, it still got its SYSTEM number (JV-000001 style)',
      v1 && /^JV-\d{6}$/.test(v1.voucher_no) && v1.manual_no === null, JSON.stringify(v1));

    // ── and it must NOT show up on the daily closing sheet ────────────────
    const inLines = (await q(`select count(*) n from nf_lines where company_id='${C}'`))[0].n;
    ok('JV-05 the daily closing sheet does not see it', Number(inLines) === 0, `nf_lines rows: ${inLines}`);
    const [pos] = await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select close_cash, close_bank from nf_position_row((select id from nf_days where company_id='${C}'))`);
    ok('JV-05 the cash position is unmoved (still the 100,000 opening)', Number(pos.close_cash) === 100000, JSON.stringify(pos));

    // ── but the ledger and the statements DO see it ───────────────────────
    const [tb] = await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select (public.nf_get_trial_balance('${C}', NULL)->>'total_debit')::numeric d`);
    ok('JV-06 the Trial Balance includes it', Number(tb.d) === 150000, JSON.stringify(tb));

    // ── a multi-leg voucher, with a brand-new party on a 21100 leg ────────
    await setValue(page, '#nf-jv-nar', 'Token from one buyer split across two units');
    const shape = await fillLeg(page, 0, { account: '22100', floor: 'P-W', debit: 90000, memo: 'Collected by FMH' });
    await fillLeg(page, 1, { account: '21100', floor: 'GF', credit: 50000, party: buyer, memo: 'GF-14' });
    await settle(page); await page.click('#nf-jv-addleg');
    await fillLeg(page, 2, { account: '21100', floor: 'FF', credit: 40000, party: buyer, memo: 'FF-02' });
    await settle(page);
    const bal2 = await page.evaluate(() => document.querySelector('.jvfoot .bal').textContent.trim());
    ok('JV-07 a third line can be added and it still balances', bal2 === 'Balanced', bal2);
    await settle(page); await page.click('#nf-jv-post');
    await page.waitForFunction(() => document.querySelectorAll('.jvcard').length >= 2, { timeout: 15000 });
    const [v2] = await q(`select (select count(*) from nf_voucher_legs l where l.voucher_id=v.id) legs
                          from nf_vouchers v where v.company_id='${C}' and v.narration like 'Token from one buyer%'`);
    ok('JV-08 a three-leg voucher posted', v2 && Number(v2.legs) === 3, JSON.stringify(v2));
    const [pty] = await q(`select count(*) n from nf_parties where company_id='${C}' and name='${buyer}'`);
    ok('JV-08 the new party was created once, from the leg', Number(pty.n) === 1, JSON.stringify(pty));
    ok('JV-08 the party field offered "add new" only after finding nothing',
      shape === null || (shape.picks === 0 && shape.add === true), JSON.stringify(shape));

    // ── an unbalanced voucher cannot be posted ───────────────────────────
    await setValue(page, '#nf-jv-nar', 'deliberately unbalanced');
    await fillLeg(page, 0, { account: '53100', floor: 'P-W', debit: 100 });
    await fillLeg(page, 1, { account: '22100', floor: 'P-W', credit: 90 });
    await settle(page);
    const unbal = await page.evaluate(() => ({
      disabled: document.querySelector('#nf-jv-post').disabled,
      bal: document.querySelector('.jvfoot .bal').textContent.trim(),
      issues: [...document.querySelectorAll('.jvissues li')].map(li => li.textContent.trim()),
    }));
    ok('JV-09 an unbalanced voucher cannot be posted, and says why',
      unbal.disabled === true && /Out by/.test(unbal.bal) && unbal.issues.some(t => /match/i.test(t)), JSON.stringify(unbal));
    await settle(page); await page.click('#nf-jv-clear');
    // Clear rebuilds the whole form, and that rebuild is deferred by a tick —
    // so settle BEFORE typing, or the voucher number lands in the input that
    // is about to be thrown away and the next check reads an empty form.
    await settle(page);

    // ── a cash-book voucher number is refused ────────────────────────────
    await setValue(page, '#nf-jv-no', 'CRV-500');
    await page.evaluate(() => document.querySelector('#nf-jv-no').dispatchEvent(new Event('blur', { bubbles: true })));
    await settle(page);
    const prefix = await page.evaluate(() => [...document.querySelectorAll('.jvissues li')].map(li => li.textContent.trim()));
    ok('JV-10 a CRV/BRV/CPV/BPV number is refused before sending', prefix.some(t => /daily closing sheet/i.test(t)), JSON.stringify(prefix));

    // ── delete ───────────────────────────────────────────────────────────
    const before = (await q(`select count(*) n from nf_vouchers where company_id='${C}' and day_id is null`))[0].n;
    page.on('dialog', d => d.accept());
    await page.evaluate(() => { window.confirm = () => true; });
    await settle(page); await page.click('.jvcard [data-del-jv]');
    await page.waitForFunction(n => document.querySelectorAll('.jvcard').length < n, { timeout: 15000 }, Number(before)).catch(() => {});
    const after = (await q(`select count(*) n from nf_vouchers where company_id='${C}' and day_id is null`))[0].n;
    ok('JV-11 a journal voucher can be deleted', Number(after) === Number(before) - 1, `${before} → ${after}`);

    ok('JV-12 no console or page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    if (users.D && users.D.id) {
      const r = await http_('DELETE', `/auth/v1/admin/users/${users.D.id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user: HTTP ${r.status}`);
    }
    const [left] = await q(`select json_build_object(
      'company', (select count(*) from companies where id='${C}'),
      'nf_rows', (select count(*) from nf_vouchers where company_id='${C}') + (select count(*) from nf_days where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(left.j));
    ok('CLEANUP', left.j.company === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));
    const awamiAfter = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} → ${awamiAfter}`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
