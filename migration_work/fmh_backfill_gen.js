// Generates the idempotent FMH 21-unit backfill SQL from fmh_data/*.csv.
//   node migration_work/fmh_backfill_gen.js          -> dry run (ends ROLLBACK)
//   node migration_work/fmh_backfill_gen.js --commit -> ends COMMIT
//
// Nothing is executed here; this only writes SQL to migration_work/.
const fs = require('fs');
const path = require('path');

const CO = '71d33e07-e55c-49af-8f5b-fdd7fd6e8612';   // FMH company
const PROJ = 'ce05f4bb-a527-4e2b-b529-970c76c8d855'; // Fourteen Manzil Height
const SOLD = '5723bb68-d558-41c8-92e5-10a0eaf6682b';
const AVAIL = '839b6149-d3ef-4c49-94be-c51e5d638b31';
const SKIP = new Set(['MF-57']); // already in RMS as SAL-2026-0009 (owner-confirmed skip)
const STAMP = '2026-07-29 booking-record backfill';
const COMMIT = process.argv.includes('--commit');

const DIR = path.join(__dirname, '..', 'fmh_data');
function parseCsv(file) {
  const txt = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r/g, '').trim();
  const head = txt.split('\n')[0].split(',');
  return txt.split('\n').slice(1).map(line => {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

const q = s => (s === null || s === undefined || s === '') ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;

const allUnits = parseCsv('fmh_units_master.csv');
const allSched = parseCsv('fmh_schedules.csv');
const units = allUnits.filter(u => !SKIP.has(u.unit));
const schedOf = u => allSched.filter(r => r.unit === u).sort((a, b) => +a.sno - +b.sno);

// ---- unit pricing decomposition -------------------------------------------
// sales.net_amount is GENERATED as (price_per_sqft * area_sqft) - discount.
// We pin area to the real inventory area and derive rate from the unit's list
// price, then let `discount` absorb the remainder so net_amount lands EXACTLY
// on sale_value_pkr. Same technique as the 2026-07-27 area fix.
// Inventory area/base_price, read from units (verified against DB):
const INV = {
  'MF-30': [90.96, 3638400], 'MF-61': [159.64, 4789290], 'MF-62': [163.28, 4898310],
  '6-01': [804.00, 15708480], '2-14': [485.70, 4905570], 'MF-18': [82.11, 2463300],
  '5-02': [1260.67, 11724231], '5-03': [826.00, 15368901], '5-05': [771.50, 7174950],
  '5-06': [1615.61, 15025173], '5-14': [364.00, 4517010], '8-09': [593.79, 5344110],
  '8-15': [926.00, 8334000], '10-18': [473.00, 4351600], '11-15': [523.00, 4759300],
  'GF-43': [273.60, 16416000], 'LG-21': [150.75, 6030000], 'LG-24': [97.41, 2435250],
  'LG-37B': [157.79, 4102540], 'MF-19': [101.98, 3059400], '12-09': [559.00, 5254600],
};
const r2 = n => Math.round(n * 100) / 100;
function price(unit, saleValue) {
  const [area, base] = INV[unit];
  let rate = r2(base / area);
  // rounding can leave rate*area a few paise BELOW sale_value -> negative discount.
  while (r2(rate * area) < saleValue) rate = r2(rate + 0.01);
  const discount = r2(r2(rate * area) - saleValue);
  if (discount < 0) throw new Error(`${unit}: negative discount ${discount}`);
  if (r2(r2(rate * area) - discount) !== saleValue)
    throw new Error(`${unit}: net ${r2(r2(rate * area) - discount)} != ${saleValue}`);
  return { area, rate, discount };
}

// ---- client dedup by NIC ---------------------------------------------------
const clients = [];
for (const u of units) {
  if (!clients.find(c => c.nic === u.nic)) clients.push({
    nic: u.nic, name: u.client_name, father: u.father_or_spouse,
    cell: u.cell, address: u.address,
  });
}

// ---- emit ------------------------------------------------------------------
const L = [];
const P = s => L.push(s);

P(`-- FMH backfill: ${units.length} sales / ${allSched.filter(r => !SKIP.has(r.unit)).length} installments`);
P(`-- Generated ${new Date().toISOString()} by migration_work/fmh_backfill_gen.js`);
P(`-- MF-57 deliberately EXCLUDED (already live as SAL-2026-0009).`);
P(`-- NO receipts/payments are created. Schedule rows are DUE dates only.`);
P('');
P('BEGIN;');
P('');
P('-- Guard: refuse to run against the wrong tenant ------------------------------');
P(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id='${CO}' AND company_code='fmh') THEN
    RAISE EXCEPTION 'guard: company ${CO} is not FMH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id='${PROJ}' AND company_id='${CO}') THEN
    RAISE EXCEPTION 'guard: project ${PROJ} does not belong to FMH';
  END IF;
END $$;`);
P('');
P('-- Rollback aid: snapshot the unit statuses we are about to flip -------------');
P(`CREATE TABLE IF NOT EXISTS fmh_backfill_unit_status_backup_20260729 AS
SELECT id, unit_no, status_id FROM units
WHERE project_id='${PROJ}' AND unit_no IN (${units.map(u => q(u.unit)).join(',')});`);
P('');

// ---- 0. MF-57 schedule correction -----------------------------------------
// SAL-2026-0009 was created in-app with an even-split plan: right net total,
// wrong shape (22nd not 6th, 150,002 not 150,000, no annual lumps, a possession
// balloon 2 months past contract end). Zero payments exist, so the rows can be
// rebuilt from the booking record. Sale header / client / unit / net untouched.
// Keeps the APP convention (installment_number 0 + 'down_payment' for the
// booking row) because sales.js FIFO and record_payment both key off it.
const mf57 = allSched.filter(r => r.unit === 'MF-57').sort((a, b) => +a.sno - +b.sno);
const mf57Rows = mf57.map(r => {
  const n = +r.sno - 1;                       // sno 1 -> installment_number 0
  const typ = n === 0 ? 'down_payment' : 'installment';
  return `(${n},DATE '${r.due_date}',${Number(r.amount_pkr).toFixed(2)},${q(r.description)},${q(typ)})`;
});
const mf57Count = mf57Rows.length - 1;        // installment_count excludes the down_payment row
const mf57Sum = mf57.reduce((a, r) => a + Number(r.amount_pkr), 0);

P('-- 0. MF-57 (SAL-2026-0009) schedule rebuilt from the booking record --------');
P(`CREATE TABLE IF NOT EXISTS fmh_mf57_installments_backup_20260729 AS
SELECT i.* FROM installments i JOIN sales s ON s.id=i.sale_id
WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';`);
P('');
P(`DO $mf57$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM payments p JOIN sales s ON s.id=p.sale_id
   WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % payment(s) exist, refusing to rebuild schedule', v; END IF;

  SELECT count(*) INTO v FROM installments i JOIN sales s ON s.id=i.sale_id
   WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009'
     AND (i.amount_paid <> 0 OR i.related_payment_id IS NOT NULL);
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % installment(s) carry money', v; END IF;

  SELECT count(*) INTO v FROM payment_promises pp
   JOIN installments i ON i.id=pp.installment_id JOIN sales s ON s.id=i.sale_id
   WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % payment promise(s) linked', v; END IF;
END $mf57$;`);
P('');
P(`DELETE FROM installments i USING sales s
WHERE i.sale_id = s.id AND s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';`);
P('');
P(`INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '${CO}','${PROJ}', s.id, v.n, v.d, v.a, 0, v.typ, 'pending', v.lbl
FROM sales s,
     (VALUES ${mf57Rows.join(',\n         ')}) AS v(n,d,a,lbl,typ)
WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';`);
P('');
P(`UPDATE sales SET installment_count=${mf57Count}
WHERE company_id='${CO}' AND sale_number='SAL-2026-0009';`);
P('');

P('-- 1. CLIENTS (idempotent on the (company,project,cnic) unique) -------------');
let seq = 156;
for (const c of clients) {
  seq += 1;
  P(`INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '${CO}','${PROJ}',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\\D','','g'),'')::int)
          FROM clients WHERE company_id='${CO}' AND project_id='${PROJ}' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       ${q(c.name)}, ${q(c.father)}, ${q(c.nic)}, ${q(c.cell)}, ${q(c.cell)}, ${q(c.address)},
       'Pakistan','active',${q(STAMP)}
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='${CO}' AND project_id='${PROJ}' AND cnic=${q(c.nic)});`);
}
P('');

P('-- 2. SALES (idempotent: skipped if the unit already carries a live sale) ----');
for (const u of units) {
  const { area, rate, discount } = price(u.unit, Number(u.sale_value_pkr));
  const n = schedOf(u.unit).length;
  P(`INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '${CO}','${PROJ}','BKG-${u.booking_id}', u.id, c.id,
       ${rate.toFixed(2)}, ${area.toFixed(2)}, ${discount.toFixed(2)}, 0, ${n},
       'active', DATE ${q(u.booking_date)}, 'installment', 0, ${q(STAMP)}
FROM units u
JOIN clients c ON c.company_id='${CO}' AND c.project_id='${PROJ}' AND c.cnic=${q(u.nic)}
WHERE u.project_id='${PROJ}' AND u.unit_no=${q(u.unit)}
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');`);
}
P('');

P('-- 3. INSTALLMENTS (due dates only; amount_paid stays 0, status pending) ----');
for (const u of units) {
  const rows = schedOf(u.unit);
  const vals = rows.map(r => `(${r.sno},DATE '${r.due_date}',${Number(r.amount_pkr).toFixed(2)},${q(r.description)})`).join(',\n         ');
  P(`INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '${CO}','${PROJ}', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES ${vals}) AS v(n,d,a,lbl)
WHERE s.company_id='${CO}' AND s.sale_number='BKG-${u.booking_id}'
ON CONFLICT (sale_id, installment_number) DO NOTHING;`);
}
P('');

P('-- 4. Flip the backfilled units Available -> Sold ---------------------------');
P(`UPDATE units SET status_id='${SOLD}'
WHERE project_id='${PROJ}' AND status_id='${AVAIL}'
  AND unit_no IN (${units.map(u => q(u.unit)).join(',')});`);
P('');

P('-- 5. VERIFY — any failure aborts the whole transaction ---------------------');
const expSales = units.length;
const expInst = units.reduce((a, u) => a + schedOf(u.unit).length, 0);
const expTotal = units.reduce((a, u) => a + Number(u.sale_value_pkr), 0);
P(`DO $$
DECLARE
  v_sales int; v_inst int; v_total numeric; v_bad int; v_pay int; v_avail int;
BEGIN
  SELECT count(*), COALESCE(sum(net_amount),0) INTO v_sales, v_total
    FROM sales WHERE company_id='${CO}' AND sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')});
  IF v_sales <> ${expSales} THEN RAISE EXCEPTION 'a) sales=% expected ${expSales}', v_sales; END IF;
  IF v_total <> ${expTotal} THEN RAISE EXCEPTION 'b) net total=% expected ${expTotal}', v_total; END IF;

  SELECT count(*) INTO v_inst FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')});
  IF v_inst <> ${expInst} THEN RAISE EXCEPTION 'c) installments=% expected ${expInst}', v_inst; END IF;

  -- every sale's schedule must sum to its own net_amount
  SELECT count(*) INTO v_bad FROM (
    SELECT s.id FROM sales s JOIN installments i ON i.sale_id=s.id
    WHERE s.company_id='${CO}' AND s.sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')})
    GROUP BY s.id, s.net_amount HAVING sum(i.amount_due) <> s.net_amount) x;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'd) % sale(s) whose schedule != net_amount', v_bad; END IF;

  -- HARD RULE: nothing received
  SELECT count(*) INTO v_pay FROM payments p JOIN sales s ON s.id=p.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')});
  IF v_pay <> 0 THEN RAISE EXCEPTION 'e) % payment row(s) created - must be 0', v_pay; END IF;

  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')})
      AND (i.amount_paid <> 0 OR i.status <> 'pending');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'f) % installment(s) marked paid - must be 0', v_bad; END IF;

  -- no unit left Available, no negative discount, no double-sold unit
  SELECT count(*) INTO v_avail FROM units
    WHERE project_id='${PROJ}' AND unit_no IN (${units.map(u => q(u.unit)).join(',')}) AND status_id='${AVAIL}';
  IF v_avail <> 0 THEN RAISE EXCEPTION 'g) % unit(s) still Available', v_avail; END IF;

  SELECT count(*) INTO v_bad FROM sales
    WHERE company_id='${CO}' AND sale_number IN (${units.map(u => `'BKG-${u.booking_id}'`).join(',')}) AND discount < 0;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'h) % sale(s) with negative discount', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT unit_id FROM sales WHERE company_id='${CO}' AND status <> 'cancelled'
    GROUP BY unit_id HAVING count(*) > 1) x;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'i) % double-sold unit(s)', v_bad; END IF;

  -- MF-57 rebuild must land on the booking record exactly
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';
  IF v_bad <> ${mf57Rows.length} THEN RAISE EXCEPTION 'j) MF-57 has % rows, expected ${mf57Rows.length}', v_bad; END IF;

  SELECT COALESCE(sum(i.amount_due),0) INTO v_total FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009';
  IF v_total <> ${mf57Sum} THEN RAISE EXCEPTION 'k) MF-57 schedule=% expected ${mf57Sum}', v_total; END IF;

  SELECT count(*) INTO v_bad FROM sales s
    WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009'
      AND s.net_amount <> (SELECT sum(i.amount_due) FROM installments i WHERE i.sale_id=s.id);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'l) MF-57 schedule != its own net_amount'; END IF;

  -- every MF-57 due date must fall on the 6th (booking-record day), and none may carry money
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009'
      AND (EXTRACT(DAY FROM i.due_date) <> 6 OR i.amount_paid <> 0 OR i.status <> 'pending');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'm) % MF-57 row(s) off the 6th or carrying money', v_bad; END IF;

  -- the three annual lumps must exist
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='${CO}' AND s.sale_number='SAL-2026-0009' AND i.amount_due=400000;
  IF v_bad <> 3 THEN RAISE EXCEPTION 'n) MF-57 has % annual lump(s), expected 3', v_bad; END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: % sales, % installments, net %', v_sales, v_inst, v_total;
END $$;`);
P('');
P(COMMIT ? 'COMMIT;' : 'ROLLBACK;  -- dry run');

const out = path.join(__dirname, COMMIT ? 'fmh_backfill_commit.sql' : 'fmh_backfill_dryrun.sql');
fs.writeFileSync(out, L.join('\n') + '\n', 'utf8');
console.log(`wrote ${out}`);
console.log(`  sales        : ${expSales}`);
console.log(`  installments : ${expInst}`);
console.log(`  new clients  : up to ${clients.length} (existing CNICs are skipped)`);
console.log(`  net total    : PKR ${expTotal.toLocaleString('en-US')}`);
console.log(`  ends with    : ${COMMIT ? 'COMMIT' : 'ROLLBACK'}`);
