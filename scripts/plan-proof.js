/* ══ THE SHEET, THE REGISTER, AND YOUR OWN EYES ════════════════════════════
   Rashid's fear, said plainly: "mai manually b check nahi kar sakta aik aik,
   aur ye b nahi maloom k abhi b tum theek hee karo gay". He is right to say
   it. An assurance from me that a thousand-odd areas are correct is worth
   nothing, because it is the same assurance I gave before the one that was
   wrong. What is worth something is being able to check it without me.

   So this page does not report a conclusion. It shows, for every unit in the
   building, THE ACTUAL INK OFF THE ARCHITECT'S SHEET — the traced outlines of
   the line the draughtsman printed, lifted from the drawing and drawn again at
   a size an eye can read — and beside it the number the register holds. No
   step in between is mine to get wrong: if the ink says 492.40 and the column
   says 492.40, that unit is right, and anyone can see it in a second.

   The disagreements are put first, because those are the ones that matter and
   there should be few enough to read one by one.

   node scripts/plan-proof.js [dir] [out.html]
*/
const fs = require('fs'), path = require('path'), https = require('https');
const DIR = process.argv[2] || 'marketing_shots/plan';
const OUT = process.argv[3] || path.join(DIR, 'area-proof.html');
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

const FLOORS = [
  { page: 'page1', name: 'Lower Ground', no: 10 },
  { page: 'page2', name: 'Ground Floor', no: 20 },
  { page: 'page3', name: 'First Floor',  no: 40 },
  { page: 'page4', name: 'Second Floor', no: 50 },
  { page: 'page5', name: 'Third Floor',  no: 60 },
  { page: 'page6', name: 'Fourth Floor', no: 70 },
  { page: 'page7', name: 'Fifth Floor',  no: 80 }
];

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

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* THE INK, MADE SMALL ENOUGH TO CARRY. A traced outline is written out at full
   precision and repeats points that never move — one unit's area line runs to
   twenty-five thousand characters, and fifteen hundred of those made a page of
   thirty megabytes that no phone would open. So each line is moved to its own
   corner, rounded to a tenth of a drawing unit (a glyph is some three units
   tall, so nothing an eye can see is lost), points that repeat are dropped, and
   points that sit on the straight line between their neighbours are dropped
   too. The shape that comes out is the shape that went in. */
function tidy(d, ox, oy) {
  const pts = [];
  const re = /([-\d.]+) ([-\d.]+)/g;
  let m;
  while ((m = re.exec(d))) {
    const x = Math.round((Number(m[1]) - ox) * 10) / 10;
    const y = Math.round((Number(m[2]) - oy) * 10) / 10;
    const last = pts[pts.length - 1];
    if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
  }
  const keep = [];
  for (let i = 0; i < pts.length; i++) {
    const a = keep[keep.length - 1], b = pts[i], c = pts[i + 1];
    if (a && c) {
      /* twice the area of the triangle a-b-c: zero means b adds nothing */
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross < 0.02) continue;
    }
    keep.push(b);
  }
  if (keep.length < 3) return '';
  return 'M' + keep.map(p => p[0] + ' ' + p[1]).join('L') + 'Z';
}

/* the line as the architect drew it, put back on the page at a readable size */
function inkSvg(rec) {
  const [x0, y0, x1, y1] = rec.box;
  const pad = (y1 - y0) * 0.25;
  const w = (x1 - x0) + pad * 2, h = (y1 - y0) + pad * 2;
  const ds = rec.ink.map(d => tidy(d, x0 - pad, y0 - pad)).filter(Boolean);
  return '<svg class="ink" viewBox="0 0 ' + +w.toFixed(1) + ' ' + +h.toFixed(1) + '" ' +
         'preserveAspectRatio="xMinYMid meet" aria-hidden="true">' +
         '<path fill-rule="evenodd" d="' + ds.join('') + '"/></svg>';
}

