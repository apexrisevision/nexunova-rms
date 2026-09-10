/* ══ READING THE UNIT NUMBERS ══════════════════════════════════════════════
   The labels are traced outlines, not text and not even a font: the same digit
   printed twice differs in the fifth decimal, so no two prints share a shape and
   nothing can be matched exactly.

   They can be matched as PICTURES though. Each character is rasterised to a
   small bitmap and clustered by how many cells differ. A dozen or so clusters
   come out per sheet — the digits, the two letters of the prefix, the dash — and
   ONE contact sheet, read once by eye, turns every label on the drawing into a
   string for good.

   The reading is then checked against the system rather than trusted: the set of
   numbers read off a floor must be exactly the set of units that floor holds,
   each once. On the Lower Ground that is 167 numbers and LG-01-A. A recogniser
   that is wrong anywhere fails that test, which is the whole point of it.

   node scripts/plan-read.js <dir> <pageN>            build the contact sheet
   node scripts/plan-read.js <dir> <pageN> <map>      decode using a mapping
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const MAP = process.argv[4] || null;
/* WHAT THE SHEET WRITES IS NOT ALWAYS WHAT THE REGISTER HOLDS. The upper
   floors are printed "F.F-155", "4TH.F-33", "5TH.F-01", and the register
   calls the same shops FF-155, 4F-33, 5F-01. Rashid had to say this out loud
   once already — "ye 4F-33 aur 4th.F-33 same hain" — so it is written down
   here instead of being remembered.

   Given a prefix, a label is reduced to the digits it ends with and rebuilt as
   PREFIX-digits. That also settles the dot: a dot and a dash both rasterise to
   a solid block and no picture can tell them apart, and neither of them
   survives this step, so neither of them has to be told apart. Anything that
   does NOT end in digits is left exactly as it was read, so it shows up as a
   mismatch rather than being tidied into something plausible. */
const PREFIX = process.argv[5] || null;
function asRegister(raw) {
  if (!PREFIX) return raw;
  /* digits, and a letter after them if there is one: the First Floor has
     FF-83A and FF-159A, drawn between 83/84 and 159/160 — shops the register
     did not hold until the drawing was read. */
  const m = /([0-9]+[A-Za-z]?)$/.exec(raw);
  return m ? PREFIX + '-' + m[1] : raw;
}
/* THE UNIT NUMBERS ARE MAGENTA. Everything else the draughtsman wrote — the
   type, the dimensions, the area, the buyer's name — is black, in the same
   traced outlines, and can be read exactly the same way. Reading it matters:
   when the register and the drawing disagree about how big a shop is, the
   number PRINTED ON THE SHEET is the drawing's own answer, and measuring the
   room with a flood is only ever within a percent or so of it.

   A window can be given too, because nobody needs to read a whole floor's
   worth of black text to settle one shop. */
const COLOUR = (process.argv[6] || '#ba0d70').toLowerCase();
const WIN = process.argv[7] ? process.argv[7].split(',').map(Number) : null;   // x,y,w,h
const W = 12, H = 16;                        // the bitmap every character is drawn into

function glyphs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2].toLowerCase() !== COLOUR && m[3].toLowerCase() !== COLOUR) continue;
    const pts = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]);
    if (pts.length < 3) continue;
    if (WIN && !pts.some(p => p[0] >= WIN[0] && p[0] <= WIN[0] + WIN[2] &&
                              p[1] >= WIN[1] && p[1] <= WIN[1] + WIN[3])) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    out.push({ pts: pts, x0: x0, y0: y0, x1: x1, y1: y1,
               cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

function unionGroups(items, near) {
  const n = items.length, parent = [...Array(n).keys()];
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (near(items[i], items[j])) { const a = find(i), b = find(j); if (a !== b) parent[b] = a; }
  const out = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!out.has(r)) out.set(r, []); out.get(r).push(items[i]); }
  return [...out.values()];
}

/* even-odd fill, sampled at cell centres: the counters of an 8 stay holes */
function raster(parts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  parts.forEach(p => { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0);
                       x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); });
  const bw = x1 - x0 || 1, bh = y1 - y0 || 1;
  const bits = new Uint8Array(W * H);
  for (let ry = 0; ry < H; ry++) {
    const y = y0 + (ry + 0.5) / H * bh;
    for (let rx = 0; rx < W; rx++) {
      const x = x0 + (rx + 0.5) / W * bw;
      let inside = false;
      for (const p of parts) {
        const q = p.pts;
        for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
          if (((q[i][1] > y) !== (q[j][1] > y)) &&
              (x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0])) inside = !inside;
        }
      }
      if (inside) bits[ry * W + rx] = 1;
    }
  }
  return bits;
}
const dist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

const gs = glyphs(path.join(DIR, PAGE + '.svg'));
const hs = gs.map(g => g.h).sort((a, b) => a - b);
const TH = hs[Math.floor(hs.length * 0.75)] || 1;

