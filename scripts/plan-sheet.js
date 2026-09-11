/* ══ THE SAME CHECK, AS A WORKBOOK RASHID CAN CORRECT ══════════════════════
   "isi format mai as it is excel ki file bana k yahin rakho, mai osay theek
   karke save karke tumhe bata dunga tab tum measurements le laina us se. mai
   physical aik aik unit ko dekh k update karunga."

   So this is the proof page again, in a workbook, with one column left empty
   for him: YOUR AREA. Whatever he writes there is the answer — not the sheet,
   not the register, not anything read by me. Everything else in the row is
   there only to help him see what he is deciding between, and every one of
   those columns is labelled with where it came from.

   The row order is the order a person walks a floor in, not the order that
   flatters the reading: unit by unit, floor by floor. Filters are on, so the
   disagreements can be pulled up in one click when he wants them.

   Read back afterwards by scripts/plan-sheet-read.js, which takes YOUR AREA
   and nothing else.

   node scripts/plan-sheet.js [dir] [out.xlsx]
*/
const fs = require('fs'), path = require('path'), https = require('https');
const XLSX = require('xlsx');
const DIR = process.argv[2] || 'marketing_shots/plan';
const OUT = process.argv[3] || 'Awami_Market_Area_Check.xlsx';
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

const FLOORS = [
  { page: 'page1', name: 'Lower Ground' },
  { page: 'page2', name: 'Ground Floor' },
  { page: 'page3', name: 'First Floor'  },
  { page: 'page4', name: 'Second Floor' },
  { page: 'page5', name: 'Third Floor'  },
  { page: 'page6', name: 'Fourth Floor' },
  { page: 'page7', name: 'Fifth Floor'  }
];

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
  const reg = {};
  (await sql("select unit_no, area from units where project_id = '" + AWAMI + "'"))
    .forEach(r => reg[r.unit_no] = Number(r.area));

  const rows = [];
  FLOORS.forEach(F => {
    const file = path.join(DIR, F.page + '-area.json');
    if (!fs.existsSync(file)) return;
    const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
    /* A STRAY MARK IS NOT A SHOP. The First Floor carries two smudges the
       number-reader took for labels, named '.' and '..', and one of them sat
       close enough to FF-160 to be handed that shop's printed area. They are
       not in the register, so they are dropped here — and dropping them is
       safe precisely because anything genuinely missing from the register
       would show up as a unit with no row at all. */
    const names = JSON.parse(fs.readFileSync(path.join(DIR, F.page + '-read.json'), 'utf8'))
      .map(u => u.u).filter(u => reg[u] != null);
    const rooms = JSON.parse(fs.readFileSync(path.join(DIR, F.page + '-rooms.json'), 'utf8')).units;

    /* the sheet's own scale, so a room with nothing printed can still be
       measured — taken from the units on this floor that do carry a figure */
    const scales = names.filter(u => sheet[u] && rooms[u])
                        .map(u => sheet[u].area / rooms[u].area).sort((a, b) => a - b);
    const scale = scales.length ? scales[Math.floor(scales.length / 2)] : null;

    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(u => {
      const s = sheet[u] ? sheet[u].area : null;
      const r = reg[u] == null ? null : reg[u];
      const drawn = (scale && rooms[u]) ? Math.round(rooms[u].area * scale * 100) / 100 : null;
      const status = s == null ? 'NOTHING PRINTED'
                   : (r != null && Math.abs(s - r) < 0.005) ? 'agrees'
                   : 'DISAGREES';
      rows.push({
        'Floor': F.name,
        'Unit': u,
        'Printed on the drawing': s == null ? '' : 'AREA=' + s.toFixed(2) + ' Sqft',
        'Read as': s,
        'In the register': r,
        'Difference': (s != null && r != null) ? Math.round((s - r) * 100) / 100 : null,
        'Room measured (rough)': drawn,
        'Status': status,
        'YOUR AREA': '',
        'Your note': ''
      });
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [
    'Floor', 'Unit', 'Printed on the drawing', 'Read as', 'In the register',
    'Difference', 'Room measured (rough)', 'Status', 'YOUR AREA', 'Your note'
  ]});
  ws['!cols'] = [{ wch: 14 }, { wch: 11 }, { wch: 24 }, { wch: 11 }, { wch: 15 },
                 { wch: 11 }, { wch: 21 }, { wch: 16 }, { wch: 13 }, { wch: 34 }];
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: rows.length, c: 9 } }) };

  /* A NOTE THAT TRAVELS WITH THE FILE, because whoever opens it next may not
     have been in this conversation. */
  const guide = [
    ['Awami Market — area check'],
    [],
    ['Fill in YOUR AREA. That column is the answer; nothing else in this file is.'],
    ['Leave a row blank and nothing about that unit will be changed.'],
    [],
    ['Printed on the drawing', 'what the architect wrote beside that unit, read off the sheet'],
    ['Read as', 'the same thing as a number'],
    ['In the register', 'what the system holds today'],
    ['Difference', 'printed minus register'],
    ['Room measured (rough)', 'the drawn room measured at this sheet\'s scale — used only where'],
    ['', 'the drawing prints no figure. It is approximate and is not evidence.'],
    ['Status', 'DISAGREES, agrees, or NOTHING PRINTED. Use the filter on this column.'],
    [],
    ['The picture version of this, showing the architect\'s actual ink beside each'],
    ['unit, is at marketing_shots\\plan\\area-proof.html'],
    [],
    ['Built ' + new Date().toISOString().slice(0, 10) + '. Nothing in the system has been changed.']
  ];
  const wg = XLSX.utils.aoa_to_sheet(guide);
  wg['!cols'] = [{ wch: 26 }, { wch: 78 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wg, 'Read me');
  XLSX.utils.book_append_sheet(wb, ws, 'Units');
  XLSX.writeFile(wb, OUT);

  const n = k => rows.filter(r => r.Status === k).length;
  console.log(rows.length + ' units written to ' + OUT);
  console.log('   DISAGREES ' + n('DISAGREES') + '   agrees ' + n('agrees') +
              '   nothing printed ' + n('NOTHING PRINTED'));
})();
