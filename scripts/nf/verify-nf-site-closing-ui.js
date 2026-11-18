#!/usr/bin/env node
/**
 * NexuFinance — Site Closing screens (Stage 3), driven in a real browser against the
 * real database, golden-ui style. Nothing here touches Awami.
 *
 *   * a throw-away ZZTEST-NF-SITEUI-<run> company with the real chart; a site user, a
 *     director and a viewer, created IN SQL (bcrypt password, signed in with the public
 *     key) — no service-role key is used;
 *   * head office posts a cash payment and a withdrawal; the site keys 12-Nov (a
 *     withdrawal on the same cheque, the same payment from the site box, a tea bill, a
 *     bank payment HO does not have) and submits it -> Duplicate, Duplicate, New, Conflict;
 *     13-Nov is left open with a few lines;
 *   * the site user, at phone width: lands only on his cash book, no menu, cannot reach
 *     HO; tiles; date limits; adds a line inline; a version conflict shows its message;
 *     counts the cash (difference -> reason) and submits; sees status badges only;
 *   * the director: Reports -> Site Closing; the day with conflicts first; Accept a new
 *     line and a duplicate (checked in the database); Reject needs a reason; a version
 *     conflict shows its message; returns a day and the site sees the reason;
 *   * the viewer: reads, no buttons.
 * Screenshots go to the folder given (default: the scratchpad's site-ui).
 * Everything is removed afterwards and the removal checked by query.
 *
 *   node scripts/nf/verify-nf-site-closing-ui.js [outdir] > "$SCRATCH/nf-site-ui.log" 2>&1
 * Exit: 0 held · 1 something failed · 2 could not run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'marketing_shots', 'site-closing'));
const PORT = 4511;
const URL_BASE = `https://${REF}.supabase.co`;
const ANON = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js', 'supabase.js'), 'utf8'))[1];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(70)} ${pass ? '' : String(detail || '').slice(0, 300)}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

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
async function signIn(email, password) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error('sign-in ' + email + ': ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
async function pageFor(browser, user, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.evaluateOnNewDocument((ref, jwt, userId, email) => {
    try { localStorage.clear(); } catch (e) {}
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
      access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} } }));
    window.print = function () {};
  }, REF, user.jwt, user.id, user.email);
  return page;
}
// run SQL as a member (claims set inside one DO block)
const asUser = (uid, body) => q(`DO $x$ BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${uid}', true); ${body} END $x$;`);

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  console.log(`[verify-nf-site-closing-ui] project ${REF} · run ${run}`);
  fs.mkdirSync(OUT, { recursive: true });
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  // O is a viewer of ANOTHER throw-away company: he must not see this company's bill photos
  const C2 = crypto.randomUUID();
  const users = { S: { role: 'site', name: 'Sharose (test)' }, D: { role: 'director', name: 'Director (test)' }, V: { role: 'viewer', name: 'Viewer (test)' },
                  O: { role: 'viewer', name: 'Other company viewer (test)', company: C2 } };
  for (const [k, u] of Object.entries(users)) {
    u.id = crypto.randomUUID(); u.email = `nf-siteui-${k.toLowerCase()}-${run}@zztest-nf.invalid`; u.password = crypto.randomBytes(15).toString('base64url');
  }
  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
  let srv, browser;
  try {
    // ── fixture ──
    const built = buildSeed();
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZSUI${run}', 'ZZTEST-NF-SITEUI-${run}')`);
    await q(seedSql(C, built.seed));
    await q(`insert into companies (id, company_code, company_name) values ('${C2}', 'ZZSU2${run}', 'ZZTEST-NF-SITEUI2-${run}')`);
    for (const u of Object.values(users)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
                                       confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
                                       phone_change, phone_change_token, reauthentication_token)
               values ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${u.email}',
                       extensions.crypt('${u.password}', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}',
                       '', '', '', '', '', '', '', '');
               insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
               values (gen_random_uuid(), '${u.id}', '${u.id}', 'email', json_build_object('sub', '${u.id}', 'email', '${u.email}')::jsonb, now(), now(), now());`);
      await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${u.company || C}', '${u.id}', '${u.role}', '${u.name}', true)`);
    }
    for (const u of Object.values(users)) u.jwt = await signIn(u.email, u.password);
    const D = users.D.id, S = users.S.id;
    // head office: a day, a cash payment and a cheque cashed into HO cash (both 12-Nov)
    await asUser(D, `PERFORM public.nf_start_first_day('${C}', '2026-11-10', 'DC-1', 500000, 0, 1000000);
      PERFORM public.nf_save_line((SELECT id FROM public.nf_days WHERE company_id = '${C}'), NULL, 'OUT', 'CPV-0170',
        'NOC speed money — 50,000 deposited into Zia ul Haq account (12-Nov)', '53500', 'P-W', 'Cash', 50000, NULL, NULL);
      PERFORM public.nf_save_withdrawal((SELECT id FROM public.nf_days WHERE company_id = '${C}'), 'BPV-0046', 'Bank', 'Cash', 100000,
        '1313826265', 'Cash withdrawn from BOP, brought into cash in hand', '2026-11-12');
      PERFORM public.nf_site_start_first_day('${C}', '2026-11-12', 0);`);
    const line = (dt, side, doc, party, units, tok, head, via, amt, ref, rem) =>
      `PERFORM public.nf_site_save_line('${C}', '${dt}', NULL, '${side}', ${doc ? `'${doc}'` : 'NULL'}, ${party ? `'${party}'` : 'NULL'}, ${units ? `'${units}'` : 'NULL'},
         ${tok || 'NULL'}, '${head}', '${via}', ${amt}, ${ref ? `'${ref}'` : 'NULL'}, ${rem ? `'${rem}'` : 'NULL'}, NULL, NULL);`;
    await asUser(S, line('2026-11-12', 'IN', null, null, null, null, '10300', 'SITE_CASH', 100000, '6265', 'BOP') +
      line('2026-11-12', 'OUT', '301', 'ZIA UL HAQ', null, null, '53300', 'SITE_CASH', 50000, null, 'SPEED MONEY') +
      line('2026-11-12', 'OUT', null, null, null, null, '60400', 'SITE_CASH', 1200, null, 'TEA AND FOOD') +
      line('2026-11-12', 'OUT', null, 'OSAMA BIN YOUSAF', null, null, '22100', 'BANK', 500000, '6292', 'LOAN') +
      `PERFORM public.nf_site_submit((SELECT id FROM public.nf_site_days WHERE company_id = '${C}' AND business_date = '2026-11-12'), 48800, NULL, NULL,
         (SELECT version FROM public.nf_site_days WHERE company_id = '${C}' AND business_date = '2026-11-12'));` +
      line('2026-11-13', 'IN', '210', 'ALI RAZA', 'FF-120', 301, '21100', 'SITE_CASH', 10000, null, null) +
      line('2026-11-13', 'OUT', '302', 'HAMZA', null, null, '52600', 'SITE_CASH', 3500, null, 'LABOUR FOR PILES') +
      line('2026-11-13', 'OUT', null, null, null, null, '60400', 'SITE_CASH', 450, null, 'TEA'));
    const st = await q(`select l.party_name, l.match_status from nf_site_lines l join nf_site_days d on d.id = l.site_day_id
                         where d.company_id = '${C}' and d.business_date = '2026-11-12' order by l.line_no`);
    ok('FX-01 fixture 12-Nov matched: Duplicate, Duplicate, New, Conflict',
      st.map(r => r.match_status).join(',') === 'DUPLICATE,DUPLICATE,NEW,CONFLICT', JSON.stringify(st));

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const url = `http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`;

    // ── the site user, phone width ──
    const sp = await pageFor(browser, users.S, { width: 390, height: 844, isMobile: true, hasTouch: true });
    await sp.goto(url, { waitUntil: 'networkidle2' });
    await sp.waitForSelector('.scsheet .scgrid', { timeout: 20000 });
    let v = await sp.evaluate(() => ({
      title: document.querySelector('.scsheet h1') && document.querySelector('.scsheet h1').textContent,
      menu: !!document.querySelector('#nf-rpm-toggle'), topbar: !document.querySelector('.nf-topbar') || getComputedStyle(document.querySelector('.nf-topbar')).display === 'none',
      date: document.querySelector('#nf-sc-date').value, max: document.querySelector('#nf-sc-date').max,
      tiles: [...document.querySelectorAll('.sctile b')].map(b => b.textContent),
      codes: /\b(10100|10200|10300|21100|60400|52600)\b/.test(document.querySelector('.scsheet').innerText),
      dr: /\b(Dr|Cr|Debit|Credit)\b/.test(document.querySelector('.scsheet').innerText) }));
    ok('S-01 the site user lands on "Site Cash Book" only: no Reports menu, no way back to RMS', v.title === 'Site Cash Book' && !v.menu && v.topbar, JSON.stringify(v));
    ok('S-02 it opens on the day not yet sent (13-Nov), and no later day can be picked', v.date === '2026-11-13' && v.max === '2026-11-13', JSON.stringify(v));
    ok('S-03 tiles: opening 48,800, received 10,000, paid 3,950, in hand 54,850',
      v.tiles.join('|') === '48,800|10,000|3,950|54,850', v.tiles.join('|'));
    ok('S-04 no account codes and no Dr/Cr anywhere on the site screen', !v.codes && !v.dr, JSON.stringify(v));
    const day12 = (await q(`select id from nf_site_days where company_id = '${C}' and business_date = '2026-11-12'`))[0].id;
    v = await sp.evaluate(async (day12) => {
      const api = window.NfApi.build(supabase); const out = {};
      for (const [k, f] of [['review', () => api.siteReview(day12)],
                             ['day', () => api.getDay(new URLSearchParams(location.search).get('company'), null)],
                             ['heads', () => api.listHeads(new URLSearchParams(location.search).get('company'))]]) {
        try { await f(); out[k] = 'OK'; } catch (e) { out[k] = e.code || e.message; }
      }
      return out;
    }, day12);
    ok('S-05 the site user cannot reach HO: review, HO day and HO head list all refused',
      v.review === 'NF:NOT_ALLOWED' && v.day === 'NF:NOT_ALLOWED' && v.heads === 'NF:NOT_ALLOWED', JSON.stringify(v));
    await sp.screenshot({ path: path.join(OUT, 'a-site-grid-phone.png'), fullPage: true });

    // add a line inline: Paid to SAJAWAL, Travelling, 500 cash
    const newOut = '.scsec[data-side="OUT"] .scrow.new';
    await sp.type(newOut + ' [data-k="party_name"]', 'SAJAWAL');
    await sp.select(newOut + ' [data-k="head_code"]', '70700');
    await sp.type(newOut + ' [data-k="cash"]', '500');
    await sp.type(newOut + ' [data-k="remarks"]', 'TAXI');
    await sp.click(newOut + ' [data-save]');
    await sp.waitForFunction(() => [...document.querySelectorAll('.scsec[data-side="OUT"] .scrow:not(.new) [data-k="party_name"]')].some(i => i.value === 'SAJAWAL'), { timeout: 10000 });
    v = await sp.evaluate(() => ({ paid: document.querySelector('[data-tile="out"]').textContent, hand: document.querySelector('[data-tile="hand"]').textContent,
      newRows: document.querySelectorAll('.scsec[data-side="OUT"] .scrow.new').length }));
    const saved = await q(`select count(*) n from nf_site_lines l join nf_site_days d on d.id = l.site_day_id
                            where d.company_id = '${C}' and l.party_name = 'SAJAWAL' and l.head_code = '70700' and l.amount = 500`);
    ok('S-06 a line added inline is saved (database) and the tiles move (paid 4,450, in hand 54,350), a fresh empty row appears',
      Number(saved[0].n) === 1 && v.paid === '4,450' && v.hand === '54,350' && v.newRows === 1, JSON.stringify(v) + ' db=' + saved[0].n);

    // ── a bill photo on that line ──
    // a picture of a cash memo, drawn here and saved as a PNG
    const billFile = path.join(OUT, 'bill-sample.png');
    { const bp = await browser.newPage(); await bp.setViewport({ width: 360, height: 220 });
      await bp.setContent('<div style="font:16px monospace;padding:16px;background:#fffbe6;border:2px dashed #999;height:180px">CASH MEMO No. 4412<br>Sajawal Taxi Service<br>Karkhano - Hayatabad<br><br>Fare: Rs 500<br>13-Nov-2026</div>');
      await bp.screenshot({ path: billFile }); await bp.close(); }
    const sajawal = await sp.evaluateHandle(() => [...document.querySelectorAll('.scrow')].find(r => r.querySelector('[data-k="party_name"]').value === 'SAJAWAL'));
    await (await sajawal.$('[data-photo]')).uploadFile(billFile);
    await sp.waitForFunction(() => { const r = [...document.querySelectorAll('.scrow')].find(x => x.querySelector('[data-k="party_name"]').value === 'SAJAWAL');
      return r && r.querySelector('[data-photo-view]') && !r.classList.contains('dirty'); }, { timeout: 20000 });
    const bill = (await q(`select l.attachment_url p from nf_site_lines l join nf_site_days d on d.id = l.site_day_id where d.company_id = '${C}' and l.party_name = 'SAJAWAL'`))[0].p;
    ok('P-01 the site user adds a bill photo to a line: stored privately under the company, path saved on the line',
      !!bill && bill.indexOf(C + '/2026-11-13/') === 0, bill);
    { const sec = await sp.$('.scsec[data-side="OUT"]'); await sec.screenshot({ path: path.join(OUT, 'd-line-with-bill-photo.png') }); }
    const billBytes = fs.readFileSync(billFile);
    const storage = (u, method, p, body, extra) => fetch(`${URL_BASE}/storage/v1/object/${p}`, { method,
      headers: Object.assign({ apikey: ANON, Authorization: 'Bearer ' + u.jwt }, extra || {}), body });
    const openAs = async u => { const r = await storage(u, 'GET', 'authenticated/nf-site-bills/' + bill); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, same: b.equals(billBytes) }; };
    let a1 = await openAs(users.S), a2 = await openAs(users.D), a3 = await openAs(users.V), a4 = await openAs(users.O);
    ok('P-02 the site user and head office (director, viewer) can open it', a1.status === 200 && a1.same && a2.status === 200 && a2.same && a3.status === 200, JSON.stringify([a1, a2, a3]));
    ok('P-03 a viewer of ANOTHER company cannot', a4.status !== 200 && !a4.same, JSON.stringify(a4));
    const del = async u => (await storage(u, 'DELETE', 'nf-site-bills', JSON.stringify({ prefixes: [bill] }), { 'Content-Type': 'application/json' })).status;
    const rep = async u => (await storage(u, 'PUT', 'nf-site-bills/' + bill, Buffer.from('replaced'), { 'Content-Type': 'image/png', 'x-upsert': 'true' })).status;
    const dS = await del(users.S), dD = await del(users.D), rS = await rep(users.S), rD = await rep(users.D);
    a2 = await openAs(users.D);
    ok('P-04 nobody can delete it or replace it (site, director): still there, same bytes', a2.status === 200 && a2.same,
       JSON.stringify({ deleteSite: dS, deleteDirector: dD, replaceSite: rS, replaceDirector: rD, after: a2 }));
    const up2 = (await storage(users.O, 'POST', 'nf-site-bills/' + C + '/2026-11-13/intruder.png', billBytes, { 'Content-Type': 'image/png' })).status;
    ok('P-05 another company\'s user cannot add a photo to this company\'s folder', up2 >= 400, String(up2));

    // version conflict: another device changes the HAMZA line, then this screen edits it
    await asUser(S, `PERFORM public.nf_site_save_line('${C}', '2026-11-13', (SELECT l.id FROM public.nf_site_lines l JOIN public.nf_site_days d ON d.id = l.site_day_id
        WHERE d.company_id = '${C}' AND l.party_name = 'HAMZA'), 'OUT', '302', 'HAMZA', NULL, NULL, '52600', 'SITE_CASH', 3600, NULL, 'LABOUR FOR PILES',
        NULL, (SELECT l.version FROM public.nf_site_lines l JOIN public.nf_site_days d ON d.id = l.site_day_id WHERE d.company_id = '${C}' AND l.party_name = 'HAMZA'));`);
    const hamza = await sp.evaluateHandle(() => [...document.querySelectorAll('.scrow')].find(r => r.querySelector('[data-k="party_name"]').value === 'HAMZA'));
    const amt = await hamza.$('[data-k="cash"]');
    await amt.click({ clickCount: 3 }); await amt.type('3700');
    await (await hamza.$('[data-save]')).click();
    await sp.waitForSelector('#nf-sc-banner', { timeout: 10000 });
    v = await sp.evaluate(() => ({ banner: document.querySelector('#nf-sc-banner').textContent,
      hamza: [...document.querySelectorAll('.scrow')].map(r => r.querySelector('[data-k="party_name"]').value === 'HAMZA' ? r.querySelector('[data-k="cash"]').value : null).filter(Boolean)[0] }));
    ok('S-07 a line changed elsewhere: clear message, the latest (3,600) is shown, the stale change is not saved',
      /Someone else changed this/.test(v.banner) && v.hamza === '3600', JSON.stringify(v));

    // the cash count: a difference asks for a reason; then count exactly and send
    await sp.click('#nf-sc-count');
    await sp.waitForSelector('.scdrawer');
    await sp.type('[data-note="5000"]', '10'); await sp.type('[data-note="1000"]', '4');
    v = await sp.evaluate(() => ({ counted: document.querySelector('[data-count="counted"]').textContent, diff: document.querySelector('[data-count="diff"]').textContent,
      reason: !document.querySelector('.screason').hidden }));
    ok('S-08 the drawer adds the notes (54,000), shows the difference (−250) and asks for a reason', v.counted === '54,000' && /250/.test(v.diff) && v.reason, JSON.stringify(v));
    await sp.screenshot({ path: path.join(OUT, 'b-cash-count-drawer.png') });
    await sp.type('[data-note="100"]', '2'); await sp.type('[data-note="50"]', '1');
    v = await sp.evaluate(() => ({ diff: document.querySelector('[data-count="diff"]').textContent, reason: !document.querySelector('.screason').hidden }));
    ok('S-09 counted exactly: difference "None", no reason needed', v.diff === 'None' && !v.reason, JSON.stringify(v));
    await sp.click('#nf-sc-submit');
    let sent = true;
    try {
      await sp.waitForFunction(() => /Sent to head office/.test(document.querySelector('.scsheet').innerText) && !document.querySelector('.scdrawer'), { timeout: 15000 });
    } catch (e) {
      sent = false;
      await sp.screenshot({ path: path.join(OUT, 'debug-after-send.png') });
      const why = await sp.evaluate(() => (document.querySelector('#nf-sc-drawer-err') || {}).textContent || '');
      // Stage 2's match runs an UPDATE with no WHERE; PostgREST's safe-update guard refuses it.
      // The fix is migration 20261118c (not applied yet). Recorded as a failure, then the day is
      // sent in the database so the head office checks below still run.
      ok('S-10a "Send to head office" works through the app  [needs 20261118c]', false, why);
      await asUser(S, `PERFORM public.nf_site_submit((SELECT id FROM public.nf_site_days WHERE company_id = '${C}' AND business_date = '2026-11-13'), 54250, NULL, NULL,
         (SELECT version FROM public.nf_site_days WHERE company_id = '${C}' AND business_date = '2026-11-13'));`);
      // a fresh load opens today; go back to the day just sent
      await sp.reload({ waitUntil: 'networkidle2' }); await sp.waitForSelector('.scsheet .scgrid');
      await sp.evaluate(() => { const d = document.querySelector('#nf-sc-date'); d.value = '2026-11-13'; d.dispatchEvent(new Event('change')); });
      await sp.waitForFunction(() => /Sent to head office/.test(document.querySelector('.scsheet').innerText) && document.querySelector('#nf-sc-date').value === '2026-11-13', { timeout: 15000 });
    }
    if (sent) ok('S-10a "Send to head office" works through the app', true, '');
    v = await sp.evaluate(() => ({ editable: [...document.querySelectorAll('.scrow input:not([type=file])')].filter(i => !i.readOnly && !i.disabled).length,
      badges: [...document.querySelectorAll('.scst')].map(b => b.textContent), text: document.querySelector('.scsheet').innerText }));
    ok('S-10b after sending: the grid is read-only and each line shows a status badge only',
      v.editable === 0 && v.badges.length >= 4 && v.badges.every(b => ['New', 'Duplicate', 'Possible duplicate', 'Linked', 'Conflict', 'Accepted', 'Rejected'].indexOf(b) >= 0), JSON.stringify(v.badges) + ' editable=' + v.editable);
    ok('S-11 …and never a head office voucher number or reason', !/(CPV|BPV|CRV|BRV)-\d/.test(v.text) && !/Source mismatch|HO voucher/.test(v.text), '');
    await sp.screenshot({ path: path.join(OUT, 'a2-site-after-submit-phone.png'), fullPage: true });

    // ── the director ──
    const dp = await pageFor(browser, users.D, { width: 1280, height: 900 });
    await dp.goto(url, { waitUntil: 'networkidle2' });
    await dp.waitForSelector('#nf-rpm-toggle', { timeout: 20000 });
    await dp.click('#nf-rpm-toggle');
    v = await dp.evaluate(() => !!document.querySelector('[data-goto="site"]'));
    ok('H-01 the Reports menu has "Site Closing"', v, '');
    await dp.click('[data-goto="site"]');
    await dp.waitForSelector('.srdays', { timeout: 15000 });
    v = await dp.evaluate(() => [...document.querySelectorAll('.srdays tbody tr')].map(t => t.innerText.replace(/\s+/g, ' ')));
    ok('H-02 the list shows both site days, waiting for head office', v.length === 2 && v.every(t => /Waiting for head office/.test(t)), JSON.stringify(v));
    await dp.click('.srdays tbody tr:last-child');
    await dp.waitForSelector('.srline[data-line-row]', { timeout: 15000 });
    v = await dp.evaluate(() => [...document.querySelectorAll('.srline[data-line-row]')].map(r => r.querySelector('.scst').textContent));
    ok('H-03 12-Nov: the conflict first, then the duplicates, then the new line', v.join(',') === 'Conflict,Duplicate,Duplicate,New', v.join(','));
    v = await dp.evaluate(() => document.querySelector('.srsheet').innerText);
    ok('H-04 HO sees the matched HO vouchers and what Accept would do', /CPV-0170/.test(v) && /BPV-0046/.test(v) && /moves 1,00,000|moves 100,000/.test(v) && /Bank line missing at HO/.test(v), '');
    await dp.screenshot({ path: path.join(OUT, 'c-ho-review-day.png'), fullPage: true });

    const clickIn = async (party, act) => {
      const id = await dp.evaluate((p) => { const r = [...document.querySelectorAll('.srline[data-line-row]')].find(x => x.innerText.indexOf(p) >= 0); return r && r.getAttribute('data-line-row'); }, party);
      await dp.click(`.srline[data-line-row="${id}"] [data-act="${act}"]`);
      await dp.waitForSelector('.srdlg');
      return id;
    };
    // "Link to…": search by the real date
    await clickIn('OSAMA BIN YOUSAF', 'link');
    await dp.waitForFunction(() => !/Loading vouchers/.test(document.querySelector('#nf-sr-pick').innerText), { timeout: 15000 });
    const pickFor = async (txt) => {
      await dp.evaluate(t => { const i = document.querySelector('#nf-sr-q'); i.value = t; i.dispatchEvent(new Event('input')); }, txt);
      return dp.evaluate(() => [...document.querySelectorAll('#nf-sr-pick [data-pick-v] b')].map(b => b.innerText.replace(/\s+/g, ' ')));
    };
    const by12 = await pickFor('12-Nov'), byIso = await pickFor('2026-11-12'), by13 = await pickFor('13-Nov');
    ok('H-04b "Link to…" finds by real date: 12-Nov gives the withdrawal (its real date) and CPV-0170 (date in its narration)',
      by12.some(t => /BPV-0046/.test(t) && /12-Nov-2026/.test(t)) && by12.some(t => /CPV-0170/.test(t)), JSON.stringify(by12));
    ok('H-04c …"2026-11-12" works the same; 13-Nov does not bring the 12-Nov withdrawal',
      byIso.some(t => /BPV-0046/.test(t)) && !by13.some(t => /BPV-0046/.test(t)), JSON.stringify({ byIso, by13 }));
    await dp.click('#nf-sr-dlg-cancel');
    // Reject needs a reason
    await clickIn('TEA AND FOOD', 'reject');
    await dp.click('#nf-sr-dlg-ok');
    v = await dp.evaluate(() => document.querySelector('#nf-sr-dlg-err').textContent);
    ok('H-05 Reject without a reason is refused on the screen', /Write a reason/.test(v), v);
    await dp.click('#nf-sr-dlg-cancel');
    // Accept the withdrawal first: it moves 1,00,000 from HO cash into the site box
    let lid = await clickIn('BOP', 'accept');
    await dp.click('#nf-sr-dlg-ok');
    await dp.waitForFunction(() => !document.querySelector('.srdlg'), { timeout: 15000 });
    let db = await q(`select l.match_status, (select count(*) from nf_vouchers v join nf_voucher_legs g on g.voucher_id = v.id
                       where v.company_id = '${C}' and v.voucher_no like 'XFR-SITE-%' and g.account_code = '10200' and g.debit = 100000) xfr
                      from nf_site_lines l where l.id = '${lid}'`);
    ok('H-06 Accept on the withdrawal calls nf_site_accept: 1,00,000 moved from HO cash to the site box', db[0].match_status === 'LINKED' && Number(db[0].xfr) === 1, JSON.stringify(db));
    // then the new line
    await wait(300);
    lid = await clickIn('TEA AND FOOD', 'accept');
    await dp.click('#nf-sr-dlg-ok');
    await dp.waitForFunction(() => !document.querySelector('.srdlg'), { timeout: 15000 });
    db = await q(`select match_status, posted_voucher_id is not null posted from nf_site_lines where id = '${lid}'`);
    ok('H-07 Accept on the new line: posted from the site box', db[0].match_status === 'ACCEPTED' && db[0].posted, JSON.stringify(db));
    // a version conflict on the HO screen (the Zia line changed behind it)
    lid = await dp.evaluate(() => { const r = [...document.querySelectorAll('.srline[data-line-row]')].find(x => x.innerText.indexOf('ZIA UL HAQ') >= 0); return r.getAttribute('data-line-row'); });
    await q(`update nf_site_lines set version = version + 1 where id = '${lid}'`);
    await dp.click(`.srline[data-line-row="${lid}"] [data-act="accept"]`); await dp.waitForSelector('.srdlg');
    await dp.click('#nf-sr-dlg-ok');
    await dp.waitForSelector('#nf-sr-msg', { timeout: 15000 });
    let msgTxt = await dp.evaluate(() => document.querySelector('#nf-sr-msg').textContent);
    ok('H-08 a line changed elsewhere: the HO screen says so and shows the latest', /Someone changed this just now/.test(msgTxt), msgTxt);
    // now Accept the source-mismatch duplicate on the fresh version -> HO voucher moved to the site box
    lid = await clickIn('ZIA UL HAQ', 'accept');
    await dp.click('#nf-sr-dlg-ok');
    await dp.waitForFunction(() => !document.querySelector('.srdlg'), { timeout: 15000 });
    db = await q(`select l.match_status, g.account_code from nf_site_lines l join nf_vouchers v on v.id = l.matched_voucher_id
                    join nf_voucher_legs g on g.voucher_id = v.id and g.line_no = 2 where l.id = '${lid}'`);
    ok('H-09 Accept on the duplicate moves HO voucher CPV-0170 to the site box (10200)', db[0] && db[0].match_status === 'LINKED' && db[0].account_code === '10200', JSON.stringify(db));
    // return 13-Nov to the site
    await dp.click('#nf-sr-list'); await dp.waitForSelector('.srdays');
    await dp.click('.srdays tbody tr:first-child'); await dp.waitForSelector('#nf-sr-return');
    v = await dp.evaluate(async (p) => {
      const btn = !!document.querySelector('[data-bill]');
      const u = await window.NfApi.build(supabase).siteBillUrl(p);
      const r = u ? await fetch(u) : null;
      return { btn, status: r && r.status, type: r && r.headers.get('content-type') };
    }, bill);
    ok('P-06 head office sees "Bill photo" on the line and its link opens the picture', v.btn && v.status === 200 && /image/.test(v.type || ''), JSON.stringify(v));
    await dp.click('#nf-sr-return'); await dp.waitForSelector('#nf-sr-reason');
    await dp.type('#nf-sr-reason', 'Hamza labour bill photo missing — add it and send again');
    await dp.click('#nf-sr-dlg-ok');
    await dp.waitForFunction(() => /Sent back to site/.test(document.querySelector('.srsheet').innerText), { timeout: 15000 });
    ok('H-10 Return day to site calls nf_site_return (13-Nov now "Sent back to site")', true, '');

    await sp.reload({ waitUntil: 'networkidle2' }); await sp.waitForSelector('.scsheet .scgrid');
    v = await sp.evaluate(() => ({ text: document.querySelector('.scsheet').innerText,
      editable: [...document.querySelectorAll('.scrow input:not([type=file])')].filter(i => !i.readOnly && !i.disabled).length }));
    ok('S-12 the site user sees HO\'s reason in a banner and can edit the day again',
      /Head office sent this day back/.test(v.text) && /bill photo missing/.test(v.text) && v.editable > 0, 'editable=' + v.editable);

    // ── the viewer ──
    const vp = await pageFor(browser, users.V, { width: 1280, height: 900 });
    await vp.goto(url, { waitUntil: 'networkidle2' });
    await vp.waitForSelector('#nf-rpm-toggle', { timeout: 20000 });
    await vp.click('#nf-rpm-toggle'); await vp.click('[data-goto="site"]');
    await vp.waitForSelector('.srdays'); await vp.click('.srdays tbody tr:last-child');
    await vp.waitForSelector('.srline[data-line-row]');
    v = await vp.evaluate(() => ({ acts: document.querySelectorAll('[data-act], #nf-sr-acceptnew, #nf-sr-return, #nf-sr-rematch').length,
      ro: /Read only/.test(document.querySelector('.srsheet').innerText) }));
    ok('V-01 the viewer reads the review with no action buttons', v.acts === 0 && v.ro, JSON.stringify(v));

    const errs = [].concat(sp.__errors, dp.__errors, vp.__errors);
    ok('X-01 no page errors on any screen', errs.length === 0, errs.join(' | '));
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.close();
    // ── cleanup, always ──
    try {
      await q(`DO $c$ BEGIN
        PERFORM set_config('nf.purge_company', '${C}', true);
        DELETE FROM public.nf_site_lines WHERE company_id = '${C}';
        DELETE FROM public.nf_site_days WHERE company_id = '${C}';
        DELETE FROM public.nf_combined_closings WHERE company_id = '${C}';
        DELETE FROM public.nf_voucher_counters WHERE company_id = '${C}';
        PERFORM public._nf_test_purge('${C}');
        PERFORM set_config('nf.purge_company', '${C2}', true);
        DELETE FROM public.nf_members WHERE company_id = '${C2}';
        PERFORM public._nf_test_purge('${C2}');
        -- the test's photo rows (nobody may delete through the API, by design; storage's own switch)
        PERFORM set_config('storage.allow_delete_query', 'true', true);
        DELETE FROM storage.objects WHERE bucket_id = 'nf-site-bills' AND (name LIKE '${C}/%' OR name LIKE '${C2}/%');
      END $c$;`);
      for (const u of Object.values(users)) await q(`delete from auth.identities where user_id = '${u.id}'; delete from auth.users where id = '${u.id}';`);
      const left = await q(`select (select count(*) from companies where id in ('${C}', '${C2}')) co, (select count(*) from nf_site_days where company_id = '${C}') sd,
                                   (select count(*) from storage.objects where bucket_id = 'nf-site-bills' and (name like '${C}/%' or name like '${C2}/%')) photos,
                                   (select count(*) from auth.users where email like 'nf-siteui-%-${run}@zztest-nf.invalid') users,
                                   (select count(*) from nf_vouchers where company_id = '${AWAMI_COMPANY_ID}') awami`);
      console.log('  cleanup verified by query:', JSON.stringify(left[0]));
      ok('CLEANUP nothing of the test companies, their users or photo rows is left', Number(left[0].co) === 0 && Number(left[0].sd) === 0 && Number(left[0].users) === 0 && Number(left[0].photos) === 0, JSON.stringify(left[0]));
      ok('AWAMI-UNTOUCHED', Number(left[0].awami) === Number(awamiBefore), awamiBefore + ' -> ' + left[0].awami);
    } catch (e) { ok('CLEANUP', false, e.message); }
    const p = results.filter(r => r.pass).length, f = results.length - p;
    console.log(`\n${results.length} checks · ${p} passed · ${f} failed`);
    console.log('screenshots:', OUT);
    process.exitCode = f ? 1 : 0;
  }
})();
