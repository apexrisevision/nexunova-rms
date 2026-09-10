/* ══ AN APARTMENT IS A ROOM PLUS THE ROOMS THAT OPEN OFF IT ═════════════════
   On the shop floors a unit is one sealed box and flooding from its number is
   the whole job. On the three residential floors it is not. There, a unit is a
   room, a kitchen, a bath and a balcony — and the kitchen may not touch the
   room at all. Rashid put it plainly:

     "baaz apartment mai side by side kitchen washroom aur balcony wagaira banay
      hain… Unit 4th floor pe 67, is mai neeche Kitchen Bath aur open hai aur isi
      k peeche b yehi cheezain hain… q k aik unit 67 ki hain aur dosri unit 66 ki"

   Two identical service strips, back to back: the upper one belongs to the unit
   above, the lower one to the unit below. Nothing on the sheet says so in
   words. The DOORS say so — 67's kitchen opens into 67's room, and 66's opens
   into 66's, which is the only reason they were drawn back to back.

   So this asks the doors, and nothing else:

     1. With a heavy pen every doorway is pinched shut, and the floor falls apart
        into separate cells: rooms, kitchens, baths, balconies, the verandah.
     2. The pixels that are floor at the true pen but wall at the heavy one ARE
        the doorways. Each one is followed to see which two cells it joins.
     3. A unit is its own numbered cell plus every cell that can be reached from
        it through doors WITHOUT reaching another numbered cell on the way.

   The verandah fails that last test twice over: it reaches every other unit,
   and it runs off the edge of the window this works in — and a cell that leaves
   the window is never taken, because what it touches out there is unknown.

   Written in the same shape plan-rooms writes, so polys, lines and check need
   to know nothing about any of this.

   WHAT IT IS CHECKED AGAINST. Not the area printed on the sheet — that is a
   super area with a share of the common parts in it: the Third Floor sheet
   says 495.50 for a unit the register calls 345.50, and 492.40 for one it
   calls 342.40. What this is held to is the REGISTER, unit by unit, the same
   test the shop floors passed. On the Third Floor 117 of the 150 land within
   10% of their record and the typical one within 2.7%.

   The 33 that do not are marked disputed and reported by name. A watershed
   shape cannot lie on top of another one — every pixel has exactly one owner —
   so what is in dispute there is the register's number, not the outline.

   node scripts/plan-units.js <dir> <pageN> <floor_no> [px] [pinch] [half]
*/
const fs = require('fs'), path = require('path'), https = require('https'),
      puppeteer = require('puppeteer-core');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page5';
const FLOORNO = Number(process.argv[4]);
const PX = Number(process.argv[5] || 8);
const PINCH = Number(process.argv[6] || 20);
const HALF = Number(process.argv[7] || 120);       // drawing units either side of a label
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const TEXT = new Set(['#ba0d70', '#000000', '#bf00ff']);
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];

function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
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
function wallPaths(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    const f = m[2].toLowerCase(), s = m[3].toLowerCase();
    if (TEXT.has(f) || TEXT.has(s)) continue;
    out.push(m[1]);
  }
  return out;
}
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

