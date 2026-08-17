/**
 * Unit map — click the RIGHT unit, and see only that unit. MEASURED.
 *
 *   node scripts/verify-unitmap-focus.js
 *
 * This harness exists because of a bug that reached the owner: every tap after the
 * first one re-opened whichever unit had been opened first. The cause was
 * setPointerCapture() on pointerdown — with the pointer captured by the stage, the
 * browser dispatches the CLICK to the stage, so the polygon's own handler never
 * runs. The earlier verifications missed it because they fired
 * dispatchEvent(new MouseEvent('click')) straight at the polygon, which bypasses
 * pointer capture entirely.
 *
 * So: every click here is page.mouse.click() at real screen coordinates, through
 * the browser's own event path, and SEVERAL units are clicked in a row — a bug that
 * only shows up from the second tap onwards cannot hide from that.
 *
 * Also measured, by photographing the stage and counting ink:
 *   · the map frames the units, not the sheet's margins and title band
 *   · after a click, what is left drawn lies inside the clicked unit
 *
 * ZZTEST first, as the house rule says. The live KBH pass at the end is read-only.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4207;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'unitmap_focus');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const stepH = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pc = v => (v * 100).toFixed(1) + '%';

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
let n = 0;
async function shot(page, name, clip) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot(clip ? { path: f, clip } : { path: f });
  console.log('     \u{1F4F7} ' + path.basename(f));
  return f;
}
const until = (page, fn, ms = 25000) =>
  page.waitForFunction(fn, { timeout: ms, polling: 120 }).then(() => true).catch(() => false);

/* Photograph the stage and count ink, inside the clicked unit and out. The
   screenshot is what a person sees, so it is the only honest thing to measure. */
async function ink(page, stage, poly) {
  const b64 = await page.screenshot({ clip: stage, encoding: 'base64' });
  const btn = await page.evaluate(() => {
    const b = document.getElementById('umv-out');
    if (!b || !b.offsetParent) return null;
    const r = b.getBoundingClientRect();
    return { left: r.left - 2, top: r.top - 2, right: r.right + 2, bottom: r.bottom + 2 };
  });
  return page.evaluate(({ b64, sx, sy, sw, poly, btn }) => new Promise(res => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const x = c.getContext('2d'); x.drawImage(i, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const k = c.width / sw;                                   // shot pixels per CSS pixel
      // inside the UNIT'S OWN OUTLINE, not its bounding box — the flats are not
      // rectangles and the slack in a bbox would flatter the result
      // The unit's own outline is stroked ON its boundary, so half the stroke falls
      // outside the path. That is the unit, not a neighbour — so a pixel counts as
      // "on this unit" if it is inside the path OR within the stroke of it.
      const TOL = 5;
      const hit = (px, py) => {
        let on = false, near = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const xa = poly[a][0], ya = poly[a][1], xb = poly[b][0], yb = poly[b][1];
          if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) on = !on;
          if (!near) {
            const dx = xb - xa, dy = yb - ya, L = dx * dx + dy * dy;
            let t = L ? ((px - xa) * dx + (py - ya) * dy) / L : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = px - (xa + t * dx), ey = py - (ya + t * dy);
            if (ex * ex + ey * ey <= TOL * TOL) near = true;
          }
        }
        return on || near;
      };
      let all = 0, inside = 0;
      for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
        const p = (yy * c.width + xx) * 4;
        if (Math.min(d[p], d[p + 1], d[p + 2]) >= 215) continue;   // paper, or paper under the veil
        const cx = xx / k + sx, cy = yy / k + sy;
        // the "All units" control is chrome, not the drawing — it is not what is
        // being measured here
        if (btn && cx >= btn.left && cx <= btn.right && cy >= btn.top && cy <= btn.bottom) continue;
        all++;
        if (poly && hit(cx, cy)) inside++;
      }
      res({ all, inside, outside: all - inside });
    };
    i.src = 'data:image/png;base64,' + b64;
  }), { b64, sx: stage.x, sy: stage.y, sw: stage.width, poly: poly || null, btn });
}
// the focused unit's outline, in the same screen coordinates the screenshot uses
const focusPoly = page => page.evaluate(() => {
  const p = document.querySelector('#umv-svg polygon[data-unit]'); if (!p) return null;
  const m = p.getScreenCTM(); const out = [];
  for (let i = 0; i < p.points.numberOfItems; i++) {
    const q = p.points.getItem(i).matrixTransform(m); out.push([q.x, q.y]);
  }
  return out;
});

