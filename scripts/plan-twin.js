/* ══ THE BUILDING, AS SOMETHING YOU CAN TURN ═══════════════════════════════
   Rashid: "un floors ko mila k dashboard pe aik 3d structured map do… make it
   outclass."

   Everything needed for that was already made today. plans/awami-market/*.json
   holds, for every one of the 1,469 units, the OUTLINE THE ARCHITECT DREW —
   not a bounding box, the real shape, kitchens and baths and all, read off the
   sheets and checked unit by unit against the register. This turns those seven
   floors into one model.

   THE SEVEN SHEETS ALREADY SHARE AN ORIGIN, which is the thing that could have
   made this hard and did not. Every page draws the building in the same place:
   x runs 953→1495 on all of them and the back wall lands within a hundred
   units of y=3,280 on all of them. So the floors stack by their own
   coordinates with nothing to align by hand — and where they differ they
   differ for real. The Lower Ground is half the length of the others, and the
   Fourth and Fifth step back from the front. That is the building, and a model
   built from boxes of equal footprint cannot show it.

   WHAT IS DONE TO THE OUTLINES. Nothing, except making them smaller to send:
   points are rounded to a quarter of a drawing unit (about two inches) and any
   point sitting on the straight line between its neighbours is dropped. The
   shape that comes out is the shape that went in.

   node scripts/plan-twin.js [out.json]
*/
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'assets/awami-twin.json';
const PLANS = 'plans/awami-market';
const ROOMS = 'marketing_shots/plan';

/* floor_no is the register's own, so the model and the link agree about order */
const FLOORS = [
  { code: 'LG', page: 'page1', floor_no: 10, label: 'Lower Ground' },
  { code: 'GF', page: 'page2', floor_no: 20, label: 'Ground Floor' },
  { code: 'FF', page: 'page3', floor_no: 40, label: 'First Floor'  },
  { code: 'SF', page: 'page4', floor_no: 50, label: 'Second Floor' },
  { code: 'TF', page: 'page5', floor_no: 60, label: 'Third Floor'  },
  { code: '4F', page: 'page6', floor_no: 70, label: 'Fourth Floor' },
  { code: '5F', page: 'page7', floor_no: 80, label: 'Fifth Floor'  }
];
const PAD = 14;          // the margin plan-lines.js normalised against

/* HALF A DRAWING UNIT, AND AS A WHOLE NUMBER. A drawing unit is a little
   under four inches, so half of one is finer than any wall is thick. Written
   as integers offset from the building's own corner the file is half the size
   of the same shapes written as "1234.25", and the page multiplies back on
   the way in. */
const Q = 2;
const q = v => Math.round(v * Q);

/* drop the point in the middle when three sit on one line — an outline traced
   off a drawing carries dozens of them and they cost bytes and nothing else */
function thin(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[(i + 1) % pts.length];
    if (a && c) {
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross < 0.35) continue;
    }
    if (!a || a[0] !== b[0] || a[1] !== b[1]) out.push(b);
  }
  return out;
}

let kept = 0, raw = 0, units = 0;
const floors = FLOORS.map(F => {
  const plan  = JSON.parse(fs.readFileSync(path.join(PLANS, F.code + '.json'), 'utf8'));
  const rooms = JSON.parse(fs.readFileSync(path.join(ROOMS, F.page + '-rooms.json'), 'utf8')).units;

  /* the box plan-lines.js normalised to, rebuilt from the same rooms it used */
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  Object.values(rooms).forEach(u => {
    X0 = Math.min(X0, u.x0); Y0 = Math.min(Y0, u.y0);
    X1 = Math.max(X1, u.x1); Y1 = Math.max(Y1, u.y1);
  });
  const bx = X0 - PAD, by = Y0 - PAD;
  const W = (X1 - X0) + PAD * 2, H = (Y1 - Y0) + PAD * 2;
  if (Math.abs(W - plan.w) > 0.5 || Math.abs(H - plan.h) > 0.5) {
    throw new Error(F.code + ': the box does not match the plan (' +
                    W.toFixed(1) + '×' + H.toFixed(1) + ' vs ' + plan.w + '×' + plan.h + ')');
  }

  const list = Object.keys(plan.units).sort().map(n => {
    const p = plan.units[n].p.map(pt => [bx + pt[0] * W, by + pt[1] * H]);
    raw += p.length;
    const t = thin(p);
    kept += t.length; units++;
    return { n: n, p: [].concat(...t) };
  });
  return { code: F.code, label: F.label, floor_no: F.floor_no, units: list };
});

/* the whole building's extent, so the page does not have to walk every point */
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
floors.forEach(f => f.units.forEach(u => {
  for (let i = 0; i < u.p.length; i += 2) {
    x0 = Math.min(x0, u.p[i]);   x1 = Math.max(x1, u.p[i]);
    y0 = Math.min(y0, u.p[i + 1]); y1 = Math.max(y1, u.p[i + 1]);
  }
}));

/* measured from the building's own corner, in half-units, as whole numbers —
   the page undoes this in one line and the file is half the size */
floors.forEach(f => f.units.forEach(u => {
  for (let i = 0; i < u.p.length; i += 2) {
    u.p[i]     = q(u.p[i]     - x0);
    u.p[i + 1] = q(u.p[i + 1] - y0);
  }
}));

fs.writeFileSync(OUT, JSON.stringify({
  /* what the page needs to put it back: divide by s, and the model spans w×h */
  s: Q, w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2), floors: floors
}));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(units + ' units across ' + floors.length + ' floors → ' + OUT + '  (' + kb + ' KB)');
console.log('  outline points: ' + raw + ' traced → ' + kept + ' kept  (' +
            Math.round(100 - kept * 100 / raw) + '% dropped as straight-line filler)');
console.log('  building box: ' + (x1 - x0).toFixed(0) + ' × ' + (y1 - y0).toFixed(0) + ' drawing units');
console.log('  per floor: ' + floors.map(f => f.code + ' ' + f.units.length).join(', '));
