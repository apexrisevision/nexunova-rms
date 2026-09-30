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
const BY_NAME = { '535': 'down', '541': 'up' };   // the sheet's own numbers; matched with or without the register's '5F-'
{
  const ends = [];
  struct.forEach(d => d.split('M').slice(1).forEach(sub => {
    const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) ends.push([n[i], n[i + 1]]);
  }));
  Object.entries(BY_NAME).forEach(([u, dir]) => {
    const lab = L.find(l => l.u === u || l.u.replace(/^[^-]+-/, '') === u);
    if (!lab) throw new Error('closed-by-name unit ' + u + ' is not on the sheet — refusing to build a plate with its front open');
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
    /* EVERY gap in the block's front line within reach of the flat, not one of
       them: the line is the block's face onto the passage, so nothing on it is
       an inner door. (Picking one gap closed a sliver beside a column and left
       535's real 13-unit door open.) */
    let best = null;
    for (let dy = 8; dy < 60 && !best; dy += 0.25) {
      const y = lab.cy + sgn * dy;
      const run = hseg.filter(s => Math.abs(s[2] - y) < 0.4 && s[1] > lab.cx - 45 && s[0] < lab.cx + 45);
      if (run.length < 2) continue;
      /* the wall must span most of the window, or this is not the front line */
      const covered = run.reduce((t, s) => t + (Math.min(s[1], lab.cx + 45) - Math.max(s[0], lab.cx - 45)), 0);
      if (covered < 40) continue;
      const xs = run.map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0]);
      let reach = xs[0][1]; const gaps = [];
      for (let i = 1; i < xs.length; i++) {
        const gap = xs[i][0] - reach, mid = (reach + xs[i][0]) / 2;
        if (gap > 2 && gap < 30 && Math.abs(mid - lab.cx) < 35) gaps.push([[reach, y], [xs[i][0], y]]);
        reach = Math.max(reach, xs[i][1]);
      }
      if (gaps.length) best = gaps;
    }
    if (!best) throw new Error('could not find the front of ' + u + ' — refusing to build a plate with it open');
    best.forEach(g => spans.push('M' + g[0][0] + ' ' + g[0][1] + ' L' + g[1][0] + ' ' + g[1][1]));
    console.log('  closed by name: ' + u + ' front, ' + best.length + ' gap(s) ' + JSON.stringify(best.map(g => [g[0][0], g[1][0]])));
  });
}
if (process.env.SPANNEAR) { const [sx, sy] = process.env.SPANNEAR.split(',').map(Number); spans.forEach(d => { const n = (d.match(/-?[0-9.]+/g) || []).map(Number); if (Math.min(n[0], n[2]) - 3 < sx && Math.max(n[0], n[2]) + 3 > sx && Math.min(n[1], n[3]) - 3 < sy && Math.max(n[1], n[3]) + 3 > sy) console.log('  SPAN', d); }); walls.forEach((d, i) => { const n = (d.match(/-?[0-9.]+/g) || []).map(Number); for (let k = 0; k + 3 < n.length; k += 2) { const a = [n[k], n[k+1]], b = [n[k+2], n[k+3]]; if (Math.min(a[0], b[0]) - 1.5 < sx && Math.max(a[0], b[0]) + 1.5 > sx && Math.min(a[1], b[1]) - 1.5 < sy && Math.max(a[1], b[1]) + 1.5 > sy) { console.log('  WALLSEG', a, b); } } }); }
if (process.env.PASS2) {
  const extra = JSON.parse(fs.readFileSync(DIR + '/closures.json', 'utf8'));
  extra.forEach(s => spans.push(s));
  console.log('pass 2: ' + extra.length + ' carried-on walls drawn');
}
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

