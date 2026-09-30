/* ══ THE FIFTH FLOOR PLATE, DRESSED LIKE THE SHEET ══════════════════════════
   plan-lines.js, for the revised Fifth Floor only, with the two things the
   owner asked for so the plate reads like the architect's PDF:

   THE LETTERING GOES BACK ON. Unlike the older sheets, this one writes its
   words as real text, so they cost nothing: every room name and size, and the
   common names — VERANDAH, OPEN, PASSAGE, CORRIDOR, W.C, S.DUCT, stairs — are
   put back from the PDF's own text layer, small and grey, where the architect
   put them. Two kinds are left off because the page writes them itself from
   the register, where they are current: the unit number, and "AREA=…".

   WINDOWS AS A THIN DOUBLE LINE. The sheet draws a pane as four hairlines a
   few hundredths apart; at the plate's stroke they merge into a solid blue
   bar. Only the two outermost lines of each pane are kept, which is how the
   PDF reads when it is opened.

   Everything else is plan-lines.js unchanged: the lettering-colour strokes
   come off, the page is cropped to the rooms plus a margin, and the linework
   and the shapes are cut to the same box.

   node scripts/plan-lines-5f.js <dir> <pageN> <floor label> <prefix> <project slug>
   (<dir> also holds text.json, the sheet's text runs in PDF space)
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan5f';
const PAGE = process.argv[3] || 'page1';
const LABEL = process.argv[4] || 'Fifth Floor';
const PREFIX = process.argv[5] || '5F';
const SLUG = process.argv[6] || 'awami-market';
const PAD = Number(process.argv[7] || 14);
const TEXT = new Set(['#ba0d70', '#000000', '#bf00ff']);
const GLASS = new Set(['#0036db', '#0000ff']);
const INK = '#8a9099';                    // the room names: small and grey

const R = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8'));
const S = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-shapes.json'), 'utf8'));
const T = JSON.parse(fs.readFileSync(path.join(DIR, 'text.json'), 'utf8'));

let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
Object.values(R.units).forEach(u => {
  X0 = Math.min(X0, u.x0); Y0 = Math.min(Y0, u.y0);
  X1 = Math.max(X1, u.x1); Y1 = Math.max(Y1, u.y1);
});
const w0 = X1 - X0, h0 = Y1 - Y0;
const bx = X0 - PAD, by = Y0 - PAD;
const W = w0 + PAD * 2, H = h0 + PAD * 2;
const r1 = v => Math.round(v * 10) / 10;

/* the outer two of a pane's parallel hairlines */
function thinPane(d) {
  const subs = d.split('M').slice(1).map(s => (s.match(/-?[0-9.]+/g) || []).map(Number)).filter(n => n.length >= 4);
  if (subs.length < 3) return d;
  const vertical = subs.every(n => Math.abs(n[0] - n[2]) < 0.05);
  const horizontal = subs.every(n => Math.abs(n[1] - n[3]) < 0.05);
  if (!vertical && !horizontal) return d;
  const key = n => vertical ? n[0] : n[1];
  const sorted = subs.slice().sort((a, b) => key(a) - key(b));
  return [sorted[0], sorted[sorted.length - 1]]
    .map(n => 'M' + n.slice(0, 2).join(' ') + ' ' + n.slice(2).reduce((s, v, i) => s + (i % 2 ? ' ' + v : ' L' + v), '').trim())
    .join(' ');
}

/* ── the linework ── */
const src = fs.readFileSync(path.join(DIR, PAGE + '.svg'), 'utf8');
const Hs = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(src)[1]);
const out = [];
let seen = 0, dropped = 0, lettering = 0, panes = 0;
const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g;
let m;
while ((m = re.exec(src))) {
  seen++;
  const fill = m[2].toLowerCase(), stroke = m[3].toLowerCase();
  if (TEXT.has(fill) || TEXT.has(stroke)) { lettering++; continue; }
  const pts = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)];
  if (!pts.length) continue;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) {
    const px = Number(p[1]), py = Number(p[2]);
    if (px < a) a = px; if (px > c) c = px;
    if (py < b) b = py; if (py > d) d = py;
  }
  if (c < bx || a > bx + W || d < by || b > by + H) { dropped++; continue; }
  let dPath = m[1];
  if (GLASS.has(stroke)) { const t = thinPane(dPath); if (t !== dPath) panes++; dPath = t; }
  const moved = dPath.replace(/([-\d.]+) ([-\d.]+)/g, (s0, px, py) =>
    r1(Number(px) - bx) + ' ' + r1(Number(py) - by));
  out.push('<path d="' + moved + '" fill="' + (fill === 'none' ? 'none' : m[2]) +
           '" stroke="' + (stroke === 'none' ? 'none' : m[3]) + '"/>');
}

/* ── the lettering, from the PDF's own text ── */
const decode = s => s.replace(/\\([0-7]{3})/g, (x, o) => {
  const code = parseInt(o, 8);
  return code === 0xBD ? '½' : code === 0xBC ? '¼' : code === 0xBE ? '¾' : String.fromCharCode(code);
}).replace(/\\(.)/g, '$1');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const words = [];
let kept = 0, skipped = 0;
T.forEach(o => {
  const t = decode(o.t);
  if (/^\d{3}$/.test(t) || /^AREA=/.test(t)) { skipped++; return; }      // the page writes these itself
  const x = o.x - bx, y = (Hs - o.y) - by;
  if (x < -2 || y < -2 || x > W + 2 || y > H + 2) { skipped++; return; }  // title block, off the plate
  words.push('<text x="' + r1(x * 10) / 10 + '" y="' + r1(y * 10) / 10 + '" font-size="' + o.size + '">' + esc(t) + '</text>');
  kept++;
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
  (Math.round(W * 100) / 100) + ' ' + (Math.round(H * 100) / 100) + '">' +
  '<g stroke-width="0.8" vector-effect="non-scaling-stroke">' + out.join('') + '</g>' +
  '<g fill="' + INK + '" font-family="Arial,Helvetica,sans-serif" stroke="none">' + words.join('') + '</g></svg>';

/* ── the shapes, moved onto the same box ── */
const units = {};
const move = p => [ +(((p[0] * w0) + PAD) / W).toFixed(4), +(((p[1] * h0) + PAD) / H).toFixed(4) ];
Object.keys(S.units).forEach(u => { units[u] = { p: S.units[u].p.map(move), c: move(S.units[u].c) }; });

const dir = path.join('plans', SLUG);
fs.mkdirSync(dir, { recursive: true });
const fSvg = path.join(dir, PREFIX + '.svg'), fJson = path.join(dir, PREFIX + '.json');
fs.writeFileSync(fSvg, svg);
fs.writeFileSync(fJson, JSON.stringify({ floor: LABEL, w: +W.toFixed(2), h: +H.toFixed(2), units: units }));
const kb = f => Math.round(fs.statSync(f).size / 1024) + ' KB';
console.log(PAGE + ' → ' + PREFIX + '   box ' + W.toFixed(1) + ' × ' + H.toFixed(1));
console.log('  ' + seen + ' paths: ' + lettering + ' lettering-colour, ' + dropped + ' off the plate, ' + out.length + ' kept; ' +
            panes + ' panes thinned to a double line');
console.log('  ' + kept + ' words put back from the PDF text (' + skipped + ' left off: unit numbers, AREA=, title block)');
console.log('  ' + fSvg + '  ' + kb(fSvg) + '     ' + fJson + '  ' + kb(fJson) + '  (' + Object.keys(units).length + ' units)');
