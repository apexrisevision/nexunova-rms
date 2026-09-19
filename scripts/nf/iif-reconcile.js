#!/usr/bin/env node
/**
 * NexuFinance — IIF export, Part 3: per-account post-import reconciliation.
 *
 *   node scripts/nf/iif-reconcile.js <qb_general_journal.iif> [--company <uuid>] [--tolerance <rupees>]
 *
 * Compares NexuFinance's own live per-account balances against a fresh
 * QuickBooks General Journal export, ONE ROW PER COA CODE — both
 * figures and the difference. Deliberately not the retired
 * `reconciliations` table's shape (two numbers, cash and bank only) —
 * the owner's own instruction: that shape was wrong, this doesn't
 * repeat it. Every account either system has ANY balance in gets a row,
 * not just the ones that happen to differ.
 *
 * Reads the SAME TRNS/SPL IIF transaction format iif-export.js writes
 * (confirmed against real ground truth, docs/PLAN.md §25/26): ACCNT is
 * the account's full colon-path, AMOUNT is signed (positive = debit,
 * negative = credit). Sums every TRNS/SPL row's amount per account path
 * — this is a real general-journal transaction export, not a summary
 * report, so every line contributes.
 *
 * Matches by colon-PATH, not by our internal 5-digit code — the whole
 * point of reconciling against an external system is not trusting our
 * own code as the join key. An account only in one system (added here,
 * not yet in QuickBooks, or vice versa) still gets a row, with the
 * other side blank, not silently skipped.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
function flag(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const COMPANY = flag('company', AWAMI);
const TOLERANCE = Number(flag('tolerance', '0.01'));

if (!file) {
  console.error('usage: node scripts/nf/iif-reconcile.js <qb_general_journal.iif> [--company <uuid>] [--tolerance <rupees>]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error(`not found: ${file}`); process.exit(2); }

function parseTrnsSpl(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('TRNS\t') && !line.startsWith('SPL\t')) continue;
    const f = line.split('\t');
    // TRNS/SPL layout confirmed against docs/reference/Awami_Entries_
    // import.iif's own header row: kind(0) id(1) TRNSTYPE(2) DATE(3)
    // ACCNT(4) NAME(5) CLASS(6) AMOUNT(7) DOCNUM(8) MEMO(9)
    rows.push({ accnt: f[4], amount: Number(f[7]) || 0, docnum: f[8] });
  }
  return rows;
}

(async () => {
  const text = fs.readFileSync(file, 'utf8');
  if (!/^!TRNS/m.test(text)) {
    console.error('not a TRNS/SPL general journal IIF export (no !TRNS header)');
    process.exit(2);
  }
  const rows = parseTrnsSpl(text);
  console.log(`[iif-reconcile] ${path.basename(file)} · ${rows.length} transaction line(s) parsed`);

  const qbByPath = new Map();
  for (const r of rows) {
    qbByPath.set(r.accnt, (qbByPath.get(r.accnt) || 0) + r.amount);
  }

  const nfRows = await q(`
    WITH RECURSIVE up AS (
      SELECT code, code AS leaf_code, name, parent_code, 0 AS depth FROM nf_accounts WHERE company_id='${COMPANY}'
      UNION ALL
      SELECT a.code, up.leaf_code, a.name, a.parent_code, up.depth+1 FROM nf_accounts a JOIN up ON a.code=up.parent_code WHERE a.company_id='${COMPANY}' AND up.depth<20
    ), paths AS (SELECT leaf_code, string_agg(name, ':' ORDER BY depth DESC) AS full_path FROM up GROUP BY leaf_code)
    SELECT a.code, p.full_path,
           COALESCE((SELECT sum(l.debit - l.credit) FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id=l.voucher_id
                      WHERE v.status='POSTED' AND l.company_id=a.company_id AND l.account_code=a.code), 0) AS nf_balance
      FROM nf_accounts a JOIN paths p ON p.leaf_code = a.code
     WHERE a.company_id='${COMPANY}'
     ORDER BY a.code`);

  const nfByPath = new Map(nfRows.map(r => [r.full_path, { code: r.code, balance: Number(r.nf_balance) }]));
  const allPaths = new Set([...qbByPath.keys(), ...nfByPath.keys()]);

  const report = [];
  for (const p of allPaths) {
    const nf = nfByPath.get(p);
    const qb = qbByPath.has(p) ? qbByPath.get(p) : null;
    const nfBal = nf ? nf.balance : null;
    const diff = (nfBal !== null && qb !== null) ? Math.round((nfBal - qb) * 100) / 100 : null;
    report.push({ code: nf ? nf.code : '(not in nf_accounts)', path: p, nf_balance: nfBal, qb_balance: qb, difference: diff });
  }
  report.sort((a, b) => Math.abs(b.difference || 0) - Math.abs(a.difference || 0) || (a.code < b.code ? -1 : 1));

  console.log('\ncode      difference    nf_balance    qb_balance    path');
  for (const r of report) {
    const flag = r.difference === null ? '  ?  ' : (Math.abs(r.difference) > TOLERANCE ? '⚠ DIFF' : '  ok ');
    console.log(`${r.code.padEnd(9)} ${flag.padEnd(7)} ${fmt(r.nf_balance).padStart(13)} ${fmt(r.qb_balance).padStart(13)}  ${r.path}`);
  }

  const real = report.filter(r => r.difference !== null && Math.abs(r.difference) > TOLERANCE);
  const onlyNf = report.filter(r => r.qb_balance === null);
  const onlyQb = report.filter(r => r.nf_balance === null);
  console.log(`\n${report.length} account(s) compared · ${real.length} real difference(s) > ${TOLERANCE} · ${onlyNf.length} only in NexuFinance · ${onlyQb.length} only in the QuickBooks export`);
  process.exitCode = real.length ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message); process.exitCode = 2; });

function fmt(n) { return n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
