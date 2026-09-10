/* ══ THE AREA THE DRAUGHTSMAN PRINTED ══════════════════════════════════════
   Rashid's rule, and he has had to say it twice: the size that counts is the
   one WRITTEN ON THE MAP, not the one the register happens to hold. On the
   Fourth Floor the register carries 342.40 against twenty-eight different
   shops; the sheet writes AREA=492.40SFT on one of them. The register was a
   placeholder wearing a number's clothes, it was taken on trust, and the link
   showed it to buyers. This reads the sheet instead.

   NOTHING HERE IS TEXT. The plans are vector with no fonts: every character is
   a traced outline, so "AREA=492.40SFT" is not a string anywhere in the file.
   The outlines are grouped into lines, the lines into characters, each
   character is drawn into a small bitmap, and identical bitmaps are clustered.
   That much is plan-read.js's method, proven on the unit numbers.

   WHAT IS NEW HERE IS THAT NOTHING IS GUESSED. Every area on every sheet is
   written the same way — AREA= then digits then a dot then digits then Sqft —
   so the writing itself says what each character must be:

     · AREA= is looked for anywhere in a line, and the Sqft anywhere after it
     · what lies between the two is the number, and nothing else on that line
       is read or needed
     · the decimal point is the only solid mark, so it says where it is
     · every other character is a digit, and digits are matched ONLY against
       digits, so a 5 can never be read as an S

   The characters that carry meaning — the digits — are therefore chosen from
   ten shapes, not from the hundreds of shapes a sheet holds. A misreading has
   to survive that, and then survive the check below as well.

   AND IT IS CHECKED, NOT TRUSTED. Three ways:
     · the line must read AREA=<digits>.<digits>SFT or it is refused outright
     · every unit must end up with exactly one area, and every area with a unit
     · the number read must agree with the room actually drawn, within the
       spread the sheet itself shows — a digit read wrong moves an area by tens
       of percent and cannot hide

   node scripts/plan-areas.js <dir> <pageN> [colour]
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page6';
/* THE RESIDENTIAL SHEETS WRITE IN PURPLE, THE COMMERCIAL ONES IN BLACK, and
   the black is shared with everything else the draughtsman noted — the type,
   the dimensions, a buyer's name. The area line is picked out of that crowd by
   its shape alone, so the rest never has to be understood. */
const COLOUR = (process.argv[4] || '#bf00ff').toLowerCase();
const W = 12, H = 16;                       // the bitmap every character is drawn into

/* ── the outlines, as pictures ──────────────────────────────────────────── */
function glyphs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2].toLowerCase() !== COLOUR && m[3].toLowerCase() !== COLOUR) continue;
    const pts = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]);
    if (pts.length < 3) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    out.push({ d: m[1], pts, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
               w: x1 - x0, h: y1 - y0 });
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
const apart = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
const fillOf = b => { let n = 0; for (const v of b) n += v; return n / b.length; };

/* ── lines, and the characters in them ──────────────────────────────────── */
const gs = glyphs(path.join(DIR, PAGE + '.svg'));
const hs = gs.map(g => g.h).sort((a, b) => a - b);
const TH = hs[Math.floor(hs.length * 0.75)] || 1;

const lines = unionGroups(gs, (a, b) =>
  Math.abs(a.cy - b.cy) <= TH * 0.7 && (b.x0 - a.x1 <= TH * 1.1) && (a.x0 - b.x1 <= TH * 1.1));

const labels = lines.map(L => {
  /* pieces of the SAME character overlap along x; two characters side by side
     do not, however close they are set */
  const cs = unionGroups(L, (a, b) => a.x1 > b.x0 + 1e-6 && b.x1 > a.x0 + 1e-6);
  cs.sort((a, b) => Math.min(...a.map(p => p.x0)) - Math.min(...b.map(p => p.x0)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  L.forEach(p => { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0);
                   x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); });
  return { chars: cs.map(c => ({ parts: c, bits: raster(c) })),
           x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
           ink: L.map(p => p.d) };
});

/* ── which lines are area lines, and what they say ──────────────────────── */
const alphabet = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-alphabet.json'), 'utf8'));
const digits = alphabet.filter(g => /[0-9]/.test(g.ch));
const key = b => [...b].join('');

/* THE SAME CHARACTER IS NEVER PRINTED TWICE THE SAME. A letter drawn again a
   few units away lands on the grid differently and a cell or two flips, so two
   prints of one S are near-identical pictures and not equal ones. They have to
   be clustered with a tolerance before anything can be counted — asking for
   equality found two area lines on a sheet that holds a hundred and fifty. */