/* ── OPEN EDGES: where a flat meets common space or another flat with no
   wall between. A closed front leaves none; every one left is a wedge. ── */
{
  const open = {};
  for (let k = 0; k < GW * GH; k++) {
    const a = owner[k]; if (a < 0 || a === 999) continue;
    const i = k % GW;
    for (const n of [i < GW - 1 ? k + 1 : -1, k + GW < GW * GH ? k + GW : -1, i > 0 ? k - 1 : -1, k - GW]) {
      if (n < 0) continue;
      const b = owner[n];
      if (b === -1 || b === a || wall[n]) continue;
      const key = units[a] + (b === 999 ? ' ~ common' : ' ~ ' + units[b]);
      open[key] = (open[key] || 0) + 1;
    }
  }
  const list = Object.entries(open).filter(([, n]) => n >= 2 * PX).sort((x, y) => y[1] - x[1]);
  global.OPEN_EDGES = list;

  /* ── A WALL CARRIED ON TO THE WALL IT WAS GOING TO MEET ─────────────────
     Some fronts run from a wall's END to another wall's FACE (597: the
     kitchen wall stops, the living-room wall carries on; 547/548 the same at
     the widened foot of the block). bridges() only joins end to end, so these
     stay open and the flat meets the verandah on a diagonal watershed. Pass 1
     finds every red wall end within 4 units of such an open edge and carries
     it on, straight, until it meets a wall (at most 30 units); pass 2 draws
     those as walls. Only ends on axis-aligned walls, only where a flat is
     actually open. */
  if (!process.env.PASS2) {
    const edgeCell = new Uint8Array(GW * GH);
    for (let k = 0; k < GW * GH; k++) {
      const a = owner[k]; if (a < 0 || a === 999) continue;
      const i = k % GW;
      for (const n of [i < GW - 1 ? k + 1 : -1, k + GW < GW * GH ? k + GW : -1, i > 0 ? k - 1 : -1, k - GW]) {
        if (n < 0) continue; const b = owner[n];
        if (b !== -1 && b !== a && !wall[n] && (b === 999 || b >= 0)) { edgeCell[k] = 1; edgeCell[n] = 1; }
      }
    }
    const nearEdge = (x, y) => {
      const ci = Math.round((x - X0) * PX), cj = Math.round((y - Y0) * PX), R = 4 * PX;
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++)
        if (i >= 0 && j >= 0 && i < GW && j < GH && edgeCell[j * GW + i]) return true;
      return false;
    };
    const closures = [];
    struct.forEach(d => d.split('M').slice(1).forEach(sub => {
      const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
      const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      for (let i = 0; i + 1 < pts.length; i++) for (const [p, q] of [[pts[i], pts[i + 1]], [pts[i + 1], pts[i]]]) {
        const dx = p[0] - q[0], dy = p[1] - q[1], Ls = Math.hypot(dx, dy);
        if (Ls < 0.5) continue;
        const ux = dx / Ls, uy = dy / Ls;
        if (!nearEdge(p[0], p[1])) continue;
        if (process.env.WHYEND) console.log('  end near an open edge', p.map(v => v.toFixed(2)).join(','), 'dir', ux.toFixed(3), uy.toFixed(3));
        if (Math.abs(ux) < 0.995 && Math.abs(uy) < 0.995) continue;      // axis-aligned walls only
        for (let t = 2; t <= 30; t += 0.25) {
          const x = p[0] + ux * t, y = p[1] + uy * t;
          const ci = Math.round((x - X0) * PX), cj = Math.round((y - Y0) * PX);
          if (ci < 0 || cj < 0 || ci >= GW || cj >= GH) break;
          if (wall[cj * GW + ci]) { break;   /* untested carry-ons are NOT drawn: at 597 one ran across the kitchen. Only the tested search below closes a front. */ }
        }
      }
    }));
    /* WHERE THE WEDGE IS FAR FROM THE DOOR. At 547/548 the flat floods up the
       verandah strip before it meets the verandah's own seed, so the open edge
       is well above the corner the door is actually in, and no wall end is
       near it. For each flat still open, every axis-aligned red end inside its
       reach is carried on to the wall it meets (<= 30 units), and a candidate is
       KEPT only if, drawn as a wall, (a) the flat's own number can no longer
       reach its open edge, and (b) it can still reach every room name the
       drawing puts inside the flat (BED, BATH, KIT…). Of those, the one that
       cuts least off the flat wins. An arch between a flat's own rooms fails
       (b), so it is never closed. */
    const stillOpen = new Set(list.filter(([k]) => / ~ common$/.test(k)).map(([k]) => k.split(' ~ ')[0]));
    const ROOMWORDS = /^(BED|BEDROOM|STUDIOAPARTMENT|LOUNGE|LIVING|KIT|KITCHEN|BATH|DRESS|BALCONY)$/;
    const cellOf = (x, y) => Math.round((y - Y0) * PX) * GW + Math.round((x - X0) * PX);
    stillOpen.forEach(u => {
      const id = units.indexOf(u);
      if (closures.some(c => c._u === u)) return;
      let a = GW, b = GH, c = -1, d = -1;
      for (let k = 0; k < GW * GH; k++) if (owner[k] === id) { const i = k % GW, j = (k - i) / GW; a = Math.min(a, i); c = Math.max(c, i); b = Math.min(b, j); d = Math.max(d, j); }
      const M = 30 * PX; a = Math.max(0, a - M); b = Math.max(0, b - M); c = Math.min(GW - 1, c + M); d = Math.min(GH - 1, d + M);
      const edges = []; const rooms = [];
      for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) {
        const k = j * GW + i; if (owner[k] !== id) continue;
        for (const n of [k + 1, k - 1, k + GW, k - GW]) if (owner[n] === 999 && !wall[n]) { edges.push(k); break; }
      }
      T.forEach(o => { if (!ROOMWORDS.test(o.t)) return;
        const k = cellOf(o.x + 0.3 * o.size * o.t.length, H - o.y - 0.35 * o.size); if (owner[k] === id) rooms.push(k); });
      const lab = L[id], start = cellOf(lab.cx, lab.cy);
      const cand = [];
      struct.forEach(dd => dd.split('M').slice(1).forEach(sub => {
        const n = (sub.match(/-?[0-9.]+/g) || []).map(Number);
        const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
        for (let i = 0; i + 1 < pts.length; i++) for (const [p, q] of [[pts[i], pts[i + 1]], [pts[i + 1], pts[i]]]) {
          const dx = p[0] - q[0], dy = p[1] - q[1], Ls = Math.hypot(dx, dy); if (Ls < 0.5) continue;
          const ux = dx / Ls, uy = dy / Ls; if (Math.abs(ux) < 0.995 && Math.abs(uy) < 0.995) continue;
          const pi = Math.round((p[0] - X0) * PX), pj = Math.round((p[1] - Y0) * PX);
          if (pi < a || pi > c || pj < b || pj > d) continue;
          for (let t = 2; t <= 30; t += 0.25) {
            const x = p[0] + ux * t, y = p[1] + uy * t, k = cellOf(x, y);
            if (wall[k]) { if (t > 2.5) cand.push([p[0], p[1], x, y]); break; }
          }
        }
      }));
      let best = null, bestReach = -1;
      const W2 = c - a + 1, H2 = d - b + 1;
      /* only candidates that cross the flat's own floor can matter */
      const masks = [];
      cand.forEach(s => {
        const cells = [];
        const steps = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) * PX * 2);
        let crosses = false;
        for (let t = 0; t <= steps; t++) {
          const x = s[0] + (s[2] - s[0]) * t / steps, y = s[1] + (s[3] - s[1]) * t / steps;
          const ci = Math.round((x - X0) * PX), cj = Math.round((y - Y0) * PX);
          for (let jj = cj - PX; jj <= cj + PX; jj++) for (let ii = ci - PX; ii <= ci + PX; ii++)
            if (ii >= a && ii <= c && jj >= b && jj <= d) { cells.push((jj - b) * W2 + (ii - a)); if (owner[jj * GW + ii] === id) crosses = true; }
        }
        if (crosses) masks.push({ s, cells });
      });
      const si = start % GW, sj = (start - si) / GW;
      const test = picked => {
        const block = new Uint8Array(W2 * H2);
        picked.forEach(m => m.cells.forEach(l => { block[l] = 1; }));
        if (block[(sj - b) * W2 + (si - a)]) return -1;
        const seen = new Uint8Array(W2 * H2); const st = [start]; let reach = 0;
        seen[(sj - b) * W2 + (si - a)] = 1;
        while (st.length) {
          const k = st.pop(); reach++;
          const i = k % GW, j = (k - i) / GW;
          for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
            if (ni < a || ni > c || nj < b || nj > d) continue;
            const l = (nj - b) * W2 + (ni - a), n = nj * GW + ni;
            if (seen[l] || block[l] || wall[n] || owner[n] !== id) continue;
            seen[l] = 1; st.push(n);
          }
        }
        const at = k => { const i = k % GW, j = (k - i) / GW; return seen[(j - b) * W2 + (i - a)]; };
        const eHit = edges.filter(at).length, rMiss = rooms.filter(k => !at(k)).length;
        if (process.env.DEBUGU === u && picked.length === 1)
          console.log('    cand ' + picked[0].s.map(v => v.toFixed(1)).join(',') + ' reach ' + reach + ' edgesStillReached ' + eHit + '/' + edges.length + ' roomsLost ' + rMiss + '/' + rooms.length);
        if (eHit) return -1;                         // still reaches the open edge
        if (rMiss) return -1;                        // cut off one of its own rooms
        return reach;
      };
      /* the rooms that count are the ones the flat's number can reach TODAY: a
         balcony given to the flat through its sliding glass is not reachable on
         foot, and demanding it made every candidate fail */
      {
        const base = test.bind(null, []);
        const keepRooms = [];
        const saved = rooms.slice(); rooms.length = 0;
        base();                                        // reach with nothing blocked (rooms empty => always passes)
        // recompute reachability explicitly
        const seen0 = new Uint8Array(W2 * H2); const st0 = [start]; seen0[(sj - b) * W2 + (si - a)] = 1;
        while (st0.length) {
          const k = st0.pop(), i = k % GW, j = (k - i) / GW;
          for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
            if (ni < a || ni > c || nj < b || nj > d) continue;
            const l = (nj - b) * W2 + (ni - a), n = nj * GW + ni;
            if (seen0[l] || wall[n] || owner[n] !== id) continue;
            seen0[l] = 1; st0.push(n);
          }
        }
        saved.forEach(k => { const i = k % GW, j = (k - i) / GW; if (seen0[(j - b) * W2 + (i - a)]) keepRooms.push(k); });
        keepRooms.forEach(k => rooms.push(k));
      }
      /* one wall end, and if no single one does it, two (a front may be open on
         both sides of a column) */
      /* THE SHORTEST line that seals it: a door is the narrowest place, and "cut least" chose a line far up the verandah strip */
      const len = ms => ms.reduce((t, m) => t + Math.hypot(m.s[2] - m.s[0], m.s[3] - m.s[1]), 0);
      let bestLen = Infinity;
      /* shortest first; among lines of the same length (to half a unit) the one that leaves the flat least of what is not its rooms */
      const better = (l, r) => Math.round(l * 2) < Math.round(bestLen * 2) || (Math.round(l * 2) === Math.round(bestLen * 2) && r < bestReach);
      masks.forEach(m => { const r = test([m]); if (r > 0 && better(len([m]), r)) { bestLen = len([m]); bestReach = r; best = [m]; } });
      if (!best) for (let i = 0; i < masks.length; i++) for (let j = i + 1; j < masks.length; j++) {
        const pair = [masks[i], masks[j]], r = test(pair); if (r > 0 && better(len(pair), r)) { bestLen = len(pair); bestReach = r; best = pair; }
      }
      if (best) {
        best.forEach(m => {
          const s = 'M' + m.s[0] + ' ' + m.s[1] + ' L' + m.s[2].toFixed(2) + ' ' + m.s[3].toFixed(2);
          closures.push(s);
          console.log('  ' + u + ': front closed at ' + s);
        });
        console.log('  ' + u + ': ' + best.length + ' line(s) of ' + masks.length + ' candidates crossing the flat');
      } else console.log('  ' + u + ': NO one or two wall ends close it (' + masks.length + ' candidates crossing the flat)');
    });
    fs.writeFileSync(DIR + '/closures.json', JSON.stringify(closures));
    console.log('pass 1: ' + closures.length + ' wall ends carried on to the wall they meet (written for pass 2)');
  }
  console.log('open edges (flat touching common or another flat with no wall, >= 2 units): ' + list.length +
              (list.length ? '  ' + list.map(([k, n]) => k + ' ' + (n / PX).toFixed(0) + 'u').join(', ') : ''));
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

