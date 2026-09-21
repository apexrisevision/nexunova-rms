#!/usr/bin/env node
/**
 * NexuFinance v1 Phase 2 — the closing sheet screen, driven for real.
 *
 *   node scripts/nf/verify-nf-golden-ui.js > "$SCRATCH/nf-golden-ui.log" 2>&1
 *
 * Everything happens through nexufinance.html served over real HTTP, with a
 * real Supabase session (a real password-created user, a real JWT) — not a
 * stub, not a mocked network. The one thing replaced is `window.print()`,
 * which would otherwise open a native dialog headless Chrome cannot answer;
 * it is monkey-patched to a no-op via evaluateOnNewDocument (a browser API,
 * not an application global — SR-7 is about not stubbing the app's own
 * state). The real print output is captured separately with page.pdf()
 * under @media print, which does not go through window.print() at all.
 *
 * Tenant: a fresh ZZTEST-NF-<run> company (gen-seed's own seed — the same
 * one Awami got), two real users (director, accountant), each in their own
 * incognito browser context so their sessions never share storage. Awami is
 * never touched; cleanup is verified by query, always, even on failure.
 *
 * Covers: the golden day typed into the real form → totals to the rupee →
 * print → one A4 page → light and dark screenshots → a payment refused for
 * insufficient cash, shown on the line → a duplicate voucher refused, shown
 * on the line → cleanup.
 *
 * Exit (via process.exitCode): 0 held · 1 something failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require('./gen-seed');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'nexufinance', 'v1', 'design');
const PORT = 4488;
const URL_BASE = `https://${REF}.supabase.co`;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[verify-nf-golden-ui] SKIPPED \u2014 puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(28)} ${pass ? '' : String(detail).slice(0, 300)}`); };

// ── static server for the real page, real CSS, real JS \u2014 nothing stubbed ──
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

// ── auth: real password sign-in, same technique as verify-nf-rules.js ──────
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
  // page.pdf() returns a Uint8Array on this puppeteer-core version, not a
  // Node Buffer — Uint8Array.prototype.toString() ignores its argument and
  // silently produces a comma-joined decimal dump, which matched nothing and
  // reported "0 pages" for a real PDF. Buffer.from() makes either type safe.
  const s = Buffer.from(buf).toString('latin1');
  const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (m) return Number(m[1]);
  const pages = (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  return pages;
}

async function injectSession(page, ref, jwt, userId, email) {
  await page.evaluateOnNewDocument((ref, jwt, userId, email) => {
    try { localStorage.clear(); } catch (e) {}
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
      access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
    }));
    // window.print() would open a native dialog headless Chrome cannot answer.
    // A browser API, not an application global \u2014 stubbing it does not touch
    // anything the page itself computes or stores.
    window.print = function () {};
  }, ref, jwt, userId, email);
}

// ── row helpers ─────────────────────────────────────────────────────────
// nf-sheet.js redraws the whole .books block on a select change (a new row
// may need to appear), which detaches any ElementHandle taken before that
// point. Every field is therefore located FRESH, by a selector keyed on the
// draft's stable tmpId (data-draft), not by a cached handle — the tmpId
// survives the redraw because it names the same entry in the drafts array,
// even though the DOM node under it is new.
async function lastDraftTmpId(page, side) {
  return page.evaluate(s => {
    const rows = [...document.querySelectorAll(`.row.draft[data-side="${s}"]`)];
    return rows.length ? rows[rows.length - 1].getAttribute('data-draft') : null;
  }, side);
}
// Triple-click was not reliable at clearing a pre-filled numeric input under
// headless automation: on the fd-cash/petty/bank fields (prefilled "0") the
// caret landed BEFORE the "0" rather than selecting it, so Backspace deleted
// nothing and the typed digits were inserted in front of it — "250000"
// typed at a field holding "0" came back as "2500000" (250,000 read as
// 2,500,000; every opening was exactly ×10). Clear the value directly.
async function setValue(page, selector, text) {
  await page.focus(selector);
  await page.evaluate(sel => {
    var el = document.querySelector(sel);
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector);
  await page.type(selector, text);
}
// The head and the party are no longer <select>s — both are the shared
// type-to-search picker (js/nf/nf-pick.js, owner's ask 2026-09-20: type Y and
// Yousaf should come up). Driving one means focus it, type enough to narrow
// the list, wait for the list, then take the row. A `value` of null takes the
// "+ Add new" row instead, which only an open list (party) ever offers.
// Picking a head redraws the row, so settle before touching the row again.
const settle = page => page.evaluate(() => new Promise(r => setTimeout(r, 40)));
async function pick(page, scope, key, query, value) {
  const inp = scope + ' [data-pick="' + key + '"] .nfpick-in';
  await page.focus(inp);
  await page.evaluate(s => { const e = document.querySelector(s); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }, inp);
  await page.type(inp, query);
  await page.waitForSelector(scope + ' [data-pick="' + key + '"] .nfpick-dd:not([hidden])', { timeout: 5000 });
  await page.click(scope + ' [data-pick="' + key + '"] ' +
    (value === null ? '[data-pick-add]' : '[data-pick-value="' + value + '"]'));
  await settle(page);
}

async function fillDraftRow(page, side, v, d, h, f, m, a, party) {
  // tmpId is captured ONCE, before anything is typed — filling this row's
  // first field makes ensureTrailingBlank() append a fresh blank row behind
  // it, so "last draft row" drifts to that new one; the tmpId itself
  // survives every redraw and still names this exact row throughout
  // (20260919i/j party-field verify: re-resolving "last" mid-fill picks up
  // the wrong row and silently no-ops the save).
  const tmpId = await lastDraftTmpId(page, side);
  const row = `.row.draft[data-draft="${tmpId}"]`;
  const sel = k => `${row} [data-k="${k}"]`;
  await setValue(page, sel('v'), v);
  await setValue(page, sel('d'), d);
  await pick(page, row, 'head', h, h);          // search by code; the list matches code OR name
  await page.select(sel('f'), f);
  await page.select(sel('m'), m);
  await setValue(page, sel('a'), String(a));
  if (party) {
    // 20260919i/j: the account this golden day posts its token receipt to
    // (21100) requires an explicit party on the SCREEN, not just a
    // description the backend can pattern-match — search-first, take the
    // pre-registered match (never "+ Add new", since it already exists).
    await pick(page, row, 'party', party, party);
  } else {
    await page.focus(sel('a'));
    await page.keyboard.press('Enter');
  }
}
async function waitSaved(page, voucher, timeout = 8000) {
  await page.waitForFunction(v => [...document.querySelectorAll('.row[data-saved] .vno')].some(el => el.value === v),
    { timeout }, voucher);
}
async function waitRowError(page, side, timeout = 6000) {
  await page.waitForFunction(s => {
    const rows = [...document.querySelectorAll(`.row.draft[data-side="${s}"]`)];
    return rows.some(r => r.querySelector('.row-err'));
  }, { timeout }, side);
  return page.evaluate(s => {
    const rows = [...document.querySelectorAll(`.row.draft[data-side="${s}"]`)];
    const r = rows.find(x => x.querySelector('.row-err'));
    return r ? r.querySelector('.row-err').textContent : null;
  }, side);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-golden-ui] project ${REF} \u00b7 run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN \u2014 the nf_ migrations are not applied.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN \u2014', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN \u2014 seed assertions failed'); process.exitCode = 2; return; }
  const s = built.ref.sample;   // the golden day, read from the reference file itself
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};

  const awamiBefore = (await q(`select count(*) n from nf_lines where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFUI${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    for (const who of ['D', 'A']) {
      const email = `nf-ui-${who.toLowerCase()}-${run}@zztest-nf.invalid`;
      const password = crypto.randomBytes(18).toString('base64url');
      const r = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
      if (r.status >= 300) throw new Error(`create user ${who}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
      users[who] = { id: r.json.id, email, password };
    }
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values
      ('${C}', '${users.D.id}', 'director', 'UI Test Director', true),
      ('${C}', '${users.A.id}', 'accountant', 'UI Test Accountant', true)`);
    for (const who of ['D', 'A']) {
      const r = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email: users[who].email, password: users[who].password } });
      if (r.status !== 200) throw new Error(`sign-in ${who}: HTTP ${r.status}`);
      users[who].jwt = r.json.access_token;
    }
    // 20260918i: the description fallback only MATCHES an already-
    // registered party, it never mints one — this stands in for an
    // accountant having registered the golden day's real Token Money
    // buyer ahead of time, through whatever channel exists before the
    // real party field ships. Name matches the reference sample's own
    // description text exactly, since that is what nf_resolve_party
    // matches against when the real screen (no party field) is driven.
    const tokenLine = s.in.find(x => x.h === '21100');
    if (tokenLine) {
      await q(`insert into nf_parties (company_id, name, kind, created_by) values
        ('${C}', '${tokenLine.d.replace(/'/g, "''")}', 'customer', '${users.A.id}'::uuid)`);
    }
    console.log('  fixtures: company, seed, 2 users signed in with real passwords\n');

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });

    async function pageFor(who) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // "Failed to load resource: 400/404" is Chrome's own network log for any
      // non-2xx fetch response — it fires for the two refusals this suite
      // deliberately triggers (negative payment, duplicate voucher) even
      // though nf-sheet.js catches both and shows them inline. Real app
      // errors still surface as pageerror or other console.error text.
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
      });
      await injectSession(page, REF, users[who].jwt, users[who].id, users[who].email);
      await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
      // This headless Chrome reports prefers-color-scheme: dark by default,
      // which drove the page dark before either it or the test ever touched
      // the theme toggle (nf.css has its own @media (prefers-color-scheme:
      // dark) rule) — the "light" screenshot was the dark page, and clicking
      // the toggle correctly went TO light, which then read as "failure to
      // reach dark". Pin a known starting scheme so the toggle test means
      // what it says regardless of the host machine's own setting.
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      page.__errors = errors;
      page.__context = context;
      return page;
    }

    // ── director: start the first day with the golden openings ──────────────
    const dirPage = await pageFor('D');
    await dirPage.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await dirPage.waitForSelector('#nf-fd-go', { timeout: 10000 });
    // A native <input type=date> stores an ISO value regardless of display
    // locale; typing raw digits at it depends on the OS's date-segment
    // behaviour and is not reliable under headless automation. Set it directly.
    await dirPage.evaluate(v => {
      var el = document.getElementById('nf-fd-date');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, s.date);
    await setValue(dirPage, '#nf-fd-cno', s.cno);
    for (const [id, via] of [['#nf-fd-cash', 'Cash'], ['#nf-fd-petty', 'Petty'], ['#nf-fd-bank', 'Bank']]) {
      await setValue(dirPage, id, String(s.open[via]));
    }
    const dateEchoed = await dirPage.evaluate(() => document.getElementById('nf-fd-date').value);
    ok('UI-00 date field accepted', dateEchoed === s.date, `got "${dateEchoed}", expected "${s.date}"`);
    await dirPage.click('#nf-fd-go');
    await dirPage.waitForSelector('.pos-grid', { timeout: 10000 });
    ok('UI-01 first day opened', true, '');

    // ── accountant: type the golden day exactly as printed in the book ──────
    const accPage = await pageFor('A');
    await accPage.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await accPage.waitForSelector('.books', { timeout: 10000 });

    for (const r of s.in.filter(r => Number(r.a))) {
      // 21100/21200/21300 require an explicit party on the screen now
      // (20260919i/j) — the pre-registered party below matches the token
      // line's own description exactly, so this is the "pick existing" path.
      const party = ['21100', '21200', '21300'].includes(r.h) ? r.d : undefined;
      await fillDraftRow(accPage, 'IN', r.v, r.d, r.h, r.f, r.m, Number(r.a), party);
      try { await waitSaved(accPage, r.v); ok(`UI-02 saved ${r.v}`, true, ''); }
      catch (e) { ok(`UI-02 saved ${r.v}`, false, await accPage.evaluate(() => document.body.innerText.slice(0, 200))); }
    }
    for (const r of s.out.filter(r => Number(r.a))) {
      await fillDraftRow(accPage, 'OUT', r.v, r.d, r.h, r.f, r.m, Number(r.a));
      try { await waitSaved(accPage, r.v); ok(`UI-02 saved ${r.v}`, true, ''); }
      catch (e) { ok(`UI-02 saved ${r.v}`, false, await accPage.evaluate(() => document.body.innerText.slice(0, 200))); }
    }

    const t0 = Date.now();
    const timeline = [];
    accPage.on('request', req => {
      const u = req.url();
      if (u.includes('/rpc/nf_set_transfers') || u.includes('/rpc/nf_get_day')) {
        timeline.push(`+${Date.now() - t0}ms → ${u.split('/rpc/')[1]} ${req.postData() || ''}`);
      }
    });
    accPage.on('response', async res => {
      const u = res.url();
      if (u.includes('/rpc/nf_set_transfers') || u.includes('/rpc/nf_get_day')) {
        let body = '';
        try { body = (await res.text()).slice(0, 200); } catch (e) { body = 'READ-ERR:' + e.message; }
        timeline.push(`+${Date.now() - t0}ms ← ${u.split('/rpc/')[1].split('?')[0]} HTTP ${res.status()} ${body}`);
      }
    });

    const tBankEl = await accPage.$('#nf-tBank'); await tBankEl.click({ clickCount: 3 }); await tBankEl.type(String(s.tBank));
    await tBankEl.press('Tab');
    await accPage.waitForFunction(() => {
      const el = document.querySelector('#nf-tBank'); return el && el.value.replace(/,/g, '') === '300000';
    }, { timeout: 6000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 700)); // debounced save (500ms)

    // The cash count was removed (owner, 2026-09-21, docs/PLAN.md §44). UI-03b
    // used to wait for the typed count to reach the database; it now waits
    // for the TRANSFER typed just above — the one fact neither client timing
    // nor a client bug can fake — and UI-03c proves the count is really gone.
    async function waitForDbTransfer(timeoutMs) {
      const start = Date.now();
      for (;;) {
        const [row] = await q(`select count(*) n from nf_vouchers where company_id='${C}' and voucher_key like 'XFR-%'`);
        if (row && Number(row.n) > 0) return true;
        if (Date.now() - start > timeoutMs) return false;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    const transferred = await waitForDbTransfer(15000);
    if (!transferred) console.log('  DEBUG timeline:\n    ' + timeline.join('\n    '));
    ok('UI-03b the transfer reached the database', transferred, 'no XFR- voucher after 15s');
    const countGone = await accPage.evaluate(() => ({
      denFields: document.querySelectorAll('[data-den]').length,
      countHeading: [...document.querySelectorAll('.sh h2')].some(h => /cash count/i.test(h.textContent)),
      asCounted: /as counted|Not counted|Cash short|Cash over/.test(document.querySelector('#nf-sheet').innerText),
      transfersStill: !!document.querySelector('#nf-tBank') && !!document.querySelector('#nf-tPetty'),
    }));
    ok('UI-03c the cash count is gone from the sheet; the transfers are still there',
      countGone.denFields === 0 && !countGone.countHeading && !countGone.asCounted && countGone.transfersStill, JSON.stringify(countGone));
    await new Promise(r => setTimeout(r, 600));   // let the client's own refresh() catch up and re-render
    await accPage.waitForSelector('.pos-grid', { timeout: 10000 });

    const totals = await accPage.evaluate(() => {
      const rows = [...document.querySelectorAll('.pos tbody tr')].map(tr => {
        const tds = tr.querySelectorAll('td');
        return { label: tds[0] && tds[0].textContent.trim(), closing: tds[5] && tds[5].textContent.trim() };
      });
      const kClose = document.querySelector('.kpis b') && document.querySelector('.kpis b').textContent.trim();
      const status = document.querySelector('.status span') && document.querySelector('.status span').textContent.trim();
      return { rows, kClose, status };
    });
    console.log('  position:', JSON.stringify(totals));
    ok('UI-03 Cash closes 313,000', totals.rows.some(r => /Cash in hand/.test(r.label) && r.closing === '313,000'), JSON.stringify(totals.rows));
    ok('UI-03 Petty closes 13,500', totals.rows.some(r => /Petty cash/.test(r.label) && r.closing === '13,500'), JSON.stringify(totals.rows));
    ok('UI-03 Bank closes 2,108,960', totals.rows.some(r => /Bank Al-Habib/.test(r.label) && r.closing === '2,108,960'), JSON.stringify(totals.rows));
    ok('UI-03 total closing 2,435,460', totals.kClose === 'Rs 2,435,460', totals.kClose);
    ok('UI-04 status Balanced', totals.status === 'Balanced', totals.status);

    // ── print: one A4 page, filename set on the page's own title ────────────
    await accPage.click('#nf-print');
    await new Promise(r => setTimeout(r, 150));
    const printTitle = await accPage.evaluate(() => document.title);
    ok('UI-05 print title set', /^Awami_Daily_Closing_\d{2}-[A-Za-z]{3}-\d{4}$/.test(printTitle), printTitle);

    // emulateMediaType() and emulateMediaFeatures() share one CDP call under
    // the hood — calling one drops whatever the other had set. Without
    // re-asserting the colour scheme here, print picks up this machine's own
    // dark preference instead of the print stylesheet's forced-light output.
    await accPage.emulateMediaType('print');
    await accPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    const measure = await accPage.evaluate(() => {
      const s = document.querySelector('.sheet');
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return {
        docScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        sheetRectHeight: r.height, sheetOffsetTop: s.offsetTop,
        sheetZoom: cs.zoom, sheetMarginTop: cs.marginTop, sheetMarginBottom: cs.marginBottom,
        sheetLastChild: s.lastElementChild ? s.lastElementChild.className : null,
        docfootRect: document.querySelector('.docfoot') ? document.querySelector('.docfoot').getBoundingClientRect() : null,
      };
    });
    console.log('  DEBUG print measurements:', JSON.stringify(measure));
    // A4 = 297mm tall; @page margin is 9mm top+bottom → ~279mm printable ≈ 1055px at 96dpi.
    console.log('  DEBUG A4 printable height ≈ 1055px (297mm − 18mm margin, at 96dpi)');
    const pdfBuf = await accPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pdfPath = path.join(OUT, `golden-day-${run}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuf);
    const pages = countPdfPages(pdfBuf);
    if (pages !== 1) {
      // A screenshot of the LIVE page under emulateMediaType('print') is not
      // trustworthy evidence — the same "one emulation call drops the other"
      // behaviour already caught once (see the colour-scheme fix above) means
      // it may not be showing print styles at all. Render the ACTUAL PDF
      // bytes through Chrome's own PDF viewer instead, so what gets read is
      // what a printer would actually receive.
      const printShot = path.join(OUT, `print-overflow-${run}.png`);
      const pdfPage = await browser.newPage();
      await pdfPage.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
      await pdfPage.goto('file:///' + pdfPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 500));
      await pdfPage.screenshot({ path: printShot, fullPage: true });
      await pdfPage.close();
      console.log('  print layout at fault, saved to', path.relative(ROOT, printShot));
    }
    ok('UI-06 print is one A4 page', pages === 1, `counted ${pages} page(s) \u2014 saved to ${path.relative(ROOT, pdfPath)}`);
    await accPage.emulateMediaType('screen');
    await accPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // ── screenshots: light and dark ───────────────────────────────────────
    await accPage.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise(r => setTimeout(r, 300));
    const lightPath = path.join(OUT, 'sheet-light.png');
    await accPage.screenshot({ path: lightPath, fullPage: true });
    ok('UI-07 light screenshot', fs.existsSync(lightPath) && fs.statSync(lightPath).size > 1000, lightPath);

    await accPage.click('#nf-theme');
    await new Promise(r => setTimeout(r, 250));
    const themeAttr = await accPage.evaluate(() => document.documentElement.dataset.theme);
    ok('UI-08 theme toggled to dark', themeAttr === 'dark', themeAttr);
    const darkPath = path.join(OUT, 'sheet-dark.png');
    await accPage.screenshot({ path: darkPath, fullPage: true });
    ok('UI-08 dark screenshot', fs.existsSync(darkPath) && fs.statSync(darkPath).size > 1000, darkPath);
    await accPage.click('#nf-theme');   // back to light for what follows

    // ── refused: a payment that would take Cash negative ───────────────────
    await fillDraftRow(accPage, 'OUT', 'CPV-901', 'more than the drawer holds', '81300', 'P-W', 'Cash', 999999999);
    let negMsg;
    try { negMsg = await waitRowError(accPage, 'OUT'); ok('UI-09 negative payment refused', /does not have enough money/.test(negMsg || ''), negMsg); }
    catch (e) { ok('UI-09 negative payment refused', false, 'no row-err appeared: ' + e.message); }
    const linesAfterNeg = (await q(`select count(*) n from nf_vouchers where company_id='${C}' and manual_no='CPV-901'`))[0].n;
    ok('UI-09 nothing was written', Number(linesAfterNeg) === 0, `nf_lines rows for CPV-901: ${linesAfterNeg}`);

    // clear that draft row before the next test (click its delete button)
    await accPage.evaluate(s => {
      const row = [...document.querySelectorAll(`.row.draft[data-side="OUT"]`)].find(r => r.querySelector('.row-err'));
      if (row) row.querySelector('[data-del-draft]').click();
    });
    await new Promise(r => setTimeout(r, 200));

    // ── refused: a voucher already used earlier today ───────────────────────
    const reusedVoucher = s.in.filter(r => Number(r.a))[0].v;   // e.g. CRV-001
    // 21100 requires a party on the screen now too — reuse the same
    // pre-registered party so this stays the "pick existing" path and the
    // duplicate-voucher refusal (not a party error) is what's under test.
    await fillDraftRow(accPage, 'IN', reusedVoucher, 'same voucher again', '21100', 'GF', 'Cash', 1, tokenLine ? tokenLine.d : undefined);
    let dupMsg;
    try { dupMsg = await waitRowError(accPage, 'IN'); ok('UI-10 duplicate voucher refused', /already on the books/.test(dupMsg || ''), dupMsg); }
    catch (e) { ok('UI-10 duplicate voucher refused', false, 'no row-err appeared: ' + e.message); }
    const dupCount = (await q(`select count(*) n from nf_vouchers where company_id='${C}' and manual_no='${reusedVoucher.toUpperCase()}'`))[0].n;
    ok('UI-10 still exactly one row for that voucher', Number(dupCount) === 1, `rows: ${dupCount}`);

    // UI-12: the Reports dropdown must be genuinely INVISIBLE until asked for.
    // The owner found it rendering permanently open (2026-09-19): .rpmpanel's
    // `display:flex` outranks the browser's own [hidden]{display:none}, so the
    // attribute close() sets had no visual effect. Every earlier check here
    // asked whether the ATTRIBUTE was present, which stayed true the whole
    // time — so this one measures what a person actually sees instead.
    const menuVis = async () => accPage.evaluate(() => {
      const p = document.querySelector('#nf-rpm-panel');
      if (!p) return null;
      const cs = getComputedStyle(p);
      return { attrHidden: p.hidden, display: cs.display, visible: cs.display !== 'none' && p.getClientRects().length > 0 };
    });
    const atRest = await menuVis();
    ok('UI-12 Reports menu is closed on arrival', atRest && atRest.visible === false, JSON.stringify(atRest));
    await accPage.click('#nf-rpm-toggle');
    const opened = await menuVis();
    ok('UI-12 it opens when clicked', opened && opened.visible === true, JSON.stringify(opened));
    await accPage.click('#nf-rpm-toggle');
    const reclosed = await menuVis();
    ok('UI-12 and closes again when clicked a second time', reclosed && reclosed.visible === false, JSON.stringify(reclosed));

    // UI-13: the letterhead. A missing or mis-pathed logo is the classic
    // silent failure — the <img> is present in the DOM and every structural
    // assertion passes while the header shows a broken-image box. So this
    // checks the thing that actually matters: did the file LOAD
    // (naturalWidth > 0), is it on screen, and does it keep its 4:1 shape
    // rather than being squashed by a leftover square rule. Checked on
    // screen AND under print media, because the report's print stylesheet
    // has its own .mark rule and paper is where this logo matters most.
    const logoState = async (media) => {
      if (media) await accPage.emulateMediaType(media);
      const s = await accPage.evaluate(() => {
        const el = document.querySelector('img.mark');
        if (!el) return { present: false };
        const r = el.getBoundingClientRect();
        return {
          present: true, loaded: el.naturalWidth > 0, src: el.getAttribute('src'),
          natural: el.naturalWidth + 'x' + el.naturalHeight,
          shown: Math.round(r.width) + 'x' + Math.round(r.height),
          ratio: r.height ? +(r.width / r.height).toFixed(2) : 0,
          visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none',
          alt: el.getAttribute('alt'),
        };
      });
      if (media) await accPage.emulateMediaType('screen');
      return s;
    };
    const logoScreen = await logoState(null);
    ok('UI-13 the letterhead logo is present and actually loaded',
      logoScreen.present && logoScreen.loaded && logoScreen.visible, JSON.stringify(logoScreen));
    // the artwork is 4:1; allow a little slack for the dark-theme chip padding
    ok('UI-13 it keeps its shape, not squashed into a square',
      logoScreen.ratio >= 3 && logoScreen.ratio <= 5, JSON.stringify(logoScreen));
    const logoPrint = await logoState('print');
    ok('UI-13 and it survives print, still in shape',
      logoPrint.loaded && logoPrint.visible && logoPrint.ratio >= 3 && logoPrint.ratio <= 5, JSON.stringify(logoPrint));

    // ── §44: a voucher saved WITHOUT its manual number; Close day asks ──────
    // The owner's rule (2026-09-21): the closing is made before the paper
    // voucher is written, so a line saves without its number — but the day
    // does not close until every number is in, and Close day brings those
    // vouchers up to be filled in on the spot.
    const pendRow = s.in.filter(r => Number(r.a)).find(r => r.h !== '21100') || s.in[1];
    await fillDraftRow(accPage, 'IN', '', 'Receipt before its paper voucher', pendRow.h, pendRow.f, 'Cash', 1000);
    let pendingShown = null;
    try {
      await accPage.waitForSelector('.row.vno-pending[data-saved]', { timeout: 8000 });
      pendingShown = await accPage.evaluate(() => {
        const r = document.querySelector('.row.vno-pending[data-saved]');
        return { value: r.querySelector('.vno').value, placeholder: r.querySelector('.vno').placeholder,
                 stored: r.getAttribute('data-vno'), sys: (r.querySelector('.vno-sys') || {}).textContent,
                 note: !!document.querySelector('#nf-pending-note') };
      });
    } catch (e) { pendingShown = { error: e.message }; }
    // two numbers (owner, 2026-09-21): the SYSTEM one is given at save and
    // shown under the field; the MANUAL one is still blank
    ok('UI-14 a receipt saves with NO manual number, but with its system number (CRV-000001 style)',
      pendingShown && pendingShown.value === '' && pendingShown.placeholder === 'Manual no.' && /^CRV-\d{6}$/.test(pendingShown.stored || '')
        && pendingShown.sys === pendingShown.stored && pendingShown.note,
      JSON.stringify(pendingShown));
    await accPage.click('#nf-close');
    let dlg = null;
    try {
      await accPage.waitForSelector('#nf-numbers-dialog .nfn-in', { timeout: 5000 });
      dlg = await accPage.evaluate(() => ({ rows: document.querySelectorAll('#nf-numbers-dialog .nfn-row').length,
        prefill: document.querySelector('#nf-numbers-dialog .nfn-in').value }));
    } catch (e) { dlg = { error: e.message }; }
    const stillOpen = (await q(`select status from nf_days where company_id='${C}' order by business_date desc limit 1`))[0].status;
    ok('UI-15 Close day does not close; it brings up the voucher still missing its manual number', dlg && dlg.rows === 1 && dlg.prefill === '' && stillOpen === 'OPEN',
      JSON.stringify({ dlg, stillOpen }));
    await setValue(accPage, '#nf-numbers-dialog .nfn-in', 'CRV-0777');
    await accPage.click('#nf-numbers-go');
    let closedRow = null;
    for (let i = 0; i < 40; i++) {
      [closedRow] = await q(`select d.status, (select count(*)::int from nf_vouchers v where v.company_id=d.company_id and v.manual_no='CRV-0777') pend
                              from nf_days d where d.company_id='${C}' order by d.business_date desc limit 1`);
      if (closedRow && closedRow.status === 'CLOSED') break;
      await new Promise(r => setTimeout(r, 250));
    }
    ok('UI-16 typing the number there saves it and closes the day', closedRow && closedRow.status === 'CLOSED' && closedRow.pend === 1,
      JSON.stringify(closedRow));

    ok('UI-11 no console/page errors', dirPage.__errors.length === 0 && accPage.__errors.length === 0,
      JSON.stringify(dirPage.__errors.concat(accPage.__errors)));

    await dirPage.__context.close();
    await accPage.__context.close();
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();

    console.log('\n\u2500\u2500 cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    for (const who of Object.keys(users)) {
      if (!users[who] || !users[who].id) continue;
      const r = await http_('DELETE', `/auth/v1/admin/users/${users[who].id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user ${who}: HTTP ${r.status}`);
    }
    const ids = Object.values(users).filter(u => u && u.id).map(u => `'${u.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    const [left] = await q(`select json_build_object(
        'company', (select count(*) from companies where id = '${C}' or company_name = '${companyName}'),
        'auth_users', (select count(*) from auth.users where id in (${ids})),
        'nf_rows', (select count(*) from nf_members where company_id='${C}') + (select count(*) from nf_days where company_id='${C}')
                 + (select count(*) from nf_lines where company_id='${C}') + (select count(*) from nf_accounts where company_id='${C}')) j`);
    console.log(`  verified by query: ${JSON.stringify(left.j)}`);
    ok('CLEANUP', left.j.company === 0 && left.j.auth_users === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));

    const awamiAfter = (await q(`select count(*) n from nf_lines where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} \u2192 ${awamiAfter}`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks \u00b7 ${results.length - failed.length} passed \u00b7 ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