(async () => {
  const reg = {};
  (await sql("select unit_no, floor_no, area from units where project_id = '" + AWAMI + "'"))
    .forEach(r => reg[r.unit_no] = Number(r.area));

  let nAgree = 0, nDiffer = 0, nNoInk = 0, nUnits = 0;
  const sections = [];

  FLOORS.forEach(F => {
    const file = path.join(DIR, F.page + '-area.json');
    if (!fs.existsSync(file)) return;
    const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
    const names = JSON.parse(fs.readFileSync(path.join(DIR, F.page + '-read.json'), 'utf8')).map(u => u.u);

    /* A THIRD NUMBER, OWED TO THE UNITS THE SHEET DOES NOT LABEL. Not every
       commercial shop has its area printed — on the Ground Floor thirty-two do
       not — and for those there is nothing to hold the register against. So
       every room is also MEASURED: the drawn shape is counted in pixels and
       turned into feet by this sheet's own scale, taken from the units that do
       carry a printed number. It is a coarser figure than the print, and it is
       said to be coarser, but it is arrived at from the drawing alone and it is
       enough to show whether a register entry is in the right country. */
    const rooms = JSON.parse(fs.readFileSync(path.join(DIR, F.page + '-rooms.json'), 'utf8')).units;
    const scales = names.filter(u => sheet[u] && rooms[u]).map(u => sheet[u].area / rooms[u].area).sort((a, b) => a - b);
    const scale = scales.length ? scales[Math.floor(scales.length / 2)] : null;

    const rows = names.map(u => {
      const s = sheet[u], r = reg[u];
      return { u, sheet: s ? s.area : null, reg: r == null ? null : r, ink: s || null,
               drawn: (scale && rooms[u]) ? rooms[u].area * scale : null };
    });
    nUnits += rows.length;
    rows.forEach(r => {
      if (!r.ink) nNoInk++;
      else if (r.reg != null && Math.abs(r.sheet - r.reg) < 0.005) nAgree++;
      else nDiffer++;
    });

    /* WORST FIRST, AND UNCHECKED BEFORE CHECKED. Disagreements lead, biggest
       gap at the top; then the units the sheet never labelled, which nobody can
       settle from the print; then the ones that agree, which need no reading. */
    const rank = r => !r.ink ? 1 : (r.reg == null || Math.abs(r.sheet - r.reg) >= 0.005) ? 0 : 2;
    const gap = r => (r.ink && r.reg != null) ? Math.abs(r.sheet - r.reg) : 0;
    rows.sort((a, b) => rank(a) - rank(b) || gap(b) - gap(a) ||
                        a.u.localeCompare(b.u, undefined, { numeric: true }));

    const body = rows.map(r => {
      const bad = r.ink && (r.reg == null || Math.abs(r.sheet - r.reg) >= 0.005);
      /* with nothing printed, the measured room is the only witness — flag it
         only when it is far enough out that no measuring error explains it */
      const doubt = !r.ink && r.reg != null && r.drawn != null &&
                    Math.abs(r.drawn - r.reg) > r.reg * 0.25;
      return '<tr class="' + (bad ? 'bad' : doubt ? 'doubt' : r.ink ? 'ok' : 'none') + '">' +
        '<td class="u">' + esc(r.u) + '</td>' +
        '<td class="i">' + (r.ink ? inkSvg(r.ink)
            : '<span class="mut">nothing printed — room measures ' +
              (r.drawn == null ? 'unknown' : '≈ ' + num(r.drawn)) + '</span>') + '</td>' +
        '<td class="n">' + (r.sheet == null ? '—' : num(r.sheet)) + '</td>' +
        '<td class="n">' + (r.reg == null ? '<span class="mut">not in the register</span>' : num(r.reg)) + '</td>' +
        '<td class="n d">' + (r.ink && r.reg != null
            ? (Math.abs(r.sheet - r.reg) < 0.005 ? '<span class="tick">same</span>'
               : (r.sheet > r.reg ? '+' : '') + num(r.sheet - r.reg))
            : doubt ? '<span class="warn">look</span>' : '') + '</td></tr>';
    }).join('');

    const differ = rows.filter(r => rank(r) === 0).length;
    const blank = rows.filter(r => rank(r) === 1).length;
    /* THE HEADING MUST NOT ROUND IN OUR FAVOUR. Saying "all 168 agree" when
       twenty-five of them were never checked is the same kind of quiet claim
       that put a placeholder on the link in the first place. */
    const tag = differ ? differ + ' of ' + rows.length + ' disagree'
              : blank ? (rows.length - blank) + ' agree, ' + blank + ' not printed'
              : 'all ' + rows.length + ' agree';
    sections.push('<section><h2>' + esc(F.name) +
      '<span class="tag ' + (differ ? 'w' : blank ? 'd' : 'g') + '">' + tag +
      '</span></h2><table>' +
      '<tr><th>Unit</th><th>What the architect printed</th><th>Read as</th>' +
      '<th>In the register</th><th>Difference</th></tr>' + body + '</table></section>');
  });

  const html = '<title>Awami Market — area, checked against the drawing</title>' +
'<style>' +
':root{--bg:#faf9f7;--ink:#1a1a1a;--mut:#6b6b6b;--line:#e2e0dc;--card:#fff;--bad:#b3123c;--badbg:#fdf2f5;--good:#166534;--goodbg:#f0fdf4;--do:#a16207;--dobg:#fffbeb}' +
'@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141414;--ink:#ececec;--mut:#9a9a9a;--line:#2c2c2c;--card:#1c1c1c;--bad:#ff8199;--badbg:#2a1219;--good:#86efac;--goodbg:#0f2417;--do:#fcd34d;--dobg:#2a2109}}' +
':root[data-theme="dark"]{--bg:#141414;--ink:#ececec;--mut:#9a9a9a;--line:#2c2c2c;--card:#1c1c1c;--bad:#ff8199;--badbg:#2a1219;--good:#86efac;--goodbg:#0f2417;--do:#fcd34d;--dobg:#2a2109}' +
'body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0}' +
'.wrap{max-width:1000px;margin:0 auto;padding:28px 18px 80px}' +
'h1{font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px}' +
'.lede{color:var(--mut);margin:0 0 22px;max-width:62ch}' +
'.sum{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 26px}' +
'.s{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}' +
'.s b{display:block;font-size:24px;font-weight:600;letter-spacing:-.02em}' +
'.s span{color:var(--mut);font-size:13px}' +
'.s.bad b{color:var(--bad)}.s.good b{color:var(--good)}' +
'section{margin:0 0 30px}' +
'h2{font-size:17px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:10px}' +
'.tag{font-size:12px;font-weight:500;padding:3px 9px;border-radius:20px}' +
'.tag.w{background:var(--badbg);color:var(--bad)}.tag.g{background:var(--goodbg);color:var(--good)}' +
'.tag.d{background:var(--dobg);color:var(--do)}' +
'.wrapx{overflow-x:auto}' +
'table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}' +
'th{text-align:left;font-size:12px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;padding:9px 12px;border-bottom:1px solid var(--line)}' +
'td{padding:7px 12px;border-bottom:1px solid var(--line);vertical-align:middle}' +
'tr:last-child td{border-bottom:0}' +
'td.u{font-weight:600;white-space:nowrap}' +
'td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
'td.i{width:46%}' +
'.ink{height:19px;width:100%;max-width:230px;display:block;fill:var(--ink)}' +
'tr.bad{background:var(--badbg)}tr.bad td.d{color:var(--bad);font-weight:600}' +
'tr.doubt{background:var(--dobg)}.warn{color:var(--do);font-weight:600}' +
'.tick{color:var(--good)}' +
'.mut{color:var(--mut);font-size:13px}' +
'.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--bad);border-radius:8px;padding:14px 16px;margin:0 0 26px;color:var(--mut);max-width:70ch}' +
'.note b{color:var(--ink)}' +
'@media(max-width:640px){td.i{width:auto}.ink{max-width:150px}body{font-size:14px}}' +
'</style>' +
'<div class="wrap">' +
'<h1>Area, checked against the drawing</h1>' +
'<p class="lede">Every unit in Awami Market, with the line the architect actually printed beside the number the register holds. The picture in the middle is not typed out — it is the ink lifted straight off the sheet. If it reads the same as the last two columns, that unit is right, and you can see that for yourself without taking anyone\'s word for it.</p>' +
'<div class="note"><b>How to read a row.</b> The middle column is the architect\'s own writing. “Read as” is what that writing was decoded to — it should always match the picture. “In the register” is what the system holds today, and it is the one that can be wrong. Rows that disagree are shown first, in red.</div>' +
'<div class="sum">' +
  '<div class="s good"><b>' + nAgree + '</b><span>register matches the sheet</span></div>' +
  '<div class="s bad"><b>' + nDiffer + '</b><span>register disagrees</span></div>' +
  '<div class="s"><b>' + nNoInk + '</b><span>no line found to check</span></div>' +
  '<div class="s"><b>' + nUnits + '</b><span>units in the building</span></div>' +
'</div>' +
sections.join('') +
'<p class="mut">Read off the architect\'s sheets by scripts/plan-areas.js and laid out by scripts/plan-proof.js. The decoding was done twice by two unrelated methods and agreed on every residential unit; this page shows the ink so the decoding itself can be checked by eye.</p>' +
'</div>';

  fs.writeFileSync(OUT, html);
  console.log('units on the sheets: ' + nUnits);
  console.log('  register matches the printed area: ' + nAgree);
  console.log('  register disagrees:                ' + nDiffer);
  console.log('  no printed line found:             ' + nNoInk);
  console.log('written ' + OUT);
})();
