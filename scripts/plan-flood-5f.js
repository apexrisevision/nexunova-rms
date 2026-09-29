/* ══ THE NEW FIFTH FLOOR, FLOODED BY NEAREST LABEL ═════════════════════════
   The revised sheet (AWAMI MARKIT.pdf, 25 Sep 2026) writes every room's name
   as real text, and joins a flat's rooms with open archways and dotted
   openings rather than drawn doors. So instead of the door graph:

   1. WALLS: every stroke except the door leaves / counters (grey) and the
      dotted openings (cyan paths made only of sub-2-unit dashes). Long cyan
      stays: that is the rail along the open side.
   2. FRONTS: the flat's opening onto the verandah is closed with the very
      same rule plan-units uses (bridges(), copied verbatim from that file):
      two collinear wall ends facing each other whose gap can SEE a rail.
   3. OWNERSHIP: every free cell goes to its nearest label through open floor
      (multi-source BFS). Seeds are the 97 unit numbers AND every common-space
      name — VERANDAH letters, CORRIDOR, OPEN (light wells), W.C, S.DUCT,
      G.CHUTE, ABLUTION, stairs — so a verandah is claimed by the verandah and
      not by whichever flat is nearest.

   Output: <dir>/page1-rooms.json in plan-units' own shape, so plan-polys and
   plan-lines run on it unchanged.

   node scripts/plan-flood-5f.js <dir>    (dir holds page1.svg, text.json, page1-read.json)
*/
const fs = require('fs'), path = require('path');
const DIR = path.resolve(process.argv[2] || 'marketing_shots/plan5f');
const REPO = path.resolve(__dirname, '..');
const PX = 4;                 // grid cells per drawing unit
const THICK = Number(process.env.THICK || 1.6);   // drawing units either side of a stroke: shuts corner slivers under ~3 units, never a doorway (8+)

const svg = fs.readFileSync(DIR + '/page1.svg', 'utf8');
const H = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)[1]);
const T = JSON.parse(fs.readFileSync(DIR + '/text.json', 'utf8'));
const L = JSON.parse(fs.readFileSync(DIR + '/page1-read.json', 'utf8'));

/* bridges(), verbatim from plan-units.js */
const PU = fs.readFileSync(REPO + '/scripts/plan-units.js', 'utf8');
const bsrc = PU.slice(PU.indexOf('function bridges('), PU.indexOf('const median'));
/* ONE CHANGE: how far the ray may look. On this sheet an inner archway's ray
   walks through its own flat and out of the flat's front door to the verandah
   rail, so at 90 units it was closed as if it were the front. A real front sees
   its rail across one verandah (~14 units); 25 keeps those and nothing inside. */
const SEE_NEW = Number(process.env.SEE || 25);
if (!bsrc.includes('const SEE = 90;')) throw new Error('SEE anchor missing in plan-units.js');
/* AND A WINDOW STOPS THE RAY. A front sees its rail straight across the
   verandah; an inner opening that "sees" a rail only through a pane of glass is
   looking out of a window (548's bed-to-dress opening saw the balcony rail so). */
if (!bsrc.includes('const wallSeg = seg(paths), railSeg = seg(rails);')) throw new Error('wallSeg anchor missing in plan-units.js');
const bridgesWith = new Function('GLASS', bsrc
  .replace('const SEE = 90;', 'const SEE = ' + SEE_NEW + ';')
  .replace('const wallSeg = seg(paths), railSeg = seg(rails);',
           'const wallSeg = seg(paths).concat(seg(GLASS)), railSeg = seg(rails);') + '\nreturn bridges;');

/* ── strokes ── */
const GREY = new Set(['#bababa', '#969696', '#757575']);
const walls = [], struct = [], rails = [], glassPaths = [];
let dotted = 0, grey = 0;
const re = /<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)"[^>]*\/>/g; let m;
const subLens = d => d.split('M').slice(1).map(sub => {
  const n = (sub.match(/-?[0-9.]+/g) || []).map(Number); let len = 0;
  for (let i = 0; i + 3 < n.length; i += 2) len += Math.hypot(n[i + 2] - n[i], n[i + 3] - n[i + 1]);
  return len;
});
while ((m = re.exec(svg))) {
  const s = m[3].toLowerCase();
  if (s === 'none') continue;
  if (GREY.has(s)) { grey++; continue; }
  if (s === '#00ffff') {
    const ls = subLens(m[1]);
    if (ls.length && ls.every(l => l < 2)) { dotted++; continue; }
    rails.push(m[1]);
  }
  walls.push(m[1]);
  if (s === '#ff0000') struct.push(m[1]);
  if (s === '#0036db' || s === '#0000ff') glassPaths.push(m[1]);   // glazing: a balcony's sliding door
}
/* fronts on this floor are 13-16 units (4.5-5 ft); a 27-unit "gap" is two walls that
   were never one line (548: bed wall to the balcony return), so 20 is the ceiling */
