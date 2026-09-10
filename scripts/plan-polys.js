/* ══ FROM FILLED PIXELS TO A SHAPE WORTH SENDING ════════════════════════════
   The flood gives every unit as run-lengths — exact, and far too heavy to put
   on a phone: a single shop is a hundred rows of three numbers. This walks the
   boundary of each filled region and keeps only the corners.

   The regions are rectilinear, so the boundary is stitched from the edges
   between a filled cell and an empty one, then collinear points are dropped and
   the rest simplified. Nothing is smoothed into a tidier shape than the walls
   allow: an L-shaped shop stays L-shaped, which is the whole reason the shapes
   were flooded rather than drawn.

   Output is normalised 0..1 against the floor's own extent, so the page can
   draw it at any size without knowing anything about drawing units.

   node scripts/plan-polys.js <dir> <pageN>
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
/* HOW HARD TO SNAP THE STAIRCASE OUT OF A BOUNDARY. A flooded shop has clean
   rectilinear edges and two pixels is plenty. A watershed boundary — where two
   rooms met in the middle of an opening — runs diagonally, and a diagonal in a
   raster is a staircase: without a heavier snap the Third Floor came out at
   seventy-eight corners a room against fifteen on a shop floor. */
const SNAP = Number(process.argv[4] || 2);

const R = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8'));
const PX = R.px;

/* the outline of a set of cells: every edge with filled on one side and empty
   on the other, stitched end to end */
function outline(rows) {
  const on = new Set();
  rows.forEach(r => { for (let x = r[1]; x <= r[2]; x++) on.add(r[0] + ',' + x); });
  const has = (y, x) => on.has(y + ',' + x);
  const edges = new Map();                 // "x,y" -> list of next "x,y"
  const add = (a, b) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push(b); };
  rows.forEach(r => {
    const y = r[0];
    for (let x = r[1]; x <= r[2]; x++) {
      /* wound so the inside is always on the same hand */
      if (!has(y - 1, x)) add(x + ',' + y, (x + 1) + ',' + y);
      if (!has(y + 1, x)) add((x + 1) + ',' + (y + 1), x + ',' + (y + 1));
      if (!has(y, x - 1)) add(x + ',' + (y + 1), x + ',' + y);
      if (!has(y, x + 1)) add((x + 1) + ',' + y, (x + 1) + ',' + (y + 1));
    }
  });
  /* the longest loop is the room; anything else is a hole or a speck */
  const loops = [];
  const seen = new Set();
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    let cur = start; const loop = [];
    while (true) {
      const nexts = edges.get(cur);
      if (!nexts || !nexts.length) break;
      const nxt = nexts.shift();
      loop.push(cur.split(',').map(Number));
      seen.add(cur);
      cur = nxt;
      if (cur === start) break;
      if (loop.length > 200000) break;
    }
    if (loop.length > 3) loops.push(loop);
  }
  if (!loops.length) return null;
  loops.sort((a, b) => b.length - a.length);
  return loops[0];
}

/* CORNERS ONLY. Douglas-Peucker was tried here and collapsed every room to a
   single point: on a CLOSED loop the first and last vertex are the same, so
   the line it measures deviation from has zero length and everything is within
   it. These outlines are rectilinear anyway — they need no curve fitting, only
   the corners, with the raster staircase snapped away first. */
function tidy(pts) {
  /* px; the wall is thicker than this */
  let p = pts.map(q => [Math.round(q[0] / SNAP) * SNAP, Math.round(q[1] / SNAP) * SNAP]);
  /* consecutive duplicates first, or the collinearity test sees zero-length legs */
  p = p.filter((q, i) => { const r = p[(i + 1) % p.length]; return q[0] !== r[0] || q[1] !== r[1]; });
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) > 1e-9) out.push(b);
    }
    if (out.length === p.length) break;
    p = out;
    if (p.length < 4) break;
  }
  return p;
}
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
Object.values(R.units).forEach(u => {
  X0 = Math.min(X0, u.x0); Y0 = Math.min(Y0, u.y0);
  X1 = Math.max(X1, u.x1); Y1 = Math.max(Y1, u.y1);
});
const W = X1 - X0, H = Y1 - Y0;

const out = {};
let pts = 0, worst = 0, worstU = '';
Object.keys(R.units).forEach(u => {
  const r = R.units[u];
  const loop = outline(r.rows);
  if (!loop) { console.log('no outline for ' + u); return; }
  const t = tidy(loop);
  pts += t.length;
  if (t.length > worst) { worst = t.length; worstU = u; }
  out[u] = {
    /* back to drawing units through the tile the flood ran in, THEN normalised
       — the rows are pixels within that tile, not on the sheet */
    p: t.map(p => [ +(((p[0] / PX + r.ox) - X0) / W).toFixed(4),
                    +(((p[1] / PX + r.oy) - Y0) / H).toFixed(4) ]),
    c: [ +(((r.x0 + r.x1) / 2 - X0) / W).toFixed(4), +(((r.y0 + r.y1) / 2 - Y0) / H).toFixed(4) ]
  };
});

const n = Object.keys(out).length;
console.log('units ' + n + '   points ' + pts + '  (average ' + (pts / n).toFixed(1) +
            ', worst ' + worst + ' on ' + worstU + ')');
const payload = { w: +W.toFixed(2), h: +H.toFixed(2), units: out };
const file = path.join(DIR, PAGE + '-shapes.json');
fs.writeFileSync(file, JSON.stringify(payload));
console.log('written ' + file + '  (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
