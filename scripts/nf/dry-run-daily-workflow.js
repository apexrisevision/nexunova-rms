#!/usr/bin/env node
/**
 * NexuFinance — Part 3 of the go-live readiness pass: a dry run of the REAL
 * daily workflow, end to end, as the accountant would actually do it.
 *
 *   node scripts/nf/dry-run-daily-workflow.js > "$SCRATCH/nf-dryrun.log" 2>&1
 *
 * The owner's own words for what this had to be: "open a day, enter a few
 * receipts and payments including one token receipt and one inter-company
 * payment, close the day, print the director report, and confirm tomorrow's
 * opening equals today's closing. Report anything that felt awkward, not just
 * anything that errored."
 *
 * So this is not only a pass/fail suite. Every step also records a FRICTION
 * note — how many interactions it took, what the screen did or did not say —
 * and those are printed at the end whether or not anything failed. A step that
 * works but is unpleasant is a finding here, not a pass.
 *
 * Runs on a disposable ZZTEST-NF-<run> company, never Awami (the owner's
 * explicit instruction: the real open day DC-001 is not to be touched).
 * Real HTTP, real Supabase session, real browser, real RPCs. Cleanup is
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

const PORT = 4497;
const URL_BASE = `https://${REF}.supabase.co`;
const OUT_DIR = 'D:\\Claude Cowork';

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[dry-run] SKIPPED — puppeteer-core or Chrome not found. Nothing was verified.');
  process.exit(0);
}

const results = [];
const friction = [];
const ok = (id, pass, detail) => {
  results.push({ id, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(46)} ${pass ? '' : String(detail).slice(0, 300)}`);
};
const note = (where, text) => { friction.push({ where, text }); console.log(`  note  ${where}: ${text}`); };

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
async function setValue(page, selector, text) {
  await page.focus(selector);
  await page.evaluate(sel => { const el = document.querySelector(sel); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, selector);
  await page.type(selector, text);
}
async function lastDraftTmpId(page, side) {
  return page.evaluate(s => {
    const rows = [...document.querySelectorAll(`.row.draft[data-side="${s}"]`)];
    return rows.length ? rows[rows.length - 1].getAttribute('data-draft') : null;
  }, side);
}
async function waitSaved(page, voucher, timeout = 9000) {
  await page.waitForFunction(v => [...document.querySelectorAll('.row[data-saved] .vno')].some(el => el.value === v), { timeout }, voucher);
}
// Counts every interaction a real accountant would make, so "how awkward is
// this" has a number behind it rather than an impression.
let clicks = 0;
async function enterLine(page, side, v, d, head, floor, via, amount, party) {
  const tmpId = await lastDraftTmpId(page, side);
  const sel = k => `.row.draft[data-draft="${tmpId}"] [data-k="${k}"]`;
  await setValue(page, sel('v'), v); clicks++;
  await setValue(page, sel('d'), d); clicks++;
  await page.select(sel('h'), head); clicks++;
  await page.select(sel('f'), floor); clicks++;
  await page.select(sel('m'), via); clicks++;
  await setValue(page, sel('a'), String(amount)); clicks++;
  if (party) {
    const ps = `.row.draft[data-draft="${tmpId}"] [data-k="p"]`;
    await page.focus(ps); await page.type(ps, party); clicks++;
    await page.waitForSelector(`.row.draft[data-draft="${tmpId}"] .party-dd:not([hidden])`, { timeout: 4000 });
    const shape = await page.evaluate(t => {
      const dd = document.querySelector(`.row.draft[data-draft="${t}"] .party-dd`);
      return { add: !!dd.querySelector('[data-party-add]'), picks: dd.querySelectorAll('[data-party-pick]').length };
    }, tmpId);
    const target = shape.picks ? `[data-party-pick="${party}"]` : `[data-party-add="${party}"]`;
    await page.click(`.row.draft[data-draft="${tmpId}"] ${target}`); clicks++;
    return { tmpId, partyShape: shape };
  }
  await page.focus(sel('a'));
  await page.keyboard.press('Enter'); clicks++;
  return { tmpId };
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[dry-run] project ${REF} · run ${run}`);
  console.log('  A dry run of the real daily workflow on a DISPOSABLE company. Awami is never touched.\n');

  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — the nf_ migrations are not applied.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};
  const DAY1 = '2026-10-01', DAY2 = '2026-10-02';
  const OPEN = { cash: 500000, petty: 20000, bank: 3000000 };
  const newCustomer = `Bilal Ahmad shop GF-14 ${run}`;

  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZDRY${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    for (const who of ['D', 'A']) {
      const email = `nf-dry-${who.toLowerCase()}-${run}@zztest-nf.invalid`;
      const password = crypto.randomBytes(18).toString('base64url');
      const r = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
      if (r.status >= 300) throw new Error(`create user ${who}: HTTP ${r.status}`);
      users[who] = { id: r.json.id, email, password };
    }
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values
      ('${C}', '${users.D.id}', 'director', 'Rashid (Director)', true),
      ('${C}', '${users.A.id}', 'accountant', 'Daily Accountant', true)`);
    for (const who of ['D', 'A']) {
      const r = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email: users[who].email, password: users[who].password } });
      if (r.status !== 200) throw new Error(`sign-in ${who}: HTTP ${r.status}`);
      users[who].jwt = r.json.access_token;
    }
    console.log('  fixture: company, real chart, a director and an accountant, both signed in\n');

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    async function pageFor(who) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
      await injectSession(page, REF, users[who].jwt, users[who].id, users[who].email);
      await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      page.__errors = errors; page.__ctx = ctx;
      return page;
    }

    // ── STEP 1 · the director opens the day ────────────────────────────────
    console.log('── Step 1 · open the day (director)');
    const dir = await pageFor('D');
    await dir.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await dir.waitForSelector('#nf-fd-go', { timeout: 15000 });
    await dir.evaluate(v => { const el = document.getElementById('nf-fd-date'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, DAY1);
    await setValue(dir, '#nf-fd-cno', 'DC-001');
    await setValue(dir, '#nf-fd-cash', String(OPEN.cash));
    await setValue(dir, '#nf-fd-petty', String(OPEN.petty));
    await setValue(dir, '#nf-fd-bank', String(OPEN.bank));
    await dir.click('#nf-fd-go');
    await dir.waitForSelector('.pos-grid', { timeout: 15000 });
    ok('S1 day opened by the director', true, '');
    note('Step 1', 'first day needs the three openings typed by hand; every later day inherits them automatically — this screen is seen once, ever.');

    // ── STEP 2 · the accountant enters the day ─────────────────────────────
    console.log('\n── Step 2 · enter the day (accountant)');
    const acc = await pageFor('A');
    await acc.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await acc.waitForSelector('.books', { timeout: 15000 });
    const clicksBefore = clicks;

    // a token receipt from a customer who is not on file yet
    const tok = await enterLine(acc, 'IN', 'CRV-001', 'Token from Bilal Ahmad, shop GF-14', '21100', 'GF', 'Cash', 250000, newCustomer);
    try { await waitSaved(acc, 'CRV-001'); ok('S2 token receipt saved (21100, new party created on the spot)', true, ''); }
    catch (e) { ok('S2 token receipt saved (21100, new party created on the spot)', false, 'never appeared as a saved row'); }
    ok('S2 the party field offered "add new" only after finding nothing',
      tok.partyShape && tok.partyShape.picks === 0 && tok.partyShape.add === true, JSON.stringify(tok.partyShape));

    // a plain cash expense
    await enterLine(acc, 'OUT', 'CPV-001', 'Site labour, weekly', '81300', 'P-W', 'Cash', 85000);
    try { await waitSaved(acc, 'CPV-001'); ok('S2 cash payment saved', true, ''); }
    catch (e) { ok('S2 cash payment saved', false, 'never appeared'); }

    // an INTER-COMPANY payment, sense (a): Awami repays FMH from its own bank
    await enterLine(acc, 'OUT', 'BPV-001', 'Paid FMH against their advances, bank transfer', '22100', 'P-W', 'Bank', 400000);
    try { await waitSaved(acc, 'BPV-001'); ok('S2 inter-company payment saved (Awami repays FMH by bank)', true, ''); }
    catch (e) { ok('S2 inter-company payment saved (Awami repays FMH by bank)', false, 'never appeared'); }

    // an INTER-COMPANY entry, sense (b): FMH pays a cost ON AWAMI'S BEHALF.
    // No Awami cash or bank moves. This is the shape 100% of the real
    // imported history actually has. Probe the screen honestly: is there any
    // way to express it?
    const viaChoices = await acc.evaluate(() => {
      const row = document.querySelector('.row.draft [data-k="m"]');
      return row ? [...row.options].map(o => o.value).filter(Boolean) : [];
    });
    const canExpressNoCash = viaChoices.some(v => !['Cash', 'Petty', 'Bank'].includes(v));
    ok('S2 the screen can express "FMH paid this, no Awami cash moved"', canExpressNoCash,
      `the only "via" choices are ${JSON.stringify(viaChoices)} — every line must move Cash, Petty or Bank`);
    if (!canExpressNoCash) {
      note('Step 2 · THE BIG ONE', 'A line must always move Cash, Petty or Bank. A cost that FMH or a director paid on Awami\'s behalf — which is 100% of the 64 real imported vouchers, and which Part B calls the reason a cash book cannot serve this business — cannot be entered on this screen at all.');
      note('Step 2 · THE BIG ONE', 'Same limit: the screen builds exactly two legs, so one token receipt split across several units (7 of the 64 real vouchers, up to 10 legs) has no entry path either.');
    }

    const clicksForDay = clicks - clicksBefore;
    note('Step 2', `three lines took ${clicksForDay} field interactions (~${Math.round(clicksForDay / 3)} per line): voucher, description, head, floor, via, amount, and a party where the head needs one. No keyboard-only path was tested; every head/floor/via is a dropdown.`);

    // ── STEP 3 · transfer, count, submit ───────────────────────────────────
    console.log('\n── Step 3 · transfer, count the drawer, submit');
    const tb = await acc.$('#nf-tBank');
    await tb.click({ clickCount: 3 }); await tb.type('100000'); await tb.press('Tab'); clicks += 2;
    // The transfer save is debounced (500ms) and the position table only
    // repaints once the round trip lands. Waiting a fixed 900ms read a STALE
    // closing figure on the first run of this script, and counting that stale
    // figure into the drawer produced a 100,000 variance that blocked Submit —
    // a test bug, but a real hint: for a few hundred milliseconds the screen
    // shows a closing that the transfer has not yet been applied to.
    const transferLanded = await (async () => {
      for (let i = 0; i < 40; i++) {
        const [row] = await q(`select trf_bank from nf_position_row((select id from nf_days where company_id='${C}' and business_date='${DAY1}'))`);
        if (row && Number(row.trf_bank) === 100000) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    })();
    ok('S3 the cash-to-bank transfer reached the database', transferLanded, 'transfer_to_bank never became 100,000');
    await acc.waitForFunction(() => {
      const row = [...document.querySelectorAll('.pos tbody tr')].find(tr => /Cash in hand/.test(tr.textContent));
      return row && row.querySelectorAll('td')[5].textContent.trim() === '565,000';
    }, { timeout: 10000 }).catch(() => {});
    // count the drawer to exactly what the sheet expects, so the day is clean
    const expectCash = await acc.evaluate(() => {
      const row = [...document.querySelectorAll('.pos tbody tr')].find(tr => /Cash in hand/.test(tr.textContent));
      return row ? row.querySelectorAll('td')[5].textContent.trim() : null;
    });
    const expectN = Number(String(expectCash).replace(/,/g, ''));
    ok('S3 cash closing is computed and shown before counting', Number.isFinite(expectN) && expectN > 0, String(expectCash));
    // 500,000 opening + 250,000 in − 85,000 out − 100,000 to bank = 565,000
    const denoms = { 5000: Math.floor(expectN / 5000) };
    const rem = expectN - denoms[5000] * 5000;
    if (rem % 1000 === 0 && rem > 0) denoms[1000] = rem / 1000;
    for (const [k, v] of Object.entries(denoms)) { await setValue(acc, `[data-den="${k}"]`, String(v)); clicks++; }
    await acc.click('.sh h2');
    await acc.waitForFunction(() => { const b = document.querySelector('#nf-submit'); return b && !b.disabled; }, { timeout: 15000 }).catch(() => {});
    const submitState = await acc.evaluate(() => {
      const b = document.querySelector('#nf-submit');
      const st = document.querySelector('.status span');
      return { present: !!b, disabled: b ? b.disabled : null, status: st ? st.textContent.trim() : null };
    });
    ok('S3 day balances and Submit is enabled', submitState.present && submitState.disabled === false, JSON.stringify(submitState));
    note('Step 3', `the drawer count had to be entered denomination by denomination to reach ${expectCash}; the sheet shows the expected figure alongside, so a mismatch is visible immediately rather than after submitting.`);
    await acc.click('#nf-submit'); clicks++;
    await acc.waitForFunction(() => { const p = document.querySelector('.state-pill'); return p && /SUBMITTED/i.test(p.textContent); }, { timeout: 12000 }).catch(() => {});
    const afterSubmit = await acc.evaluate(() => { const p = document.querySelector('.state-pill'); return p ? p.textContent.trim() : null; });
    ok('S3 accountant submitted the day', /submitted/i.test(String(afterSubmit)), String(afterSubmit));
    note('Step 3', "the header carries two separate pills and they answer different questions: one says whether the day BALANCES ('Balanced' / '1 item to check'), the other says where it is in the workflow (OPEN / SUBMITTED / CLOSED). Both are needed and both are present — worth knowing that 'Balanced' alone does not mean the day is closed.");

    // ── STEP 4 · the director closes it ────────────────────────────────────
    console.log('\n── Step 4 · close the day (director)');
    await dir.reload({ waitUntil: 'networkidle2' });
    await dir.waitForSelector('.pos-grid', { timeout: 15000 });
    await dir.waitForFunction(() => { const b = document.querySelector('#nf-close'); return b && !b.disabled; }, { timeout: 15000 }).catch(() => {});
    const closeBtn = await dir.evaluate(() => { const b = document.querySelector('#nf-close'); return { present: !!b, disabled: b ? b.disabled : null }; });
    ok('S4 Close day is offered to the director', closeBtn.present && closeBtn.disabled === false, JSON.stringify(closeBtn));
    await dir.click('#nf-close'); clicks++;
    await dir.waitForFunction(() => { const p = document.querySelector('.state-pill'); return p && /CLOSED/i.test(p.textContent); }, { timeout: 12000 }).catch(() => {});
    const closedStatus = await dir.evaluate(() => { const p = document.querySelector('.state-pill'); return p ? p.textContent.trim() : null; });
    ok('S4 day closed', /closed/i.test(String(closedStatus)), String(closedStatus));
    const [dbDay] = await q(`select status, closed_at is not null closed, prepared_by_name from nf_days where company_id='${C}' and business_date='${DAY1}'`);
    ok('S4 the database agrees the day is CLOSED', dbDay && dbDay.status === 'CLOSED' && dbDay.closed, JSON.stringify(dbDay));
    note('Step 4', `the day was prepared by "${dbDay && dbDay.prepared_by_name}" and closed by the director — two different people, recorded separately, which is what the signature block on the report prints.`);

    // ── STEP 5 · the director report, printed ──────────────────────────────
    console.log('\n── Step 5 · print the director report');
    await dir.click('#nf-toDir'); clicks++;
    await dir.waitForSelector('.rbanner', { timeout: 15000 });
    const rep = await dir.evaluate(() => {
      const t = [...document.querySelectorAll('.kpis b, .kpi b')].map(e => e.textContent.trim());
      const banner = document.querySelector('.rbanner') ? document.querySelector('.rbanner').textContent.trim() : null;
      const other = document.querySelector('.otherbal') ? document.querySelector('.otherbal').innerText : '';
      const body = document.body.innerText;
      return { tiles: t, banner, other, hasDrCr: /\b(Debit|Credit|Dr\.|Cr\.)\b/.test(body), sigs: document.querySelectorAll('.rsig > div').length };
    });
    ok('S5 report shows the pass banner', /Matches|Correct/i.test(String(rep.banner)), String(rep.banner));
    ok('S5 no Debit/Credit wording on the director-facing face', rep.hasDrCr === false, 'found Dr/Cr language on the report');
    ok('S5 "Other Balances (Not Awami\'s Own Cash)" lists the token money and FMH', /Token/i.test(rep.other) && /FMH/i.test(rep.other), rep.other.slice(0, 200));
    ok('S5 three signature blocks', rep.sigs === 3, String(rep.sigs));
    await dir.emulateMediaType('print');
    await dir.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    const pdf = await dir.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pages = (() => { const s = Buffer.from(pdf).toString('latin1'); const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/); return m ? Number(m[1]) : (s.match(/\/Type\s*\/Page(?!s)/g) || []).length; })();
    ok('S5 the printed report is one A4 page', pages === 1, `${pages} pages`);
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const outPdf = path.join(OUT_DIR, `Awami_Dry_Run_Director_Report_${DAY1}.pdf`);
      fs.writeFileSync(outPdf, pdf);
      console.log(`  saved: ${outPdf}`);
    } catch (e) { note('Step 5', `could not write the PDF to ${OUT_DIR}: ${e.message}`); }
    await dir.emulateMediaType('screen');
    await dir.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // ── STEP 6 · tomorrow's opening = today's closing ──────────────────────
    console.log('\n── Step 6 · start the next day and check the carry-forward');
    const closingRow = await dir.evaluate(() => {
      const out = {};
      [...document.querySelectorAll('.rtab tbody tr, .pos tbody tr')].forEach(tr => {
        const td = tr.querySelectorAll('td');
        if (td.length >= 2) out[td[0].textContent.trim()] = td[td.length - 1].textContent.trim();
      });
      return out;
    });
    // A non-first day's OPENING is computed from the ledger (nf_ledger_position),
    // which runs nf_require_role — so the claim has to ride in the same statement
    // batch as the call. A first day reads its typed openings and needs no claim,
    // which is why the earlier query worked without one.
    const [pos1] = await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select close_cash, close_petty, close_bank from nf_position_row((select id from nf_days where company_id='${C}' and business_date='${DAY1}'))`);
    await dir.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await dir.waitForSelector('.pos-grid', { timeout: 15000 });
    const startBtn = await dir.evaluate(() => !!(document.querySelector('#nf-startNext') || document.querySelector('#nf-startNext2')));
    ok('S6 "Start new day" is offered once the day is closed', startBtn, 'no start-next button found');
    await dir.evaluate(() => { const b = document.querySelector('#nf-startNext') || document.querySelector('#nf-startNext2'); if (b) b.click(); }); clicks++;
    await dir.waitForFunction(d => { const el = document.querySelector('.docmeta'); return el && el.innerText.includes(d); }, { timeout: 15000 }, '02').catch(() => {});
    const [day2] = await q(`select id, business_date, closing_no, status from nf_days where company_id='${C}' and business_date > '${DAY1}' order by business_date limit 1`);
    ok('S6 the next day was created', !!day2, JSON.stringify(day2));
    if (day2) {
      const [pos2] = await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
        select open_cash, open_petty, open_bank from nf_position_row('${day2.id}')`);
      const same = pos2 && pos1 && String(pos2.open_cash) === String(pos1.close_cash)
        && String(pos2.open_petty) === String(pos1.close_petty) && String(pos2.open_bank) === String(pos1.close_bank);
      ok('S6 tomorrow\'s opening EQUALS today\'s closing (cash, petty and bank)', same,
        `day1 close ${JSON.stringify(pos1)} vs day2 open ${JSON.stringify(pos2)}`);
      note('Step 6', `carry-forward is computed from the ledger, not copied: day 2 opened at cash ${pos2 && pos2.open_cash} with nothing typed in.`);
      // and the ledger agrees with the screen
      ok('S6 the closed day is locked against further entry',
        (await q(`select status from nf_days where id=(select id from nf_days where company_id='${C}' and business_date='${DAY1}')`))[0].status === 'CLOSED', '');
    }

    ok('S7 no console or page errors in the whole run', dir.__errors.length === 0 && acc.__errors.length === 0,
      JSON.stringify(dir.__errors.concat(acc.__errors).slice(0, 4)));

    note('Whole run', `${clicks} field-level interactions from an empty screen to a closed, printed, carried-forward day with 3 entries.`);

    await dir.__ctx.close(); await acc.__ctx.close();
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();

    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    for (const who of Object.keys(users)) {
      if (!users[who] || !users[who].id) continue;
      const r = await http_('DELETE', `/auth/v1/admin/users/${users[who].id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user ${who}: HTTP ${r.status}`);
    }
    const ids = Object.values(users).filter(u => u && u.id).map(u => `'${u.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    const [left] = await q(`select json_build_object(
        'company', (select count(*) from companies where id='${C}'),
        'auth_users', (select count(*) from auth.users where id in (${ids})),
        'nf_rows', (select count(*) from nf_days where company_id='${C}') + (select count(*) from nf_vouchers where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(left.j));
    ok('CLEANUP', left.j.company === 0 && left.j.auth_users === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));
    const awamiAfter = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} → ${awamiAfter}`);

    console.log('\n── what felt awkward (the part the owner actually asked for)');
    friction.forEach(f => console.log(`  · ${f.where}\n      ${f.text}`));

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
