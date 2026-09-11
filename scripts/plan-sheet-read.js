/* ══ READING BACK WHAT RASHID DECIDED ══════════════════════════════════════
   He is walking the building unit by unit and writing the real area into the
   YOUR AREA column. This takes that column and nothing else. The printed
   figure, the register, the measured room — all of it was there to help him
   look; none of it gets a vote here.

   A row left blank changes nothing. That is deliberate: a half-finished
   workbook must be safe to hand back, and stopping halfway must never mean
   the untouched floors get overwritten with a guess.

   What comes out is a SQL file and a backup, and NEITHER IS RUN. Applying it
   is a separate act with his word on it.

   node scripts/plan-sheet-read.js [workbook.xlsx]
*/
const fs = require('fs'), path = require('path'), https = require('https');
const XLSX = require('xlsx');
const FILE = process.argv[2] || 'Awami_Market_Area_Check.xlsx';
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
  const body = JSON.stringify({ query: q });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN,
                 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d)) : rej(new Error(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

(async () => {
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['Units'];
  if (!ws) { console.log('no "Units" sheet in ' + FILE); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws);

  const reg = {};
  (await sql("select unit_no, area from units where project_id = '" + AWAMI + "'"))
    .forEach(r => reg[r.unit_no] = Number(r.area));

  const take = [], same = [], bad = [];
  rows.forEach(r => {
    const u = String(r['Unit'] || '').trim();
    const raw = r['YOUR AREA'];
    if (!u) return;
    if (raw === '' || raw === undefined || raw === null) return;   // untouched
    /* WHATEVER HE TYPED IS TAKEN LITERALLY, AND ANYTHING THAT IS NOT A PLAIN
       POSITIVE NUMBER IS REFUSED RATHER THAN INTERPRETED. A cell reading
       "approx 490" is a question for him, not something to round off here. */
    const v = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!isFinite(v) || v <= 0 || v > 100000) { bad.push([u, raw]); return; }
    if (reg[u] == null) { bad.push([u, 'not in the register']); return; }
    const rounded = Math.round(v * 100) / 100;
    if (Math.abs(rounded - reg[u]) < 0.005) { same.push(u); return; }
    take.push({ unit: u, was: reg[u], now: rounded, note: String(r['Your note'] || '').trim() });
  });

  console.log(FILE);
  console.log('  rows in the workbook:        ' + rows.length);
  console.log('  filled in:                   ' + (take.length + same.length + bad.length));
  console.log('  already what the register has: ' + same.length);
  console.log('  to change:                   ' + take.length);
  if (bad.length) {
    console.log('  COULD NOT READ (' + bad.length + '), nothing will be done with these:');
    bad.slice(0, 20).forEach(b => console.log('     ' + b[0] + '  →  "' + b[1] + '"'));
  }
  if (!take.length) { console.log('nothing to write'); return; }

  /* the day here, not the day in London: a file named for yesterday is a file
     somebody has to think twice about */
  const d = new Date();
  const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
                String(d.getDate()).padStart(2, '0');
  fs.writeFileSync('migration_work/_area_owner_' + stamp + '.json', JSON.stringify(take, null, 1));

  const head = [
    '-- THE AREA RASHID MEASURED, unit by unit, on his own feet.',
    '-- Taken from the YOUR AREA column of ' + FILE + ' and from nothing else.',
    '-- ' + take.length + ' units. Rows he left blank are not in here.',
    '-- The values being replaced are kept in the table this creates and in',
    '-- migration_work/_area_owner_' + stamp + '.json',
    'begin;',
    'create table if not exists _area_before_' + stamp + ' as',
    '  select id, unit_no, area from units',
    "   where project_id = '" + AWAMI + "';",
    'update units set area = v.a from (values'
  ];
  const body = take.map((r, i) => "  ('" + r.unit + "', " + r.now.toFixed(2) + ')' +
                                  (i < take.length - 1 ? ',' : ''));
  const tail = [
    ') as v(u, a)',
    " where units.project_id = '" + AWAMI + "'",
    '   and units.unit_no = v.u;',
    '-- expect: UPDATE ' + take.length,
    'commit;'
  ];
  fs.writeFileSync('migration_work/_area_owner_' + stamp + '.sql', head.concat(body, tail).join('\n'));
  console.log('written migration_work/_area_owner_' + stamp + '.sql   (NOT RUN)');
})();