const CUT = Math.round(W * H * 0.11);
const shapes = [];
labels.forEach(L => L.chars.forEach(c => {
  let best = null, bd = 1e9;
  for (const s of shapes) { const d = apart(key(c.bits), s.k); if (d < bd) { bd = d; best = s; } }
  if (best && bd <= CUT) c.g = best.id;
  else { shapes.push({ id: shapes.length, k: key(c.bits) }); c.g = shapes.length - 1; }
}));

/* WHERE THE AREA SITS IN A LINE. The fixed part is matched against the letters
   themselves. A R E A = and S F T are known shapes, read once by eye off the
   Fourth Floor and kept in plan-alphabet.json. Letters are easy to tell apart
   at this size — it is the digits that need care, and they are handled
   separately below.

   IT IS LOOKED FOR INSIDE THE LINE, NOT AT ITS ENDS. Two earlier cuts failed
   on that. Taking the commonest shape at each position made the model for
   position nought an X, because the commercial sheets are covered in dimension
   lines that run to the same length and outnumber the area lines. Then
   requiring the line to END in SFT lost ninety-three shops on the Lower Ground
   alone, where the labels are set so tightly that the next piece of writing
   joins the same line: AREA=203.37SFT with four more characters trailing it.
   So AREA= is searched for anywhere in the line and SFT anywhere after it, and
   what lies between the two is the number. Whatever else shares the line is
   neither read nor needed. */
const modelsFor = (ch) => alphabet.filter(g => g.ch === ch).map(g => g.b);
const HEAD = ['A', 'R', 'E', 'A', '='].map(modelsFor);
const TAIL = ['S', 'F', 'T'].map(modelsFor);
if (HEAD.concat(TAIL).some(m => !m.length)) {
  console.log(PAGE + ': the alphabet is missing a letter'); process.exit(1);
}

/* generous, because the smaller hand on the black sheets sits further from a
   model than a second print at the same size would — but a letter still has to
   land nearer its own model than an X lands to an A */
const LIKE = Math.round(W * H * 0.26);
const isLetter = (c, models) => !!c && models.some(k => apart(key(c.bits), k) <= LIKE);
const runAt = (L, i, set) => set.every((m, k) => isLetter(L.chars[i + k], m));

/* every AREA=…SFT found on the sheet, as the stretch of one line it occupies */
const areaLines = [];
labels.forEach(L => {
  for (let i = 0; i + 5 < L.chars.length; i++) {
    if (!runAt(L, i, HEAD)) continue;
    for (let j = i + 6; j + 2 < L.chars.length + 1 && j <= i + 5 + 9; j++) {
      if (!runAt(L, j, TAIL)) continue;
      const parts = [].concat(...L.chars.slice(i, j + 3).map(c => c.parts));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      parts.forEach(p => { x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0);
                           x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); });
      areaLines.push({ chars: L.chars.slice(i, j + 3), from: 5, to: j - i,
                       x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
                       ink: parts.map(p => p.d) });
      break;
    }
  }
});

/* WHAT OPENS AREA= AND STILL WAS NOT TAKEN. A unit left with no area against
   it is the one thing this reader must never pass over in silence, so every
   place those five letters appear is counted, and the gap between that and
   what was read is reported whether or not anyone asks. */
let heads = 0;
labels.forEach(L => { for (let i = 0; i + 5 < L.chars.length; i++) if (runAt(L, i, HEAD)) heads++; });
if (heads > areaLines.length)
  console.log('  ' + (heads - areaLines.length) + ' places open AREA= with no SFT found after them');

/* THE DECIMAL POINT IS FOUND BY ITS SHAPE, NOT BY COUNTING BACK FROM THE END.
   Most lines write two decimals — 492.40 — but some write one, 526.6, and
   counting places from the end put the point on a digit and threw those lines
   away. A point is the only mark on the line that is solid, so it says where
   it is; the digits are then whatever is on either side of it. */
/* A DIGIT IS NAMED ONCE, NOT ONCE PER PRINT. The black sheets draw a smaller,
   heavier hand than the purple ones, so an individual 6 can sit further from
   the model 6 than the strictest threshold allows — a hundred and sixty-six
   lines on the Lower Ground were thrown away for it. But every print of that 6
   on the sheet has already been clustered together, and the cluster as a whole
   is unmistakable: it is decided once, on the evidence of all its members, and
   every line that uses it then reads the same way. A cluster that no digit
   fits is left unnamed and every line containing it is refused. */
