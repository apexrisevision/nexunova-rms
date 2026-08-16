/**
 * Phase 5 — KBH, LIVE: verification through a real Awami rep's portal session.
 *
 *   node scripts/verify-phase5-kbh-live.js
 *
 * This one runs against live inventory, so it is deliberately read-mostly. It
 * creates exactly one thing — a quote, which by design holds nothing — and deletes
 * it again. It does NOT fire a reservation: a hold on a live KBH flat is a business
 * record, not a test artefact, so the reserve path is proven ARMED (the server says
 * the unit may be held and the buttons are on screen) rather than fired.
 *
 * The point of running as Muhammad Saeed: he is an Awami sale_rep, in a different
 * company of the same dealer group, and umbrella-flagged. He must see KBH's floors
 * at all, must see the unit numbers this database holds, and — the last proof of
 * the role split on real data — must see a sold flat as "Sold" and nothing else.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4205;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'kbh_live');
const SAEED = '76b9b246-c240-48c0-a58c-f8b891a45048';      // Muhammad Saeed, Awami sale_rep, umbrella
const TOKEN = 'zz-kbh-verify';
const ART   = '3dbfd2ba-43a0-4e54-8391-9f9c451b5a67';      // KBH artwork A
const SOLD  = 'UG-02';                                     // sold to ZAHID KHAN, BKG-68
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
let n = 9;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n) + '-' + name + '.png');
  await page.screenshot({ path: f }); console.log('     \u{1F4F7} ' + path.basename(f));
}
const until = (page, fn, ms = 25000) =>
  page.waitForFunction(fn, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);

(async () => {
  step('What the migration left behind');
  const plans = await sql(`SELECT floor_label, status FROM unit_map_plans
     WHERE artwork_id='${ART}' OR company_id='3249e3b5-c411-4f5f-ae48-0246304c9c87' ORDER BY sort_order`);
  const pub = plans.filter(p => p.status === 'published').map(p => p.floor_label);
  const soon = plans.filter(p => p.status === 'coming_soon').map(p => p.floor_label);
  assert(pub.length === 8, '8 floors published: ' + pub.join(', '));
  assert(soon.length === 3 && soon.includes('Ground') && soon.includes('3rd Floor') && soon.includes('6th Floor'),
         'Ground, 3rd and 6th stayed coming-soon: ' + soon.join(', '));
  const shp = await sql(`SELECT count(*)::int n, count(*) FILTER (WHERE zone_group='10')::int z10,
      count(*) FILTER (WHERE zone_group='17')::int z17 FROM unit_map_shapes WHERE artwork_id='${ART}'`);
  assert(shp[0].n === 30, '30 outlines on artwork A');
  assert(shp[0].z10 === 3 && shp[0].z17 === 3, 'both split clusters are grouped: 10A/B/C and 17A/B/C');

  // the yardstick for everything the browser will show
  const units = await sql(`SELECT u.unit_no, _map_unit_state(u.id) st FROM units u
      JOIN projects p ON p.id=u.project_id
      JOIN unit_map_shapes s ON s.artwork_id='${ART}' AND u.unit_no='UG-'||s.slot_code
     WHERE p.project_name='KHUSHAL BAGH HEIGHTS' AND u.floor_label='Upper Ground'
       AND _map_unit_state(u.id)<>'retired' ORDER BY u.unit_no`);
  const wantNos = units.map(u => u.unit_no).sort();
  const wantAvail = units.filter(u => u.st === 'available').length;
  const wantSold = units.filter(u => u.st === 'sold').length;
  const wantResv = units.filter(u => u.st === 'reserved').length;
  assert(units.length === 30, 'Upper Ground resolves to 30 live units (' + wantSold + ' sold, ' + wantAvail + ' available)');
  const avail = units.find(u => u.st === 'available').unit_no;

  step('Muhammad Saeed signs in — Awami sale_rep, umbrella, different company');
  const me = await sql(`SELECT su.full_name, su.role, su.is_umbrella, c.company_name
     FROM sales_users su JOIN companies c ON c.id=su.company_id WHERE su.id='${SAEED}'`);
  assert(me[0].role === 'sale_rep' && me[0].is_umbrella === true,
         me[0].full_name + ' is a ' + me[0].role + ' at ' + me[0].company_name + ', umbrella');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='${TOKEN}';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, '${TOKEN}', now()+interval '40 minutes' FROM public.sales_users WHERE id='${SAEED}'`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                             localStorage.setItem('rms.sales.active', String(Date.now())); }, TOKEN);
  await page.reload({ waitUntil: 'networkidle2' });
  await until(page, () => typeof window.renderUnitMap === 'function');
  await until(page, () => { const b = document.getElementById('app-body');
                            return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
  await page.waitForFunction(() => { const b = document.getElementById('app-body'); if (!b) return false;
    const now = b.innerHTML.length; if (window.__lastLen === now) return true; window.__lastLen = now; return false;
  }, { timeout: 25000, polling: 350 }).catch(() => {});
  await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
    .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));

  step('A rep in another company can see KBH at all');
  await page.evaluate(() => renderUnitMap());
  assert(await until(page, () => document.querySelectorAll('.umv-floor').length > 0), 'the floor list loaded');
  const floors = await page.evaluate(() => [...document.querySelectorAll('.umv-floor')]
    .map(b => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), soon: b.classList.contains('soon') })));
  assert(floors.filter(f => !f.soon).length >= 8, floors.filter(f => !f.soon).length + ' floors are open to him');
  assert(floors.some(f => /Upper Ground/.test(f.t) && !f.soon), 'Upper Ground is open');
  assert(floors.some(f => /3rd Floor/.test(f.t) && f.soon) && floors.some(f => /6th Floor/.test(f.t) && f.soon),
         '3rd and 6th say "Coming soon" to him');
  await shot(page, 'kbh-floor-list');

  step('The floor draws');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.umv-floor')]
    .find(x => /Upper Ground/.test(x.textContent) && !x.classList.contains('soon')); b.click(); });
  assert(await until(page, () => document.querySelectorAll('#umv-svg polygon').length >= 30), '30 polygons rendered');
  await sleep(900);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#umv-svg text')].map(t => t.textContent).sort());
  assert(JSON.stringify(shown) === JSON.stringify(wantNos),
         'every number on the map is the DATABASE\'s unit_no, all 30, none invented');
  const legend = await page.evaluate(() => document.querySelector('.umv-legend').textContent.replace(/\s+/g, ' ').trim());
  assert(legend.includes('Available ' + wantAvail) && legend.includes('Sold ' + wantSold) &&
         legend.includes('Reserved ' + wantResv), 'legend counts come from the server: ' + legend);
  // colour is per-state, and it is the SERVER's state that decides
  const colours = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#umv-svg polygon').forEach(p => {
      const t = p.nextElementSibling; out[t.textContent] = p.getAttribute('stroke');
    });
    return out;
  });
  const mismatched = units.filter(u => colours[u.unit_no] !==
    ({ available: '#0ea5e9', reserved: '#d97706', sold: '#059669' })[u.st]);
  assert(mismatched.length === 0, 'every polygon is coloured by the server\'s state'
         + (mismatched.length ? ' — ' + mismatched[0].unit_no + ' is ' + colours[mismatched[0].unit_no] : ''));
  const chips = await page.evaluate(() => [...document.querySelectorAll('.umv-chip i')]
    .map(i => i.style.background));
  assert(new Set(chips).size === 3, 'the legend carries all three colours: ' + chips.join(' '));
  if (wantResv === 0) console.log('     \u2139\uFE0F  KBH has no reserved unit today, so no amber polygon can exist on this floor;'
    + '\n        the amber is proven on the legend chip and on ZZTEST by verify-phase5-viewer.js');
  await shot(page, 'kbh-upper-ground');

  step('THE ROLE SPLIT, on real KBH money');
  const sale = await sql(`SELECT c.full_name, s.sale_number, s.net_amount FROM sales s
      JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id
      LEFT JOIN clients c ON c.id=s.client_id
     WHERE p.project_name='KHUSHAL BAGH HEIGHTS' AND u.unit_no='${SOLD}' AND s.status='active'`);
  const tap = await page.evaluate(no => {
    const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === no);
    if (!t) return false;
    t.previousElementSibling.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true;
  }, SOLD);
  assert(tap, 'tapped ' + SOLD + ', sold to ' + sale[0].full_name + ' on ' + sale[0].sale_number);
  assert(await until(page, () => !!document.querySelector('.umv-sheet-in')), 'the unit sheet opened');
  await sleep(600);
  const sheet = await page.evaluate(() => document.querySelector('.umv-sheet-in').textContent);
  assert(/Sold/.test(sheet), 'Saeed sees the word "Sold"');
  assert(!sheet.includes(sale[0].full_name), 'he does NOT see the buyer (' + sale[0].full_name + ')');
  assert(!sheet.includes(sale[0].sale_number), 'he does NOT see the booking number');
  assert(!/Outstanding|Overdue|Paid/.test(sheet), 'he does NOT see paid, outstanding or overdue');
  assert(!sheet.replace(/\s/g, '').includes(Number(sale[0].net_amount).toLocaleString('en-US').replace(/\s/g, '')),
         'he does NOT see the net amount');
  // and it is not merely hidden — the server never sent it
  const wire = await page.evaluate(async no => {
    const r = await sb.rpc('get_map_unit_detail', { p_session_token: localStorage.getItem('rms.sales.token'),
      p_unit_id: [...document.querySelectorAll('#umv-svg polygon')]
        .find(p => p.nextElementSibling.textContent === no).getAttribute('data-unit') });
    return r.data;
  }, SOLD);
  assert(wire && wire.success && !wire.sale && wire.privileged === false,
         'the response over the wire carries no sale object at all — not hidden, not sent');
  await shot(page, 'kbh-sold-unit-as-rep');

  step('An available unit: hold armed, plan works');
  await page.evaluate(() => _umvClose());
  await page.evaluate(no => {
    const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === no);
    t.previousElementSibling.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, avail);
  assert(await until(page, () => !!document.querySelector('.umv-sheet-in')), avail + ' opened');
  await sleep(600);
  const armed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.umv-sheet-in button')].map(x => x.textContent.trim());
    return { plan: b.some(t => /Make a plan/i.test(t)), hold: b.filter(t => /days$/.test(t)) };
  });
  assert(armed.plan, '"Make a plan" is on the sheet');
  assert(armed.hold.length === 2, 'the hold buttons are armed: ' + armed.hold.join(' / ')
         + '  (not fired — a hold on a live flat is a business record, not a test)');
  await shot(page, 'kbh-available-unit');

  step('Make a plan, end to end, on the real drawing');
  await page.evaluate(() => [...document.querySelectorAll('.umv-sheet-in button')]
    .find(b => /Make a plan/i.test(b.textContent)).click());
  assert(await until(page, () => !!document.getElementById('uq-name')), 'the plan form opened');
  await page.evaluate(() => {
    const orig = QuotePDF.build;
    QuotePDF.build = async function (o) { const r = await orig(o); window.__q = { pages: r.pages, total: r.total,
      crop: r.crop.url, loc: r.locator.url, cw: r.crop.w, ch: r.crop.h }; return r; };
  });
  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('uq-name', 'ZZ VERIFY — delete me'); set('uq-disc', '0');
    set('uq-start', '2026-10-01'); set('uq-end', '2027-09-01');
  });
  await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
    .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
  await page.evaluate(() => document.getElementById('uq-go').click());
  assert(await until(page, () => !!window.__q, 30000), 'the PDF was built from the KBH drawing');

  const q = await sql(`SELECT q.quote_no, q.client_name, q.net_price, jsonb_array_length(q.schedule) rows,
      u.unit_no, _map_unit_state(u.id) st FROM unit_map_quotes q JOIN units u ON u.id=q.unit_id
     WHERE q.client_name='ZZ VERIFY — delete me'`);
  assert(q.length === 1 && /^QT-\d{4}-\d{5}$/.test(q[0].quote_no),
         'the quote was saved and numbered ' + (q[0] ? q[0].quote_no : '(none)'));
  assert(q[0].unit_no === avail, 'against ' + avail);
  assert(q[0].st === 'available', 'and ' + avail + ' is STILL available — a plan is not a hold');
  const res = await sql(`SELECT count(*)::int n FROM reservations r JOIN units u ON u.id=r.unit_id
     JOIN projects p ON p.id=u.project_id WHERE p.project_name='KHUSHAL BAGH HEIGHTS' AND r.status='active'`);
  assert(Number(res[0].n) === 0, 'and KBH still has no active reservation at all');

  // the crop must be of THIS unit — measured, not eyeballed
  const slot = avail.replace(/^UG-/, '');
  const geo = await sql(`SELECT points FROM unit_map_shapes WHERE artwork_id='${ART}' AND slot_code='${slot}'`);
  const pts = geo[0].points.map(p => [Number(p[0]), Number(p[1])]);
  const B = { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])),
              y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  const scan = await page.evaluate(url => new Promise(r => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const x = c.getContext('2d'); x.drawImage(i, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hits = 0;
      for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
        const p = (yy * c.width + xx) * 4;
        if (Math.abs(d[p] - 37) <= 10 && Math.abs(d[p + 1] - 99) <= 10 && Math.abs(d[p + 2] - 235) <= 10) {
          hits++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      r({ x0, y0, x1, y1, hits, w: c.width, h: c.height });
    };
    i.src = url;
  }), await page.evaluate(() => window.__q.loc));
  assert(scan.hits > 200, 'the locator marks the unit (' + scan.hits + ' accent pixels)');
  const near = (a, b) => Math.abs(a - b) <= 0.015;
  assert(near(scan.x0 / scan.w, B.x0) && near(scan.x1 / scan.w, B.x1) &&
         near(scan.y0 / scan.h, B.y0) && near(scan.y1 / scan.h, B.y1),
         'and it marks THE RIGHT ONE — mark at ' + (scan.x0 / scan.w).toFixed(3) + ',' + (scan.y0 / scan.h).toFixed(3) +
         '; ' + avail + ' is stored at ' + B.x0 + ',' + B.y0);
  await page.evaluate(() => { document.body.innerHTML =
    '<div style="padding:10px;font:13px system-ui"><b>crop</b><br><img src="' + window.__q.crop + '" style="width:100%;border:1px solid #ccc">' +
    '<br><br><b>locator</b><br><img src="' + window.__q.loc + '" style="width:100%;border:1px solid #ccc"></div>'; });
  await sleep(400);
  await shot(page, 'kbh-quote-crop-locator');

  step('Put the live tenant back exactly as it was');
  await sql(`DELETE FROM public.unit_map_quotes WHERE client_name='ZZ VERIFY — delete me'`);
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='${TOKEN}'`);
  const left = await sql(`SELECT (SELECT count(*)::int FROM unit_map_quotes q JOIN units u ON u.id=q.unit_id
       JOIN projects p ON p.id=u.project_id WHERE p.project_name='KHUSHAL BAGH HEIGHTS') quotes,
      (SELECT count(*)::int FROM sales_sessions WHERE session_token='${TOKEN}') sessions`);
  assert(Number(left[0].quotes) === 0 && Number(left[0].sessions) === 0,
         'test quote and test session removed — KBH carries no trace of this run');

  assert(errs.length === 0, 'no JS errors' + (errs.length ? ' — ' + errs[0] : ''));
  await browser.close(); server.close();
  console.log(`\n${'='.repeat(56)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots \u2192 migration_work/kbh_live/\n${'='.repeat(56)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.stack || e.message); process.exit(1); });
