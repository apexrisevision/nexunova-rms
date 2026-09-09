/* ══ READING A DRAWING THAT HAS NO TEXT IN IT ═══════════════════════════════
   The Awami plans are vector with no fonts: every unit number is a set of glyph
   OUTLINES, so "GF-73" is not a string anywhere in the file. It cannot be
   searched, and it cannot be read by anything but an eye.

   It can be read by shape, though. The same character drawn by the same font at
   the same size produces the SAME path, moved. So this normalises every
   magenta path to its own top-left corner, rounds it, and groups identical
   shapes. Thirty-odd clusters come out — the digits, the letters used in floor
   prefixes, the dot and the dash — and one look at a sheet of samples turns the
   whole drawing into text for good.

   Everything downstream depends on this mapping being right, so it is written
   out as a table that can be checked rather than trusted.

   node scripts/plan-glyphs.js <dir> [pageN]
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const ONLY = process.argv[3] || null;
const LABEL_COLOUR = '#ba0d70';

function glyphsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2].toLowerCase() !== LABEL_COLOUR && m[3].toLowerCase() !== LABEL_COLOUR) continue;
    const nums = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]);
    if (!nums.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nums.forEach(p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
                        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
    out.push({ d: m[1], x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/* THE SHAPE ALONE, and measured against ITSELF. Translating to the corner and
   rounding to a hundredth of a drawing unit was not enough: the same character
   printed twice differs further down the decimals, so 22,000 glyphs produced
   18,835 "distinct" shapes and the clustering did nothing at all.

   Normalised to the glyph's own width and height and quantised to fortieths,
   two prints of the same character land on the same key and two different
   characters do not — the aspect ratio is part of the key besides, so a wide
   character cannot collide with a narrow one however similar the outline. */
/* THE DRAWING'S OWN GRID. Every coordinate in these sheets is a multiple of
   0.12 units, so snapping to that grid gives whole numbers that float error
   cannot move. Quantising to fortieths of the glyph's own box did not: 40 steps
   across 1.8 units puts each real point at 2.67 quanta, permanently near a
   rounding boundary, and two prints of the same character fell on either side
   of it. 22,000 glyphs came out as 12,549 "distinct" shapes. */
const GRID = 0.12;
function signature(g) {
  const q = g.d.replace(/([-\d.]+) ([-\d.]+)/g, (s, a, b) =>
    Math.round((Number(a) - g.x0) / GRID) + ' ' + Math.round((Number(b) - g.y0) / GRID));
  return Math.round(g.w / GRID) + 'x' + Math.round(g.h / GRID) + '|' + q;
}

const pages = fs.readdirSync(DIR).filter(n => /^page\d+\.svg$/.test(n))
  .filter(n => !ONLY || n === ONLY + '.svg')
  .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));

const clusters = new Map();
const perPage = {};
pages.forEach(n => {
  const gs = glyphsOf(path.join(DIR, n));
  perPage[n] = gs;
  gs.forEach(g => {
    const k = signature(g);
    if (!clusters.has(k)) clusters.set(k, { key: k, n: 0, sample: g, w: g.w, h: g.h });
    clusters.get(k).n++;
  });
  console.log(n.padEnd(11) + gs.length + ' label glyphs');
});

const list = [...clusters.values()].sort((a, b) => b.n - a.n);
console.log('\ndistinct shapes: ' + list.length);
console.log('top 40 by count: ' + list.slice(0, 40).map(c => c.n).join(', '));

fs.writeFileSync(path.join(DIR, 'glyph-clusters.json'),
  JSON.stringify(list.map((c, i) => ({ i: i, n: c.n, w: +c.w.toFixed(2), h: +c.h.toFixed(2),
                                       d: c.sample.d, key: c.key })), null, 1));
console.log('written ' + path.join(DIR, 'glyph-clusters.json'));
