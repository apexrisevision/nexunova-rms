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

     0. The door leaves are lifted off the sheet first — see OPENING below — and
        the wall is cut back along them, so a doorway is a doorway. Where the
        draughtsman left a flat's FRONT open and drew no line at all, the line
        is put back: see WHERE A WALL STOPS AND STARTS AGAIN.
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
   test the shop floors passed. On the Third Floor 120 of the 150 land within
   10% of their record and the typical one within 1.6%.

   The 30 that do not are marked disputed and reported by name, and they fall
   into two families, both of which are the register's number rather than the
   outline. Nine units it prices at a flat 342.40 that the sheet draws half as
   big again. And a dozen along the access galleries — 48 to 51, 85 to 88 — that
   it prices at about 425 where the sheet draws 320: the difference is very
   nearly the gallery in front of them, which Rashid has confirmed is COMMON and
   not sold. A watershed shape cannot lie on top of another one — every pixel
   has exactly one owner — so what is in dispute there is what the register
   counts, not where the wall is.

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
/* ── THE GREY LINE IS A DOOR, AND A DOOR IS NOT A WALL ──────────────────────
   The sheet draws in layers by colour: red is structure, magenta the columns,
   blue the glazing, cyan the balcony rail — and a pale grey, 250 strokes of
   it, that appears only in ONE place. It spans the gap between two wall stubs
   with a jamb returned on either side. That is the door leaf.

   Read as a wall it shuts every kitchen, bath and lobby off from the room they
   belong to. The flood then cannot get in at all: on the Third Floor 427,000
   pixels a window ended up belonging to nobody, and the units came out as bare
   rooms with the service block hanging outside them — "right walay units pe
   washroom aur kitchen wagaira" missing, exactly as Rashid put it. Leaving it
   out opens the doorways and nothing else: the jambs either side are red and
   still stand, so the opening stays a doorway and does not become a hole in
   the wall.

   The blue is NOT in this list, although the balcony hangs off it. Opening the
   glazing opens the outer windows too, and 140 and 141 then flood into one
   another through the front. A balcony that stays outside the shape is a
   smaller wrong than two units becoming one. */
const OPENING = new Set(['#bababa', '#969696', '#757575']);
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
const STRUCT = '#ff0000';                     // the load-bearing lines, in red
const RAIL = '#00ffff';                       // and the rail along the open side
function wallPaths(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [], doors = [], struct = [], rails = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    const f = m[2].toLowerCase(), s = m[3].toLowerCase();
    if (TEXT.has(f) || TEXT.has(s)) continue;
    if (OPENING.has(s)) { doors.push(m[1]); continue; }
    out.push(m[1]);
    if (s === STRUCT) struct.push(m[1]);
    if (s === RAIL) rails.push(m[1]);
  }
  return { walls: out, doors: doors, struct: struct, rails: rails };
}

/* ── WHERE A WALL STOPS AND STARTS AGAIN, IT IS STILL A WALL ────────────────
   A flat's front on this floor is a four-and-a-half foot opening, and the
   access gallery it opens onto is five feet wide. No pen is thin enough to
   keep the gallery and thick enough to shut the opening, because the drawing
   simply does not put a line there. So the flat walked out through its own
   front door and helped itself to a wedge of the gallery — "center walay units
   still bahir nikal rahay hain area se".

   A person reading the sheet has no trouble at all: the wall above the opening
   and the wall below it are the same wall, and the flat ends on that line. So
   the line is drawn back in. Two wall ends that face each other across a gap,
   ON THE SAME LINE, are joined.

   Nothing else is joined. Each end must point at the other, the gap must be no
   wider than a doorway, and the two walls must be collinear to within a couple
   of inches.

   And the gap must FACE THE OPEN SIDE. A gap deep inside the block is a kitchen
   door and has to stay open — closing those took the lobby and the bath
   straight back out of the flat, which is the fault Rashid reported first. The
   sheet says which is which: it draws a rail, in cyan, along every side that is
   open to the air, so only gaps within a gallery's width of one are closed.

   The joins are drawn as WALL, and they are drawn before the door leaves are
   lifted off, so that wherever the architect actually drew a door the door
   wins. What is left bridged is the openings he drew no door for.

   WHAT THIS DOES NOT REACH. Six units at the foot of the bottom block — 45, 46,
   47 and 82, 83, 84 — have fronts ten feet wide with no line and no rail near
   enough to judge by, so they still take a piece of the gallery. They are the
   only ones left on the floor. */