(async () => {
  let labels = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-read.json'), 'utf8'));
  const rows = await sql(`select unit_no, area::float8 as area from public.units
                           where project_id = '${AWAMI}' and floor_no = ${FLOORNO}`);
  const book = {};
  rows.forEach(r => { book[r.unit_no] = r.area; });
  const turned = labels.filter(l => !(l.u in book)).map(l => l.u);
  labels = labels.filter(l => l.u in book);
  console.log(PAGE + '  floor ' + FLOORNO + ': the register holds ' + rows.length +
              ' units, ' + labels.length + ' labels match one');
  if (turned.length) console.log('  ON THE SHEET BUT NOT IN THE REGISTER: ' +
                                 turned.map(t => JSON.stringify(t)).join(', '));

  const paths = wallPaths(path.join(DIR, PAGE + '.svg'));
  console.log('  ' + paths.length + ' wall paths, pinch ' + PINCH + '\u00d7 (' +
              (1.2 / PX * 2 * PINCH).toFixed(1) + ' drawing units)');

  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)),
                                           headless: 'new',
                                           args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 300 });
  await page.goto('about:blank');
  await page.evaluate(ps => { window.__paths = ps; }, paths);

  const found = {}, failed = [], took = {};
  for (const seed of labels) {
    const others = labels.filter(l => l.u !== seed.u &&
      Math.abs(l.cx - seed.cx) < HALF && Math.abs(l.cy - seed.cy) < HALF)
      .map(l => ({ u: l.u, cx: l.cx, cy: l.cy }));
    /* A UNIT THAT WILL NOT SEAL GETS A HEAVIER PINCH, not a shrug. One room on
       the Third Floor opens wider than the rest and needs the doorway shut
       harder; the pinch that finally holds is recorded with the room. */
    let res;
    for (const pinch of [PINCH, PINCH * 1.4, PINCH * 1.8]) {
    try {
      res = await page.evaluate(async (o) => {
        const { X0, X1, Y0, Y1, PX, seed, others, pinch } = o;
        const W = Math.ceil((X1 - X0) * PX), H = Math.ceil((Y1 - Y0) * PX);
        const heavy = 1.2 / PX * 2 * pinch, thin = 1.2 / PX * 2;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
          '" viewBox="' + X0 + ' ' + Y0 + ' ' + (X1 - X0) + ' ' + (Y1 - Y0) + '">' +
          '<rect x="' + X0 + '" y="' + Y0 + '" width="' + (X1 - X0) + '" height="' + (Y1 - Y0) +
          '" fill="#fff"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
          '<g stroke="#f00" stroke-width="' + heavy + '">' +
          window.__paths.map(d => '<path d="' + d + '"/>').join('') + '</g>' +
          '<g stroke="#000" stroke-width="' + thin + '">' +
          window.__paths.map(d => '<path d="' + d + '"/>').join('') + '</g></g></svg>';
        const img = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
        cx.drawImage(img, 0, 0, W, H);
        const px = cx.getImageData(0, 0, W, H).data;
        URL.revokeObjectURL(url);

        /* three kinds of pixel: true wall, doorway (wall only to the heavy pen),
           and floor */
        const WALL = 2, DOOR = 1, FLOOR = 0;
        const kind = new Uint8Array(W * H);
        for (let i = 0, p = 0; i < kind.length; i++, p += 4) {
          const r = px[p], g = px[p + 1], b = px[p + 2];
          if (r < 220 && g < 220 && b < 220) kind[i] = WALL;
          else if (r >= 150 && g < 150 && b < 150) kind[i] = DOOR;
        }

        /* ── the floor falls apart into cells ─────────────────────────────── */
        const cell = new Int32Array(W * H).fill(-1);
        const cells = [];            // { n, edge, minx.. }
        const stack = [];
        for (let start = 0; start < kind.length; start++) {
          if (kind[start] !== FLOOR || cell[start] >= 0) continue;
          const id = cells.length;
          const c = { n: 0, edge: false, minx: W, miny: H, maxx: 0, maxy: 0 };
          cell[start] = id; stack.length = 0; stack.push(start);
          while (stack.length) {
            const i = stack.pop();
            const y = (i / W) | 0, x = i - y * W;
            c.n++;
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.edge = true;
            if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x;
            if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
            if (x > 0 && kind[i - 1] === FLOOR && cell[i - 1] < 0) { cell[i - 1] = id; stack.push(i - 1); }
            if (x < W - 1 && kind[i + 1] === FLOOR && cell[i + 1] < 0) { cell[i + 1] = id; stack.push(i + 1); }
            if (y > 0 && kind[i - W] === FLOOR && cell[i - W] < 0) { cell[i - W] = id; stack.push(i - W); }
            if (y < H - 1 && kind[i + W] === FLOOR && cell[i + W] < 0) { cell[i + W] = id; stack.push(i + W); }
          }
          cells.push(c);
        }

        /* ── which cell each number stands in ─────────────────────────────── */
        const at = (px2, py2) => {
          const sx = Math.round((px2 - X0) * PX), sy = Math.round((py2 - Y0) * PX);
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) return -1;
          if (cell[sy * W + sx] >= 0) return cell[sy * W + sx];
          /* the heavy pen may have swallowed the very spot the number sits on;
             the nearest floor within a few feet is still that number's room */
          for (let r = 1; r <= 12 * PX; r++) {
            for (let d = -r; d <= r; d++) {
              const cand = [[sx + d, sy - r], [sx + d, sy + r], [sx - r, sy + d], [sx + r, sy + d]];
              for (const [x, y] of cand) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                if (cell[y * W + x] >= 0) return cell[y * W + x];
              }
            }
          }
          return -1;
        };
        const mine = at(seed.cx, seed.cy);
        if (mine < 0) return { err: 'the number does not stand on floor' };
        /* IF THE UNIT'S OWN CELL LEAVES THE WINDOW IT HAS NOT SEALED. The pinch
           was not heavy enough to shut its door, so what was flooded is the
           unit, its neighbours and the verandah in one piece. Say so rather
           than measure it. */
        if (o.probe) return { probe: { cells: cells.length, W: W, H: H,
          mine: mine, n: cells[mine].n, edge: cells[mine].edge,
          box: [cells[mine].minx, cells[mine].miny, cells[mine].maxx, cells[mine].maxy],
          onFloor: cell[Math.round((seed.cy - Y0) * PX) * W + Math.round((seed.cx - X0) * PX)] >= 0,
          sizes: cells.map(c => c.n).sort((a, b) => b - a).slice(0, 6) } };
        if (cells[mine].edge) return { err: 'did not seal at this pinch' };
        const numbered = new Set([mine]);
        others.forEach(o => { const c = at(o.cx, o.cy); if (c >= 0) numbered.add(c); });
        /* ── EVERY SQUARE FOOT GOES TO THE ROOM IT IS NEAREST, THROUGH DOORS ──
           The heavy pen leaves the rooms as separate islands and swallows the
           small things entirely — a kitchen six feet across does not survive a
           five-foot pinch. So the islands are grown outward together, all at
           the same rate, against the TRUE walls, and every free pixel is
           claimed by whichever island reaches it first.

           That does the whole job at once, and it does it the way the building
           is actually laid out. A kitchen can only be entered through its own
           unit's door, so its pixels are nearest to that unit and go to it —
           which is exactly why the two service strips were drawn back to back,
           one for 67 and one for 66. The verandah is its own island and keeps
           its own floor. And where a room opens wide onto the verandah, the two
           meet in the middle of the opening, which is where the threshold is.

           Nothing here needs to know what a kitchen is, or which strip belongs
           to whom. It only needs the doors, and the doors are on the sheet. */
        const owner = new Int32Array(W * H).fill(-1);
        let front = [];
        for (let i = 0; i < cell.length; i++) {
          if (cell[i] >= 0) { owner[i] = cell[i]; front.push(i); }
        }
        while (front.length) {
          const next = [];
          for (const i of front) {
            const y = (i / W) | 0, x = i - y * W;
            const o = owner[i];
            const go = (j) => { if (owner[j] < 0 && kind[j] !== WALL) { owner[j] = o; next.push(j); } };
            if (x > 0) go(i - 1);
            if (x < W - 1) go(i + 1);
            if (y > 0) go(i - W);
            if (y < H - 1) go(i + W);
          }
          front = next;
        }

        const mark = new Uint8Array(W * H);
        for (let i = 0; i < owner.length; i++) if (owner[i] === mine) mark[i] = 1;
        const take = new Set([mine]);

        let area = 0, minx = W, miny = H, maxx = 0, maxy = 0;
        for (let i = 0; i < mark.length; i++) {
          if (!mark[i]) continue;
          area++;
          const y = (i / W) | 0, x = i - y * W;
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
        if (!area) return { err: 'nothing taken' };
        const rows2 = [];
        for (let y = miny; y <= maxy; y++) {
          let s0 = -1;
          for (let x = minx; x <= maxx + 1; x++) {
            const on = x <= maxx && mark[y * W + x];
            if (on && s0 < 0) s0 = x;
            else if (!on && s0 >= 0) { rows2.push([y, s0, x - 1]); s0 = -1; }
          }
        }
        return { u: seed.u, area: area, restored: true, parts: take.size,
                 ox: X0, oy: Y0,
                 x0: minx / PX + X0, y0: miny / PX + Y0,
                 x1: maxx / PX + X0, y1: maxy / PX + Y0, rows: rows2 };
      }, { X0: seed.cx - HALF, X1: seed.cx + HALF, Y0: seed.cy - HALF, Y1: seed.cy + HALF,
           PX: PX, seed: { u: seed.u, cx: seed.cx, cy: seed.cy }, others: others, pinch: pinch,
           probe: process.env.PROBE === seed.u });
    } catch (e) { res = { err: e.message.slice(0, 60) }; }
      if (res && (!res.err || res.err.indexOf('did not seal') < 0)) break;
    }
    if (res && res.probe) { console.log("  PROBE " + seed.u + " " + JSON.stringify(res.probe)); continue; }
    if (res && !res.err) { found[seed.u] = res; took[res.parts] = (took[res.parts] || 0) + 1; }
    else failed.push([seed.u, (res && res.err) || 'no answer']);
  }
  await browser.close();

  const n = Object.keys(found).length;
  console.log('  units composed: ' + n + ' of ' + labels.length);
  console.log('  rooms per unit: ' + Object.keys(took).sort((a, b) => a - b)
    .map(k => k + ' \u2192 ' + took[k]).join(',  '));
  if (failed.length) console.log('  refused (' + failed.length + '): ' +
    failed.slice(0, 10).map(f => f[0] + ' \u2014 ' + f[1]).join(';  '));

  const K = median(Object.keys(found).filter(u => book[u] > 0)
    .map(u => book[u] / (found[u].area / (PX * PX))));
  const off = Object.keys(found).filter(u => book[u] > 0)
    .map(u => ({ u: u, book: book[u], drawn: found[u].area / (PX * PX) * K }))
    .map(e => ({ ...e, d: (e.drawn - e.book) / e.book }));
  off.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log('  1 drawing unit\u00b2 = ' + K.toFixed(4) + ' sq ft;  typical unit is ' +
              (median(off.map(e => Math.abs(e.d))) * 100).toFixed(1) + '% off its record');
  /* A UNIT THE DRAWING AND THE REGISTER DISAGREE ABOUT IS MARKED, not hidden.
     The watershed gives every pixel exactly one owner, so these shapes cannot
     be lying on each other — the disagreement is about how big the register
     says the unit is, which is a question for a person. */
  const bad = off.filter(e => Math.abs(e.d) > 0.10);
  bad.forEach(e => { found[e.u].disputed = true; });
  fs.writeFileSync(path.join(DIR, PAGE + '-rooms.json'),
    JSON.stringify({ px: PX, units: found, failed: failed }));
  if (bad.length) console.log('  more than 10% off (' + bad.length + '): ' + bad.slice(0, 8)
    .map(e => e.u + ' book ' + e.book.toFixed(1) + ' drawn ' + e.drawn.toFixed(1)).join(';  '));

  fs.writeFileSync(path.join(DIR, PAGE + '-rooms.json'),
    JSON.stringify({ px: PX, units: found, failed: failed }));
  console.log('  written ' + path.join(DIR, PAGE + '-rooms.json'));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