/* ── ONE PIECE, EDGED BY ITS WALLS ─────────────────────────────────────────
   A flat is its rooms AND the walls between them. The flood stops at every
   wall, so without this the outline detours round each partition stub, and a
   balcony behind its sliding glass is a separate piece that the outline step
   (longest loop only) drops. Each flat takes every wall cell it can reach
   within R through walls (dilation into walls only); a taken cell is kept
   only if it is further than R from anything that is neither this flat nor
   one of those cells — so a wall with the flat on both sides stays, and an
   outer wall, which has someone else or the outside behind it, goes back. The
   outline then runs along the inner face of the outer walls, straight, with
   bath, dress and balcony inside. Runs in pass 2, when the fronts are shut. */
if (process.env.PASS2) {
  const R = Math.round(Number(process.env.WALLR || 3) * PX);
  const taken = new Int16Array(GW * GH).fill(-1);
  let filled = 0;
  units.forEach((u, id) => {
    let a = GW, b = GH, c = -1, d = -1;
    for (let k = 0; k < GW * GH; k++) if (owner[k] === id) { const i = k % GW, j = (k - i) / GW; if (i < a) a = i; if (i > c) c = i; if (j < b) b = j; if (j > d) d = j; }
    if (c < 0) return;
    a = Math.max(0, a - 2 * R); b = Math.max(0, b - 2 * R); c = Math.min(GW - 1, c + 2 * R); d = Math.min(GH - 1, d + 2 * R);
    const W2 = c - a + 1, H2 = d - b + 1, idx = (i, j) => (j - b) * W2 + (i - a);
    /* dilation into wall cells only */
    const dd = new Int32Array(W2 * H2).fill(-1), q2 = [];
    for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) if (owner[j * GW + i] === id) { dd[idx(i, j)] = 0; q2.push(i, j); }
    for (let h = 0; h < q2.length; h += 2) {
      const i = q2[h], j = q2[h + 1], v = dd[idx(i, j)]; if (v >= R) continue;
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1], [i + 1, j + 1], [i - 1, j - 1], [i + 1, j - 1], [i - 1, j + 1]]) {
        if (ni < a || ni > c || nj < b || nj > d) continue;
        const l = idx(ni, nj); if (dd[l] !== -1 || !wall[nj * GW + ni]) continue;
        dd[l] = v + 1; q2.push(ni, nj);
      }
    }
    /* distance from everything that is neither the flat nor a taken wall cell */
    const out = new Int32Array(W2 * H2).fill(-1), q3 = [];
    for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) {
      const l = idx(i, j);
      if (dd[l] === -1 || i === a || i === c || j === b || j === d) { out[l] = 0; q3.push(i, j); }
    }
    for (let h = 0; h < q3.length; h += 2) {
      const i = q3[h], j = q3[h + 1], v = out[idx(i, j)]; if (v > R) continue;
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1], [i + 1, j + 1], [i - 1, j - 1], [i + 1, j - 1], [i - 1, j + 1]]) {
        if (ni < a || ni > c || nj < b || nj > d) continue;
        const l = idx(ni, nj); if (out[l] !== -1) continue;
        out[l] = v + 1; q3.push(ni, nj);
      }
    }
    for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) {
      const l = idx(i, j), k = j * GW + i;
      if (dd[l] > 0 && (out[l] === -1 || out[l] > R) && taken[k] === -1 && owner[k] === -1) { taken[k] = id; filled++; }
    }
  });
  for (let k = 0; k < GW * GH; k++) if (taken[k] >= 0) owner[k] = taken[k];
  console.log('walls inside a flat joined to it: ' + (filled / PX / PX * 0.1142).toFixed(0) + ' sq ft across the floor');
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