const spans = bridgesWith(glassPaths)(struct, Number(process.env.MAXGAP || 20), 0.6, rails, 30);
/* CLOSED BY NAME. 535 and 541 are the two flats joined across the middle wall;
   their front opens onto the 8'-0" cross PASSAGE between blocks, where the
   architect drew no rail — so no rule can see that it is a front. Each is closed
   between the two red wall ends nearest the gap, found on the sheet, not typed. */
const BY_NAME = { '535': 'down', '541': 'up' };
{
  const ends = [];
  struct.forEach(d => d.split('M').slice(1).forEach(sub => {
    const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) ends.push([n[i], n[i + 1]]);
  }));
  Object.entries(BY_NAME).forEach(([u, dir]) => {
    const lab = L.find(l => l.u === u); if (!lab) return;
    /* the block's front wall on that side: the horizontal red run nearest the
       label in that direction that has a gap straddling the label's x */
    const sgn = dir === 'up' ? -1 : 1;
    /* horizontal red segments, to know where the wall actually runs */
    const hseg = [];
    struct.forEach(d => d.split('M').slice(1).forEach(sub => {
      const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
      for (let i = 0; i + 3 < n.length; i += 2)
        if (Math.abs(n[i + 1] - n[i + 3]) < 0.3) hseg.push([Math.min(n[i], n[i + 2]), Math.max(n[i], n[i + 2]), n[i + 1]]);
    }));
    let best = null;
    for (let dy = 8; dy < 60 && !best; dy += 0.25) {
      const y = lab.cy + sgn * dy;
      const run = hseg.filter(s => Math.abs(s[2] - y) < 0.4 && s[1] > lab.cx - 45 && s[0] < lab.cx + 45);
      if (run.length < 2) continue;
      /* the wall must span most of the window, or this is not the front line */
      const covered = run.reduce((t, s) => t + (Math.min(s[1], lab.cx + 45) - Math.max(s[0], lab.cx - 45)), 0);
      if (covered < 40) continue;
      const xs = run.map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0]);
      let reach = xs[0][1];
      for (let i = 1; i < xs.length; i++) {
        const gap = xs[i][0] - reach;
        if (gap > 6 && gap < 30 && Math.abs((reach + xs[i][0]) / 2 - lab.cx) < 30) { best = [[reach, y], [xs[i][0], y]]; break; }
        reach = Math.max(reach, xs[i][1]);
      }
    }
    if (best) { spans.push('M' + best[0][0] + ' ' + best[0][1] + ' L' + best[1][0] + ' ' + best[1][1]);
                console.log('  closed by name: ' + u + ' front ' + JSON.stringify(best)); }
    else console.log('  COULD NOT FIND the front of ' + u);
  });
}
if (process.env.SPANNEAR) { const [sx, sy] = process.env.SPANNEAR.split(',').map(Number); spans.forEach(d => { const n = (d.match(/-?[0-9.]+/g) || []).map(Number); if (Math.min(n[0], n[2]) - 3 < sx && Math.max(n[0], n[2]) + 3 > sx && Math.min(n[1], n[3]) - 3 < sy && Math.max(n[1], n[3]) + 3 > sy) console.log('  SPAN', d); }); walls.forEach((d, i) => { const n = (d.match(/-?[0-9.]+/g) || []).map(Number); for (let k = 0; k + 3 < n.length; k += 2) { const a = [n[k], n[k+1]], b = [n[k+2], n[k+3]]; if (Math.min(a[0], b[0]) - 1.5 < sx && Math.max(a[0], b[0]) + 1.5 > sx && Math.min(a[1], b[1]) - 1.5 < sy && Math.max(a[1], b[1]) + 1.5 > sy) { console.log('  WALLSEG', a, b); } } }); }
console.log('walls', walls.length, ' rails', rails.length, ' dotted openings left open', dotted,
            ' grey leaves/counters left open', grey, ' fronts closed', spans.length);

