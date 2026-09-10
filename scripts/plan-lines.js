/* ══ THE SHEET, CROPPED AND STRIPPED, READY TO SHIP ═════════════════════════
   The last step. Takes the architect's page and the rooms flooded out of it,
   and writes the two files the public page loads:

     plans/<project>/<PREFIX>.svg    the linework, and nothing else
     plans/<project>/<PREFIX>.json   one polygon per unit, normalised 0..1

   Three things happen here and nothing else does:

   THE LETTERING COMES OFF. Every character on these sheets is a traced
   outline — twelve megabytes of them against one megabyte of walls — and the
   page writes the labels itself from the register, where they are also current.

   THE PAGE IS CROPPED to the floor plate: the extent of the rooms plus a
   margin. A drawing sheet is mostly title block and empty paper.

   AND BOTH FILES ARE CUT TO THE SAME BOX, here, in one place. That is the
   whole reason this is a script and not a series of commands: the polygons are
   normalised against the same rectangle the drawing is cropped to, so a shape
   cannot drift off its room by an offset nobody typed twice the same way.

   Nothing is redrawn, moved or simplified. The paths are the file's own, with
   the origin subtracted and the numbers rounded to a tenth of a drawing unit.

   node scripts/plan-lines.js <dir> <pageN> <floor label> <prefix> <project slug>
*/
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const LABEL = process.argv[4] || 'Floor';
const PREFIX = process.argv[5] || 'LG';
const SLUG = process.argv[6] || 'awami-market';
const PAD = Number(process.argv[7] || 14);          // drawing units of margin
const TEXT = new Set(['#ba0d70', '#000000', '#bf00ff']);   // the traced lettering,
                                                          // purple included: the
                                                          // residential sheets write
                                                          // the area in it

const R = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8'));
const S = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-shapes.json'), 'utf8'));

/* the box, from the rooms — the same rooms the shapes were normalised against */
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
Object.values(R.units).forEach(u => {
  X0 = Math.min(X0, u.x0); Y0 = Math.min(Y0, u.y0);
  X1 = Math.max(X1, u.x1); Y1 = Math.max(Y1, u.y1);
});
const w0 = X1 - X0, h0 = Y1 - Y0;                    // what plan-polys normalised to
const bx = X0 - PAD, by = Y0 - PAD;
const W = w0 + PAD * 2, H = h0 + PAD * 2;

/* ── the linework ─────────────────────────────────────────────────────────── */
const src = fs.readFileSync(path.join(DIR, PAGE + '.svg'), 'utf8');
const out = [];
let seen = 0, dropped = 0, lettering = 0;
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
  /* anything that does not reach the plate is title block, key or border */
  if (c < bx || a > bx + W || d < by || b > by + H) { dropped++; continue; }
  const moved = m[1].replace(/([-\d.]+) ([-\d.]+)/g, (s0, px, py) =>
    (Math.round((Number(px) - bx) * 10) / 10) + ' ' + (Math.round((Number(py) - by) * 10) / 10));
  out.push('<path d="' + moved + '" fill="' + (fill === 'none' ? 'none' : m[2]) +
           '" stroke="' + (stroke === 'none' ? 'none' : m[3]) + '"/>');
}

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
  (Math.round(W * 100) / 100) + ' ' + (Math.round(H * 100) / 100) + '">' +
  '<g stroke-width="0.8" vector-effect="non-scaling-stroke">' + out.join('') + '</g></svg>';

/* ── the shapes, moved onto the same box ──────────────────────────────────── */
const units = {};
const move = p => [ +(((p[0] * w0) + PAD) / W).toFixed(4),
                    +(((p[1] * h0) + PAD) / H).toFixed(4) ];
Object.keys(S.units).forEach(u => {
  units[u] = { p: S.units[u].p.map(move), c: move(S.units[u].c) };
});

const dir = path.join('plans', SLUG);
fs.mkdirSync(dir, { recursive: true });
const fSvg = path.join(dir, PREFIX + '.svg'), fJson = path.join(dir, PREFIX + '.json');
fs.writeFileSync(fSvg, svg);
fs.writeFileSync(fJson, JSON.stringify({ floor: LABEL, w: +W.toFixed(2), h: +H.toFixed(2), units: units }));

const kb = f => Math.round(fs.statSync(f).size / 1024) + ' KB';
console.log(PAGE + ' → ' + PREFIX + '   box ' + W.toFixed(1) + ' × ' + H.toFixed(1));
console.log('  ' + seen + ' paths on the sheet: ' + lettering + ' were lettering, ' +
            dropped + ' were off the plate, ' + out.length + ' kept');
console.log('  ' + fSvg + '  ' + kb(fSvg) + '     ' + fJson + '  ' + kb(fJson) +
            '  (' + Object.keys(units).length + ' units)');
