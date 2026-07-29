// Validates fmh_data/*.csv against the stated reconciliation targets.
// Pure arithmetic — touches no database.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'fmh_data');

function parseCsv(file) {
  const txt = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r/g, '').trim();
  const lines = txt.split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    // minimal RFC4180: handles quoted fields containing commas
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

const units = parseCsv('fmh_units_master.csv');
const sched = parseCsv('fmh_schedules.csv');

const fmt = n => 'PKR ' + Number(n).toLocaleString('en-US');
const errs = [];

// --- per-unit reconciliation -------------------------------------------------
const byUnit = new Map();
for (const r of sched) {
  if (!byUnit.has(r.unit)) byUnit.set(r.unit, []);
  byUnit.get(r.unit).push(r);
}

console.log('unit     rows  sum(schedule)        sale_value           delta  zero  ok');
console.log('-'.repeat(76));
let grand = 0, totalRows = 0, totalZero = 0;

for (const u of units) {
  const rows = byUnit.get(u.unit) || [];
  const sum = rows.reduce((a, r) => a + Number(r.amount_pkr), 0);
  const val = Number(u.sale_value_pkr);
  const zero = rows.filter(r => Number(r.amount_pkr) === 0).length;
  const delta = sum - val;
  const ok = delta === 0;
  if (!ok) errs.push(`${u.unit}: schedule ${sum} != sale_value ${val} (delta ${delta})`);

  // sno must be 1..n contiguous
  const snos = rows.map(r => Number(r.sno)).sort((a, b) => a - b);
  snos.forEach((s, i) => { if (s !== i + 1) errs.push(`${u.unit}: sno gap at ${s}`); });

  // booking_date must equal first schedule row's date
  const first = rows.find(r => Number(r.sno) === 1);
  if (!first) errs.push(`${u.unit}: no sno=1 row`);
  else if (first.due_date !== u.booking_date)
    errs.push(`${u.unit}: booking_date ${u.booking_date} != first due_date ${first.due_date}`);

  // dates must be non-decreasing
  for (let i = 1; i < rows.length; i++)
    if (rows[i].due_date < rows[i - 1].due_date)
      errs.push(`${u.unit}: due_date goes backwards at sno ${rows[i].sno}`);

  grand += val; totalRows += rows.length; totalZero += zero;
  console.log(
    u.unit.padEnd(8) + String(rows.length).padStart(5) +
    fmt(sum).padStart(19) + fmt(val).padStart(21) +
    String(delta).padStart(8) + String(zero).padStart(6) +
    (ok ? '   YES' : '   NO')
  );
}

// schedule rows for units not in master?
for (const k of byUnit.keys())
  if (!units.find(u => u.unit === k)) errs.push(`schedule has orphan unit ${k}`);

// --- client dedup ------------------------------------------------------------
const byNic = new Map();
for (const u of units) {
  if (!byNic.has(u.nic)) byNic.set(u.nic, { name: u.client_name, units: [] });
  byNic.get(u.nic).units.push(u.unit);
  if (byNic.get(u.nic).name !== u.client_name)
    errs.push(`NIC ${u.nic} maps to two names: ${byNic.get(u.nic).name} / ${u.client_name}`);
}

console.log('-'.repeat(76));
console.log(`units(sales)     : ${units.length}`);
console.log(`schedule rows    : ${totalRows}`);
console.log(`zero-amount rows : ${totalZero}`);
console.log(`unique clients   : ${byNic.size}`);
console.log(`grand total      : ${fmt(grand)}`);
console.log('');
console.log('multi-unit buyers:');
for (const [nic, v] of byNic)
  if (v.units.length > 1) console.log(`  ${v.name.padEnd(24)} ${nic}  ->  ${v.units.join(', ')}`);

// --- targets -----------------------------------------------------------------
console.log('');
const targets = [
  ['sales == 22', units.length === 22],
  ['schedule_rows == 844', totalRows === 844],
  ['unique clients == 14', byNic.size === 14],
  ['grand_total == PKR 153,254,688', grand === 153254688],
];
for (const [label, pass] of targets) console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);

if (errs.length) {
  console.log('\nERRORS:');
  errs.forEach(e => console.log('  ! ' + e));
  process.exit(1);
}
console.log('\nAll per-unit and structural checks passed.');
