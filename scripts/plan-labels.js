/* ══ FINDING THE UNIT LABELS ON A DRAWING WITH NO TEXT IN IT ════════════════
   Step one of reading these sheets. The unit numbers are magenta (#ba0d70) and
   every character is a traced outline, so a label like "GF-73" is five or six
   separate little polygons sitting on one baseline.

   This groups them back into labels — same baseline, touching along x — and
   reports how many each sheet has. That count is the first real check: the
   Lower Ground sheet must produce 168 labels, because the system holds exactly
   168 lower-ground units. A grouping that cannot count is not worth reading.

   node scripts/plan-labels.js <dir>
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const COLOUR = '#ba0d70';

function glyphs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2].toLowerCase() !== COLOUR && m[3].toLowerCase() !== COLOUR) continue;
    const pts = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]);
    if (!pts.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    out.push({ d: m[1], pts: pts, x0: x0, y0: y0, x1: x1, y1: y1,
               cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/* ONE CHARACTER IS OFTEN SEVERAL OUTLINES — the ring of an 8, the bar of an A,
   and on a traced drawing sometimes three or four pieces of one digit. So a
   label is not built by walking a line once and stopping at the first match:
   that split 22 of the Lower Ground's labels in half, and the halves OVERLAPPED
   each other, which no single pass would ever put back together.

   Union-find instead. Two pieces belong to the same label when they sit on the
   same line of text and are near enough along x to be the next character rather
   than another unit's label two rooms away. Nearness is measured in text
   heights, so it does not care what scale a sheet was drawn at. */
function group(gs) {
  const n = gs.length;
  const parent = new Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  /* the height of a character on this sheet, taken from the glyphs themselves */
  const hs = gs.map(g => g.h).sort((a, b) => a - b);
  const TH = hs[Math.floor(hs.length * 0.75)] || 1;
  const GAP = TH * 1.1, LINE = TH * 0.7;

  /* sorted by x so only a short window of candidates has to be considered */
  const idx = gs.map((g, i) => i).sort((p, q) => gs[p].x0 - gs[q].x0);
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a], gi = gs[i];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b], gj = gs[j];
      if (gj.x0 - gi.x1 > GAP) break;              // sorted: nothing further can be near
      if (Math.abs(gi.cy - gj.cy) > LINE) continue;
      union(i, j);
    }
  }

  const rows = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!rows.has(r)) rows.set(r, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, parts: [] });
    const row = rows.get(r), g = gs[i];
    row.parts.push(g);
    if (g.x0 < row.x0) row.x0 = g.x0; if (g.x1 > row.x1) row.x1 = g.x1;
    if (g.y0 < row.y0) row.y0 = g.y0; if (g.y1 > row.y1) row.y1 = g.y1;
  }
  return [...rows.values()].map(r => { r.cy = (r.y0 + r.y1) / 2; r.h = r.y1 - r.y0; return r; });
}
const pages = fs.readdirSync(DIR).filter(n => /^page\d+\.svg$/.test(n))
  .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));

const all = {};
pages.forEach(n => {
  const gs = glyphs(path.join(DIR, n));
  if (!gs.length) { console.log(n.padEnd(11) + 'no labels (not a floor sheet)'); return; }
  const rows = group(gs);
  const widths = rows.map(r => r.x1 - r.x0).sort((a, b) => a - b);
  console.log(n.padEnd(11) + String(gs.length).padStart(5) + ' glyphs  ->  ' +
              String(rows.length).padStart(4) + ' labels' +
              '   width ' + widths[0].toFixed(1) + '..' + widths[widths.length - 1].toFixed(1) +
              '  (median ' + widths[Math.floor(widths.length / 2)].toFixed(1) + ')');
  all[n] = rows.map(r => ({ x0: +r.x0.toFixed(2), y0: +r.y0.toFixed(2),
                            x1: +r.x1.toFixed(2), y1: +r.y1.toFixed(2),
                            parts: r.parts.length }));
});
fs.writeFileSync(path.join(DIR, 'labels.json'), JSON.stringify(all));
console.log('\nwritten ' + path.join(DIR, 'labels.json'));
