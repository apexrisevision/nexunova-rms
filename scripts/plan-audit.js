/* ══ THE WHOLE PLATE, AUDITED ═══════════════════════════════════════════════
   Asked for by name: is anything missing, does every unit have a link, and is
   what the plate says about a unit — available or gone — actually what the
   system says about it?

   That last question is the one worth being afraid of. A plate that shows a
   sold shop as free sends a dealer to ask for something somebody already owns,
   and a plate that crosses out a free shop quietly stops it being sold. So the
   status is followed the whole way down and compared at every step:

     THE REGISTER          what units + the status tables actually hold
       ↓
     THE PUBLIC PAYLOAD    what the token'd call sends to a phone
       ↓
     THE PAINTED PLATE     what a shape on the drawing is wearing

   Three sources, derived by different code, compared unit by unit. Agreement
   between all three is worth something; agreement between two of them is not.

   Nothing is written. This only reports.

   node scripts/plan-audit.js
*/
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'),
      puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4207, BASE = 'http://127.0.0.1:' + PORT;
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
const ok = m => console.log('  \u2705 ' + m);
const bad = m => { console.log('  \u274C ' + m); FAILED = true; };

(async () => {
  /* ── 1. THE REGISTER ────────────────────────────────────────────────────
     Read straight from the tables, through the same two gates the desk uses:
     the mapped state of the unit, and whether the tenant's own status list
     says a unit in that status may be booked. Not through the RPC — that is
     the thing being audited. */
  const reg = await sql(`
    SELECT u.unit_no, u.floor_no, u.area::float8 AS area,
           public._map_unit_state(u.id) AS state,
           COALESCE(cs.is_available, false) AS bookable
      FROM public.units u
      LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
     WHERE u.project_id = '${AWAMI}'
       AND public._map_unit_state(u.id) <> 'retired'
     ORDER BY u.unit_no`);
  const truth = {};
  reg.forEach(r => {
    truth[r.unit_no] = (r.state === 'available' && r.bookable) ? 'available' : 'not_available';
  });
  console.log('\n\u2500\u2500 The register');
  const freeN = Object.values(truth).filter(v => v === 'available').length;
  console.log('   ' + reg.length + ' live units, ' + freeN + ' available, ' +
              (reg.length - freeN) + ' not');

  /* ── 2. THE PUBLIC PAYLOAD ──────────────────────────────────────────── */
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    VALUES ('${CO}','${DIR}','${AWAMI}','audit_probe', now() + interval '2 minutes');
    CREATE TEMP TABLE lk ON COMMIT DROP AS SELECT
      (public.create_availability_link('audit_probe','${AWAMI}','plan audit')->>'token') AS tok;
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability((SELECT tok FROM lk)) AS d;
    SELECT d::text AS payload FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].payload);
  const said = {};
  (payload.floors || []).forEach(f => (f.units || []).forEach(u => { said[u.n] = u.s; }));

  console.log('\n\u2500\u2500 The register against the public payload');
  const inReg = Object.keys(truth), inSaid = Object.keys(said);
  const missFromPayload = inReg.filter(u => !(u in said));
  const extraInPayload = inSaid.filter(u => !(u in truth));
  (missFromPayload.length === 0 && extraInPayload.length === 0)
    ? ok('the payload carries exactly the ' + inReg.length + ' live units the register holds')
    : bad('payload is missing ' + missFromPayload.length + ' (' + missFromPayload.slice(0, 8).join(', ') +
          ') and invents ' + extraInPayload.length + ' (' + extraInPayload.slice(0, 8).join(', ') + ')');
  const wrongState = inReg.filter(u => u in said && said[u] !== truth[u]);
  (wrongState.length === 0)
    ? ok('and every one of them carries the state the register gives it \u2014 ' +
         'no shop offered that is gone, none crossed out that is free')
    : bad(wrongState.length + ' units reach the phone with the WRONG state: ' +
          wrongState.slice(0, 10).map(u => u + ' (register ' + truth[u] + ', payload ' + said[u] + ')').join('; '));

  /* ── 3. THE PAINTED PLATE ───────────────────────────────────────────── */
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plans', 'manifest.json'), 'utf8'));
  const floors = manifest['awami-market'] || [];
  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  try {
    await page.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await page.evaluate(p => window._availPreview(p), payload);
    await sleep(400);

    for (const PFX of floors) {
      const idx = (payload.floors || []).findIndex(f => (f.units || []).length &&
        String(f.units[0].n).split('-')[0].toUpperCase() === PFX);
      if (idx < 0) { bad('no floor in the payload whose units start ' + PFX); continue; }
      const F = payload.floors[idx];
      console.log('\n\u2500\u2500 ' + F.floor_label + '  (' + PFX + ', ' + F.units.length + ' units)');

      await page.evaluate(i => { FLOOR = i; renderFloor(); }, idx);
      await page.waitForFunction(() => {
        const b = document.querySelector('#pv-in .base svg');
        return !!b && document.querySelectorAll('#pv-in .over .u').length > 0;
      }, { timeout: 30000 });
      await sleep(500);

      const painted = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('#pv-in .over .u').forEach(p => {
          out[p.getAttribute('data-u')] = {
            off: p.classList.contains('off'),
            tap: getComputedStyle(p).pointerEvents !== 'none',
            box: (b => ({ w: b.width, h: b.height }))(p.getBBox())
          };
        });
        return { units: out, crosses: document.querySelectorAll('#pv-in .over .x').length };
      });

      const want = F.units.map(u => u.n);
      const drawn = Object.keys(painted.units);
      const noShape = want.filter(u => !painted.units[u]);
      const notInFloor = drawn.filter(u => want.indexOf(u) < 0);
      (noShape.length === 0 && notInFloor.length === 0)
        ? ok('all ' + want.length + ' units of this floor are on the plate \u2014 none missing, none foreign')
        : bad((noShape.length ? noShape.length + ' units have no shape: ' + noShape.slice(0, 10).join(', ') : '') +
              (notInFloor.length ? '   ' + notInFloor.length + ' shapes belong to no unit here' : ''));

      const noTap = drawn.filter(u => !painted.units[u].tap);
      const tiny = drawn.filter(u => painted.units[u].box.w < 2 || painted.units[u].box.h < 2);
      (noTap.length === 0 && tiny.length === 0)
        ? ok('and every one of them is a live tap target of a usable size')
        : bad((noTap.length ? noTap.length + ' cannot be tapped: ' + noTap.slice(0, 8).join(', ') : '') +
              (tiny.length ? '   ' + tiny.length + ' are too small to hit: ' + tiny.slice(0, 8).join(', ') : ''));

      /* the crossing-out, against the register itself rather than the payload */
      const shownGone = drawn.filter(u => painted.units[u].off);
      const trulyGone = want.filter(u => truth[u] === 'not_available');
      const paintedFreeButGone = trulyGone.filter(u => painted.units[u] && !painted.units[u].off);
      const paintedGoneButFree = shownGone.filter(u => truth[u] === 'available');
      (paintedFreeButGone.length === 0 && paintedGoneButFree.length === 0)
        ? ok('the plate crosses out exactly the ' + trulyGone.length + ' the register says are gone \u2014 ' +
             'checked against the tables, not against the payload it was drawn from')
        : bad((paintedFreeButGone.length ? paintedFreeButGone.length + ' are GONE but drawn as free: ' +
                paintedFreeButGone.slice(0, 10).join(', ') : '') +
              (paintedGoneButFree.length ? '   ' + paintedGoneButFree.length + ' are FREE but crossed out: ' +
                paintedGoneButFree.slice(0, 10).join(', ') : ''));

      (painted.crosses === shownGone.length)
        ? ok('one cross per taken shop, ' + painted.crosses + ' of them \u2014 no cross without a shop under it')
        : bad(painted.crosses + ' crosses for ' + shownGone.length + ' tinted shops');
    }

    (errs.length === 0) ? ok('\nno page errors while drawing every plate')
                        : bad('page errors: ' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close(); server.close();
  }

  console.log(FAILED ? '\n\u274C THE AUDIT FOUND SOMETHING' : '\n\u2705 AUDIT CLEAN');
  process.exit(FAILED ? 1 : 0);
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
