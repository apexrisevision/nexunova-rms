/**
 * Phase 5 — portal viewer: REAL-BROWSER VERIFICATION, both roles.
 *
 *   node scripts/verify-phase5-viewer.js
 *
 * The point of the two-role run: the same sold unit must show a rep the word
 * "Sold" and nothing else, while a director sees the buyer and the money.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4196;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'phase5_shots');
const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
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
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
let n = 20;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n) + '-' + name + '.png');
  await page.screenshot({ path: f }); console.log('     \u{1F4F7} ' + path.basename(f));
}
async function until(page, fn, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 150 }); return true; } catch (e) { return false; }
}

(async () => {
  step('Fresh sessions');
  // Cancel any hold left by an earlier run so the outcome never depends on history.
  await sql("UPDATE public.reservations r SET status='cancelled' FROM public.units u, public.projects p"
          + " WHERE r.unit_id=u.id AND u.project_id=p.id AND p.project_name='ZZ Map Tower' AND r.status='active'");
  // Cancelling the reservation row does not put the unit back on the shelf — its
  // status_id still says Reserved, and reserve_unit rightly refuses it. Reset both.
  await sql("UPDATE public.units u SET status_id=(SELECT s.id FROM public.category_unit_statuses s"
          + " WHERE s.project_id=u.project_id AND s.status_name='Available' LIMIT 1)"
          + " FROM public.projects p WHERE p.id=u.project_id AND p.project_name='ZZ Map Tower'"
          + " AND u.unit_no='UG-02'");
  await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-map-rep','zz-map-dir');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id,
           CASE WHEN role='director' THEN 'zz-map-dir' ELSE 'zz-map-rep' END, now()+interval '2 hours'
      FROM public.sales_users WHERE company_id='${CO}' AND full_name IN ('ZZ Director','ZZ Rep One')`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function open(token) {
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t); localStorage.setItem('rms.sales.active', String(Date.now())); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    await until(page, () => typeof window.renderUnitMap === 'function');
    await sleep(1400);
    await page.evaluate(() => { document.querySelectorAll('.overlay,.locbar').forEach(e => e.remove()); });
    return { page, errs };
  }

  async function openFloor(page, label) {
    await page.evaluate(() => renderUnitMap());
    await until(page, () => document.querySelectorAll('.umv-floor').length > 0);
    return page.evaluate(l => {
      const b = [...document.querySelectorAll('.umv-floor')].find(x => x.textContent.includes(l));
      if (!b || b.disabled) return false; b.click(); return true;
    }, label);
  }

  // ══ SALE REP ══
  step('Sale rep');
  const A = await open('zz-map-rep');

  await A.page.evaluate(() => renderUnitMap());
  await until(A.page, () => document.querySelectorAll('.umv-floor').length > 0);
  const soonSeen = await A.page.evaluate(() =>
    [...document.querySelectorAll('.umv-floor.soon')].length);
  await shot(A.page, 'viewer-floor-list');
  assert(await openFloor(A.page, 'Upper Ground'), 'rep opened the published floor');
  assert(await until(A.page, () => document.querySelectorAll('#umv-svg polygon').length >= 30),
         '30 unit polygons rendered');
  await sleep(800);
  const nums = await A.page.evaluate(() => [...document.querySelectorAll('#umv-svg text')].map(t => t.textContent));
  assert(nums.includes('UG-17A') && nums.includes('UG-10A'),
         'numbers come from the DB — both 10A and 17A present (drawing label irrelevant)');
  const legend = await A.page.evaluate(() => document.querySelector('.umv-legend').textContent.replace(/\s+/g, ' '));
  assert(/Sold 1/.test(legend) && /Available 29/.test(legend), 'legend counts from the server: ' + legend.trim());
  await shot(A.page, 'viewer-canvas-rep');

  await A.page.evaluate(() => { const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === 'UG-01');
    t.previousElementSibling.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert(await until(A.page, () => !!document.querySelector('.umv-sheet-in')), 'rep opened the sold unit');
  await sleep(700);
  const repSheet = await A.page.evaluate(() => document.querySelector('.umv-sheet-in').textContent);
  assert(/Sold/.test(repSheet), 'rep sees "Sold"');
  assert(!/ZZ Buyer/.test(repSheet) && !/Outstanding/.test(repSheet) && !/03001234567/.test(repSheet),
         'rep sees NO client, NO phone, NO outstanding');
  await shot(A.page, 'viewer-rep-sold-unit');
  assert(A.errs.length === 0, 'rep: no JS errors' + (A.errs.length ? ' — ' + A.errs[0] : ''));

  // ══ DIRECTOR ══
  step('Director');
  const B = await open('zz-map-dir');
  assert(await openFloor(B.page, 'Upper Ground'), 'director opened the floor');
  await until(B.page, () => document.querySelectorAll('#umv-svg polygon').length >= 30);
  await sleep(700);
  await B.page.evaluate(() => { const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === 'UG-01');
    t.previousElementSibling.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert(await until(B.page, () => !!document.querySelector('.umv-sheet-in')), 'director opened the same unit');
  await sleep(700);
  const dirSheet = await B.page.evaluate(() => document.querySelector('.umv-sheet-in').textContent);
  assert(/ZZ Buyer/.test(dirSheet), 'director sees the client');
  assert(/Outstanding/.test(dirSheet) && /5,000,000/.test(dirSheet), 'director sees the outstanding');
  await shot(B.page, 'viewer-director-sold-unit');

  step('Zoom, pan, coming-soon');
  const z0 = await B.page.evaluate(() => getComputedStyle(document.getElementById('umv-pan')).transform);
  await B.page.evaluate(() => _umvZoom(1));
  await sleep(400);
  const z1 = await B.page.evaluate(() => getComputedStyle(document.getElementById('umv-pan')).transform);
  assert(z0 !== z1 && /matrix/.test(z1), 'zoom applies a CSS transform');
  await shot(B.page, 'viewer-zoomed');
  await B.page.evaluate(() => _umvZoom(0));

  await B.page.evaluate(() => renderUnitMap());
  await until(B.page, () => document.querySelectorAll('.umv-floor').length > 0);
  const soon = await B.page.evaluate(() => [...document.querySelectorAll('.umv-floor.soon')]
    .map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  assert(soon.length >= 1 && soon.every(s => /Coming soon/.test(s)),
         'floors without a drawing say Coming soon (' + soon.length + ')');
  assert(B.errs.length === 0, 'director: no JS errors' + (B.errs.length ? ' — ' + B.errs[0] : ''));

  await B.page.evaluate(() => { window.MAPPLAN = null; });
  const ids = await sql(`SELECT u.id AS unit_id, pl.id AS plan_id FROM public.units u
     JOIN public.projects p ON p.id=u.project_id
     JOIN public.unit_map_plans pl ON pl.project_id=p.id
     WHERE p.project_name='ZZ Map Tower' AND u.unit_no='UG-02'`);
  await B.page.evaluate(o => { window.MAPUNIT = o.unit_id; window.MAPPLAN = o.plan_id; }, ids[0]);

  step('Reserve goes through reserve_unit() only');
  const before = await sql(`SELECT count(*)::int n FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
     JOIN public.projects p ON p.id=u.project_id WHERE p.project_name='ZZ Map Tower' AND r.status='active'`);
  assert(Number(before[0].n) === 0, 'no active reservation before the test');

  // Call the same RPC the button calls, from the page's own session.
  const held = await B.page.evaluate(async () => {
    const u = MAPUNIT;
    const r = await sb.rpc('reserve_unit', {
      p_session_token: localStorage.getItem('rms.sales.token'), p_unit_id: u,
      p_client_name: 'ZZ Holder', p_client_phone: '03007654321', p_expiry_days: 3,
      p_token_received: false, p_token_amount: null, p_note: 'Held from the unit map' });
    return r.data;
  });
  assert(held && held.success, 'reserve_unit() accepted the hold' + (held && held.message ? ' — ' + held.message : ''));

  const after = await sql(`SELECT r.status, r.client_name, (r.expiry_date::date - current_date) AS days
     FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
     JOIN public.projects p ON p.id=u.project_id
     WHERE p.project_name='ZZ Map Tower' AND r.status='active'`);
  assert(after.length === 1 && after[0].client_name === 'ZZ Holder', 'one active reservation, written by reserve_unit');
  assert(Number(after[0].days) === 3, 'a 3-day hold expires in 3 days (cron can still expire it)');

  // The map must recolour from the SERVER, not from anything cached locally.
  await B.page.evaluate(() => _umvOpen(MAPPLAN));
  await until(B.page, () => /Reserved 1/.test(document.querySelector('.umv-legend').textContent));
  const legend2 = await B.page.evaluate(() => document.querySelector('.umv-legend').textContent.replace(/\s+/g, ' ').trim());
  assert(/Reserved 1/.test(legend2), 'the map recoloured from the server: ' + legend2);
  await shot(B.page, 'viewer-after-reserve');

  await browser.close(); server.close();
  console.log(`\n${'='.repeat(50)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots → migration_work/phase5_shots/\n${'='.repeat(50)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