(async () => {
  stepH('Draft tenant first');
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);
  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-focus%';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-focus', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One'`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function openMap(token, floorText) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1320, height: 900, deviceScaleFactor: 1.5 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now())); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    // The portal's service worker can reload the page once just after boot, which
    // detaches the frame under any wait in flight. Settle, then wait — and never let
    // that transient kill the run.
    await sleep(1500);
    try {
      await until(page, () => { const b = document.getElementById('app-body');
                                return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
      await page.waitForFunction(() => { const b = document.getElementById('app-body'); if (!b) return false;
        const now = b.innerHTML.length; if (window.__l === now) return true; window.__l = now; return false;
      }, { timeout: 25000, polling: 350 });
    } catch (e) { await sleep(1500); }
    await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    await page.evaluate(() => [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Unit map').click());
    await until(page, () => document.querySelectorAll('.umv-floor').length > 0);
    await page.evaluate(t => { const b = [...document.querySelectorAll('.umv-floor')]
      .find(x => x.textContent.includes(t) && !x.classList.contains('soon')); b.click(); }, floorText);
    await until(page, () => document.querySelectorAll('#umv-svg polygon').length > 0);
    await sleep(1500);                                  // let the opening fit settle
    return { page, errs };
  }

  const geo = page => page.evaluate(() => {
    const st = document.getElementById('umv-stage').getBoundingClientRect();
    const ps = [...document.querySelectorAll('#umv-svg polygon[data-unit]')];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ps.forEach(p => { const r = p.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
    return { stage: { x: st.x, y: st.y, width: st.width, height: st.height },
             units: { w: x1 - x0, h: y1 - y0 },
             polys: ps.length, labels: document.querySelectorAll('#umv-svg text').length,
             veil: !!document.querySelector('#umv-svg mask'),
             focusChrome: document.getElementById('umv-stage').classList.contains('focus'),
             sheet: (document.querySelector('.umv-sheet-in b') || {}).textContent || null };
  });

  // Where a unit's number sits on screen — a point that is inside that unit.
  const pointOn = (page, no) => page.evaluate(t => {
    const el = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === t);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, no);
  const focusedNo = page => page.evaluate(() => {
    const p = document.querySelector('#umv-svg polygon[data-unit]');
    const t = document.querySelector('#umv-svg text');
    return p && t ? t.textContent : null;
  });

  // ══ ZZTEST ══
  stepH('The whole floor, before any click');
  const A = await openMap('zz-focus', 'Upper Ground');
  const before = await geo(A.page);
  assert(before.polys === 30, '30 units drawn');
  assert(!before.veil && !before.focusChrome, 'no veil, no focus chrome yet');
  const fillW = before.units.w / before.stage.width, fillH = before.units.h / before.stage.height;
  assert(fillW > 0.9, 'the units fill ' + pc(fillW) + ' of the stage width — the sheet\'s margins are out of frame');
  assert(fillH > 0.55, 'and ' + pc(fillH) + ' of its height — the title band is out of frame');
  assert(before.stage.height > 400, 'the stage is ' + Math.round(before.stage.height) + 'px tall, not a letterbox');
  const inkBefore = await ink(A.page, before.stage, null);
  await shot(A.page, 'zz-01-whole-floor', before.stage);

  // ══ THE BUG: five real clicks, five different units ══
  stepH('Five real mouse clicks, five different units');
  const TARGETS = ['UG-08', 'UG-23', 'UG-14', 'UG-10B', 'UG-19'];
  const seen = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const no = TARGETS[i];
    const pt = await pointOn(A.page, no);
    if (!assert(!!pt, no + ' is on the map')) continue;
    await A.page.mouse.click(pt.x, pt.y);            // a REAL click, not a synthetic event
    await until(A.page, () => document.querySelector('#umv-svg mask'), 8000);
    await sleep(900);
    const got = await focusedNo(A.page);
    const g = await geo(A.page);
    seen.push(got);
    assert(got === no, 'click ' + (i + 1) + ' on ' + no + ' \u2192 focused ' + got +
           (got === no ? '' : '   \u2190 WRONG UNIT'));
    assert(g.sheet === no, '   and the sheet reads ' + g.sheet);
    assert(g.polys === 1 && g.labels === 1, '   exactly one unit left on the layer');
    if (i === 0) await shot(A.page, 'zz-02-focused-' + no, g.stage);
    if (i === 1) await shot(A.page, 'zz-03-focused-' + no, g.stage);
    if (i === 3) await shot(A.page, 'zz-04-focused-' + no, g.stage);
    await A.page.evaluate(() => document.getElementById('umv-out').click());
    await until(A.page, () => document.querySelectorAll('#umv-svg polygon[data-unit]').length === 30, 8000);
    await sleep(800);
  }
  assert(new Set(seen).size === TARGETS.length,
         'five clicks produced five DIFFERENT units: ' + seen.join(', '));

  // ══ the focused state, measured in pixels ══
  stepH('What the client actually sees when one unit is open');
  const T = 'UG-08';
  const uBefore = await A.page.evaluate(no => {
    const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === no);
    const r = t.previousElementSibling.getBoundingClientRect();
    return { w: r.width, h: r.height, area: r.width * r.height };
  }, T);
  const dur = await A.page.evaluate(() => getComputedStyle(document.getElementById('umv-pan')).transitionDuration);
  const pt = await pointOn(A.page, T);
  // Sample the transform right through the flight. The zoom only begins once the
  // server has answered, so one fixed-delay sample proves nothing either way — a run
  // of distinct intermediate values is what tells a glide from a jump.
  await A.page.evaluate(() => { window.__f = [];
    window.__t = setInterval(() => window.__f.push(getComputedStyle(document.getElementById('umv-pan')).transform), 45); });
  await A.page.mouse.click(pt.x, pt.y);
  await sleep(1500);
  const frames = await A.page.evaluate(() => { clearInterval(window.__t); return window.__f; });
  const distinct = [...new Set(frames)];
  assert(parseFloat(dur) >= 0.3, 'the pan carries a real transition (' + dur + ') — it glides, it does not snap');
  assert(distinct.length >= 4, 'and it was watched in flight: ' + distinct.length +
         ' distinct transforms across ' + frames.length + ' samples (a jump would give 2)');

  const after = await geo(A.page);
  assert(after.veil && after.focusChrome, 'a veil with a hole cut in it covers the rest of the drawing');
  const uAfter = await A.page.evaluate(() => {
    const r = document.querySelector('#umv-svg polygon[data-unit]').getBoundingClientRect();
    return { w: r.width, h: r.height, area: r.width * r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  assert(uAfter.area / uBefore.area > 8, T + ' grew ' + (uAfter.area / uBefore.area).toFixed(1) +
         '\u00d7 (' + Math.round(uBefore.w) + '\u00d7' + Math.round(uBefore.h) + 'px \u2192 ' +
         Math.round(uAfter.w) + '\u00d7' + Math.round(uAfter.h) + 'px)');
  const cover = Math.max(uAfter.w / after.stage.width, uAfter.h / after.stage.height);
  assert(cover > 0.6, 'it now fills ' + pc(cover) + ' of the stage');
  const poly = await focusPoly(A.page);
  const inkAfter = await ink(A.page, after.stage, poly);
  const conc = inkAfter.inside / Math.max(1, inkAfter.all);
  assert(conc > 0.95, pc(conc) + ' of every drawn pixel on the stage now lies INSIDE ' + T +
         '’s own outline — the client is looking at that flat and nothing else');
  assert(inkAfter.outside < inkBefore.all * 0.06,
         'the surroundings collapsed from ' + inkBefore.all.toLocaleString('en-US') + ' drawn pixels to ' +
         inkAfter.outside.toLocaleString('en-US') + ' (' + pc(inkAfter.outside / inkBefore.all) + ') — the rest of the floor is gone');

  stepH('The way back');
  const outBtn = await A.page.evaluate(() => {
    const b = document.getElementById('umv-out'); if (!b) return null;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: b.textContent.trim(), visible: !!b.offsetParent, hit: !!el && (el === b || b.contains(el)),
             x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  assert(outBtn && outBtn.visible && outBtn.hit, 'a way out is on screen and clickable: "' + (outBtn || {}).text + '"');
  await A.page.mouse.click(outBtn.x, outBtn.y);
  await sleep(1100);
  const back = await geo(A.page);
  assert(back.polys === 30, 'all 30 units are back');
  assert(!back.veil && !back.focusChrome, 'the veil is gone and focus mode is off');
  assert(Math.abs(back.units.w / back.stage.width - fillW) < 0.03, 'and the framing returned to where it started');
  await shot(A.page, 'zz-05-back-to-floor', back.stage);

  stepH('Dragging the map must not open a unit');
  const dragFrom = await pointOn(A.page, 'UG-14');
  await A.page.mouse.move(dragFrom.x, dragFrom.y);
  await A.page.mouse.down();
  for (let i = 1; i <= 8; i++) { await A.page.mouse.move(dragFrom.x - i * 9, dragFrom.y - i * 5); await sleep(16); }
  await A.page.mouse.up();
  await sleep(700);
  const afterDrag = await geo(A.page);
  assert(!afterDrag.veil && afterDrag.polys === 30, 'a pan that ends over a unit does not open it');
  assert(A.errs.length === 0, 'no JS errors' + (A.errs.length ? ' — ' + A.errs[0] : ''));
  await A.page.close();

  // ══ LIVE KBH — read-only ══
  stepH('The same thing on live KBH (read-only)');
  await sql(`INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-focus-kbh', now()+interval '20 minutes'
      FROM public.sales_users WHERE full_name='Rashid Manzoor'`);
  const B = await openMap('zz-focus-kbh', 'Upper Ground');
  const kb = await geo(B.page);
  assert(kb.polys === 30, 'KBH Upper Ground draws 30 units');
  assert(kb.units.w / kb.stage.width > 0.9, 'framed to the building: ' + pc(kb.units.w / kb.stage.width) + ' of the stage width');
  await shot(B.page, 'kbh-01-whole-floor', kb.stage);
  for (const no of ['UG-14', 'UG-01', 'UG-22']) {
    const p = await pointOn(B.page, no);
    await B.page.mouse.click(p.x, p.y);
    await until(B.page, () => document.querySelector('#umv-svg mask'), 8000);
    await sleep(900);
    const got = await focusedNo(B.page);
    assert(got === no, 'clicked ' + no + ' on live KBH \u2192 focused ' + got);
    if (no === 'UG-14') {
      const g = await geo(B.page);
      const ki = await ink(B.page, g.stage, await focusPoly(B.page));
      assert(ki.inside / Math.max(1, ki.all) > 0.95,
             pc(ki.inside / Math.max(1, ki.all)) + ' of every drawn pixel is inside UG-14’s outline');
      await shot(B.page, 'kbh-02-focused-UG-14', g.stage);
      await shot(B.page, 'kbh-03-full-screen');
    }
    await B.page.evaluate(() => document.getElementById('umv-out').click());
    await until(B.page, () => document.querySelectorAll('#umv-svg polygon[data-unit]').length === 30, 8000);
    await sleep(700);
  }
  assert(B.errs.length === 0, 'no JS errors on live' + (B.errs.length ? ' — ' + B.errs[0] : ''));
  await B.page.close();

  stepH('Clean up');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-focus%'`);
  const left = await sql(`SELECT count(*)::int n FROM sales_sessions WHERE session_token LIKE 'zz-focus%'`);
  assert(Number(left[0].n) === 0, 'sessions removed');

  await browser.close(); server.close();
  console.log(`\n${'='.repeat(56)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots \u2192 migration_work/unitmap_focus/\n${'='.repeat(56)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.stack || e.message); process.exit(1); });
