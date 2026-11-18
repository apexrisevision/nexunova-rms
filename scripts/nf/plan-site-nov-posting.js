#!/usr/bin/env node
/* Read-only plan (owner's option A, 18-Nov): which of the site accountant's lines get posted, on which day,
   under which head, and the Site Cash (10200 Petty Cash) balance day by day. Writes a CSV and prints a summary.
   Usage: node scripts/nf/plan-site-nov-posting.js <site-xlsx.json> <out.csv> */
const fs = require('fs');
const { lines } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];

// Lines already in head office's books (skipped), keyed by date + party/ref + amount.
const SKIP = [
  { d: '2026-11-05', head: 'Bank to Cash', amt: 150000, why: 'BPV-0026 (chq 1313825996) — re-pointed to Site Cash' },
  { d: '2026-11-14', token: '208', amt: 20000, why: 'BRV-0079 (Token #208 Irfan Ullah)' },
  { d: '2026-11-16', ref: '6265', amt: 300000, why: 'BPV-0046 (chq 1313826265) — re-pointed to Site Cash' },
  { d: '2026-11-16', ref: '6268', amt: 200000, why: 'BPV-0045 (chq 1313826268, Khyber cement) — one event' },
  { d: '2026-11-16', party: 'KHYBER', amt: 200000, why: 'BPV-0045 (chq 1313826268, Khyber cement) — one event' },
  { d: '2026-11-16', party: 'WAQAR', amt: 1000000, why: 'BPV-0043 (chq 1313826266)' },
  { d: '2026-11-16', party: 'FAWAD', amt: 300000, why: 'BPV-0044 (chq 1313826267)' },
  { d: '2026-11-16', party: 'ZIA', amt: 50000, why: 'CPV-0172 — re-pointed to Site Cash' },
  { d: '2026-11-16', party: 'ABU BAKAR', amt: 59000, why: 'CPV-0171 — re-pointed to Site Cash' },
  { d: '2026-11-16', party: 'NAEEM', amt: 150000, why: 'CPV-0170 — re-pointed to Site Cash' },
];
// Bank lines head office has not posted: held until the owner confirms them on the BOP statement.
const HOLD = [
  { party: 'SAKHI JAN', amt: 30011, why: 'bank (JazzCash) — not in head office books; confirm on BOP statement' },
  { party: 'OSMA', amt: 500000, why: 'bank chq 6292 — not in head office books; confirm on BOP statement' },
];
// Site head (Excel) → NexuFinance account. A few lines get a better head by what they are (marked *).
const HEAD = {
  'Printing & Stationery': '70500', 'Entertainment': '60400', 'Office Expense': '70950', 'Site Utilities': '52900',
  'Communication & Internet': '70600', 'Furniture & Fixtures': '15100', 'Fuel & Transport': '70700',
  'Construction Material': '52500', 'General Expenses': '70950', 'Labour / Wages': '52600', 'Advertising': '60100',
  'Token - Unit': '21100', 'Other (explain in Remarks)': '81300',
};
const BY_REMARK = [
  [/50 INCH TV/, '15200', 'TV is office equipment, not a site utility'],
  [/MOBILE PACKAGE/, '70600', 'mobile package is communication, not marketing printing'],
  [/SOFTWARE/, '16100', 'software'],
];
const NAMES = { '70500': 'Printing & Stationery', '60400': 'Entertainment', '70950': 'General Expenses', '52900': 'Site Utilities & Temp Works',
  '70600': 'Communication & Internet', '15100': 'Furniture & Fixtures', '70700': 'Travelling & Conveyance', '52500': 'Other Construction Material',
  '52600': 'Labour', '60100': 'Advertising & Promotion', '21100': 'Token Money - Units', '81300': 'Miscellaneous Expense', '15200': 'Office Equipment',
  '16100': 'Software & Licences' };

const rows = [];
for (const l of lines) {
  const amt = l.cash || l.bank;
  const s = SKIP.find(k => k.d === l.date && k.amt === amt && (!k.head || l.head.startsWith(k.head)) && (!k.token || l.token === k.token)
    && (!k.ref || l.ref === k.ref) && (!k.party || l.party.includes(k.party)));
  const h = HOLD.find(k => l.party.includes(k.party) && k.amt === amt);
  let code = HEAD[l.head], note = '';
  for (const [re, c, why] of BY_REMARK) if (re.test(l.remarks)) { code = c; note = '* ' + why; }
  const action = s ? 'SKIP' : h ? 'HOLD' : 'POST';
  rows.push({ ...l, amt, action, why: s ? s.why : h ? h.why : note, code: action === 'POST' ? code : '', head_name: action === 'POST' ? NAMES[code] : '' });
}
// Site Cash day by day: 0 opening; + 1,50,000 on 05-Nov and + 3,00,000 on 16-Nov (the re-pointed BPVs);
// − the three re-pointed CPVs on 16-Nov; ± the posted cash lines.
const byDay = {};
const add = (d, k, v) => { (byDay[d] = byDay[d] || { in: 0, out: 0, n: 0 })[k] += v; };
add('2026-11-05', 'in', 150000); add('2026-11-16', 'in', 300000); add('2026-11-16', 'out', 150000 + 59000 + 50000);
for (const r of rows) if (r.action === 'POST' && r.cash) { add(r.date, r.side === 'IN' ? 'in' : 'out', r.cash); byDay[r.date].n++; }
let bal = 0; const days = Object.keys(byDay).sort().map(d => { const o = byDay[d]; const open = bal; bal = open + o.in - o.out; return { d, open, ...o, close: bal }; });
fs.writeFileSync(out, 'date,action,side,no,party,units,token,site_head,nf_code,nf_head,cash,bank,ref,remarks,why\n' + rows.map(r =>
  [r.date, r.action, r.side, r.no, r.party, r.units, r.token, r.head, r.code, r.head_name, r.cash || '', r.bank || '', r.ref, r.remarks, r.why]
    .map(v => /[,"]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n') + '\n');
console.log(JSON.stringify({ counts: { post: rows.filter(r => r.action === 'POST').length, skip: rows.filter(r => r.action === 'SKIP').length, hold: rows.filter(r => r.action === 'HOLD').length }, days }, null, 1));