/* ── grid over the drawn extent ── */
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
walls.forEach(d => { const n = (d.match(/-?[0-9.]+/g) || []).map(Number);
  for (let i = 0; i + 1 < n.length; i += 2) { X0 = Math.min(X0, n[i]); X1 = Math.max(X1, n[i]); Y0 = Math.min(Y0, n[i + 1]); Y1 = Math.max(Y1, n[i + 1]); } });
X0 -= 4; Y0 -= 4; X1 += 4; Y1 += 4;
const GW = Math.ceil((X1 - X0) * PX), GH = Math.ceil((Y1 - Y0) * PX);
const wall = new Uint8Array(GW * GH), glass = new Uint8Array(GW * GH);
let INTO = wall;
function stamp(x, y) {
  const r = THICK * PX, cx = (x - X0) * PX, cy = (y - Y0) * PX;
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
    if (j < 0 || j >= GH) continue;
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      if (i < 0 || i >= GW) continue;
      if ((i - cx) * (i - cx) + (j - cy) * (j - cy) <= r * r) INTO[j * GW + i] = 1;
    }
  }
}
function line(ax, ay, bx, by) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * PX * 2));
  for (let k = 0; k <= n; k++) stamp(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
}
[...walls, ...spans].forEach(d => d.split('M').slice(1).forEach(sub => {
  const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
  for (let i = 0; i + 3 < n.length; i += 2) line(n[i], n[i + 1], n[i + 2], n[i + 3]);
}));
INTO = glass;
glassPaths.forEach(d => d.split('M').slice(1).forEach(sub => {
  const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
  for (let i = 0; i + 3 < n.length; i += 2) line(n[i], n[i + 1], n[i + 2], n[i + 3]);
}));
INTO = wall;

/* ── seeds ── */
const COMMON = /^(V|E|R|A|N|D|H|WIDE|VERANDAH|CORRIDOR|OPEN|OPENBELOW|W\.C|S\.DUCT|G\.|CHUTE|G\.CHUTE|ABLUTIONAREA|PASSAGE|UP|DN|LEFT)$/;
const owner = new Int16Array(GW * GH).fill(-1);   // -1 nobody, 0..96 unit, 999 common
const q = new Int32Array(GW * GH); let qh = 0, qt = 0;
function seedAt(x, y, id) {
  let ci = Math.round((x - X0) * PX), cj = Math.round((y - Y0) * PX);
  for (let r = 0; r < 6 * PX; r++) {           // nearest open cell to the text
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
      const k = j * GW + i;
      if (!wall[k] && owner[k] === -1) { owner[k] = id; q[qt++] = k; return true; }
    }
  }
  return false;
}
const units = L.map(l => l.u);
let lost = [];
L.forEach((l, i) => { if (!seedAt(l.cx, l.cy, i)) lost.push(l.u); });
let commons = 0;
T.forEach(o => { if (COMMON.test(o.t)) { if (seedAt(o.x + 0.3 * o.size * o.t.length, H - o.y - 0.35 * o.size, 999)) commons++; } });
console.log('unit seeds', L.length - lost.length, lost.length ? 'LOST ' + lost.join(',') : '', ' common seeds', commons);

/* ── nearest label through open floor ── */
while (qh < qt) {
  const k = q[qh++], id = owner[k], i = k % GW, j = (k - i) / GW;
  if (i > 0      && !wall[k - 1]  && owner[k - 1]  === -1) { owner[k - 1] = id;  q[qt++] = k - 1; }
  if (i < GW - 1 && !wall[k + 1]  && owner[k + 1]  === -1) { owner[k + 1] = id;  q[qt++] = k + 1; }
  if (j > 0      && !wall[k - GW] && owner[k - GW] === -1) { owner[k - GW] = id; q[qt++] = k - GW; }
  if (j < GH - 1 && !wall[k + GW] && owner[k + GW] === -1) { owner[k + GW] = id; q[qt++] = k + GW; }
}

