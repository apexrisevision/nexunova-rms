/**
 * The public availability link — opened the way a stranger opens it.
 *
 *   node scripts/verify-public-availability.js
 *
 * This link can be forwarded anywhere: a dealer group, a client, a WhatsApp
 * status. So the thing under test is not "does the page look right" but "what
 * did the server actually put on the wire". Every assertion about privacy reads
 * the RESPONSE BODY of get_public_availability, because a page that merely omits
 * a buyer's name proves nothing — a payload that never contained one proves
 * everything.
 *
 * The browser context is deliberately empty: a fresh incognito-style context,
 * no localStorage, no session token, no portal code on the page. If the tower
 * renders, it rendered for someone with no account at all.
 *
 * ZZTEST only. The link is created and revoked here through the same director
 * RPCs a human would use, and the fixture is cleaned up at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4221;
const SHOTS = path.join(ROOT, 'migration_work', 'public_link');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const ZZ_PROJECT = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';

/* what must never appear, taken from the real ZZTEST sale on UG-01 */
const SECRETS = { buyer: 'ZZ Buyer', phone: '03001234567', sale_no: 'ZZ-SALE-001' };

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const stepH = m => console.log('\n── ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      // mirror the vercel rewrite: /a/<token> serves the same file
      let url = decodeURIComponent(q.url.split('?')[0]);
      if (/^\/a\/[A-Za-z0-9_-]+$/.test(url)) url = '/availability.html';
      const p = path.join(ROOT, url);
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
const until = (page, fn, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 200 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  // ── a director mints the link, exactly as a human would ───────────────────
  stepH('A ZZTEST director creates the link');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-pub-dir';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-pub-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';`);
  const made = await sql(`SELECT public.create_availability_link('zz-pub-dir','${ZZ_PROJECT}','ZZ verify') AS r`);
  const TOKEN = made[0].r.token;
  assert(made[0].r.success && /^[0-9a-f]{32}$/.test(TOKEN || ''),
    'token is 128 random bits: ' + String(TOKEN).slice(0, 8) + '…');

  // a rep must NOT be able to mint one
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-pub-rep';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-pub-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';`);
  const repTry = await sql(`SELECT public.create_availability_link('zz-pub-rep','${ZZ_PROJECT}','nope') AS r`);
  assert(repTry[0].r.success === false && repTry[0].r.error === 'not_allowed',
    'a rep cannot mint a public link (' + repTry[0].r.error + ')');

  // ── the table itself is closed to the public ──────────────────────────────
  stepH('The token table is not readable by anon');
  const acl = await sql(`SELECT has_table_privilege('anon','public.availability_links','SELECT') AS s,
                                relrowsecurity AS rls
                           FROM pg_class WHERE oid='public.availability_links'::regclass`);
  assert(acl[0].s === false, 'anon has no SELECT on availability_links');
  assert(acl[0].rls === true, 'and RLS is on (deny-all, no policies)');

  const fnAcl = await sql(`SELECT p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('get_public_availability','create_availability_link','revoke_availability_link','list_availability_links')`);
  const anonCan = fnAcl.filter(f => f.anon).map(f => f.proname);
  assert(anonCan.length === 1 && anonCan[0] === 'get_public_availability',
    'anon may execute exactly one function: ' + anonCan.join(', '));

  // ── open it in a browser with NOTHING in it ───────────────────────────────
  stepH('A stranger opens /a/<token> — no login, no session, empty browser');
  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function visit(token) {
    // a fresh context = its own cookie jar and storage; nothing carries over
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
    const errs = [], wire = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('requestfailed', q => errs.push('requestfailed ' + q.url()));
    page.on('response', async r => {
      if (r.status() >= 400) errs.push(r.status() + ' ' + r.url());
      if (!/rpc\/get_public_availability/.test(r.url())) return;
      try { wire.push(await r.text()); } catch (e) { /* body gone */ }
    });
    await page.goto(`http://127.0.0.1:${PORT}/a/${token}`, { waitUntil: 'networkidle0' });
    return { ctx, page, errs, wire };
  }

  const V = await visit(TOKEN);
  await until(V.page, () => document.querySelectorAll('.win').length > 0);
  await sleep(2200);
  await V.page.screenshot({ path: path.join(SHOTS, '01-public-tower.png'), fullPage: true });
  console.log('  📸 01-public-tower');

  const storage = await V.page.evaluate(() => ({
    ls: Object.keys(localStorage).length, ss: Object.keys(sessionStorage).length }));
  assert(storage.ls === 0 && storage.ss === 0,
    'the page stored nothing locally (localStorage ' + storage.ls + ', sessionStorage ' + storage.ss + ')');

  const shape = await V.page.evaluate(() => ({
    title: document.getElementById('ttl').textContent,
    units: document.querySelectorAll('.win').length,
    avail: document.querySelectorAll('.win.available').length,
    sold: document.querySelectorAll('.win.sold').length,
    reserved: document.querySelectorAll('.win.reserved').length,
    numbered: [...document.querySelectorAll('.win')].filter(w => w.textContent === w.dataset.u).length,
    chips: [...document.querySelectorAll('#filters .pill')].map(p => p.textContent.trim())
  }));
  assert(shape.title === 'ZZ Map Tower', 'the tower is titled "' + shape.title + '"');
  assert(shape.units === 30, 'all 30 ZZTEST units drawn');
  assert(shape.numbered === 30, 'every pane carries its unit number');
  assert(shape.sold === 1 && shape.reserved === 1 && shape.avail === 28,
    'states are real: ' + shape.avail + ' available, ' + shape.reserved + ' reserved, ' + shape.sold + ' sold');

  // ── THE POINT: what came down the wire ────────────────────────────────────
  stepH('What the server actually sent');
  const body = V.wire.join('\n');
  console.log('     ' + body.replace(/\s+/g, ' ').slice(0, 220) + '…');
  assert(body.length > 0, 'captured the response body');

  const leaked = Object.entries(SECRETS).filter(([, v]) => body.includes(v)).map(([k]) => k);
  assert(leaked.length === 0, 'no buyer name, phone or booking number on the wire' +
    (leaked.length ? ' — LEAKED: ' + leaked : ''));
  const keys = ['client', 'phone', 'paid', 'outstanding', 'overdue', 'net_amount', 'sale_number', 'due']
    .filter(k => new RegExp('"[a-z_]*' + k, 'i').test(body));
  assert(keys.length === 0, 'not one private key name is present' + (keys.length ? ' — found: ' + keys : ''));

  // price: available units yes, sold/reserved no — decided in SQL
  const priced = await V.page.evaluate(() => {
    const out = { availPriced: 0, takenPriced: 0 };
    // read what the page itself received, unit by unit
    return fetch(document.location.href).then(() => out);
  }).catch(() => null);
  const parsed = JSON.parse(body.trim().split('\n').pop());
  const units = parsed.floors.flatMap(f => f.units);
  const takenWithPrice = units.filter(u => u.s !== 'available' && u.p != null);
  const availWithPrice = units.filter(u => u.s === 'available' && u.p != null);
  assert(takenWithPrice.length === 0,
    'no price for sold or reserved units' + (takenWithPrice.length ? ' — ' + takenWithPrice.map(u => u.n) : ''));
  assert(availWithPrice.length > 0, availWithPrice.length + ' available units DO carry a price (a rep needs it)');

  // ── no way to act from here ───────────────────────────────────────────────
  stepH('Read-only: there is nothing to press');
  await V.page.evaluate(() => document.querySelector('.win.sold').click());
  await sleep(600);
  await V.page.screenshot({ path: path.join(SHOTS, '02-sold-unit-card.png'),
    clip: await V.page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520) }; }) });
  console.log('  📸 02-sold-unit-card');
  const soldCard = await V.page.evaluate(() => ({
    rows: [...document.querySelectorAll('#cbody .row')].map(r => r.children[0].textContent),
    text: document.getElementById('card').innerText
  }));
  assert(!soldCard.rows.some(r => /Price|Rate/.test(r)),
    'a sold unit shows no price: ' + soldCard.rows.join(', '));
  assert(!/ZZ Buyer|0300/.test(soldCard.text), 'and names nobody');

  const buttons = await V.page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean));
  assert(!buttons.some(b => /reserve|hold|make a plan|book/i.test(b)),
    'no Reserve / Make-a-plan / Book button anywhere on the page');
  const src = fs.readFileSync(path.join(ROOT, 'availability.html'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');           // strip comments, judge the CODE
  assert(!/reserve_unit|save_unit_quote|get_map_plan|sales_sessions/.test(code),
    'the page cannot even name a write RPC or a session');
  const rpcs = [...code.matchAll(/sb\.rpc\(\s*'([^']+)'/g)].map(m => m[1]);
  assert(rpcs.length === 1 && rpcs[0] === 'get_public_availability',
    'it calls exactly one RPC: ' + rpcs.join(', '));

  // ── filters still work for a stranger ─────────────────────────────────────
  stepH('Filters and cheapest work without an account');
  await V.page.evaluate(() => document.getElementById('cx').click());
  await V.page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(p => p.textContent.startsWith('1 Bed')).click());
  await V.page.evaluate(() => { const e = document.getElementById('bmin');
    e.value = '4000000'; e.dispatchEvent(new Event('input', { bubbles: true }));
    const x = document.getElementById('bmax');
    x.value = '6000000'; x.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await V.page.screenshot({ path: path.join(SHOTS, '03-filter-budget.png'), fullPage: true });
  console.log('  📸 03-filter-budget');
  const filtered = await V.page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    note: document.getElementById('fnote').textContent
  }));
  assert(filtered.lit > 0 && /showing \d+ of 30/.test(filtered.note),
    'type + budget filter works: ' + filtered.note);

  await V.page.evaluate(() => document.getElementById('cheap').click());
  await sleep(600);
  await V.page.screenshot({ path: path.join(SHOTS, '04-cheapest.png'), fullPage: true });
  console.log('  📸 04-cheapest');
  const list = await V.page.evaluate(() => [...document.querySelectorAll('.lrow')].map(r => r.dataset.u));
  assert(list.length > 0, 'the cheapest list opens with ' + list.length + ' units');
  assert(V.errs.length === 0, 'no console errors' + (V.errs.length ? ': ' + V.errs[0] : ''));
  await V.ctx.close();

  // ── revoke kills the same URL ─────────────────────────────────────────────
  stepH('Revoke — the same link, a moment later');
  const rev = await sql(`SELECT public.revoke_availability_link('zz-pub-dir','${TOKEN}') AS r`);
  assert(rev[0].r.success === true, 'the director revoked it');

  const D = await visit(TOKEN);
  await until(D.page, () => /no longer active/i.test(document.body.innerText));
  await D.page.screenshot({ path: path.join(SHOTS, '05-revoked.png') });
  console.log('  📸 05-revoked');
  const deadText = await D.page.evaluate(() => document.body.innerText);
  assert(/no longer active/i.test(deadText), 'the revoked link says so plainly');
  assert(!/ZZ Map Tower|ZZTEST/.test(deadText),
    'and does not even name the project it used to show');
  assert(D.page.url().includes('/a/'), 'still on the public route, never redirected into the portal');
  await D.ctx.close();

  // a made-up token answers the same way — a prober learns nothing
  const G = await visit('deadbeefdeadbeefdeadbeefdeadbeef');
  await until(G.page, () => /no longer active/i.test(document.body.innerText));
  const guessText = await G.page.evaluate(() => document.body.innerText);
  assert(guessText === deadText, 'a guessed token gives the identical answer — no oracle');
  await G.ctx.close();

  await browser.close(); server.close();
  await sql(`DELETE FROM public.availability_links WHERE token='${TOKEN}';
             DELETE FROM public.sales_sessions WHERE session_token IN ('zz-pub-dir','zz-pub-rep');`);
  console.log('\n✓ fixture link and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/public_link/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