const digitPositions = new Set();
areaLines.forEach(L => { for (let i = L.from; i < L.to; i++) digitPositions.add(L.chars[i].g); });
const named = new Map();
let worstDigit = 0;
digitPositions.forEach(g => {
  const mine = [];
  areaLines.forEach(L => { for (let i = L.from; i < L.to; i++) if (L.chars[i].g === g) mine.push(L.chars[i]); });
  if (fillOf(mine[0].bits) > 0.55) return;            // the decimal point, not a digit
  let ch = null, best = 1e9;
  for (const d of digits) {
    /* the whole cluster votes: the average distance from this digit's model */
    let sum = 0;
    for (const c of mine) sum += apart(key(c.bits), d.b);
    const avg = sum / mine.length;
    if (avg < best) { best = avg; ch = d.ch; }
  }
  if (best <= W * H * 0.30) { named.set(g, ch); if (best > worstDigit) worstDigit = best; }
  else if (process.env.SHOW) {
    const rows = [];
    for (let y = 0; y < H; y++) {
      let r = '   ';
      for (let x = 0; x < W; x++) r += mine[0].bits[y * W + x] ? '#' : '.';
      rows.push(r);
    }
    console.log('unnamed shape, ' + mine.length + ' prints, nearest is ' + ch +
                ' at ' + best.toFixed(0) + ' cells:\n' + rows.join('\n'));
  }
});
console.log('  ' + named.size + ' digit shapes named' +
            (named.size ? ', worst fit ' + worstDigit.toFixed(1) + ' cells of ' + (W * H) : ''));

const readNumber = (L) => {
  let s = '', dots = 0;
  for (let i = L.from; i < L.to; i++) {
    const c = L.chars[i];
    if (fillOf(c.bits) > 0.55) { dots++; s += '.'; continue; }
    const ch = named.get(c.g);
    if (!ch) return null;                    // a shape no digit fits
    s += ch;
  }
  if (dots !== 1) return null;
  return /^[0-9]+\.[0-9]+$/.test(s) ? Number(s) : null;
};

const read = [], refused = [];
areaLines.forEach(L => {
  const v = readNumber(L);
  if (v === null) refused.push(L); else read.push({ L, v });
});
console.log(PAGE + ' (' + COLOUR + '): ' + labels.length + ' lines, ' +
            areaLines.length + ' of them area lines, ' + read.length + ' read, ' +
            refused.length + ' refused');

/* ── whose area is it ───────────────────────────────────────────────────── */
/* The number and its area are printed as a pair, the area a line below, so the
   nearest unit number owns it — and the proof that it worked is that no unit
   is claimed twice. */
const units = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-read.json'), 'utf8'));
const out = {}, twice = [];
read.forEach(r => {
  let best = null, bd = 1e9;
  units.forEach(u => { const d = Math.hypot(u.cx - r.L.cx, u.cy - r.L.cy); if (d < bd) { bd = d; best = u; } });
  if (out[best.u]) twice.push(best.u);
  out[best.u] = { area: r.v, away: +bd.toFixed(1),
                  box: [+r.L.x0.toFixed(2), +r.L.y0.toFixed(2), +r.L.x1.toFixed(2), +r.L.y1.toFixed(2)],
                  ink: r.L.ink };
});
const missing = units.filter(u => !out[u.u]).map(u => u.u);
console.log('  ' + Object.keys(out).length + ' of ' + units.length + ' units carry an area' +
            (twice.length ? '   CLAIMED TWICE: ' + twice.slice(0, 6).join(' ') : '') +
            (missing.length ? '   no area found for ' + missing.length : ''));

/* ── does the number agree with the room that was drawn ─────────────────── */
/* A digit read wrong moves an area by tens of percent. Every unit is measured
   against the sheet's own median of area-per-pixel, and anything far off it is
   named here rather than shipped quietly. */
const rooms = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8')).units;
const ks = Object.keys(out).filter(u => rooms[u]).map(u => out[u].area / rooms[u].area).sort((a, b) => a - b);
const med = ks[Math.floor(ks.length / 2)];
const strays = Object.keys(out).filter(u => rooms[u])
  .map(u => ({ u, off: (out[u].area / rooms[u].area / med - 1) * 100 }))
  .filter(s => Math.abs(s.off) > 25)
  .sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
console.log('  measured against the rooms: ' + (ks.length - strays.length) + ' of ' + ks.length +
            ' sit within a quarter of the sheet\'s own scale' +
            (strays.length ? '   LOOK AT: ' + strays.slice(0, 6).map(s => s.u + ' ' + s.off.toFixed(0) + '%').join(' ') : ''));

const file = path.join(DIR, PAGE + '-area.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('  written ' + file);
if (twice.length || strays.length) process.exitCode = 1;
