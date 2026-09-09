/* ══ THE ROOM EACH UNIT NUMBER IS STANDING IN ═══════════════════════════════
   Reading the numbers gave a point per unit. This turns each point into the
   shape around it.

   Not by tracing outlines by eye — that was tried on KBH and Rashid found the
   borders wrong on the live screen twice, because a rectangle drawn inside an
   L-shaped flat looks perfect by every measure except the one that matters. It
   is done by FLOODING: the drawing is rasterised, and from each unit number the
   fill spreads until it hits ink. Whatever it fills is the room, whatever shape
   that turns out to be, because the walls decide and nothing here guesses.

   A fill that escapes into the corridor is not quietly accepted. Each one is
   capped, and anything that runs past the cap is reported by name rather than
   turned into a shape nobody checked.

   node scripts/plan-rooms.js <dir> <pageN>
*/
const fs = require('fs'), path = require('path'), https = require('https'),
      puppeteer = require('puppeteer-core');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const FLOORNO = process.argv[4] ? Number(process.argv[4]) : null;   // judge against the register
const PX = Number(process.argv[5] || 8);          // pixels per drawing unit
const BAND = Number(process.argv[6] || 420);      // drawing units per tile
const TOL = 0.10;                                 // how far a room may be from its record
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

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
const median = a => { const q = [...a].sort((p, r) => p - r); return q[Math.floor(q.length / 2)]; };
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* the walls, without a word of text: the labels would dam the flood */
const TEXT = new Set(['#ba0d70', '#000000']);
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