if (process.env.ASK) process.env.ASK.split(';').forEach(p => { const [x, y] = p.split(',').map(Number); const k = Math.round((y - Y0) * PX) * GW + Math.round((x - X0) * PX); console.log('  ASK', x, y, 'wall', wall[k], 'owner', owner[k] >= 0 && owner[k] < 999 ? units[owner[k]] : owner[k]); });
/* ── ROOMS BEHIND GLASS ─────────────────────────────────────────────────────
   A balcony here is entered through the sliding glazing, drawn as a wall, so
   no flood reaches it. An enclosed pocket that no label reached is given to
   the flat it touches most through the wall — but only when that flat touches
   it at least twice as much as any other, it touches no common space, and the
   pocket is small (a balcony, a duct, not a hall). Anything in doubt stays
   with nobody. */
{
  const seen = new Uint8Array(GW * GH);
  const REACH = 6 * PX;                     // look this far through a wall: glazing band + both faces is ~3.5
  const MAXCELLS = 160 / K2() * PX * PX;    // no pocket larger than ~160 sq ft
  function K2() { return 0.1199 / (1.02457 * 1.02457); }
  let given = 0, left = 0;
  for (let s = 0; s < GW * GH; s++) {
    if (wall[s] || owner[s] !== -1 || seen[s]) continue;
    const cells = []; const st = [s]; seen[s] = 1; let edge = false;
    while (st.length) {
      const k = st.pop(); cells.push(k);
      const i = k % GW, j = (k - i) / GW;
      if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1) edge = true;
      for (const n of [k - 1, k + 1, k - GW, k + GW]) {
        if (n < 0 || n >= GW * GH || wall[n] || seen[n] || owner[n] !== -1) continue;
        seen[n] = 1; st.push(n);
      }
    }
    if (process.env.WHY) { const [wx, wy] = process.env.WHY.split(',').map(Number); const wi = Math.round((wx - X0) * PX), wj = Math.round((wy - Y0) * PX); if (cells.includes(wj * GW + wi)) console.log('  WHY pocket at', wx, wy, 'cells', cells.length, 'sqft', (cells.length / PX / PX * K2()).toFixed(1), 'edge', edge, 'max', MAXCELLS); }
    if (edge || cells.length > MAXCELLS) { left++; continue; }
    /* a room, not the hollow inside a double-lined wall: big enough to stand in
       and at least six units across in both directions */
    if (cells.length < 15 / K2() * PX * PX) { left++; continue; }
    { let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      cells.forEach(k => { const i = k % GW, j = (k - i) / GW; a0 = Math.min(a0, i); a1 = Math.max(a1, i); b0 = Math.min(b0, j); b1 = Math.max(b1, j); });
      if ((a1 - a0) < 6 * PX || (b1 - b0) < 6 * PX) { left++; continue; } }
    const touch = {};
    cells.forEach(k => {
      const i = k % GW, j = (k - i) / GW;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let viaGlass = false;
        for (let r = 1; r <= REACH; r++) {
          const ii = i + dx * r, jj = j + dy * r;
          if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) break;
          const n = jj * GW + ii;
          if (wall[n]) { if (glass[n]) viaGlass = true; continue; }
          /* only through GLASS: a balcony is behind its flat's sliding door; a
             void behind a solid wall (the one beside 514's stair) is not */
          if (owner[n] !== -1 && viaGlass) touch[owner[n]] = (touch[owner[n]] || 0) + 1;
          break;
        }
      }
    });
    const ranked = Object.entries(touch).sort((a, b) => b[1] - a[1]);
    if (process.env.WHY) { const [wx, wy] = process.env.WHY.split(',').map(Number); const wi = Math.round((wx - X0) * PX), wj = Math.round((wy - Y0) * PX); if (cells.includes(wj * GW + wi)) console.log('  WHY touches', JSON.stringify(ranked.map(([id, n]) => [id === '999' ? 'common' : units[id], n]))); }
    if (!ranked.length || ranked[0][0] === '999' || touch[999] ||
        (ranked[1] && ranked[1][1] * 2 > ranked[0][1])) { left++; continue; }
    const id = Number(ranked[0][0]);
    cells.forEach(k => { owner[k] = id; });
    given++;
  }
  console.log('pockets behind glass given to their flat: ' + given + ', left with nobody: ' + left);
}

