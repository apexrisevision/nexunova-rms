/* ══ THE ARCHITECT'S PDF, PAGE BY PAGE, AS SVG ══════════════════════════════
   Nothing on this machine rasterises a PDF and Chrome's own viewer paints only
   the page it is showing, so the file is read directly: object table, inflated
   content streams, and the operators a CAD export actually emits — q/Q, cm,
   m l c v y h re, and the paint operators. Colours are kept, because the
   drawing has to read the way it was drawn.

   PAGE ORDER HERE IS NOT FLOOR ORDER. Pages come out in object-number order,
   which is neither the /Pages /Kids order nor the order they print in. Ask the
   sheet what it is — scripts/plan-titles.js reads the title printed on each
   one — and never guess from the index. Getting this wrong puts one floor's
   rooms under another floor's numbers.

   node scripts/plan-pages.js <file.pdf> [outdir]
*/
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const SRC = process.argv[2];
const OUT = process.argv[3] || 'marketing_shots/plan';
const buf = fs.readFileSync(SRC);
const s = buf.toString('latin1');

const objs = {};
{
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g; let m;
  while ((m = re.exec(s))) objs[m[1]] = { body: m[2], start: m.index };
}
function streamOf(n) {
  const o = objs[n]; if (!o) return null;
  const i = o.body.indexOf('stream'); if (i < 0) return null;
  const prefix = n + ' 0 obj';
  let k = o.start + prefix.length + i + 'stream'.length;
  if (buf[k] === 13) k++;
  if (buf[k] === 10) k++;
  const end = o.start + prefix.length + o.body.indexOf('endstream', i);
  try { return zlib.inflateSync(buf.slice(k, end)).toString('latin1'); }
  catch (e) { return null; }
}

const pages = [];
for (const n in objs) {
  if (/\/Type\s*\/Page[^s]/.test(objs[n].body)) {
    const c = /\/Contents\s+(\d+)\s+0\s+R/.exec(objs[n].body);
    const mb = /\/MediaBox\s*\[([^\]]+)\]/.exec(objs[n].body);
    pages.push({ obj: Number(n), contents: c && c[1],
                 box: mb ? mb[1].trim().split(/\s+/).map(Number) : [0, 0, 612, 792] });
  }
}
pages.sort((a, b) => a.obj - b.obj);

function mul(a, b) {           // a then b, both [a b c d e f]
  return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
          a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
          a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]];
}
const apply = (m, x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
const f2 = v => (Math.round(v * 100) / 100);

fs.mkdirSync(OUT, { recursive: true });
pages.forEach((pg, idx) => {
  const txt = streamOf(pg.contents);
  if (!txt) { console.log('page ' + (idx + 1) + ': no stream'); return; }

  const W = pg.box[2] - pg.box[0], H = pg.box[3] - pg.box[1];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let stroke = '#000', fill = '#000';
  let d = '', out = [], paths = 0;

  const toks = txt.match(/\/[^\s\/\[\]<>()]+|[-\d.]+|[A-Za-z*'"]+|\[[^\]]*\]/g) || [];
  const num = [];
  const col = v => '#' + [0, 1, 2].map(i =>
    Math.max(0, Math.min(255, Math.round((v[i] || 0) * 255))).toString(16).padStart(2, '0')).join('');

  function emit(op) {
    if (!d) return;
    const strokeOn = /S|s|B|b/.test(op);
    const fillOn = /f|F|B|b/.test(op);
    out.push('<path d="' + d + '" fill="' + (fillOn ? fill : 'none') +
             '" stroke="' + (strokeOn ? stroke : 'none') + '" stroke-width="1.2"/>');
    paths++;
    d = '';
  }

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^[-\d.]+$/.test(t)) { num.push(Number(t)); continue; }
    if (t[0] === '/' || t[0] === '[') { continue; }
    const n = num.slice();
    switch (t) {
      case 'q': stack.push([ctm.slice(), stroke, fill]); break;
      case 'Q': { const p = stack.pop(); if (p) { ctm = p[0]; stroke = p[1]; fill = p[2]; } break; }
      case 'cm': if (n.length >= 6) ctm = mul(n.slice(-6), ctm); break;
      case 'm': if (n.length >= 2) { const p = apply(ctm, n[n.length-2], n[n.length-1]); d += 'M' + f2(p[0]) + ' ' + f2(H - p[1]) + ' '; } break;
      case 'l': if (n.length >= 2) { const p = apply(ctm, n[n.length-2], n[n.length-1]); d += 'L' + f2(p[0]) + ' ' + f2(H - p[1]) + ' '; } break;
      case 'c': if (n.length >= 6) { const a = apply(ctm, n[n.length-6], n[n.length-5]), b = apply(ctm, n[n.length-4], n[n.length-3]), c = apply(ctm, n[n.length-2], n[n.length-1]);
                  d += 'C' + f2(a[0]) + ' ' + f2(H-a[1]) + ' ' + f2(b[0]) + ' ' + f2(H-b[1]) + ' ' + f2(c[0]) + ' ' + f2(H-c[1]) + ' '; } break;
      case 'v': case 'y': if (n.length >= 4) { const a = apply(ctm, n[n.length-4], n[n.length-3]), b = apply(ctm, n[n.length-2], n[n.length-1]);
                  d += 'Q' + f2(a[0]) + ' ' + f2(H-a[1]) + ' ' + f2(b[0]) + ' ' + f2(H-b[1]) + ' '; } break;
      case 'h': d += 'Z '; break;
      case 're': if (n.length >= 4) {
          const x = n[n.length-4], y = n[n.length-3], w = n[n.length-2], hh = n[n.length-1];
          const p1 = apply(ctm, x, y), p2 = apply(ctm, x+w, y), p3 = apply(ctm, x+w, y+hh), p4 = apply(ctm, x, y+hh);
          d += 'M' + f2(p1[0]) + ' ' + f2(H-p1[1]) + ' L' + f2(p2[0]) + ' ' + f2(H-p2[1]) +
               ' L' + f2(p3[0]) + ' ' + f2(H-p3[1]) + ' L' + f2(p4[0]) + ' ' + f2(H-p4[1]) + ' Z ';
        } break;
      case 'RG': case 'SC': case 'SCN': stroke = col(n.slice(-3)); break;
      case 'rg': case 'sc': case 'scn': fill = col(n.slice(-3)); break;
      case 'G': stroke = col([n[n.length-1], n[n.length-1], n[n.length-1]]); break;
      case 'g': fill = col([n[n.length-1], n[n.length-1], n[n.length-1]]); break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
        emit(t); break;
      case 'n': d = ''; break;
      default: break;
    }
    num.length = 0;
  }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
              'width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H +
              '" fill="#fff"/>' + out.join('') + '</svg>';
  const f = path.join(OUT, 'page' + (idx + 1) + '.svg');
  fs.writeFileSync(f, svg);
  console.log('page ' + (idx + 1) + ': ' + paths + ' paths -> ' + f + '  (' + Math.round(svg.length / 1024) + ' KB)');
});
