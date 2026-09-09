/**
 * The floor plan on the public link — drawn, coloured and tapped.
 *
 * Everything here runs against AWAMI'S REAL PAYLOAD, captured inside a
 * transaction that is rolled back, and the drawing served the way Vercel will
 * serve it. Nothing is written anywhere.
 *
 * What it has to prove, in the order it matters:
 *   1. the architect's linework is on the page, not a redrawing of it
 *   2. every unit the floor holds has a shape, and the shapes are that floor's
 *   3. what is crossed out is exactly what the system says is gone
 *   4. tapping a free shop opens the same sheet a chip opens
 *   5. tapping a taken one opens nothing
 *
 *   node scripts/shot-floorplan.js
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'),
      puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4201, BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, 'marketing_shots', 'floorplan');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const DIR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const body = JSON.stringify({ query: q });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
               '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end('nf');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}

let FAILED = false;
const okP = m => console.log('  ✅ ' + m);
const badP = m => { console.log('  ❌ ' + m); FAILED = true; };
const ok = m => console.log('  \u2705 ' + m);
const bad = m => { console.log('  \u274C ' + m); FAILED = true; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES ('${CO}','${DIR}','${AWAMI}','fp_probe', now() + interval '2 minutes');
    CREATE TEMP TABLE lk ON COMMIT DROP AS SELECT
      (public.create_availability_link('fp_probe','${AWAMI}','floor plan probe')->>'token') AS tok;
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability((SELECT tok FROM lk)) AS d;
    SELECT d::text AS payload FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].payload);
  const lg = (payload.floors || []).findIndex(f => /lower ground/i.test(f.floor_label));
  if (lg < 0) { console.log('no Lower Ground in the payload'); process.exit(1); }
  const F = payload.floors[lg];
  const gone = F.units.filter(u => u.s !== 'available');
  console.log('\n\u2500\u2500 The floor as it was drawn');
  console.log('   ' + F.floor_label + ': ' + F.units.length + ' units, ' +
              (F.units.length - gone.length) + ' available, ' + gone.length + ' not');

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  try {
    await page.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await page.evaluate(p => window._availPreview(p), payload);
    await sleep(400);
    await page.evaluate(i => { FLOOR = i; renderFloor(); }, lg);
    await page.waitForFunction(() => {
      const b = document.querySelector('#pv-in .base svg');
      return !!b && document.querySelectorAll('#pv-in .over .u').length > 0;
    }, { timeout: 30000 });
    await sleep(600);

    const seen = await page.evaluate(() => ({
      basePaths: document.querySelectorAll('#pv-in .base svg path').length,
      shapes: document.querySelectorAll('#pv-in .over .u').length,
      off: document.querySelectorAll('#pv-in .over .u.off').length,
      crosses: document.querySelectorAll('#pv-in .over .x').length,
      names: document.querySelectorAll('#pv-in .over .n').length,
      listHidden: document.getElementById('units').hidden,
      note: (document.getElementById('pv-note') || {}).textContent || '',
      ids: [...document.querySelectorAll('#pv-in .over .u')].map(p => p.getAttribute('data-u'))
    }));

    seen.basePaths > 400
      ? ok('the architect\u2019s own linework is on the page \u2014 ' + seen.basePaths +
           ' paths, walls and columns and stairs, not a redrawing')
      : bad('the drawing did not load: ' + seen.basePaths + ' paths');
    /* The one unit whose walls have a gap has no shape yet, and is named rather
       than quietly missing. */
    const want = new Set(F.units.map(u => u.n));
    const have = new Set(seen.ids);
    const missing = [...want].filter(u => !have.has(u));
    const stray = [...have].filter(u => !want.has(u));
    (stray.length === 0 && missing.length <= 1)
      ? ok(seen.shapes + ' of ' + F.units.length + ' units have a shape' +
           (missing.length ? ', and the one that does not is ' + missing[0] : '') +
           ' \u2014 and every shape belongs to this floor')
      : bad('shapes do not match the floor: missing ' + missing.length +
            ' ' + missing.slice(0, 5).join(',') + '  stray ' + stray.slice(0, 5).join(','));
    (seen.off === seen.crosses && Math.abs(seen.off - gone.length) <= 1)
      ? ok('what is crossed out is what the system says is gone \u2014 ' + seen.crosses +
           ' crosses against ' + gone.length + ' taken units')
      : bad('crosses ' + seen.crosses + ', tinted ' + seen.off + ', taken ' + gone.length);
    (seen.names === seen.shapes)
      ? ok('and every shop carries its label as real text, not as an outline')
      : bad('labels drawn: ' + seen.names + ' for ' + seen.shapes + ' shapes');

    /* ── THE THREE LINES THE ARCHITECT PRINTED ───────────────────────────
       The sheet writes the number, what the thing is and how big it is, one
       under the other, and a dealer reads all three. They are painted from
       the register rather than lifted off the drawing, so this asks the page
       what it wrote and holds it against what the register says — the full
       code (LG-85, not 85), the type in the tenant’s own words, and the area
       with its unit. */
    const labels = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#pv-in .over .n').forEach(t => {
        const l = [...t.querySelectorAll('tspan')].map(x => x.textContent);
        if (l.length) out[l[0]] = l;
      });
      return out;
    });
    const fmt = a => Number(a).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' sqft';
    const wrong = F.units.filter(u => have.has(u.n)).filter(u => {
      const l = labels[u.n];
      return !l || l.length !== 3 ||
             l[1] !== String(u.t || '').toUpperCase() ||
             l[2] !== fmt(u.a);
    });
    (wrong.length === 0)
      ? ok('and each one says its full code, its type and its size — e.g. ' +
           (labels[F.units.find(u => have.has(u.n)).n] || []).join(' / '))
      : bad(wrong.length + ' labels disagree with the register, first: ' + wrong[0].n +
            ' → ' + JSON.stringify(labels[wrong[0].n]) + ' vs ' +
            JSON.stringify([wrong[0].n, wrong[0].t, wrong[0].a]));

    /* A type on the wire is worth nothing if it is somebody else’s idea of the
       type: it comes from the tenant’s own category list, and the page must
       not be inventing one when the register has none. */
    const typed = F.units.filter(u => u.t).length;
    (typed === F.units.length)
      ? ok('every unit on the floor carries a type from the register (' + typed + ')')
      : bad(F.units.length - typed + ' units reach the page with no type at all');
    /* ── AND THE SHAPES ARE WHERE THE ROOMS ARE ──────────────────────────
       Everything above passed once while every outline sat off the sheet at
       negative coordinates: the runs are pixels inside the tile the flood ran
       in, and the offset was dropped converting them back. The numbers were
       fine — they come from the bounding box, which was converted correctly —
       so the page looked right and the drawing carried nothing.

       Two questions settle it. Is the shape ON the sheet, and does the unit’s
       own number fall INSIDE its own shape? The two are derived by different
       routes, so agreeing is worth something. */
    const placed = await page.evaluate(() => {
      const svg = document.querySelector('#pv-in .over');
      const vb = svg.viewBox.baseVal;
      let off = 0, apart = 0, checked = 0;
      const boxes = {};
      svg.querySelectorAll('.u').forEach(p => {
        const b = p.getBBox();
        boxes[p.getAttribute('data-u')] = b;
        checked++;
        if (b.x < -1 || b.y < -1 || b.x + b.width > vb.width + 1 || b.y + b.height > vb.height + 1) off++;
      });
      /* NOT THE CENTRE OF THE LABEL — THE WHOLE OF IT. A block can sit with its
         middle in the right shop and its last line out on the wall, which is
         exactly what LG-46 did: the label was fitted to a bounding box and that
         shop wraps around the stairwell. The centre-point test passed while a
         reader could see the text outside the room, so it is the four corners
         that are asked about now. */
      /* AGAINST THE OUTLINE, NOT AGAINST A BOX AROUND IT. Checking the label
         against the shape's bounding box was no check at all for the shops
         this is about: LG-46 wraps around the stairwell, so its box covers the
         stairs too and a label sitting on them passed. The browser can answer
         the real question about the real outline — isPointInFill — so the four
         corners of the block are put to it one by one. */
      const spill = [];
      const shapes = {};
      svg.querySelectorAll('.u').forEach(p => { shapes[p.getAttribute('data-u')] = p; });
      svg.querySelectorAll('.n').forEach(t => {
        const b = t.getBBox();
        const own = shapes[t.getAttribute('data-n')];
        if (!own) { apart++; return; }
        /* a hair inside, so a letter resting exactly on a wall is not a spill */
        const ix = Math.min(b.width * 0.06, 0.4), iy = Math.min(b.height * 0.06, 0.4);
        const corners = [[b.x + ix, b.y + iy], [b.x + b.width - ix, b.y + iy],
                         [b.x + ix, b.y + b.height - iy], [b.x + b.width - ix, b.y + b.height - iy]];
        const outside = corners.filter(c => {
          const pt = svg.createSVGPoint(); pt.x = c[0]; pt.y = c[1];
          return !own.isPointInFill(pt);
        }).length;
        if (outside) spill.push(t.getAttribute('data-n') + '(' + outside + '/4)');
      });
      return { checked: checked, off: off, apart: apart, spill: spill, w: vb.width, h: vb.height };
    });
    (placed.off === 0)
      ? okP('every one of the ' + placed.checked + ' shapes lands inside the drawing — ' +
           'none off the sheet')
      : badP(placed.off + ' shapes are outside the drawing: ' + JSON.stringify(placed));
    (placed.apart === 0 && placed.spill.length === 0)
      ? okP('and every label sits wholly inside its own shop — all four corners of ' +
           'all ' + placed.checked + ' put to the outline itself, not to a box round it')
      : badP((placed.apart ? placed.apart + ' labels belong to no shape. ' : '') +
             (placed.spill.length ? placed.spill.length + ' spill out of their own shop: ' +
              placed.spill.slice(0, 6).join(', ') : ''));

    /* ── THE TAP LANDS ON THE SHOP, INCLUDING ON ITS NAME ────────────────
       Reported from the phone: a shop answered in some places and not in
       others, and took several tries. The label lies in the middle of the shop
       and the cross lies across it, and both are drawn after it — so the
       likeliest spot for a thumb was the one spot that did nothing. This asks
       the page what is under the middle of every label, and then actually taps
       one there. */
    const under = await page.evaluate(() => {
      const out = { wrong: [], checked: 0 };
      document.querySelectorAll('#pv-in .over .n').forEach(t => {
        const r = t.getBoundingClientRect();
        if (r.width < 1 || r.bottom < 0 || r.top > innerHeight) return;   // off screen, not asked
        out.checked++;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const owner = hit && hit.closest ? hit.closest('[data-u]') : null;
        if (!owner || owner.getAttribute('data-u') !== t.getAttribute('data-n')) {
          out.wrong.push(t.getAttribute('data-n') + ' → ' + (owner ? owner.getAttribute('data-u') : (hit && hit.tagName)));
        }
      });
      return out;
    });
    (under.checked > 5 && under.wrong.length === 0)
      ? ok('the middle of every label on screen belongs to its own shop — ' +
           under.checked + ' checked, none blocked by the text or the cross')
      : bad(under.wrong.length + ' of ' + under.checked + ' labels are not tappable: ' +
            under.wrong.slice(0, 5).join('; '));

    seen.listHidden
      ? ok('the chip list steps aside while the plan is up \u2014 it is one tap away')
      : bad('both the plan and the chip list are on screen at once');

    await page.screenshot({ path: path.join(OUT, 'a-plan.png') });
    /* and further down, where the taken shops are: the crosses are the point */
    /* zoomed, because a cross ten pixels wide proves nothing in a photograph */
    await page.evaluate(() => { PLANZ = 3; const el = document.getElementById('pv-in'); if (el) el.style.width = '300%'; });
    await sleep(400);
    await page.evaluate(() => window.scrollTo(0, 2600));
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'a2-plan-crossed.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);

    /* ── the tap ─────────────────────────────────────────────────────────── */
    const free = F.units.find(u => u.s === 'available');
    const taken = gone[0];
    /* A REAL TAP, ON THE NAME, WITH A REAL MOUSE. Dispatching a click straight
       at the shape proves the handler works and nothing else — it walks past
       whatever is lying on top, which is the bug that was reported. This aims
       at the middle of the label, the way a thumb does. */
    const spot = await page.evaluate(no => {
      const t = document.querySelector('#pv-in .over .n[data-n="' + no + '"]');
      if (!t) return null;
      t.scrollIntoView({ block: 'center' });
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, free.n);
    if (spot) await page.mouse.click(spot.x, spot.y);
    await sleep(250);
    const tap = spot ? await page.evaluate(() => ({
      open: document.getElementById('sheet').classList.contains('on'),
      unit: (window.SHEET || {}).n
    })) : { err: 'no label for ' + free.n };
    (tap.open && tap.unit === free.n)
      ? ok('tapping ' + free.n + ' — on its printed name, with a real mouse — opens ' +
           'the same sheet a chip opens')
      : bad('the tap did not open the sheet: ' + JSON.stringify(tap));
    await page.screenshot({ path: path.join(OUT, 'b-plan-sheet.png') });

    const tap2 = await page.evaluate(no => {
      closeSheet();
      const p = document.querySelector('#pv-in .over .u[data-u="' + no + '"]');
      if (!p) return { err: 'no shape for ' + no };
      p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { open: document.getElementById('sheet').classList.contains('on') };
    }, taken.n);
    (tap2 && tap2.open === false)
      ? ok('and tapping ' + taken.n + ', which is taken, opens nothing')
      : bad('a taken unit opened the sheet: ' + JSON.stringify(tap2));

    /* ── the weight ──────────────────────────────────────────────────────── */
    const svgB = fs.statSync(path.join(ROOT, 'plans', 'awami-market', 'LG.svg')).size;
    const jsonB = fs.statSync(path.join(ROOT, 'plans', 'awami-market', 'LG.json')).size;
    const gz = require('zlib');
    const gzTotal = gz.gzipSync(fs.readFileSync(path.join(ROOT, 'plans', 'awami-market', 'LG.svg'))).length +
                    gz.gzipSync(fs.readFileSync(path.join(ROOT, 'plans', 'awami-market', 'LG.json'))).length;
    (gzTotal < 120 * 1024)
      ? ok('the whole floor costs ' + Math.round(gzTotal / 1024) + ' KB over the wire ' +
           '(' + Math.round((svgB + jsonB) / 1024) + ' KB raw) \u2014 the sheet it came from is 9 MB')
      : bad('the floor weighs ' + Math.round(gzTotal / 1024) + ' KB gzipped');
    /* the drawing is a brochure, and must carry nothing that is not */
    const plan = fs.readFileSync(path.join(ROOT, 'plans', 'awami-market', 'LG.json'), 'utf8');
    !/price|client|phone|sold|hold|reserved|status/i.test(plan)
      ? ok('and the drawing files carry geometry only \u2014 no price, no holder, no status')
      : bad('the plan file carries something it should not');

    const real = errs.filter(e => !/favicon|manifest|404/i.test(e));
    real.length === 0 ? ok('no page errors') : bad('page errors: ' + real.slice(0, 2).join(' | '));

    console.log('\n' + (FAILED ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
    process.exitCode = FAILED ? 1 : 0;
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
