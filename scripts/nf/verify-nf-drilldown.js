#!/usr/bin/env node
/**
 * NexuFinance v1 — drill-down ("360") navigation, driven for real
 * (js/nf/nf-drill.js, docs/PLAN.md §43). Stage 1 (D-*): P&L → ledger → entry.
 * Stage 2 (S2-*): every other report — Balance Sheet, Trial Balance, Cash &
 * Bank, Project Cost, Floor Summary, Monthly Trend, Token Register, Party
 * Statement, General Journal, Director Report — and Transaction Detail, whose
 * marked lines must total, penny for penny, to the grouped figure clicked.
 *
 * The owner's ask (2026-09-21): like QuickBooks. Click a P&L figure and that
 * account's LEDGER opens for the same range; double-click a ledger entry and
 * the ORIGINAL ENTRY opens in the screen it was entered on.
 *
 * The fixture puts all three kinds of voucher on ONE account (53100), so a
 * single ledger exercises every destination:
 *   CPV-001  a daily-closing payment   → the Daily Closing sheet, that day
 *   JV-JRN-1 a journal voucher         → the Journal Vouchers screen
 *   JV-9101  imported QuickBooks history → the General Journal, read-only
 *
 * Every assertion is about what a person SEES land: the right screen, the
 * right line lit, a Back button that returns to where they came from with
 * the range they had — and that the ledger they land on ties to the exact
 * figure they clicked. Plus the regression that matters most on a screen
 * used every day: opening the closing sheet normally is unchanged.
 *
 *   node scripts/nf/verify-nf-drilldown.js > "$SCRATCH/nf-drill.log" 2>&1
 *   DRILL_SHOTS=<dir>   also save a screenshot of every step there
 *
 * Disposable ZZTEST-NF-<run> company; Awami is never touched; cleanup is
 * verified by query, always, even on failure.
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

const PORT = 4503;
const URL_BASE = `https://${REF}.supabase.co`;
const SHOTS = process.env.DRILL_SHOTS || null;
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) { console.log('[verify-nf-drilldown] SKIPPED — no puppeteer-core/Chrome. Nothing was verified.'); process.exit(0); }

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(66)} ${pass ? '' : String(detail).slice(0, 300)}`); };

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
  return { anon: list.find(k => k.name === 'anon').api_key, svc: list.find(k => k.name === 'service_role').api_key };
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
// A double-click is { count: 2 } on puppeteer-core 25: `count` is the number
// of clicks, while `clickCount` only sets the detail on ONE click — which
// never fires dblclick. (The first run of this suite fell for exactly that.)
// The screens re-render when data lands, detaching nodes Puppeteer just
// resolved; the driver retries rather than the app holding still for a test.
async function clickStable(page, selector, opts = {}, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { await page.click(selector, opts); return; }
    catch (e) {
      if (i === tries - 1 || !/detached|not clickable|not visible|No element/i.test(e.message)) throw e;
      await new Promise(r => setTimeout(r, 300));
    }
  }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const n = s => Number(String(s || '').replace(/[^0-9.\-()]/g, '').replace(/^\((.*)\)$/, '-$1')) || 0;

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-drilldown] project ${REF} · run ${run}`);
  let K;
  try { K = await keys(); } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const s = built.ref.sample;
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = {};
  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
  let srv, browser;

  try {
    // ── fixture: the golden day + a JV + one imported voucher, all on 53100 ──
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFDRL${run}', 'ZZTEST-NF-${run}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-drill-${run}@zztest-nf.invalid`, password = crypto.randomBytes(18).toString('base64url');
    const u = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (u.status >= 300) throw new Error('create user: ' + JSON.stringify(u.json));
    users.D = { id: u.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}','${users.D.id}','director','Drill Director',true)`);
    const li = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (li.status !== 200) throw new Error('sign-in: HTTP ' + li.status);
    users.D.jwt = li.json.access_token;
    const tokenLine = s.in.find(x => x.h === '21100');
    if (tokenLine) await q(`insert into nf_parties (company_id, name, kind, created_by) values ('${C}', '${tokenLine.d.replace(/'/g, "''")}', 'customer', '${users.D.id}'::uuid)`);

    const rpc = (name, args) => http_('POST', `/rest/v1/rpc/${name}`, { key: K.anon, jwt: users.D.jwt, body: args });
    let r = await rpc('nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno,
      p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
    if (r.status !== 200) throw new Error('nf_start_first_day: ' + JSON.stringify(r.json));
    const dayId = r.json.day.id;
    for (const [side, rows] of [['IN', s.in], ['OUT', s.out]]) {
      for (const x of rows.filter(x => Number(x.a))) {
        r = await rpc('nf_save_line', { p_day_id: dayId, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
          p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null,
          p_party_name: x.h === '21100' ? x.d : null });
        if (r.status !== 200) throw new Error(`nf_save_line ${x.v}: ` + JSON.stringify(r.json));
      }
    }
    const floor = built.seed.floors[0].code;
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-JRN-1', p_voucher_date: s.date,
      p_narration: 'FMH paid a project cost directly',
      p_legs: [{ account_code: '53100', floor_code: floor, debit: 75000 }, { account_code: '22100', floor_code: floor, credit: 75000 }] });
    if (r.status !== 200) throw new Error('nf_jv_save: ' + JSON.stringify(r.json));
    // imported history: posted through the service channel, then tagged the
    // way scripts/nf/import-awami-history.js tags it
    await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select public.nf_post_voucher('${C}', NULL, 'JV-9101', '${s.date}', 'Imported from QuickBooks history, test', 0,
        '[{"account_code":"53100","floor_code":"${floor}","debit":5000},{"account_code":"22200","floor_code":"${floor}","credit":5000}]'::jsonb)`);
    await q(`update nf_vouchers set source='IMPORT', iif_exportable=false where company_id='${C}' and voucher_key='JV-9101'`);
    // a token receipt tagged with a unit, the way the Token Register reads it
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-TKN-1', p_voucher_date: s.date,
      p_narration: 'Token received for a unit',
      p_legs: [{ account_code: '22100', floor_code: floor, debit: 20000, memo: 'Token 7 against unit G-12' },
               { account_code: '21100', floor_code: floor, credit: 20000, memo: 'Token 7 against unit G-12', party_name: 'Drill Token Holder' }] });
    if (r.status !== 200) throw new Error('nf_jv_save JV-TKN-1: ' + JSON.stringify(r.json));
    const cpv53100 = s.out.find(x => x.h === '53100' && Number(x.a));
    if (!cpv53100) throw new Error('golden day has no 53100 payment to drill into');
    console.log(`  fixture: golden day (${cpv53100.v} on 53100) + JV-JRN-1 + imported JV-9101, all on 53100\n`);

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
    await page.setViewport({ width: 1400, height: 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.pos-grid', { timeout: 15000 });

    // ── the everyday screen is unchanged ────────────────────────────────────
    const normal = await page.evaluate(() => ({ back: !!document.querySelector('#nf-sheet-back'),
      drilled: !!document.querySelector('[data-drilled]') }));
    ok('D-00 opening the closing sheet normally: no Back button, nothing lit', !normal.back && !normal.drilled, JSON.stringify(normal));

    // ── P&L → ledger ────────────────────────────────────────────────────────
    await clickStable(page, '#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    await clickStable(page, '[data-goto="pl"]');
    await page.waitForSelector('.plsheet [data-drill-acct="53100"]', { timeout: 15000 });
    const plFigure = await page.$eval('.plsheet [data-drill-acct="53100"] b', el => el.textContent.trim());
    await shot(page, '1-pl');
    await clickStable(page, '.plsheet [data-drill-acct="53100"]');
    await page.waitForSelector('.lsheet [data-drill-vno]', { timeout: 15000 });
    const lg = await page.evaluate(() => ({
      foot: (document.querySelector('.lsheet .docfoot') || {}).textContent || '',
      back: (document.querySelector('#nf-lgr-back') || {}).textContent || '',
      closing: [...document.querySelectorAll('.lsheet .rtile')].map(t => t.textContent).find(t => /Closing/.test(t)) || '',
      vnos: [...document.querySelectorAll('.lsheet [data-drill-vno]')].map(tr => tr.getAttribute('data-drill-vno')),
    }));
    await shot(page, '2-ledger');
    ok('D-01 clicking 53100 on the P&L opens ITS ledger', /53100/.test(lg.foot), lg.foot);
    ok('D-02 the ledger\'s Back says it returns to the P&L', /Profit & Loss/.test(lg.back), lg.back);
    ok('D-03 the ledger ties to the exact figure clicked on the P&L', n(lg.closing) === n(plFigure) && n(plFigure) !== 0,
      `P&L ${plFigure} vs ledger closing ${lg.closing}`);
    ok('D-03b all three kinds of entry are on this ledger', ['JV-JRN-1', 'JV-9101', cpv53100.v].every(v => lg.vnos.includes(v)), JSON.stringify(lg.vnos));

    const backToLedger = async () => {
      await page.waitForSelector('.lsheet [data-drill-vno]', { timeout: 15000 });
      return page.evaluate(() => ({ foot: (document.querySelector('.lsheet .docfoot') || {}).textContent || '',
        back: (document.querySelector('#nf-lgr-back') || {}).textContent || '' }));
    };

    // ── ledger → a daily-closing payment ────────────────────────────────────
    await clickStable(page, `.lsheet [data-drill-vno="${cpv53100.v}"]`, { count: 2 });
    await page.waitForSelector('#nf-sheet [data-drilled]', { timeout: 15000 });
    const sh = await page.evaluate(() => {
      const hit = document.querySelector('#nf-sheet [data-drilled]');
      return { vno: hit && hit.querySelector('.vno') ? hit.querySelector('.vno').value : null,
        back: (document.querySelector('#nf-sheet-back') || {}).textContent || '',
        date: (document.querySelector('.docmeta') || {}).textContent || '' };
    });
    await shot(page, '3-closing-sheet');
    ok(`D-04 double-clicking ${cpv53100.v} opens the Daily Closing with THAT line lit`, sh.vno === cpv53100.v, JSON.stringify(sh));
    ok('D-05 …on the day the voucher belongs to', /16 Sept 2026|16-Sep-2026/.test(sh.date), sh.date.slice(0, 120));
    ok('D-05b …and its Back returns to the ledger', /ledger/i.test(sh.back), sh.back);
    await clickStable(page, '#nf-sheet-back');
    let lg2 = await backToLedger();
    ok('D-06 Back from the entry lands on the SAME ledger, still pointing back to the P&L',
      /53100/.test(lg2.foot) && /Profit & Loss/.test(lg2.back), JSON.stringify(lg2));

    // ── ledger → a journal voucher ──────────────────────────────────────────
    await clickStable(page, '.lsheet [data-drill-vno="JV-JRN-1"]', { count: 2 });
    await page.waitForSelector('.jvsheet [data-drilled]', { timeout: 15000 });
    const jv = await page.evaluate(() => ({ no: document.querySelector('.jvsheet [data-drilled]').getAttribute('data-jv-no'),
      back: (document.querySelector('#nf-jv-back') || {}).textContent || '' }));
    await shot(page, '4-journal-voucher');
    ok('D-07 double-clicking JV-JRN-1 opens the Journal Vouchers screen with THAT voucher lit', jv.no === 'JV-JRN-1', JSON.stringify(jv));
    await clickStable(page, '#nf-jv-back');
    lg2 = await backToLedger();
    ok('D-07b …and Back returns to the ledger', /53100/.test(lg2.foot), JSON.stringify(lg2));

    // ── ledger → imported history ───────────────────────────────────────────
    await clickStable(page, '.lsheet [data-drill-vno="JV-9101"]', { count: 2 });
    await page.waitForSelector('.jsheet [data-drilled]', { timeout: 15000 });
    const im = await page.evaluate(() => ({ no: document.querySelector('.jsheet [data-drilled]').getAttribute('data-jrn-vno'),
      note: (document.querySelector('.nf-drill-note') || {}).textContent || '',
      onJvScreen: !!document.querySelector('.jvsheet') }));
    await shot(page, '5-imported');
    ok('D-08 an IMPORTED voucher opens read-only in the General Journal, lit, and labelled', im.no === 'JV-9101' && /imported from QuickBooks/i.test(im.note),
      JSON.stringify(im));
    ok('D-08b …and never on the Journal Vouchers screen, where Delete lives', !im.onJvScreen, JSON.stringify(im));
    await clickStable(page, '#nf-jrn-back');
    lg2 = await backToLedger();

    // ── ledger → back to the P&L ────────────────────────────────────────────
    await clickStable(page, '#nf-lgr-back');
    await page.waitForSelector('.plsheet [data-drill-acct="53100"]', { timeout: 15000 });
    const pl2 = await page.$eval('.plsheet [data-drill-acct="53100"] b', el => el.textContent.trim());
    ok('D-09 Back from the ledger returns to the P&L, same figure', pl2 === plFigure, `${plFigure} → ${pl2}`);

    // ════ Stage 2: every other report (the owner's "poora trail") ═════════
    const goto = async key => {
      await clickStable(page, '#nf-rpm-toggle');
      await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
      await clickStable(page, `[data-goto="${key}"]`);
    };
    const heading = () => page.$eval('h1', el => el.textContent.trim()).catch(() => '');
    // Transaction Detail has landed: its tie-out banner, and what it says.
    const detailView = async () => {
      await page.waitForSelector('.jsheet [data-detail-total]', { timeout: 15000 });
      return page.evaluate(() => ({
        h1: document.querySelector('.jsheet h1').textContent.trim(),
        total: Number(document.querySelector('[data-detail-total]').getAttribute('data-detail-total')),
        note: document.querySelector('.jrn-detail').textContent,
        lines: document.querySelectorAll('.jsheet tr.jrn-match').length,
        back: (document.querySelector('#nf-jrn-back') || {}).textContent || '',
      }));
    };
    const ties = (d, figure) => d.h1 === 'Transaction Detail' && Math.round(d.total * 100) === Math.round(n(figure) * 100) &&
      /matches the figure clicked/.test(d.note) && d.lines > 0;
    const ledgerView = async () => {
      await page.waitForSelector('.lsheet .rtile', { timeout: 15000 });
      return page.evaluate(() => ({ foot: document.querySelector('.lsheet .docfoot').textContent,
        opening: [...document.querySelectorAll('.lsheet .rtile')].map(t => t.textContent).find(t => /Opening/.test(t)) || '',
        closing: [...document.querySelectorAll('.lsheet .rtile')].map(t => t.textContent).find(t => /Closing/.test(t)) || '',
        back: (document.querySelector('#nf-lgr-back') || {}).textContent || '' }));
    };

    // ── P&L section total → Transaction Detail → an entry → back ────────────
    // the total of the section 53100 sits in — so JV-JRN-1 is one of its lines
    await page.waitForSelector('.plsheet [data-drill-qb]', { timeout: 15000 });
    const qb53 = await page.$eval('.plsheet [data-drill-acct="53100"]', el => el.closest('.oblist').querySelector('[data-drill-qb]').getAttribute('data-drill-qb'));
    const expTotal = await page.$eval(`.plsheet [data-drill-qb="${qb53}"] b`, el => el.textContent.trim());
    await clickStable(page, `.plsheet [data-drill-qb="${qb53}"]`);
    let d = await detailView();
    await shot(page, '6-detail-expense');
    ok(`S2-01 P&L "Total ${qb53}" opens Transaction Detail whose lines tie to it`, ties(d, expTotal), `${expTotal} vs ${JSON.stringify(d)}`);
    await clickStable(page, '.jsheet tr[data-jrn-vno="JV-JRN-1"]', { count: 2 });
    await page.waitForSelector('.jvsheet [data-drilled]', { timeout: 15000 });
    ok('S2-02 double-clicking a line in Transaction Detail opens its original entry',
      await page.$eval('.jvsheet [data-drilled]', el => el.getAttribute('data-jv-no')) === 'JV-JRN-1', '');
    await clickStable(page, '#nf-jv-back');
    d = await detailView();
    ok('S2-03 …and Back returns to the same Transaction Detail, still tied', ties(d, expTotal) && /Profit & Loss/.test(d.back), JSON.stringify(d));
    await clickStable(page, '#nf-jrn-back');
    await page.waitForSelector('.plsheet [data-drill-qb]', { timeout: 15000 });

    // ── Balance Sheet: an account, the totals, the computed earnings ────────
    await goto('bs');
    await page.waitForSelector('.bssheet [data-drill-acct]', { timeout: 15000 });
    const bsRow = await page.$eval('.bssheet [data-drill-acct]', el => ({ code: el.getAttribute('data-drill-acct'), amt: el.querySelector('b').textContent }));
    await clickStable(page, `.bssheet [data-drill-acct="${bsRow.code}"]`);
    let l = await ledgerView();
    ok(`S2-04 Balance Sheet ${bsRow.code} opens its ledger, closing = the figure`,
      new RegExp(bsRow.code).test(l.foot) && Math.abs(n(l.closing)) === Math.abs(n(bsRow.amt)) && /Balance Sheet/.test(l.back), `${bsRow.amt} vs ${JSON.stringify(l)}`);
    await clickStable(page, '#nf-lgr-back');
    for (const [kind, label] of [['assets', 'Total Assets'], ['liabilities', 'Total Liabilities']]) {
      await page.waitForSelector(`.bssheet [data-drill-total="${kind}"]`, { timeout: 15000 });
      const fig = await page.$eval(`.bssheet [data-drill-total="${kind}"] b`, el => el.textContent.trim());
      await clickStable(page, `.bssheet [data-drill-total="${kind}"]`);
      d = await detailView();
      ok(`S2-05 Balance Sheet "${label}" → Transaction Detail ties`, ties(d, fig), `${fig} vs ${JSON.stringify(d)}`);
      await clickStable(page, '#nf-jrn-back');
    }
    await page.waitForSelector('.bssheet [data-drill-earnings]', { timeout: 15000 });
    const earn = await page.$eval('.bssheet [data-drill-earnings] > b', el => el.textContent.trim());
    await clickStable(page, '.bssheet [data-drill-earnings]');
    await page.waitForSelector('.plsheet .orow.net b', { timeout: 15000 });
    const ni = await page.$eval('.plsheet .orow.net b', el => el.textContent.trim());
    ok('S2-06 Balance Sheet earnings opens the P&L to date, Net Income = the figure', n(ni) === n(earn), `${earn} vs ${ni}`);
    await clickStable(page, '#nf-pl-back');
    await page.waitForSelector('.bssheet', { timeout: 15000 });
    ok('S2-06b …and Back returns to the Balance Sheet', /Balance Sheet/.test(await heading()), await heading());

    // ── Trial Balance / Cash & Bank: an account → its ledger ────────────────
    await goto('tb');
    await page.waitForSelector('.ttab [data-drill-acct="53100"]', { timeout: 15000 });
    const tbDr = await page.$eval('.ttab [data-drill-acct="53100"] td:nth-child(3)', el => el.textContent.trim());
    await clickStable(page, '.ttab [data-drill-acct="53100"]');
    l = await ledgerView();
    ok('S2-07 Trial Balance 53100 → its ledger, closing = the debit shown', /53100/.test(l.foot) && n(l.closing) === n(tbDr) && /Trial Balance/.test(l.back), `${tbDr} vs ${JSON.stringify(l)}`);
    await clickStable(page, '#nf-lgr-back');
    await goto('cashbank');
    await page.waitForSelector('.cbrow[data-drill-acct]', { timeout: 15000 });
    const cb = await page.$eval('.cbrow[data-drill-acct]', el => ({ code: el.getAttribute('data-drill-acct'),
      opening: el.children[1].textContent, closing: el.lastElementChild.textContent }));
    await clickStable(page, `.cbrow[data-drill-acct="${cb.code}"]`);
    l = await ledgerView();
    // The MOVEMENT ties. The opening need not: Cash & Bank starts from the
    // sheet's typed first-day opening (nf_ledger_position), which is never a
    // posted voucher, so the ledger does not carry it — see
    // docs/findings/2026-09-21-P-typed-opening-never-posted.md. This fixture types one.
    ok(`S2-08 Cash & Bank ${cb.code} → its ledger; the ledger's movement = the row's (closing − opening)`,
      new RegExp(cb.code).test(l.foot) && n(l.closing) - n(l.opening) === n(cb.closing) - n(cb.opening) && /Cash & Bank/.test(l.back),
      `${cb.opening}→${cb.closing} vs ${JSON.stringify(l)}`);
    await clickStable(page, '#nf-lgr-back');

    // ── grouped figures → Transaction Detail, each tied ──────────────────────
    await goto('projectcost');
    await page.waitForSelector('.pcrow[data-drill-cat]', { timeout: 15000 });
    const pcs = await page.$$eval('.pcrow[data-drill-cat]', els => els.map(e => ({ cat: e.getAttribute('data-drill-cat'), fig: e.children[1].textContent })));
    for (const pc of pcs) {
      await clickStable(page, `.pcrow[data-drill-cat="${pc.cat}"]`);
      d = await detailView();
      ok(`S2-09 Project Cost "${pc.cat || 'Total'}" → Transaction Detail ties`, ties(d, pc.fig), `${pc.fig} vs ${JSON.stringify(d)}`);
      await clickStable(page, '#nf-jrn-back');
      await page.waitForSelector('.pcrow[data-drill-cat]', { timeout: 15000 });
    }
    await goto('floor');
    await page.waitForSelector('.flrow [data-drill-floor]', { timeout: 15000 });
    const figs = await page.$$eval('.flrow [data-drill-floor]', els => els.map(e => ({ floor: e.getAttribute('data-drill-floor'), kind: e.getAttribute('data-drill-kind'), fig: e.textContent }))
      .filter(x => Number(x.fig.replace(/[^0-9.-]/g, '')) !== 0));
    for (const fg of figs) {
      await clickStable(page, `.flrow [data-drill-floor="${fg.floor}"][data-drill-kind="${fg.kind}"]`);
      d = await detailView();
      ok(`S2-10 Floor Summary ${fg.floor} ${fg.kind} → Transaction Detail ties`, ties(d, fg.fig), `${fg.fig} vs ${JSON.stringify(d)}`);
      await clickStable(page, '#nf-jrn-back');
      await page.waitForSelector('.flrow [data-drill-floor]', { timeout: 15000 });
    }
    ok('S2-10b the fixture exercised Floor Summary cost, income AND token figures', ['cost', 'income', 'token'].every(k => figs.some(f => f.kind === k)), JSON.stringify(figs));
    await goto('trend');
    await page.waitForSelector('.mtrow [data-drill-ym]', { timeout: 15000 });
    const mts = await page.$$eval('.mtrow [data-drill-ym]', els => els.map(e => ({ ym: e.getAttribute('data-drill-ym'), kind: e.getAttribute('data-drill-kind'), fig: e.textContent }))
      .filter(x => Number(x.fig.replace(/[^0-9.-]/g, '')) !== 0));
    for (const mt of mts) {
      await clickStable(page, `.mtrow [data-drill-ym="${mt.ym}"][data-drill-kind="${mt.kind}"]`);
      d = await detailView();
      ok(`S2-11 Monthly Trend ${mt.ym} ${mt.kind} → Transaction Detail ties`, ties(d, mt.fig), `${mt.fig} vs ${JSON.stringify(d)}`);
      await clickStable(page, '#nf-jrn-back');
      await page.waitForSelector('.mtrow [data-drill-ym]', { timeout: 15000 });
    }
    await goto('token');
    await page.waitForSelector('.tkrow[data-drill-unit="G-12"]', { timeout: 15000 });
    const tkNet = await page.$eval('.tkrow[data-drill-unit="G-12"]', el => el.children[8].textContent);
    await clickStable(page, '.tkrow[data-drill-unit="G-12"]');
    d = await detailView();
    ok('S2-12 Token Register unit G-12 → its token lines, tied to Net', ties(d, tkNet), `${tkNet} vs ${JSON.stringify(d)}`);
    await clickStable(page, '#nf-jrn-back');

    // ── Party Statement: double-click an entry ──────────────────────────────
    if (tokenLine) {
      await goto('party');
      // the golden day's own token party, so its entry lives on the closing sheet
      await page.waitForSelector('#nf-pty-sel option:nth-child(2)', { timeout: 15000 });
      await page.select('#nf-pty-sel', await page.$$eval('#nf-pty-sel option', (os, nm) => (os.find(o => o.textContent.trim().startsWith(nm)) || {}).value || '', tokenLine.d));
      await page.waitForSelector('.pgrow[data-drill-vno]', { timeout: 15000 });
      const pv = await page.$eval('.pgrow[data-drill-vno]', el => el.getAttribute('data-drill-vno'));
      await clickStable(page, `.pgrow[data-drill-vno="${pv}"]`, { count: 2 });
      await page.waitForSelector('#nf-sheet [data-drilled]', { timeout: 15000 });
      const pvHit = await page.$eval('#nf-sheet [data-drilled] .vno', el => el.value);
      ok(`S2-13 Party Statement: double-clicking ${pv} opens it on the closing sheet, lit`, pvHit === pv, pvHit);
      await clickStable(page, '#nf-sheet-back');
      await page.waitForSelector('.pgrow[data-drill-vno]', { timeout: 15000 });
      ok('S2-13b …and Back returns to the same party\'s statement', true, '');
    } else ok('S2-13 Party Statement', false, 'golden day has no 21100 line — fixture cannot exercise it');

    // ── General Journal: double-click any line ──────────────────────────────
    await goto('journal');
    await page.waitForSelector('.jsheet #nf-jrn-from', { timeout: 15000 });
    await page.$eval('#nf-jrn-from', (el, v) => { el.value = v; }, s.date);
    await page.$eval('#nf-jrn-to', (el, v) => { el.value = v; }, s.date);
    await clickStable(page, '#nf-jrn-apply');
    await page.waitForSelector('.jsheet tr.jrnleg[data-jrn-vno="JV-JRN-1"]', { timeout: 15000 });
    await clickStable(page, '.jsheet tr.jrnleg[data-jrn-vno="JV-JRN-1"]', { count: 2 });
    await page.waitForSelector('.jvsheet [data-drilled]', { timeout: 15000 });
    ok('S2-14 General Journal: double-clicking even a SECOND line of a voucher opens it',
      await page.$eval('.jvsheet [data-drilled]', el => el.getAttribute('data-jv-no')) === 'JV-JRN-1', '');
    await clickStable(page, '#nf-jv-back');
    await page.waitForSelector('.jsheet tr[data-jrn-vno]', { timeout: 15000 });
    const jBack = await page.evaluate(() => ({ h1: document.querySelector('.jsheet h1').textContent, from: document.querySelector('#nf-jrn-from').value }));
    ok('S2-14b …and Back returns to the journal on the range it had', jBack.h1.trim() === 'General Journal' && jBack.from === s.date, JSON.stringify(jBack));

    // ── Director Report: a cash row → its ledger; an entry → the sheet ───────
    await goto('closing');
    await page.waitForSelector('#nf-toDir', { timeout: 15000 });
    await clickStable(page, '#nf-toDir');
    await page.waitForSelector('.rsheet tr[data-drill-via]', { timeout: 15000 });
    const dr = await page.$eval('.rsheet tr[data-drill-via]', el => ({ via: el.getAttribute('data-drill-via'),
      opening: el.children[1].textContent, closing: el.lastElementChild.textContent }));
    await clickStable(page, `.rsheet tr[data-drill-via="${dr.via}"]`);
    l = await ledgerView();
    ok(`S2-15 Director Report "${dr.via}" row → its ledger for that day; the day's movement ties`,
      n(l.closing) - n(l.opening) === n(dr.closing) - n(dr.opening) && /Director Report/.test(l.back), `${dr.opening}→${dr.closing} vs ${JSON.stringify(l)}`);
    await clickStable(page, '#nf-lgr-back');
    await page.waitForSelector(`.rsheet tr[data-drill-vno="${cpv53100.v}"]`, { timeout: 15000 });
    await clickStable(page, `.rsheet tr[data-drill-vno="${cpv53100.v}"]`, { count: 2 });
    await page.waitForSelector('#nf-sheet [data-drilled]', { timeout: 15000 });
    ok(`S2-16 Director Report: double-clicking ${cpv53100.v} opens that line on the closing sheet`,
      await page.$eval('#nf-sheet [data-drilled] .vno', el => el.value) === cpv53100.v, '');
    await shot(page, '7-director-to-sheet');

    ok('D-10 no console or page errors anywhere along the way', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
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
