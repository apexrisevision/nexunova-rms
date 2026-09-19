#!/usr/bin/env node
/**
 * NexuFinance v1 — party field on the daily-closing sheet, driven for real.
 *
 *   node scripts/nf/verify-nf-party-field.js > "$SCRATCH/nf-party-field.log" 2>&1
 *
 * Tests the owner's own design requirement for the party field (20260919i/j):
 * search matches existing parties first, "add new" only appears once a
 * search has visibly returned nothing, and a genuinely new party created
 * from the screen is a real nf_parties row — same table, same resolve path
 * (nf_resolve_party / nf_create_party) as every other party in the system.
 *
 * Same technique as verify-nf-golden-ui.js: a fresh ZZTEST-NF-<run> company,
 * real HTTP, real Supabase session, headless Chrome. Awami is never touched;
 * cleanup is verified by query, always, even on failure.
 *
 * Covers:
 *   PF-01  existing party ("Existing") shows the seeded match, no "add new"
 *   PF-02  picking it (mousedown, not click) saves the line against that
 *          party's real id — not a new one
 *   PF-03  a genuinely new name shows ONLY "+ Add new party", no stale match
 *   PF-04  picking "add new" creates a real nf_parties row and the saved
 *          line's party_id points to it
 *   PF-05  editing an already-SAVED line's party (the p:'party_name' wiring
 *          fix) updates party_id through the same dropdown
 *   PF-06  an empty party field shows a browse list, never "add new"
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
const PORT = 4489;
const URL_BASE = `https://${REF}.supabase.co`;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[verify-nf-party-field] SKIPPED \u2014 puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

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
  await page.evaluate(sel => {
    var el = document.querySelector(sel);
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector);
  await page.type(selector, text);
}
async function lastDraftTmpId(page, side) {
  return page.evaluate(s => {
    const rows = [...document.querySelectorAll(`.row.draft[data-side="${s}"]`)];
    return rows.length ? rows[rows.length - 1].getAttribute('data-draft') : null;
  }, side);
}
async function waitSaved(page, voucher, timeout = 8000) {
  await page.waitForFunction(v => [...document.querySelectorAll('.row[data-saved] .vno')].some(el => el.value === v),
    { timeout }, voucher);
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-party-field] project ${REF} \u00b7 run ${run}`);

  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN \u2014 the nf_ migrations are not applied.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN \u2014', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN \u2014 seed assertions failed'); process.exitCode = 2; return; }
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};
  const existingPartyName = `Existing Test Party ${run}`;
  const newPartyName = `Brand New Fixture Party ${run}`;
  const secondExistingParty = `Second Existing Party ${run}`;

  const awamiBefore = (await q(`select count(*) n from nf_lines where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFPF${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    for (const who of ['D', 'A']) {
      const email = `nf-pf-${who.toLowerCase()}-${run}@zztest-nf.invalid`;
      const password = crypto.randomBytes(18).toString('base64url');
      const r = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
      if (r.status >= 300) throw new Error(`create user ${who}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
      users[who] = { id: r.json.id, email, password };
    }
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values
      ('${C}', '${users.D.id}', 'director', 'PF Test Director', true),
      ('${C}', '${users.A.id}', 'accountant', 'PF Test Accountant', true)`);
    for (const who of ['D', 'A']) {
      const r = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email: users[who].email, password: users[who].password } });
      if (r.status !== 200) throw new Error(`sign-in ${who}: HTTP ${r.status}`);
      users[who].jwt = r.json.access_token;
    }
    // Two pre-existing parties, seeded directly — stands in for the parties
    // already on record before today's accountant opens the screen (the
    // real-world case the search-first requirement exists for).
    const existingId = crypto.randomUUID(), secondId = crypto.randomUUID();
    await q(`insert into nf_parties (id, company_id, name, kind, created_by) values
      ('${existingId}', '${C}', '${existingPartyName.replace(/'/g, "''")}', 'customer', '${users.A.id}'::uuid),
      ('${secondId}', '${C}', '${secondExistingParty.replace(/'/g, "''")}', 'customer', '${users.A.id}'::uuid)`);
    console.log('  fixtures: company, seed, 2 users, 2 pre-existing parties\n');

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });

    async function pageFor(who) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
      });
      await injectSession(page, REF, users[who].jwt, users[who].id, users[who].email);
      await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      page.__errors = errors;
      page.__context = context;
      return page;
    }

    // ── director: open the first day (openings don't matter for this test) ──
    const dirPage = await pageFor('D');
    await dirPage.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await dirPage.waitForSelector('#nf-fd-go', { timeout: 10000 });
    const today = new Date().toISOString().slice(0, 10);
    await dirPage.evaluate(v => {
      var el = document.getElementById('nf-fd-date');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, today);
    await setValue(dirPage, '#nf-fd-cno', '1');
    for (const id of ['#nf-fd-cash', '#nf-fd-petty', '#nf-fd-bank']) await setValue(dirPage, id, '0');
    await dirPage.click('#nf-fd-go');
    await dirPage.waitForSelector('.pos-grid', { timeout: 10000 });
    ok('PF-00 first day opened', true, '');

    // ── accountant: the party field itself ──────────────────────────────────
    const accPage = await pageFor('A');
    await accPage.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await accPage.waitForSelector('.books', { timeout: 10000 });

    accPage.on('response', async res => {
      const u = res.url();
      if (u.includes('/rpc/nf_save_line')) {
        let body = ''; try { body = (await res.text()).slice(0, 400); } catch (e) { body = 'READ-ERR:' + e.message; }
        console.log(`  DEBUG nf_save_line ← HTTP ${res.status()} ${body}`);
      }
    });

    // PF-06: an empty party field on a fresh draft row shows a browse list
    // (both seeded parties), never "+ Add new" — "add new" only after a
    // search has visibly returned nothing, never as the easy first action.
    let tmpId = await lastDraftTmpId(accPage, 'IN');
    let sel = k => `.row.draft[data-draft="${tmpId}"] [data-k="${k}"]`;
    await setValue(accPage, sel('v'), 'CRV-PF1');
    await setValue(accPage, sel('d'), 'party field test — pick existing');
    await accPage.select(sel('h'), '21100');
    await accPage.select(sel('f'), 'GF');
    await accPage.select(sel('m'), 'Cash');
    await setValue(accPage, sel('a'), '5000');
    // NOT re-resolved here: filling in v/h/f/m already made ensureTrailingBlank
    // append a fresh blank row behind this one, so "last draft row" now means
    // THAT one, not ours — the tmpId captured before any of this started is
    // still this exact row (tmpIds survive a redraw; only "last" drifts).
    const partySel = `.row.draft[data-draft="${tmpId}"] [data-k="p"]`;
    await accPage.focus(partySel);
    await new Promise(r => setTimeout(r, 50));
    await accPage.waitForSelector(`.row.draft[data-draft="${tmpId}"] .party-dd:not([hidden])`, { timeout: 4000 });
    const browseState = await accPage.evaluate(t => {
      const dd = document.querySelector(`.row.draft[data-draft="${t}"] .party-dd`);
      return { hasAdd: !!dd.querySelector('.party-add'), optCount: dd.querySelectorAll('.party-opt').length };
    }, tmpId);
    ok('PF-06 empty field shows browse list, no add-new', !browseState.hasAdd && browseState.optCount >= 2, JSON.stringify(browseState));

    // PF-01/02: type a partial match of the existing party, expect it (and
    // only it — no "add new") in the dropdown, pick it via mousedown.
    await accPage.type(partySel, 'Existing Test Party');
    await accPage.waitForSelector(`.row.draft[data-draft="${tmpId}"] .party-dd:not([hidden])`, { timeout: 4000 });
    const matchState = await accPage.evaluate(t => {
      const dd = document.querySelector(`.row.draft[data-draft="${t}"] .party-dd`);
      return { hasAdd: !!dd.querySelector('.party-add'), opts: [...dd.querySelectorAll('[data-party-pick]')].map(e => e.getAttribute('data-party-pick')) };
    }, tmpId);
    ok('PF-01 existing party matched, no add-new offered', !matchState.hasAdd && matchState.opts.includes(existingPartyName), JSON.stringify(matchState));

    const pickSel = `.row.draft[data-draft="${tmpId}"] [data-party-pick="${existingPartyName}"]`;
    await accPage.click(pickSel);
    await new Promise(r => setTimeout(r, 100));
    const postClick = await accPage.evaluate(t => {
      const wrap = document.querySelector(`.row.draft[data-draft="${t}"] [data-party-wrap]`);
      const inp = wrap ? wrap.querySelector('[data-k="p"]') : null;
      const dd = wrap ? wrap.querySelector('.party-dd') : null;
      return { found: !!wrap, inputValue: inp ? inp.value : null, ddHidden: dd ? dd.hidden : null };
    }, tmpId);
    console.log('  DEBUG postClick', JSON.stringify(postClick));
    try { await waitSaved(accPage, 'CRV-PF1'); ok('PF-02 line with existing party saved', true, ''); }
    catch (e) { ok('PF-02 line with existing party saved', false, await accPage.evaluate(t => { const row = document.querySelector(`.row.draft[data-draft="${t}"]`); const el = row && row.querySelector('.row-err'); const p = row && row.querySelector('[data-k="p"]'); return el ? el.textContent : 'no row-err; row found=' + !!row + ' party value=' + (p ? p.value : null); }, tmpId)); }

    const [row1] = await q(`select vl.party_id, p.name from nf_lines l join public.nf_voucher_legs vl on vl.id = l.id
                              join public.nf_parties p on p.id = vl.party_id where l.company_id='${C}' and l.voucher_no='CRV-PF1'`);
    ok('PF-02 party_id points at the EXISTING party (no duplicate)', row1 && row1.name === existingPartyName, JSON.stringify(row1));
    const dupCount1 = (await q(`select count(*) n from nf_parties where company_id='${C}' and name='${existingPartyName.replace(/'/g, "''")}'`))[0].n;
    ok('PF-02 still exactly one party row with that name', Number(dupCount1) === 1, `rows: ${dupCount1}`);

    // PF-03/04: a genuinely new name — no existing match, "+ Add new" only.
    await accPage.click('button.add[data-side="IN"]');
    await new Promise(r => setTimeout(r, 100));
    tmpId = await lastDraftTmpId(accPage, 'IN');
    sel = k => `.row.draft[data-draft="${tmpId}"] [data-k="${k}"]`;
    await setValue(accPage, sel('v'), 'CRV-PF2');
    await setValue(accPage, sel('d'), 'party field test — create new');
    await accPage.select(sel('h'), '21100');
    await accPage.select(sel('f'), 'GF');
    await accPage.select(sel('m'), 'Cash');
    await setValue(accPage, sel('a'), '7500');
    const partySel2 = `.row.draft[data-draft="${tmpId}"] [data-k="p"]`;
    await accPage.focus(partySel2);
    await accPage.type(partySel2, newPartyName);
    await accPage.waitForSelector(`.row.draft[data-draft="${tmpId}"] .party-dd:not([hidden])`, { timeout: 4000 });
    const newState = await accPage.evaluate(t => {
      const dd = document.querySelector(`.row.draft[data-draft="${t}"] .party-dd`);
      return { addEl: dd.querySelector('[data-party-add]') ? dd.querySelector('[data-party-add]').getAttribute('data-party-add') : null, pickCount: dd.querySelectorAll('[data-party-pick]').length };
    }, tmpId);
    ok('PF-03 unmatched name offers ONLY add-new', newState.pickCount === 0 && newState.addEl === newPartyName, JSON.stringify(newState));

    const addSel = `.row.draft[data-draft="${tmpId}"] [data-party-add="${newPartyName}"]`;
    await accPage.click(addSel);
    try { await waitSaved(accPage, 'CRV-PF2'); ok('PF-04 line with new party saved', true, ''); }
    catch (e) { ok('PF-04 line with new party saved', false, await accPage.evaluate(() => { const el = document.querySelector('.row-err'); return el ? el.textContent : 'no row-err'; })); }

    const [newParty] = await q(`select id, name, kind from public.nf_parties where company_id='${C}' and name='${newPartyName.replace(/'/g, "''")}'`);
    ok('PF-04 a real nf_parties row was created', !!newParty, JSON.stringify(newParty));
    const [row2] = await q(`select vl.party_id from nf_lines l join public.nf_voucher_legs vl on vl.id = l.id
                              where l.company_id='${C}' and l.voucher_no='CRV-PF2'`);
    ok('PF-04 saved line points at the new party', row2 && newParty && row2.party_id === newParty.id, JSON.stringify({ row2, newParty }));

    // PF-05: editing an already-SAVED line's party through the same dropdown
    // (the p:'party_name' field-mapping fix).
    await accPage.waitForSelector('.row[data-saved] .vno', { timeout: 8000 });
    const savedSel = await accPage.evaluate(() => {
      const rows = [...document.querySelectorAll('.row[data-saved]')];
      const r = rows.find(x => x.querySelector('.vno').value === 'CRV-PF1');
      return r ? r.getAttribute('data-id') : null;
    });
    ok('PF-05 setup: found the saved CRV-PF1 row', !!savedSel, savedSel);
    if (savedSel) {
      const savedPartySel = `.row[data-saved][data-id="${savedSel}"] [data-k="p"]`;
      await accPage.focus(savedPartySel);
      await accPage.evaluate(sel => { document.querySelector(sel).value = ''; }, savedPartySel);
      await accPage.type(savedPartySel, 'Second Existing Party');
      await accPage.waitForSelector(`.row[data-saved][data-id="${savedSel}"] .party-dd:not([hidden])`, { timeout: 4000 });
      const editPick = `.row[data-saved][data-id="${savedSel}"] [data-party-pick="${secondExistingParty}"]`;
      await accPage.click(editPick);
      await new Promise(r => setTimeout(r, 1200)); // saveSavedLine round-trip + applyDay redraw
      const [row1After] = await q(`select vl.party_id, p.name from nf_lines l join public.nf_voucher_legs vl on vl.id = l.id
                                     join public.nf_parties p on p.id = vl.party_id where l.company_id='${C}' and l.voucher_no='CRV-PF1'`);
      ok('PF-05 saved-row party edit took effect', row1After && row1After.name === secondExistingParty, JSON.stringify(row1After));
    }

    ok('PF-11 no console/page errors', dirPage.__errors.length === 0 && accPage.__errors.length === 0,
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
                 + (select count(*) from nf_lines where company_id='${C}') + (select count(*) from nf_accounts where company_id='${C}')
                 + (select count(*) from nf_parties where company_id='${C}')) j`);
    console.log(`  verified by query: ${JSON.stringify(left.j)}`);
    ok('CLEANUP', left.j.company === 0 && left.j.auth_users === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));

    const awamiAfter = (await q(`select count(*) n from nf_lines where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} \u2192 ${awamiAfter}`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks \u00b7 ${results.length - failed.length} passed \u00b7 ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
