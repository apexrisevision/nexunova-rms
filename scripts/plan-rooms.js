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
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const PX = Number(process.argv[4] || 8);          // pixels per drawing unit
const BAND = Number(process.argv[5] || 420);      // drawing units per tile
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
      const { X0, X1, y0, y1, PX, seeds, thick } = o;
      const W = Math.ceil((X1 - X0) * PX), H = Math.ceil((y1 - y0) * PX);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
        '" viewBox="' + X0 + ' ' + y0 + ' ' + (X1 - X0) + ' ' + (y1 - y0) + '">' +
        '<rect x="' + X0 + '" y="' + y0 + '" width="' + (X1 - X0) + '" height="' + (y1 - y0) +
        '" fill="#fff"/><g fill="none" stroke="#000" stroke-width="' + (1.2 / PX * 2 * thick) + '">' +
        window.__paths.map(d => '<path d="' + d + '"/>').join('') + '</g></svg>';
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

      const CAP = Math.round(120 * 40 * PX * PX);      // a room this big is a leak
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
  /* ── A SECOND PASS FOR WHAT ESCAPED ─────────────────────────────────────
     A fill that runs away is almost always a doorway: a gap narrower than the
     wall it sits in. Drawing the walls thicker closes those and leaves real
     openings open, so a room that fills on the second pass was always a room.
     Anything still escaping is reported by name and gets no shape at all. */
  const stuck = failed.map(f => f[0]);
  if (stuck.length) {
    console.log('  second pass, walls drawn thicker, for: ' + stuck.join(', '));
    for (const u of stuck) {
      const seed = labels.find(l => l.u === u);
      if (!seed) continue;
      const y0 = seed.cy - 60, y1 = seed.cy + 60;
      const res = await page.evaluate(async (o) => window.__flood(o),
        { X0: X0, X1: X1, y0: y0, y1: y1, PX: PX, seeds: [seed], thick: 2.5 });
      if (res.out.length) {
        found[u] = res.out[0];
        failed.splice(failed.findIndex(f => f[0] === u), 1);
        console.log('    ' + u + ' filled on the second pass');
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
