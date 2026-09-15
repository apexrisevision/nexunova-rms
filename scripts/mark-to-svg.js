/* THE MARK AS PATHS, SO IT CAN DRAW ITSELF ─────────────────────────────────
   Rashid asked for the logo to be drawn in front of you, a line at a time,
   rather than faded up finished: "logo hee yahin banay samnay animate hotay
   howay". A picture cannot be drawn line by line — only a path can — so the
   mark has to stop being a picture.

   Nothing here is redrawn by hand. The artwork's own pixels are read, split
   into the two colours it is made of, and the boundary between inside and
   outside is followed exactly: every place a coloured pixel meets an
   uncoloured one contributes one unit edge, the edges are chained into closed
   loops, and each loop is then simplified — so what comes out is the shape
   that was there, with the pixel staircase taken off it.

   It is read at four times the size for the sake of the diagonals, and the
   result is checked the only way that means anything: the SVG is rendered back
   at the mark's own size and compared with the PNG pixel for pixel.

   node scripts/mark-to-svg.js
*/
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'awami-mark.png');
const OUT = path.join(ROOT, 'assets', 'awami-mark.svg');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UP = 4;                      // read it this much larger
const TOL = 0.9;                   // simplify to this, in upscaled pixels

/* the two inks the mark is printed in, taken from the artwork rather than
   named: whatever the two clusters turn out to be */
function classify(px, w, h) {
  const seen = {};
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const k = (px[i] >> 5) + ',' + (px[i + 1] >> 5) + ',' + (px[i + 2] >> 5);
    if (!seen[k]) seen[k] = { n: 0, r: 0, g: 0, b: 0 };
    seen[k].n++; seen[k].r += px[i]; seen[k].g += px[i + 1]; seen[k].b += px[i + 2];
  }
  const top = Object.keys(seen).map(k => seen[k]).sort((a, b) => b.n - a.n).slice(0, 2)
    .map(c => ({ n: c.n, r: Math.round(c.r / c.n), g: Math.round(c.g / c.n),
                 b: Math.round(c.b / c.n) }));
  /* darkest first, so the shield is drawn before the chevrons that sit on it */
  top.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  return top;
}

function maskOf(px, w, h, ink, others) {
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (px[i + 3] < 128) continue;
    const d = c => (px[i] - c.r) ** 2 + (px[i + 1] - c.g) ** 2 + (px[i + 2] - c.b) ** 2;
    let best = d(ink), win = true;
    others.forEach(o => { if (d(o) < best) win = false; });
    if (win) m[p] = 1;
  }
  return m;
}

/* every edge where inside meets outside, chained into closed loops */
function loopsOf(m, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : m[y * w + x];
  const edges = new Map();                      // "x,y" -> [x2,y2]
  const put = (a, b) => {
    const k = a[0] + ',' + a[1];
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) put([x, y], [x + 1, y]);
      if (!at(x + 1, y)) put([x + 1, y], [x + 1, y + 1]);
      if (!at(x, y + 1)) put([x + 1, y + 1], [x, y + 1]);
      if (!at(x - 1, y)) put([x, y + 1], [x, y]);
    }
  }
  const loops = [];
  for (const start of [...edges.keys()]) {
    while (edges.has(start) && edges.get(start).length) {
      const loop = [start.split(',').map(Number)];
      let cur = start;
      for (;;) {
        const nexts = edges.get(cur);
        if (!nexts || !nexts.length) break;
        const n = nexts.shift();
        if (!nexts.length) edges.delete(cur);
        loop.push(n);
        cur = n[0] + ',' + n[1];
        if (cur === start) break;
      }
      if (loop.length > 8) loops.push(loop);
    }
  }
  return loops;
}

