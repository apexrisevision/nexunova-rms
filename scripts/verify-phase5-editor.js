/**
 * Phase 5 — polygon editor: REAL-BROWSER VERIFICATION
 *
 * Signs in through the actual login form as a ZZTEST admin, opens the Unit Map,
 * draws real polygons by clicking, and checks the database agrees.
 *
 *   node scripts/verify-phase5-editor.js
 *
 * Credentials come from .env.local (gitignored). They are never printed.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4194, PAGE = `http://127.0.0.1:${PORT}/login.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'phase5_shots');
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
                  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function env() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) { console.error('.env.local missing — cannot log in.'); process.exit(1); }
  const o = {};
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(l => {
    if (/^\s*#/.test(l) || !l.includes('=')) return;
    const i = l.indexOf('='); o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  if (!o.RMS_ADMIN_USER || !o.RMS_ADMIN_PW) { console.error('.env.local has no username/password yet.'); process.exit(1); }
  return o;
}
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
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
let n = 0;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  console.log('     \u{1F4F7} ' + path.basename(f));
}
async function until(page, fn, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 150 }); return true; } catch (e) { return false; }
}

(async () => {
  const E = env();
  step('Resetting ZZ Map Tower shapes');
  await sql(`DELETE FROM public.unit_map_shapes s USING public.unit_map_artworks a, public.projects p
             WHERE s.artwork_id=a.id AND a.project_id=p.id AND p.project_name='ZZ Map Tower'`);

  const server = await serve();
  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1.4 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  step('Signing in through the real login form');
  await page.goto(PAGE, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const filled = await page.evaluate(c => {
    const set = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
    const ins = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null);
    // The login form takes ONE identity field: username@COMPANYCODE. There is no
    // separate company box — filling a non-existent one is why this first failed.
    const us = ins.find(i => /user/i.test(i.id + i.name + i.placeholder)) || ins.find(i => i.type === 'text');
    const pw = ins.find(i => i.type === 'password');
    return set(us, c.us + '@' + c.co) && set(pw, c.pw);
  }, { co: E.RMS_ADMIN_CO, us: E.RMS_ADMIN_USER, pw: E.RMS_ADMIN_PW });
  assert(filled, 'login form filled');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && /sign in|login/i.test(x.textContent));
    if (b) b.click();
  });
  // Assert on something that ONLY exists after a real sign-in, and fail loudly on
  // the error dialog — the first run 'passed' this against the marketing page.
  const loggedIn = await until(page, () => typeof window.nav === 'function' && !!document.getElementById('pg-unitmap'));
  const errBox = await page.evaluate(() => (document.body.innerText.match(/Sign in failed[sS]{0,60}/) || [''])[0].trim());
  assert(loggedIn && !errBox, 'signed in for real' + (errBox ? ' — ' + errBox : ''));
  await sleep(1500);

  step('Opening the Unit Map');
  await page.evaluate(() => nav('unitmap'));
  const listUp = await until(page, () => !!document.querySelector('#um-body table'));
  assert(listUp, 'floor list rendered (admin was allowed in)');
  await shot(page, 'editor-floor-list');

  const zzOpened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#um-body tbody tr')];
    const r = rows.find(x => /ZZ Map Tower/.test(x.textContent));
    const b = r && r.querySelector('button'); if (b) { b.click(); return true; } return false;
  });
  assert(zzOpened, 'opened the ZZ Map Tower floor');
  const stage = await until(page, () => !!document.querySelector('#um-stage img') && document.querySelector('#um-stage img').complete);
  assert(stage, 'artwork loaded on the canvas');
  await sleep(700);

  const slotCount = await page.evaluate(() => document.querySelectorAll('#um-slot option').length - 1);
  assert(slotCount === 30, `30 slots offered from inventory (got ${slotCount})`);
  await shot(page, 'editor-canvas-30-slots');

  step('Click-to-draw a real polygon');
  await page.select('#um-slot', '01');
  await page.evaluate(() => _umPickSlot('01'));
  await page.evaluate(() => _umStartDraw());
  // Bring the canvas fully into view first. getBoundingClientRect is viewport-relative,
  // so clicking those coordinates while the image sits below the fold lands on whatever
  // is actually there — which is why every click was being swallowed.
  const box = await page.evaluate(() => {
    const img = document.querySelector('#um-img');
    img.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80);
    const r = img.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const pts = [[0.10, 0.10], [0.22, 0.10], [0.22, 0.26], [0.10, 0.26]];
  for (const [nx, ny] of pts) { await page.mouse.click(box.x + nx * box.w, box.y + ny * box.h); await sleep(160); }
  await page.keyboard.press('Enter');
  await until(page, () => document.querySelectorAll('#um-svg polygon').length >= 1);
  await sleep(900);
  await shot(page, 'editor-polygon-drawn');

  const saved = await sql(`SELECT s.slot_code, jsonb_array_length(s.points) v, s.points
      FROM public.unit_map_shapes s JOIN public.unit_map_artworks a ON a.id=s.artwork_id
      JOIN public.projects p ON p.id=a.project_id WHERE p.project_name='ZZ Map Tower'`);
  assert(saved.length === 1 && saved[0].slot_code === '01', 'shape saved against slot 01');
  assert(saved[0] && saved[0].v === 4, 'four corners stored');
  const all01 = saved[0] && saved[0].points.every(p => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1);
  assert(all01, 'every vertex is normalised 0..1');

  step('Snap: a corner dropped near an existing one fuses to it');
  await page.evaluate(() => _umPickSlot('02'));
  await page.evaluate(() => _umStartDraw());
  const near = [[0.2207, 0.1004], [0.34, 0.10], [0.34, 0.26], [0.2207, 0.2604]];
  for (const [nx, ny] of near) { await page.mouse.click(box.x + nx * box.w, box.y + ny * box.h); await sleep(160); }
  await page.keyboard.press('Enter');
  await sleep(1100);
  const snap = await sql(`SELECT s.points FROM public.unit_map_shapes s
      JOIN public.unit_map_artworks a ON a.id=s.artwork_id JOIN public.projects p ON p.id=a.project_id
      WHERE p.project_name='ZZ Map Tower' AND s.slot_code='02'`);
  // The neighbour's corner is whatever the click produced, not a round 0.22 — so the
  // real test is that slot 02 carries a vertex IDENTICAL to one of slot 01's.
  const nb = saved[0].points.map(p => p.join(','));
  const shared = snap[0] && snap[0].points.some(p => nb.includes(p.join(',')));
  assert(shared, 'the shared edge landed exactly on the neighbour\u2019s corner (no hairline gap)');
  await shot(page, 'editor-snap-shared-edge');

  step('Label drag');
  await page.evaluate(() => _umPickSlot('01'));
  await page.evaluate(() => _umStartLabel());
  await page.mouse.click(box.x + 0.16 * box.w, box.y + 0.20 * box.h);
  await sleep(1000);
  const lab = await sql(`SELECT label_x, label_y FROM public.unit_map_shapes s
      JOIN public.unit_map_artworks a ON a.id=s.artwork_id JOIN public.projects p ON p.id=a.project_id
      WHERE p.project_name='ZZ Map Tower' AND s.slot_code='01'`);
  assert(lab[0] && lab[0].label_x != null && Math.abs(lab[0].label_x - 0.16) < 0.02, 'label point stored where it was dropped');
  await shot(page, 'editor-label-moved');

  step('Guards');
  const tooFew = await page.evaluate(async () => {
    _umPickSlot('03'); _umStartDraw();
    const r = await supabase.rpc('save_map_shape', { p_artwork_id: UM.artId, p_slot_code: '03', p_points: [[0.1,0.1],[0.2,0.2]] });
    return r.data;
  });
  assert(tooFew && !tooFew.success && tooFew.error === 'bad_points', 'two corners refused by the server');
  const outside = await page.evaluate(async () => {
    const r = await supabase.rpc('save_map_shape', { p_artwork_id: UM.artId, p_slot_code: '03', p_points: [[0.1,0.1],[1.4,0.2],[0.2,0.3]] });
    return r.data;
  });
  assert(outside && !outside.success && outside.error === 'bad_points', 'a vertex outside 0..1 refused (pixels, not normalised)');

  step('Zone group on a split child');
  await page.evaluate(() => _umPickSlot('10B'));
  await page.evaluate(() => _umStartDraw());
  for (const [nx, ny] of [[0.40,0.40],[0.50,0.40],[0.50,0.52]]) { await page.mouse.click(box.x + nx*box.w, box.y + ny*box.h); await sleep(160); }
  await page.keyboard.press('Enter');
  await sleep(1000);
  const zg = await sql(`SELECT zone_group FROM public.unit_map_shapes s
      JOIN public.unit_map_artworks a ON a.id=s.artwork_id JOIN public.projects p ON p.id=a.project_id
      WHERE p.project_name='ZZ Map Tower' AND s.slot_code='10B'`);
  assert(zg[0] && zg[0].zone_group === '10', 'split child carries zone_group "10"');

  assert(errs.length === 0, 'no JS errors' + (errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''));
  await shot(page, 'editor-final-state');

  step('Live tenants untouched');
  const live = await sql(`SELECT count(*)::int n FROM public.unit_map_shapes s
      JOIN public.unit_map_artworks a ON a.id=s.artwork_id JOIN public.projects p ON p.id=a.project_id
      WHERE p.project_name <> 'ZZ Map Tower'`);
  assert(Number(live[0].n) === 0, 'no shape written outside the ZZTEST fixture');

  await browser.close(); server.close();
  console.log(`\n${'='.repeat(50)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots → migration_work/phase5_shots/\n${'='.repeat(50)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
