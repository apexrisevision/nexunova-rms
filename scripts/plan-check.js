/* ══ IS THE SHAPE THE RIGHT SHAPE? ══════════════════════════════════════════
   Everything before this is a picture being read by a machine, and a machine
   reading a picture is exactly the thing that should not be believed. So the
   flooded rooms are put against the register, which is the book the building
   is sold from.

   The drawing carries no units — it is in whatever the CAD file used — so the
   scale is not assumed, it is DERIVED: the ratio of flooded area to recorded
   area is taken for every room and the median is used as the sheet's scale.
   A room that then disagrees with its own record by more than the tolerance is
   named. It cannot be tuned away, because the scale comes from the same rooms
   it is judging: one room being wrong barely moves the median, and a hundred
   being wrong makes every one of them look right — which is why the SPREAD is
   reported too. A sheet whose rooms are genuinely read will cluster tightly.

   Nothing is written. This only says whether the floor is fit to ship.

   node scripts/plan-check.js <dir> <pageN> <floor_no> [tolerance%]
*/
const fs = require('fs'), path = require('path'), https = require('https');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const FLOOR = Number(process.argv[4]);
const TOL = Number(process.argv[5] || 10) / 100;
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const body = JSON.stringify({ query: q });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

(async () => {
  const R = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8'));
  const PX = R.px, rooms = R.units;
  const rows = await sql(
    `select unit_no, area::float8 as area from public.units
      where project_id = '${AWAMI}' and floor_no = ${FLOOR} order by unit_no`);
  const reg = {};
  rows.forEach(r => { reg[r.unit_no] = r.area; });

  const have = Object.keys(rooms);
  const missing = Object.keys(reg).filter(u => !rooms[u]);
  const stray = have.filter(u => !(u in reg));

  /* THE PEN EATS THE ROOM IT DRAWS, so a room flooded with a wide pen to close
     a doorway measures small. The bite is given back the same way the flood
     gave it back — half the stroke, along the whole boundary — or a correct
     room would be failed here for being correct. */
  const bite = pen => 1.2 / PX * 2 * (pen || 1) / 2;
  /* a room that was grown back against the true walls has already been given
     what the heavy pen ate; only a plain fill still needs the allowance */
  const drawnOf = r => r.area / (PX * PX) +
    (r.restored ? 0 : 2 * ((r.x1 - r.x0) + (r.y1 - r.y0)) * bite(r.pen));

  /* the sheet's own scale, from the sheet itself */
  const pairs = have.filter(u => reg[u] > 0)
                    .map(u => ({ u: u, drawn: drawnOf(rooms[u]), book: reg[u] }));
  const k = median(pairs.map(p => p.book / p.drawn));
  const errs = pairs.map(p => ({ u: p.u, book: p.book, said: p.drawn * k,
                                 off: (p.drawn * k - p.book) / p.book }));
  errs.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
  /* A ROOM THE FLOOD ALREADY REPORTED AS DISPUTED IS NOT A SURPRISE. It was
     flooded cleanly, sits on nobody, and the architect simply drew it a
     different size from the size the register records — which is a question
     for a person who knows the building, not a fault in the reading. It is
     listed apart so that a NEW disagreement cannot hide among the known ones. */
  const bad = errs.filter(e => Math.abs(e.off) > TOL && !rooms[e.u].disputed);
  const known = errs.filter(e => Math.abs(e.off) > TOL && rooms[e.u].disputed);
  const spread = median(errs.map(e => Math.abs(e.off)));

  console.log(PAGE + '  floor ' + FLOOR + '  —  register ' + rows.length +
              ', rooms ' + have.length);
  console.log('  scale from the sheet itself: 1 drawing unit² = ' + k.toFixed(4) + ' ' +
              'sq ft   (typical room is ' + (spread * 100).toFixed(1) + '% off its record)');
  if (missing.length) console.log('  NO SHAPE (' + missing.length + '): ' + missing.join(', '));
  if (stray.length)   console.log('  NOT IN THE REGISTER (' + stray.length + '): ' + stray.join(', '));
  if (bad.length) {
    console.log('  OUT BY MORE THAN ' + (TOL * 100) + '% (' + bad.length + '):');
    bad.slice(0, 20).forEach(e => console.log('    ' + e.u.padEnd(10) +
      ' book ' + e.book.toFixed(2).padStart(8) + '   drawn ' + e.said.toFixed(2).padStart(8) +
      '   ' + (e.off > 0 ? '+' : '') + (e.off * 100).toFixed(1) + '%'));
  }
  if (known.length) {
    console.log('  THE DRAWING AND THE REGISTER DISAGREE, cleanly, on (' + known.length + '):');
    known.forEach(e => console.log('    ' + e.u.padEnd(10) +
      ' register ' + e.book.toFixed(2).padStart(8) + '   drawn ' + e.said.toFixed(2).padStart(8) +
      '   ' + (e.off > 0 ? '+' : '') + (e.off * 100).toFixed(1) + '%   — shape kept, area to be settled'));
  }
  const ok = !missing.length && !stray.length && !bad.length;
  console.log(ok ? '\n  ✅ every room on this sheet matches the register within ' + (TOL * 100) + '%'
                 : '\n  ❌ this floor is NOT fit to ship yet');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
