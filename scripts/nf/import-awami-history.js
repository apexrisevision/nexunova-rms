#!/usr/bin/env node
/**
 * NexuFinance — one-time import of Awami's real QuickBooks history into
 * the live double-entry ledger. Source: docs/reference/Awami_Closing_All_
 * Entries.xlsx, "Entries" sheet — 64 vouchers / 154 real lines (the 155th
 * row is a blank "Total" footer, excluded explicitly by predicate — no
 * voucher, no account — not by row count).
 *
 * One import, not the Excel's own 15-Sep/16-Sep presentation split
 * (owner, 2026-09-18): every voucher posts on its own real date;
 * QuickBooks itself has never had that split and splitting it here would
 * make the reconciliation permanently non-zero.
 *
 * Attribution (owner, 2026-09-18, after being asked): NOT a real
 * director's account — these 64 vouchers were posted in QuickBooks over
 * months, not hand-keyed by a person in one sitting, and the audit trail
 * should say what actually happened. Posted as a dedicated, clearly
 * non-human "Historical Import (system)" account (import@awami.internal,
 * sign-in disabled via a 100-year ban, minimum accountant role, created
 * separately before this script ran — see docs/PLAN.md §14). Every
 * voucher's narration carries an explicit "Imported from QuickBooks
 * history" marker for the same reason — obvious on the face of the
 * record without inspecting who posted it.
 *
 * Whole import is ONE database transaction: party creation + all 64
 * nf_post_voucher calls + the owner's own 8-figure trial-balance
 * checksum, checked BEFORE committing. A checksum mismatch RAISEs inside
 * the same transaction, which rolls back everything — no partial import
 * is possible, and nothing is adjusted to force a match.
 *
 *   node scripts/nf/import-awami-history.js
 */
'use strict';
const fs = require('fs');
const XLSX = require('xlsx');
const { q } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const SYSTEM_USER = fs.readFileSync(__dirname + '/_import_system_user_id.txt', 'utf8').trim();
const IMPORT_MARKER = 'Imported from QuickBooks history, 2026-09-18';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function isoFromDisplay(disp) {
  const m = String(disp).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) throw new Error('unparseable date: ' + disp);
  const [, d, mon, yy] = m;
  if (!(mon in MONTHS)) throw new Error('unknown month: ' + mon);
  return new Date(Date.UTC(2000 + Number(yy), MONTHS[mon], Number(d))).toISOString().slice(0, 10);
}
function num(v) { return v == null ? 0 : (typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))); }
function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function sqlNum(n) { if (!Number.isFinite(n)) throw new Error('not a finite number: ' + n); return String(n); }

const PARTY_BY_CODE = { '12610': 'Syed Yousaf Shah', '12620': 'Naeem Hussain', '22100': 'FMH', '22200': 'KBH' };
const FIXED_PARTIES = [
  ['FMH', 'sister_company'], ['KBH', 'sister_company'],
  ['Syed Yousaf Shah', 'director'], ['Naeem Hussain', 'director'],
];

