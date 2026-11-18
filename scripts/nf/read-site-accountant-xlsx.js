#!/usr/bin/env node
/* Read-only: every line from the site accountant's "Awami Daily Entry - Accountant.xlsx" day tabs
   (receipts rows 13-37, payments rows 43-67) as JSON.
   Usage: node scripts/nf/read-site-accountant-xlsx.js "<xlsx>" <out.json> */
const fs = require('fs');
const X = require('xlsx');
const [file, out] = process.argv.slice(2);
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const num = s => +String(s).replace(/[,\s]/g, '').replace(/^–$/, '') || 0;
const t = s => String(s).trim();
const wb = X.readFile(file);
const lines = [];
for (const n of wb.SheetNames) {
  const m = /^(\d{2})-([A-Z][a-z]{2})$/.exec(n); if (!m) continue;
  const date = `2026-${String(MON[m[2]]).padStart(2, '0')}-${m[1]}`;
  const r = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
  const prepared = t((r[1] || [])[4]);
  for (let i = 12; i <= 36; i++) {
    const x = r[i] || []; const cash = num(x[6]), bank = num(x[7]);
    if (!(cash || bank) && !t(x[1]) && !t(x[2])) continue;
    lines.push({ date, tab: n, row: i + 1, side: 'IN', no: t(x[1]), party: t(x[2]), units: t(x[3]), token: t(x[4]), head: t(x[5]), cash, bank, ref: t(x[8]), remarks: t(x[9]), prepared });
  }
  for (let i = 42; i <= 66; i++) {
    const x = r[i] || []; const cash = num(x[6]), bank = num(x[7]);
    if (!(cash || bank) && !t(x[1]) && !t(x[2])) continue;
    lines.push({ date, tab: n, row: i + 1, side: 'OUT', no: t(x[1]), party: t(x[2]), bill: t(x[3]), head: t(x[5]), cash, bank, ref: t(x[8]), remarks: t(x[9]), prepared });
  }
}
const ob = X.utils.sheet_to_json(wb.Sheets['Opening Balances'], { header: 1, raw: false, defval: '' });
fs.writeFileSync(out, JSON.stringify({ opening: ob.filter(x => x.some(c => t(c))).map(x => x.filter(c => t(c))), lines }, null, 1));
console.log('lines', lines.length);