/* Douglas–Peucker: the staircase becomes the straight lines it was drawn as */
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return (p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = d2(pts[i], pts[a], pts[b]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol * tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}

const hex = c => '#' + [c.r, c.g, c.b].map(v =>
  v.toString(16).padStart(2, '0')).join('').toUpperCase();

(async () => {
  const b = fs.readFileSync(SRC);
  const W = b.readUInt32BE(16), H = b.readUInt32BE(20);
  const browser = await puppeteer.launch({ executablePath: CHROME,
    headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const dataUrl = 'data:image/png;base64,' + b.toString('base64');
  const px = await page.evaluate(async (url, w, h) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, w, h);
    return [...g.getImageData(0, 0, w, h).data];
  }, dataUrl, W * UP, H * UP);
  const data = Uint8ClampedArray.from(px);
  const w = W * UP, h = H * UP;

  const inks = classify(data, w, h);
  console.log('the two inks in it: ' + inks.map(c => hex(c) + ' (' + c.n + 'px)').join('  '));

  const groups = inks.map((ink, i) => {
    const others = inks.filter((_, j) => j !== i);
    const m = maskOf(data, w, h, ink, others);
    const loops = loopsOf(m, w, h);
    /* A HOLE ONLY CUTS A HOLE IF IT IS IN THE SAME PATH. The first cut put
       every loop in a path of its own, and separate paths do not cancel — they
       paint over each other, so the hollow half of the shield came out solid.
       Each outer boundary is given the loops that lie inside it, as further
       subpaths of the same d, and the even-odd rule does the rest. */
    const simp = loops.map(l => simplify(l, TOL));
    const area = p => { let a2 = 0;
      for (let i = 0, n = p.length; i < n; i++) {
        const q = p[(i + 1) % n]; a2 += p[i][0] * q[1] - q[0] * p[i][1];
      } return a2 / 2; };
    const inside = (pt, poly) => { let win = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i][1], yj = poly[j][1];
        if ((yi > pt[1]) !== (yj > pt[1]) &&
            pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - yi) / (yj - yi) + poly[i][0])
          win = !win;
      } return win; };
    const areas = simp.map(area);
    /* who sits inside whom. A loop's host is the smallest loop that contains
       it; a loop with no host is a shape of its own. Everything below a shape
       — its holes, and any island inside a hole — goes into that shape's own
       path, because even-odd only cancels within one path and an island
       attached to a hole that was never emitted would simply vanish. */
    const host = simp.map(() => -1);
    simp.forEach((p, i) => {
      let small = Infinity;
      simp.forEach((q, j) => {
        if (j === i || Math.abs(areas[j]) <= Math.abs(areas[i])) return;
        if (inside(p[0], q) && Math.abs(areas[j]) < small) { host[i] = j; small = Math.abs(areas[j]); }
      });
    });
    const put = p => 'M' + p.map(q => (q[0] / UP).toFixed(1) + ',' + (q[1] / UP).toFixed(1))
                            .join('L') + 'Z';
    const kidsOf = i => {
      const out = [];
      simp.forEach((p, j) => { if (host[j] === i) out.push(j, ...kidsOf(j)); });
      return out;
    };
    const d = simp.map((p, i) => host[i] >= 0 ? null
                : put(p) + kidsOf(i).map(j => put(simp[j])).join(''))
              .filter(Boolean);
    console.log('  ' + hex(ink) + ': ' + loops.length + ' loop(s), ' +
      loops.reduce((n, l) => n + l.length, 0) + ' edges -> ' +
      d.join('').split(/[ML]/).length + ' points');
    return { fill: hex(ink), d: d };
  });

  /* one path per loop, so each can be drawn on its own */
  const body = groups.map((g, gi) =>
    '  <g fill="' + g.fill + '" stroke="' + g.fill + '" stroke-width="0" data-ink="' +
      (gi === 0 ? 'shield' : 'chevron') + '">\n' +
    g.d.map(d => '    <path d="' + d + '"/>').join('\n') + '\n  </g>'
  ).join('\n');
  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
     fill-rule="evenodd" aria-hidden="true">
${body}
</svg>
`;
  fs.writeFileSync(OUT, svg);
  console.log('wrote ' + path.relative(ROOT, OUT) + '  ' + Math.round(svg.length / 1024 * 10) / 10 + 'KB');

  /* ── and now the only check worth making: does it look like the artwork? ── */
  const diff = await page.evaluate(async (pngUrl, svgText, w, h) => {
    const draw = async src => {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      return g.getImageData(0, 0, w, h).data;
    };
    const a = await draw(pngUrl);
    const bb = await draw('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText))));
    let off = 0, ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      const ai = a[i + 3] > 128, bi = bb[i + 3] > 128;
      if (ai || bi) ink++;
      if (ai !== bi) { off++; continue; }
      if (!ai) continue;
      const d = Math.abs(a[i] - bb[i]) + Math.abs(a[i+1] - bb[i+1]) + Math.abs(a[i+2] - bb[i+2]);
      if (d > 110) off++;
    }
    return { off, ink, pct: Math.round(off / ink * 10000) / 100 };
  }, dataUrl, svg, W, H);
  console.log('against the artwork: ' + diff.off + ' of ' + diff.ink +
    ' inked pixels differ — ' + diff.pct + '%');
  await browser.close();
  if (diff.pct > 4) { console.log('*** too far from the artwork to ship ***'); process.exit(1); }
})().catch(e => { console.log('BLEW UP: ' + e.message); process.exit(1); });