(async () => {
  // ── 1. parse and validate the source, exactly as checked interactively ──
  const wbDisplay = XLSX.readFile('docs/reference/Awami_Closing_All_Entries.xlsx', { raw: false });
  const wbSerial = XLSX.readFile('docs/reference/Awami_Closing_All_Entries.xlsx', { raw: true });
  const rowsDisplay = XLSX.utils.sheet_to_json(wbDisplay.Sheets['Entries'], { header: 1, defval: null, raw: false });
  const rowsSerial = XLSX.utils.sheet_to_json(wbSerial.Sheets['Entries'], { header: 1, defval: null, raw: true });
  const header = rowsDisplay[0];
  if (header.join('|') !== 'Voucher|Date|Account|COA code|Name|Class|Debit|Credit|Memo|Closing') {
    throw new Error('Entries sheet header changed, re-check column order: ' + header.join('|'));
  }

  const rows = [];
  for (let i = 1; i < rowsDisplay.length; i++) {
    const r = rowsDisplay[i];
    if (!r[0]) continue; // the blank "Total" footer row — excluded by predicate (no voucher), not by count
    const isoA = isoFromDisplay(r[1]);
    const serial = rowsSerial[i][1];
    const isoB = new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
    if (isoA !== isoB) throw new Error(`date mismatch row ${i}: display says ${isoA}, serial says ${isoB}`);
    rows.push({ voucher: r[0], date: isoA, code: String(r[3]), name: r[4], klass: r[5],
      debit: num(r[6]), credit: num(r[7]), memo: r[8] });
  }
  console.log(`parsed ${rows.length} lines (expected 154)`);
  if (rows.length !== 154) throw new Error(`expected 154 lines, got ${rows.length} — STOP, do not proceed`);

  const byVoucher = {};
  for (const r of rows) (byVoucher[r.voucher] = byVoucher[r.voucher] || []).push(r);
  const voucherNos = Object.keys(byVoucher);
  console.log(`grouped into ${voucherNos.length} vouchers (expected 64)`);
  if (voucherNos.length !== 64) throw new Error(`expected 64 vouchers, got ${voucherNos.length} — STOP, do not proceed`);

  // Real discrepancy, found and checked against the owner's own QuickBooks
  // reconciliation before touching anything: 3 of 64 vouchers (JV-0007,
  // JV-0009, JV-0011) don't balance in the Entries sheet as written —
  // 21100's own credit column here totals 3,530,009, not the 3,530,000
  // the owner already reconciled exactly against the live QuickBooks
  // General Journal. QuickBooks holds each of these three as a single
  // exact lump sum against 21100 (500,000 / 600,000 / 800,000); the
  // Entries sheet's per-unit breakdown is a later allocation of that
  // lump sum across units, and it rounded every unit's share UP, with
  // nothing absorbing the resulting excess (owner: "the lump sum is the
  // fact; the per-unit breakdown is an allocation").
  //
  // Fixed here, deterministically, not by hand-picking a unit: largest-
  // remainder allocation. base = floor(lump / n); the shortfall
  // (lump - base*n) is distributed as +1 rupee each to the FIRST that
  // many units in the sheet's own row order — never more than 1 rupee
  // from an even share, same result the owner's own worked example
  // gives (500,000 across 9 -> four units at 55,555, five at 55,556).
  // No income/rounding leg is created — no income was earned; the
  // company received the lump sum and owes the lump sum.
  for (const [v, legs] of Object.entries(byVoucher)) {
    if (legs.length < 2) throw new Error(`${v}: fewer than 2 legs`);
    let d = legs.reduce((s, r) => s + r.debit, 0), c = legs.reduce((s, r) => s + r.credit, 0);
    if (Math.round((d - c) * 100) !== 0) {
      const lumpLegs = legs.filter(r => r.debit > 0), splitLegs = legs.filter(r => r.credit > 0);
      const lumpSide = lumpLegs.length === 1 ? lumpLegs : (splitLegs.length === 1 ? splitLegs : null);
      const otherSide = lumpSide === lumpLegs ? splitLegs : lumpLegs;
      const lumpAmount = lumpSide ? (lumpSide[0].debit || lumpSide[0].credit) : null;
      const allEqual = otherSide.length > 1 && otherSide.every(r => (r.debit || r.credit) === (otherSide[0].debit || otherSide[0].credit));
      const diff = Math.round((d - c) * 100) / 100;
      if (!lumpSide || lumpSide.length !== 1 || !allEqual || Math.abs(diff) > otherSide.length) {
        throw new Error(`${v}: debit ${d} != credit ${c} (diff ${diff}) and doesn't match the known lump-sum/even-split pattern — STOP, do not proceed`);
      }
      const n = otherSide.length;
      const base = Math.floor(lumpAmount / n);
      const shortfall = lumpAmount - base * n;
      otherSide.forEach((r, i) => {
        const share = base + (i < shortfall ? 1 : 0);
        if (r.debit > 0) r.debit = share; else r.credit = share;
        r.memo = `${r.memo} [unit share adjusted from an equal split of ${lumpAmount} across ${n} units to largest-remainder, so the voucher balances exactly to the amount actually received — see docs/PLAN.md §14]`;
      });
      console.log(`  ${v}: reallocated ${n} legs (lump ${lumpAmount}, was off by ${-diff}) via largest-remainder`);
      d = legs.reduce((s, r) => s + r.debit, 0); c = legs.reduce((s, r) => s + r.credit, 0);
      if (Math.round((d - c) * 100) !== 0) throw new Error(`${v}: still unbalanced after reallocation — STOP, do not proceed`);
    }
    for (const r of legs) {
      if ((r.debit > 0) === (r.credit > 0)) throw new Error(`${v}: a leg has both/neither debit and credit`);
    }
  }
  console.log('every voucher balances (3 vouchers required the largest-remainder reallocation above), every leg has exactly one of debit/credit — confirmed, not assumed');

  // ── 2. floors: validated against the live table, not assumed ────────────
  const floorRows = await q(`select code, qb_class from nf_floors where company_id=${sqlStr(AWAMI)}`);
  const floorByClass = {};
  for (const f of floorRows) { floorByClass[f.code] = f.code; floorByClass[f.qb_class] = f.code; }
  for (const r of rows) if (!(r.klass in floorByClass)) throw new Error(`unknown Class "${r.klass}" — no matching floor for Awami`);

  // ── 3. accounts: every COA code must already exist for Awami (already
  //    reconciled 110/110 against the real QuickBooks export, §11.11) ─────
  const codes = [...new Set(rows.map(r => r.code))];
  const acctRows = await q(`select code from nf_accounts where company_id=${sqlStr(AWAMI)} and code = ANY(ARRAY[${codes.map(sqlStr).join(',')}])`);
  const knownCodes = new Set(acctRows.map(a => a.code));
  const missingCodes = codes.filter(c => !knownCodes.has(c));
  if (missingCodes.length) throw new Error(`COA codes not found for Awami: ${missingCodes.join(', ')}`);

  // ── 4. parties: the 4 fixed ones the owner named explicitly, plus every
  //    distinct token customer (the PERSON only — "Haji Ibrar:LG-01" and
  //    "Haji Ibrar:LG-02" are the same customer across two units, not two
  //    parties; the unit goes in the leg's own memo, already present in
  //    the source Memo text) ───────────────────────────────────────────
  const tokenCustomers = [...new Set(rows.filter(r => r.code === '21100').map(r => r.name.split(':')[0].trim()))].sort();
  console.log(`${tokenCustomers.length} distinct token customers (person, not per-unit):`, tokenCustomers.join(', '));
  const allParties = [...FIXED_PARTIES, ...tokenCustomers.map(n => [n, 'customer'])];

  // ── 5. build the whole import as ONE transaction: party creation, then
  //    every voucher, then the owner's own checksum — a mismatch RAISEs
  //    and rolls back everything, nothing partial is ever left behind ───
  const partySql = allParties.map(([name, kind]) =>
    `(${sqlStr(name)}, (public.nf_create_party(${sqlStr(AWAMI)}::uuid, ${sqlStr(name)}, ${sqlStr(kind)})->>'id')::uuid)`
  ).join(',\n    ');

  const voucherSql = voucherNos.map((vno, vi) => {
    const legs = byVoucher[vno];
    const legsSql = legs.map(r => {
      const partyName = PARTY_BY_CODE[r.code] || (r.code === '21100' ? r.name.split(':')[0].trim() : null);
      const partyExpr = partyName
        ? `(SELECT id FROM _import_parties WHERE name = ${sqlStr(partyName)})::text`
        : 'NULL';
      return `jsonb_build_object('account_code', ${sqlStr(r.code)}, 'floor_code', ${sqlStr(floorByClass[r.klass])}, ` +
        `'party_id', ${partyExpr}, 'debit', ${sqlNum(r.debit)}, 'credit', ${sqlNum(r.credit)}, ` +
        `'memo', ${r.memo ? sqlStr(r.memo) : 'NULL'})`;
    }).join(',\n      ');
    return `SELECT public.nf_post_voucher(${sqlStr(AWAMI)}::uuid, NULL, ${sqlStr(vno)}, ${sqlStr(byVoucher[vno][0].date)}::date, ` +
      `${sqlStr(IMPORT_MARKER)}, ${vi + 1},\n    jsonb_build_array(\n      ${legsSql}\n    ));`;
  }).join('\n\n');

  // the owner's own checksum — QuickBooks-reconciled figures, checked
  // as an ALL-TIME trial balance (no date filter: this is the complete,
  // final position after every voucher above), inside the same
  // transaction, RAISE on any mismatch so the whole thing rolls back.
  const checksum = [
    ['12610', 7660900, 'debit'], ['22100', -20124450, 'net'], ['22200', -6549500, 'net'],
    ['21100', -3280000, 'net'], ['15300', 130000, 'debit'], ['16100', 488000, 'debit'], ['70100', 50000, 'debit'],
  ];
  const checksumSql = checksum.map(([code, expected]) => {
    const actualExpr = `(SELECT COALESCE(sum(debit - credit), 0) FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${sqlStr(AWAMI)}::uuid AND v.status = 'POSTED' AND l.account_code = ${sqlStr(code)})`;
    return `  v_actual := ${actualExpr};\n` +
      `  IF round(v_actual * 100) <> round(${sqlNum(expected)} * 100) THEN\n` +
      `    RAISE EXCEPTION 'CHECKSUM_MISMATCH: % expected % got %', ${sqlStr(code)}, ${sqlNum(expected)}, v_actual;\n` +
      `  END IF;\n` +
      `  RAISE NOTICE 'checksum ok: % = %', ${sqlStr(code)}, v_actual;`;
  }).join('\n');

  // NOT "SET LOCAL ROLE authenticated" here — nf_create_party (like every
  // other party/read function locked down in 20260918n) correctly has no
  // EXECUTE grant for the authenticated role at all, since nothing calls
  // it directly except this kind of controlled, privileged import channel.
  // Running as whatever privileged role the Management API itself uses
  // (postgres) bypasses that ACL check entirely, the same way applying a
  // migration does — but auth.uid() still resolves correctly from the
  // request.jwt.claims GUC below regardless of which role is running, so
  // nf_require_role's REAL internal membership/role check (not the ACL
  // grant) still enforces exactly what it should: this call only
  // succeeds because the system import account really is an Awami
  // accountant member. Every table trigger (the balance/position guards)
  // fires unconditionally regardless of role either way - nothing here
  // is bypassing the invariants those enforce, only the RPC-layer ACL
  // that end users go through and this channel deliberately doesn't.
  const fullSql = `
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"${SYSTEM_USER}","role":"authenticated"}', true);

CREATE TEMP TABLE _import_parties (name text PRIMARY KEY, id uuid);
INSERT INTO _import_parties (name, id) VALUES
    ${partySql};

${voucherSql}

DO $verify$
DECLARE v_actual numeric;
BEGIN
${checksumSql}
  RAISE NOTICE 'ALL 7 CHECKSUM FIGURES MATCH — import correct';
END
$verify$;

COMMIT;
`.trim();

  fs.writeFileSync(__dirname + '/_import_awami_generated.sql', fullSql);
  console.log(`\ngenerated SQL: ${fullSql.length} bytes, ${voucherNos.length} vouchers, ${allParties.length} parties`);

  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run: wrote scripts/nf/_import_awami_generated.sql, NOT executed against live.');
    return;
  }
  console.log('running the import as one transaction now...\n');

  try {
    const result = await q(fullSql);
    console.log('IMPORT SUCCEEDED. Server output:');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('\nIMPORT FAILED AND WAS ROLLED BACK — nothing was written:');
    console.error(e.message);
    process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