/* ── WHAT EACH FLAT HOLDS, read off its own rooms ── */
{
  const ROOMS = /^(BED|BEDROOM|STUDIOAPARTMENT|LOUNGE|LIVING|KIT|KITCHEN|BATH|DRESS|BALCONY)$/;
  const held = {}; units.forEach(u => held[u] = {});
  const stray = [];
  T.forEach(o => {
    if (!ROOMS.test(o.t)) return;
    const x = o.x + 0.3 * o.size * o.t.length, y = H - o.y - 0.35 * o.size;
    let k = Math.round((y - Y0) * PX) * GW + Math.round((x - X0) * PX), id = owner[k];
    if (id < 0 || id === 999) {                // the word may sit on a line; look a little round it
      for (let r = 1; r < 3 * PX && (id < 0 || id === 999); r++)
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const n = k + dy * GW + dx; if (owner[n] >= 0 && owner[n] !== 999) { id = owner[n]; break; }
        }
    }
    if (id < 0 || id === 999) { stray.push(o.t + '@' + x.toFixed(0) + ',' + y.toFixed(0)); return; }
    const t = o.t === 'BEDROOM' ? 'BED' : o.t === 'KITCHEN' ? 'KIT' : o.t === 'LIVING' ? 'LOUNGE' : o.t;
    held[units[id]][t] = (held[units[id]][t] || 0) + 1;
  });
  fs.writeFileSync(DIR + '/unit-rooms.json', JSON.stringify(held, null, 1));
  console.log('room names inside a flat: written; not inside any flat: ' + stray.length + (stray.length ? ' ' + stray.slice(0, 12).join(' ') : ''));
}

/* ── write plan-units' shape ── */
const out = { px: PX, units: {}, failed: [] };
units.forEach((u, id) => {
  const rows = []; let cnt = 0, a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let j = 0; j < GH; j++) {
    let run = -1;
    for (let i = 0; i <= GW; i++) {
      const on = i < GW && owner[j * GW + i] === id;
      if (on && run < 0) run = i;
      if (!on && run >= 0) { rows.push([j, run, i - 1]); cnt += i - run; a = Math.min(a, run); c = Math.max(c, i - 1); b = Math.min(b, j); d = Math.max(d, j); run = -1; }
    }
  }
  if (!rows.length) { out.failed.push(u); return; }
  out.units[u] = { u, area: cnt, ox: X0, oy: Y0,
                   x0: X0 + a / PX, y0: Y0 + b / PX, x1: X0 + (c + 1) / PX, y1: Y0 + (d + 1) / PX, rows };
});
fs.writeFileSync(DIR + '/page1-rooms.json', JSON.stringify(out));

/* DEBUG=cx,cy,half[,name] writes a BMP of the ownership around a point:
   walls black, common grey, nobody white, each unit its own colour */
if (process.env.DEBUG) {
  process.env.DEBUG.split(';').forEach(spec => {
    const [cx, cy, half, name] = spec.split(',');
    const i0 = Math.max(0, Math.round((Number(cx) - Number(half) - X0) * PX)), j0 = Math.max(0, Math.round((Number(cy) - Number(half) - Y0) * PX));
    const W = Math.min(GW - i0, Math.round(2 * Number(half) * PX)), Hh = Math.min(GH - j0, Math.round(2 * Number(half) * PX));
    const rowB = Math.ceil(W * 3 / 4) * 4, buf = Buffer.alloc(54 + rowB * Hh);
    buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(W, 18); buf.writeInt32LE(-Hh, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
    const col = id => { const h = (id * 2654435761) >>> 0; return [60 + (h & 127), 60 + ((h >> 8) & 127), 60 + ((h >> 16) & 127)]; };
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const k = (j0 + j) * GW + (i0 + i), o = 54 + j * rowB + i * 3;
      let c = wall[k] ? [0, 0, 0] : owner[k] === 999 ? [200, 200, 200] : owner[k] < 0 ? [255, 255, 255] : col(owner[k]);
      buf[o] = c[2]; buf[o + 1] = c[1]; buf[o + 2] = c[0];
    }
    fs.writeFileSync(DIR + '/dbg-' + (name || cx + '_' + cy) + '.bmp', buf);
  });
}
console.log('written', Object.keys(out.units).length, 'units', out.failed.length ? 'FAILED ' + out.failed.join(',') : '', ' grid', GW + 'x' + GH);