function bridges(paths, maxGap, offGap, rails, reach) {
  /* WHICH GAPS ARE FRONT DOORS. A gap deep inside the block is a kitchen
     door and must stay open — that is Rashid's first complaint, and closing
     it took the lobby and the bath straight back out of the flat. A gap that
     faces the open side is the flat's own front, and that is the one to
     close. The sheet says which is which: it draws a rail, in cyan, along
     every side that is open to the air. So a gap is bridged only if it is
     within a gallery's width of one. */
  const rail = [];
  (rails || []).forEach(d => {
    const n = (d.match(/-?[0-9.]+/g) || []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) rail.push([n[i], n[i + 1]]);
  });
  const facesOpen = (x, y) => {
    for (const p of rail) if (Math.abs(p[0] - x) < reach && Math.abs(p[1] - y) < reach) return true;
    return false;
  };
  const ends = [];
  paths.forEach(d => {
    d.split('M').slice(1).forEach(sub => {
      const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
      if (n.length < 4) return;
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      /* EVERY SEGMENT'S OWN TWO ENDS, not just the polyline's. A wall is drawn
         as an outline that runs down one face, across the jamb and back up the
         other, so the end that faces the opening is in the middle of the
         polyline, not at either end of it. */
      const push = (p, q) => {                 // p is the end, q its inner neighbour
        const dx = p[0] - q[0], dy = p[1] - q[1], L = Math.hypot(dx, dy);
        if (L > 0.01) ends.push({ x: p[0], y: p[1], ux: dx / L, uy: dy / L });
      };
      for (let i = 0; i + 1 < pts.length; i++) { push(pts[i], pts[i + 1]); push(pts[i + 1], pts[i]); }
    });
  });
  const out = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 0.5 || L > maxGap) continue;
      const ux = dx / L, uy = dy / L;
      if (a.ux * ux + a.uy * uy < 0.985) continue;      // a points at b
      if (b.ux * ux + b.uy * uy > -0.985) continue;     // and b back at a
      if (Math.abs(a.ux * uy - a.uy * ux) * L > offGap) continue;   // same line
      if (rail.length && !facesOpen((a.x + b.x) / 2, (a.y + b.y) / 2)) continue;
      out.push('M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y);
    }
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

  const sheet = wallPaths(path.join(DIR, PAGE + '.svg'));
  console.log('  ' + sheet.walls.length + ' wall paths and ' + sheet.doors.length +
              ' door leaves, pinch ' + PINCH + '\u00d7 (' +
              (1.2 / PX * 2 * PINCH).toFixed(1) + ' drawing units)');

  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)),
                                           headless: 'new',
                                           args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 300 });
  await page.goto('about:blank');
  const spans = bridges(sheet.struct, 30, 0.6, sheet.rails, 30);
  console.log('  ' + spans.length + ' wall lines closed back across their own gap');
  await page.evaluate(s => { window.__paths = s.walls; window.__doors = s.doors;
                             window.__spans = s.spans; },
                      { walls: sheet.walls, doors: sheet.doors, spans: spans });

  const found = {}, failed = [], took = {};
  for (const seed of labels) {
    if (process.env.PICTURE && seed.u !== process.env.PICTURE) continue;
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
          window.__spans.map(d => '<path d="' + d + '"/>').join('') +
          window.__paths.map(d => '<path d="' + d + '"/>').join('') + '</g>' +
          /* AND THE DOORS ARE CUT LAST, in white. Leaving the leaf out is not
             always enough: in some blocks the draughtsman ran the wall line
             straight through the opening and drew the leaf on top of it, so
             the doorway was still shut. Painting back along the leaf opens it
             either way. Only the true pen is cut — the heavy pen's band is
             walked through anyway — and only as wide as the leaf itself. */
          '<g stroke="#fff" stroke-width="' + (thin * 3) + '">' +
          window.__doors.map(d => '<path d="' + d + '"/>').join('') + '</g></g></svg>';
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
        /* ── EVERY SQUARE FOOT GOES TO THE ROOM IT IS NEAREST, THROUGH DOORS ──
           Only two kinds of place start with a name of their own: a room with a
           unit number standing in it, and anything that runs off the edge of the
           window, which is the verandah and the world outside. Everything else —
           the kitchens, the baths, the balconies, the little strips between one
           unit and the next — starts nameless, and is claimed by whichever named
           place reaches it first through a door.

           That is Rashid's rule, done by the drawing rather than by hand: "aik
           bath kit aur balcony ko square mai lete howay ham unit 67 k sath show
           kare gay aur aik square ko 66 k sath". The strip between two units is
           not refused for touching both — it is SPLIT between them, and it
           splits where the doors say it should, because 67's half is entered
           from 67 and 66's half from 66.

           An earlier version seeded every island, so a kitchen that survived the
           pinch kept its own name and belonged to nobody. That is what Rashid
           saw: "kisi b unit k sath Washroom, Kitchen aur open space balony
           select hota hee nahi hai". */
        const owner = new Int32Array(W * H).fill(-1);
        let front = [];
        for (let i = 0; i < cell.length; i++) {
          const c = cell[i];
          if (c >= 0 && (numbered.has(c) || cells[c].edge)) { owner[i] = c; front.push(i); }
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

        /* PICTURE=<unit> draws the window instead of measuring it: this unit
           solid blue, every other room its own tint, unclaimed white, true
           wall black. Colours can be argued with; this cannot. */
        if (o.picture) {
          const im = cx.createImageData(W, H);
          const pad = document.createElement('canvas').getContext('2d');
          const tint = {};
          for (let i = 0; i < W * H; i++) {
            const p = i * 4, ow = owner[i];
            let v;
            if (kind[i] === WALL) v = [20, 20, 20];
            else if (ow === mine) v = [40, 90, 220];
            else if (ow < 0) v = [255, 255, 255];
            else {
              if (!tint[ow]) {
                pad.fillStyle = cells[ow].edge ? 'hsl(0,0%,72%)'
                  : 'hsl(' + ((ow * 67) % 360) + ',' +
                    (numbered.has(ow) ? '80%,62%' : '60%,84%') + ')';
                pad.fillRect(0, 0, 1, 1);
                tint[ow] = pad.getImageData(0, 0, 1, 1).data;
              }
              v = tint[ow];
            }
            im.data[p] = v[0]; im.data[p + 1] = v[1]; im.data[p + 2] = v[2]; im.data[p + 3] = 255;
          }
          const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
          c2.getContext('2d').putImageData(im, 0, 0);
          return { picture: c2.toDataURL('image/png'), pinch: pinch,
                   ox: X0, oy: Y0, W: W, H: H };
        }

        const mark = new Uint8Array(W * H);
        let parts = 1;
        for (let i = 0; i < owner.length; i++) if (owner[i] === mine) mark[i] = 1;

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
        return { u: seed.u, area: area, restored: true, parts: parts,
                 ox: X0, oy: Y0,
                 x0: minx / PX + X0, y0: miny / PX + Y0,
                 x1: maxx / PX + X0, y1: maxy / PX + Y0, rows: rows2 };
      }, { X0: seed.cx - HALF, X1: seed.cx + HALF, Y0: seed.cy - HALF, Y1: seed.cy + HALF,
           PX: PX, seed: { u: seed.u, cx: seed.cx, cy: seed.cy }, others: others, pinch: pinch,
           probe: process.env.PROBE === seed.u,
          picture: process.env.PICTURE === seed.u });
    } catch (e) { res = { err: e.message.slice(0, 60) }; }
      if (res && (!res.err || res.err.indexOf('did not seal') < 0)) break;
    }
    if (res && res.probe) { console.log("  PROBE " + seed.u + " " + JSON.stringify(res.probe)); continue; }
    if (res && res.picture) {
      const png = path.join(DIR, '_owner-' + seed.u + '.png');
      fs.writeFileSync(png, Buffer.from(res.picture.split(',')[1], 'base64'));
      console.log('  PICTURE ' + seed.u + ' ' + res.W + 'x' + res.H + ' at (' +
        res.ox.toFixed(1) + ',' + res.oy.toFixed(1) + ') pinch ' + res.pinch + '  → ' + png);
      continue;
    }
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