(async () => {
  const labels = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-read.json'), 'utf8'));
  const paths = wallPaths(path.join(DIR, PAGE + '.svg'));
  console.log(PAGE + ': ' + labels.length + ' units, ' + paths.length + ' wall paths');

  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  labels.forEach(l => { X0 = Math.min(X0, l.x0); Y0 = Math.min(Y0, l.y0);
                        X1 = Math.max(X1, l.x1); Y1 = Math.max(Y1, l.y1); });
  X0 -= 60; X1 += 60; Y0 -= 40; Y1 += 40;
  console.log('label extent  x ' + X0.toFixed(0) + '..' + X1.toFixed(0) +
              '   y ' + Y0.toFixed(0) + '..' + Y1.toFixed(0));

  const exe = BROWSERS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
                                           args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 300 });
  await page.goto('about:blank');
  await page.evaluate(ps => { window.__paths = ps; }, paths);

  const found = {}, failed = [];
  for (let bandY = Y0; bandY < Y1; bandY += BAND) {
    const y0 = bandY - 30, y1 = Math.min(Y1, bandY + BAND) + 30;
    const seeds = labels.filter(l => l.cy >= bandY && l.cy < bandY + BAND);
    if (!seeds.length) continue;

    const res = await page.evaluate(async (o) => {
      /* defined once and kept, so the second pass runs the same code with a
         thicker wall rather than a second copy of it */
      window.__flood = window.__flood || (async function (o) {
      const { X0, X1, y0, y1, PX, seeds, thick, blocks } = o;
      const W = Math.ceil((X1 - X0) * PX), H = Math.ceil((y1 - y0) * PX);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
        '" viewBox="' + X0 + ' ' + y0 + ' ' + (X1 - X0) + ' ' + (y1 - y0) + '">' +
        '<rect x="' + X0 + '" y="' + y0 + '" width="' + (X1 - X0) + '" height="' + (y1 - y0) +
        '" fill="#fff"/>' +
        /* ROUND CAPS, AND THIS IS THE WHOLE REASON A THICKER PEN WORKS AT ALL.
           Thickness runs ACROSS a line, not along it: a wall drawn nine times
           heavier still has exactly the same gap in the middle of it, because
           a flat-ended segment ends where it ends. GF-256 was lost to this for
           an hour — the fill walked through a break a pixel wide in a wall
           twenty pixels thick. A round cap extends every segment end by half
           the stroke, so widening the pen finally closes the breaks it was
           meant to close, and closes nothing a door has not already opened. */
        '<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"' +
        ' stroke-width="' + (1.2 / PX * 2 * thick) + '">' +
        window.__paths.map(d => '<path d="' + d + '"/>').join('') + '</g>' +
        /* THE SHOPS NEXT DOOR ARE WALLS TOO. Not a line on the sheet — a fact
           about a building: a shop is bounded by the shops beside it. Passed
           in as the rooms already found, painted solid, so a fill cannot walk
           through a neighbour it has no business being in. */
        (blocks || []).map(b => '<rect x="' + b[0] + '" y="' + b[1] + '" width="' +
          b[2] + '" height="' + b[3] + '" fill="#000"/>').join('') +
        '</svg>';
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
      cx.drawImage(img, 0, 0, W, H);
      const px = cx.getImageData(0, 0, W, H).data;
      URL.revokeObjectURL(url);

      /* ink is anything that is not near-white */
      const wall = new Uint8Array(W * H);
      for (let i = 0, p = 0; i < wall.length; i++, p += 4) {
        if (px[p] < 220 || px[p + 1] < 220 || px[p + 2] < 220) wall[i] = 1;
      }

      /* HOW BIG IS TOO BIG. This was 120 by 40 drawing units — about 394 sq ft —
         and it was throwing away RIGHT ANSWERS: GF-201 is a 483 sq ft corner shop,
         so its correct fill was declared a leak and the unit vanished from the
         plate. GF-139, at 417, only survived by being squeezed under the cap by a
         nine-times pen, which is why its area then read small.

         The cap is not the thing that decides whether a room is right — the
         register is, further down, room by room. This only has to catch a fill
         that has run away across the sheet, so it is set well above any shop in
         the building and left to do that one job. */
      const CAP = Math.round(120 * 160 * PX * PX);
      const out = [], bad = [];
      const seen = new Uint8Array(W * H);
      for (const s of seeds) {
        const sx = Math.round((s.cx - X0) * PX), sy = Math.round((s.cy - y0) * PX);
        if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) { bad.push([s.u, 'outside the tile']); continue; }
        /* the number itself is not drawn, so the seed sits on clear floor */
        if (wall[sy * W + sx]) { bad.push([s.u, 'seed landed on ink']); continue; }
        const stack = [sy * W + sx];
        const mark = new Map();
        let n = 0, minx = W, miny = H, maxx = 0, maxy = 0, leaked = false;
        seen.fill(0);
        seen[sy * W + sx] = 1;
        while (stack.length) {
          const i = stack.pop();
          const y = (i / W) | 0, x = i - y * W;
          n++;
          if (n > CAP) { leaked = true; break; }
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
          mark.set(i, 1);
          if (x > 0 && !seen[i - 1] && !wall[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
          if (x < W - 1 && !seen[i + 1] && !wall[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
          if (y > 0 && !seen[i - W] && !wall[i - W]) { seen[i - W] = 1; stack.push(i - W); }
          if (y < H - 1 && !seen[i + W] && !wall[i + W]) { seen[i + W] = 1; stack.push(i + W); }
        }
        if (leaked) { bad.push([s.u, 'the fill escaped']); continue; }
        out.push({ u: s.u, area: n,
                   /* THE TILE ORIGIN TRAVELS WITH THE ROWS. The runs below are
                      pixels within THIS tile; without the corner they were cut
                      from, converting them back to drawing units silently
                      dropped the offset and every shape landed off the sheet.
                      The bounding box did not, because it was converted here —
                      so the numbers looked right while the outlines were gone. */
                   ox: X0, oy: y0,
                   x0: minx / PX + X0, y0: miny / PX + y0,
                   x1: maxx / PX + X0, y1: maxy / PX + y0,
                   /* the filled cells, run-length by row, so the shape survives
                      the trip out of the browser without a megabyte per room */
                   rows: (() => {
                     const rows = [];
                     for (let y = miny; y <= maxy; y++) {
                       let s0 = -1;
                       for (let x = minx; x <= maxx + 1; x++) {
                         const on = x <= maxx && mark.has(y * W + x);
                         if (on && s0 < 0) s0 = x;
                         else if (!on && s0 >= 0) { rows.push([y, s0, x - 1]); s0 = -1; }
                       }
                     }
                     return rows;
                   })() });
      }
      return { out: out, bad: bad, W: W, H: H };
      });
      return window.__flood(o);
    }, { X0: X0, X1: X1, y0: y0, y1: y1, PX: PX, seeds: seeds, thick: 1 });

    res.out.forEach(r => { found[r.u] = r; });
    res.bad.forEach(b => failed.push(b));
    console.log('  band y ' + bandY.toFixed(0) + '  seeds ' + seeds.length +
                '  filled ' + res.out.length + '  refused ' + res.bad.length);
  }
  /* ── MORE PASSES FOR WHAT ESCAPED, WITH A THICKER PEN EACH TIME ─────────
     A fill that runs away has found a gap. Two kinds exist on these sheets:
     a doorway, which is narrower than the wall beside it, and a DASHED
     boundary — the road-facing edge of the front row is drawn as a broken
     line, and a broken line is a line, but not to a flood. Drawing the walls
     thicker closes both and leaves real openings open.

     The pen is widened step by step and the first width that holds is kept,
     along with WHICH width it needed, because that is the thing to be
     suspicious about later. Nothing here decides whether the shape is right:
     a thicker pen eats into the room, so every shape is measured against the
     area the register holds before any of it is shipped. Anything still
     escaping at the widest pen is reported by name and gets no shape at all. */
  /* ── THE BOOK DECIDES, NOT THE CAP ──────────────────────────────────────
     A cap catches a fill that runs across the whole sheet. It does NOT catch
     one that runs through a doorway into the next five shops, which is what
     GF-256 did: a perfectly plausible-looking room, five cells tall, well
     under any cap. The only thing that knows how big a shop is, is the book
     the building is sold from.

     So the sheet's scale is derived from the rooms that filled cleanly at the
     ordinary pen, and every room is then measured against its own record.
     Anything that failed, or that disagrees, is flooded again with a wider
     pen — and the pen that lands CLOSEST TO THE RECORD is kept. This cannot
     run away with itself: a wider pen eats into the room, so over-thickening
     makes the area worse, not better, and loses.

     Nothing is silently accepted. A room that never comes within the
     tolerance is left named and shapeless, for a person to look at. */
  let book = null;
  if (FLOORNO !== null) {
    const rows = await sql('select unit_no, area::float8 as area from public.units' +
                           " where project_id = '" + AWAMI + "' and floor_no = " + FLOORNO);
    book = {}; rows.forEach(r => { book[r.unit_no] = r.area; });
    console.log('  the register holds ' + rows.length + ' units on this floor');
  }

  if (book) {
      /* THE ROOMS ALREADY FOUND, AS SOLID GROUND, near one seed. Sent as the
       runs they were filled from — merged where consecutive lines share a
       span, so a room is a handful of rectangles rather than three hundred.
       Only what is near the seed is sent: nothing at the far end of the
       building can bound a shop at this one. */
    /* Does this fill lie on top of a room that is already settled? A quarter of
       the smaller of the two is the line: shapes touch at their walls, and a
       pixel of overlap there is not a shop swallowing its neighbour. */
    const sitsOn = (r, skip) => Object.keys(found).filter(v => {
      if (v === skip) return false;
      const b = found[v];
      const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
      const h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
      if (w <= 1 || h <= 1) return false;
      return (w * h) > 0.25 * Math.min((r.x1 - r.x0) * (r.y1 - r.y0),
                                       (b.x1 - b.x0) * (b.y1 - b.y0));
    });

    const near = (seed, skip) => {
      const out = [];
      for (const v of Object.keys(found)) {
        if (v === skip) continue;
        const r = found[v];
        if (!r.rows) continue;
        if (r.x1 < seed.cx - 260 || r.x0 > seed.cx + 260 ||
            r.y1 < seed.cy - 260 || r.y0 > seed.cy + 260) continue;
        let run = null;
        const flush = () => {
          if (!run) return;
          out.push([ +(run.a / PX + r.ox).toFixed(2), +(run.y0 / PX + r.oy).toFixed(2),
                     +((run.b - run.a + 1) / PX).toFixed(2), +((run.y1 - run.y0 + 1) / PX).toFixed(2) ]);
          run = null;
        };
        for (const row of r.rows) {
          const y = row[0], a = row[1], b = row[2];
          if (run && run.a === a && run.b === b && y === run.y1 + 1) { run.y1 = y; continue; }
          flush();
          run = { a: a, b: b, y0: y, y1: y };
        }
        flush();
      }
      return out;
    };

  const STEPS = [2.5, 5, 9];   // wider was tried; it never rescued a room
    const clean = Object.keys(found).filter(u => book[u] > 0);
    const K = median(clean.map(u => book[u] / (found[u].area / (PX * PX))));
    console.log('  1 drawing unit\u00b2 = ' + K.toFixed(4) + ' sq ft, from the rooms as first flooded');
    /* THE PEN EATS THE ROOM IT DRAWS. A wall rendered nine times thicker grows
       inward by half of that all the way round, so a perfectly correct fill at
       a wide pen measures a tenth too small and would be thrown out for being
       right. The bite is given back before judging: half the stroke, along the
       whole boundary. At the ordinary pen this is a fraction of a percent; at
       nine times it is the difference between keeping a room and losing it. */
    const bite = thick => 1.2 / PX * 2 * thick / 2;
    const trueArea = (r, thick) => r.area / (PX * PX) +
      2 * ((r.x1 - r.x0) + (r.y1 - r.y0)) * bite(thick);
    const offBy = (u, r, thick) =>
      Math.abs(trueArea(r, thick || 1) * K - book[u]) / book[u];

    const retry = failed.map(x => x[0])
      .concat(Object.keys(found).filter(u => book[u] > 0 && offBy(u, found[u], 1) > TOL));
    if (retry.length) {
      console.log('  flooding again with a wider pen: ' + retry.join(', '));
      for (const u of retry) {
        const seed = labels.find(l => l.u === u);
        if (!seed) continue;
        /* THE ONES THAT SIT ON NOBODY COME FIRST. A fill that has walked into
           the next three shops can happen to have a nicer-looking area than a
           correct one, and comparing areas alone would take it. So a clean
           fill always beats a trespassing one, and only among equals does the
           register decide. */
        const tries = [];
        if (found[u] && book[u] > 0) tries.push({ r: found[u], pen: 1 });
        for (const thick of STEPS) {
          const y0 = seed.cy - 110, y1 = seed.cy + 110;
          const res = await page.evaluate(async (o) => window.__flood(o),
            { X0: X0, X1: X1, y0: y0, y1: y1, PX: PX, seeds: [seed], thick: thick,
              blocks: (function(){var b=near(seed,u); if(u===process.env.DBGU) console.log("      pen"+thick+": "+b.length+" blocks, first "+JSON.stringify(b[0])+" tile y "+y0.toFixed(0)+".."+y1.toFixed(0)); return b;})() });
          if (res.out.length) tries.push({ r: res.out[0], pen: thick });
        }
        tries.forEach(t => {
          t.off = book[u] > 0 ? offBy(u, t.r, t.pen) : 0;
          t.clean = sitsOn(t.r, u).length === 0;
        });
        if (u === process.env.DBGU) console.log("      tries for "+u+": "+tries.map(t=>"pen"+t.pen+" area"+(t.r.area/(PX*PX)).toFixed(0)+" off"+(t.off*100).toFixed(0)+"% "+(t.clean?"clean":"on "+sitsOn(t.r,u).join("/"))).join("  |  "));
        tries.sort((a, b) => (b.clean - a.clean) || (a.off - b.off));
        let best = tries[0] || null;
        if (!best) { console.log('    ' + u + ' \u2014 no fill at any pen'); continue; }
        const i = failed.findIndex(x => x[0] === u);
        if (i >= 0) failed.splice(i, 1);
        /* ── A ROOM THAT DISAGREES IS NOT AUTOMATICALLY A WRONG ROOM ──────
           Two different things look the same in the arithmetic. A fill that
           ran through a doorway is wrong: it is lying on top of the shops it
           swallowed. A cell the architect simply drew a different size from
           the one the register records is RIGHT as a shape — the walls are
           where the walls are — and only its area is in dispute.

           They are told apart by asking whether the shape sits on anybody
           else. One that does is dropped, because a wrong tap target is worse
           than none. One that sits alone is kept and reported, for a person
           who knows the building to settle. */
        const overlaps = sitsOn(best.r, u);
        if (best.off <= TOL) {
          found[u] = best.r; found[u].pen = best.pen; found[u].off = +best.off.toFixed(3);
          console.log('    ' + u + ' at pen ' + best.pen + '\u00d7 \u2014 matches the register');
        } else if (!overlaps.length) {
          found[u] = best.r; found[u].pen = best.pen; found[u].off = +best.off.toFixed(3);
          found[u].disputed = true;
          console.log('    ' + u + ' \u2014 a clean cell of its own, but ' +
                      (best.off * 100).toFixed(0) + '% off the register. Kept, and reported.');
        } else {
          delete found[u];
          failed.push([u, 'the fill lies on top of ' + overlaps.slice(0, 3).join(', ') +
                          ' \u2014 ' + (best.off * 100).toFixed(0) + '% off the register']);
          console.log('    ' + u + ' \u2014 lies on top of ' + overlaps.slice(0, 3).join(', ') +
                      '; no shape');
        }
      }
    }
  }
  await browser.close();

  const ok = Object.keys(found).length;
  console.log('\nrooms found: ' + ok + ' of ' + labels.length);
  if (failed.length) {
    console.log('refused (' + failed.length + '): ' +
                failed.slice(0, 12).map(f => f[0] + ' — ' + f[1]).join(';  '));
  }
  fs.writeFileSync(path.join(DIR, PAGE + '-rooms.json'),
    JSON.stringify({ px: PX, units: found, failed: failed }));
  console.log('written ' + path.join(DIR, PAGE + '-rooms.json'));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