/* labels first, then the characters inside each one */
const labels = unionGroups(gs, (a, b) =>
  Math.abs(a.cy - b.cy) <= TH * 0.7 && (b.x0 - a.x1 <= TH * 1.1) && (a.x0 - b.x1 <= TH * 1.1));

const chars = [];
labels.forEach((L, li) => {
  /* STRICT OVERLAP, and only that. Allowing a little slack merged neighbouring
     characters: 168 labels came out as 483 characters when they hold about 950,
     so every second pair of digits was being read as one picture. Pieces of the
     SAME character genuinely overlap along x; two characters side by side do
     not, however close they are set. */
  const cs = unionGroups(L, (a, b) => a.x1 > b.x0 + 1e-6 && b.x1 > a.x0 + 1e-6);
  cs.sort((a, b) => Math.min(...a.map(p => p.x0)) - Math.min(...b.map(p => p.x0)));
  cs.forEach((c, ci) => chars.push({ label: li, at: ci, parts: c, bits: raster(c),
                                     x0: Math.min(...c.map(p => p.x0)),
                                     w: Math.max(...c.map(p => p.x1)) - Math.min(...c.map(p => p.x0)),
                                     h: Math.max(...c.map(p => p.y1)) - Math.min(...c.map(p => p.y0)) }));
});
console.log(PAGE + ': ' + labels.length + ' labels, ' + chars.length + ' characters');
console.log('characters per label: ' + JSON.stringify(
  labels.map((_, i) => chars.filter(c => c.label === i).length)
        .reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {})));

/* cluster the pictures */
const CUT = Math.round(W * H * 0.11);
const groups = [];
chars.forEach(c => {
  let best = null, bd = 1e9;
  for (const g of groups) { const d = dist(c.bits, g.bits); if (d < bd) { bd = d; best = g; } }
  if (best && bd <= CUT) { best.n++; best.members.push(c); c.g = best.id; }
  else { const g = { id: groups.length, bits: c.bits, n: 1, members: [c], sample: c }; groups.push(g); c.g = g.id; }
});
groups.sort((a, b) => b.n - a.n);
console.log('distinct character pictures: ' + groups.length +
            '   counts: ' + groups.map(g => g.n).join(', '));

if (!MAP) {
  const cell = (g, i) => {
    let rows = '';
    for (let y = 0; y < H; y++) { let r = '';
      for (let x = 0; x < W; x++) r += g.bits[y * W + x] ? '<i class="on"></i>' : '<i></i>';
      rows += '<div class="r">' + r + '</div>'; }
    return '<div class="c"><div class="t">' + i + '  (' + g.n + ')</div>' + rows + '</div>';
  };
  const html = '<style>body{margin:0;background:#fff;font:12px system-ui}' +
    '.g{display:flex;flex-wrap:wrap;gap:10px;padding:10px}' +
    '.c{border:1px solid #999}.t{background:#111;color:#fff;padding:2px 4px;font-weight:700}' +
    '.r{display:flex;height:9px}i{width:9px;height:9px;display:block}i.on{background:#000}</style>' +
    '<div class="g">' + groups.map((g, i) => cell(g, i)).join('') + '</div>';
  fs.writeFileSync(path.join(DIR, PAGE + (COLOUR === '#ba0d70' ? '' : '-text') + '-chars.html'), html);
  console.log('contact sheet: ' + path.join(DIR, PAGE + (COLOUR === '#ba0d70' ? '' : '-text') + '-chars.html'));
} else {
  const table = MAP.split('');
  /* the string AND where it sits, because the next step needs to know which
     room each number is standing in */
  const out = labels.map((L, i) => {
    const cs = chars.filter(c => c.label === i).sort((a, b) => a.x0 - b.x0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    L.forEach(p => { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0);
                     x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); });
    const raw = cs.map(c => table[groups.findIndex(g => g.id === c.g)] || '?').join('');
    return { u: asRegister(raw), raw: raw,
             x0: +x0.toFixed(2), y0: +y0.toFixed(2), x1: +x1.toFixed(2), y1: +y1.toFixed(2),
             cx: +((x0 + x1) / 2).toFixed(2), cy: +((y0 + y1) / 2).toFixed(2) };
  });
  /* THE UNIT NUMBERS OWN -read.json. Reading the black or purple lettering is
     a side errand — an area line, a dimension — and writing it over the file the
     whole pipeline reads its labels from wipes the floor out. It cost a run to
     learn that; it goes to its own file now. */
  const out2 = path.join(DIR, PAGE + (COLOUR === '#ba0d70' ? '-read.json' : '-text.json'));
  fs.writeFileSync(out2, JSON.stringify(out, null, 1));
  console.log('read ' + out.length + ' labels → ' + out2);
  console.log(out.slice(0, 12).map(o => o.u).join('  '));
}
