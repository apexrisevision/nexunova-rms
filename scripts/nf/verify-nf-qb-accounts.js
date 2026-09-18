#!/usr/bin/env node
/**
 * NexuFinance — reconcile nf_accounts against a real QuickBooks IIF chart
 * export, by full colon-path (IIF's ACCNT NAME is the full path, not a leaf
 * name — proven once, 2026-09-18, against docs/reference/QB_COA_Awami.IIF*,
 * see docs/PLAN.md §11.11).
 *
 *   node scripts/nf/verify-nf-qb-accounts.js <chart.iif> [--company <uuid>]
 *
 * Deliberately separate from scripts/verify-qb-accounts.js, which checks
 * qb_accounts — a different, unrelated, retired RMS-financials-module
 * table (4-digit numbers, zero writers ever). nf_accounts is 5-digit and
 * lives in a different world; conflating the two tools would misreport
 * both.
 *
 * HIDDEN=Y accounts in the real file are reported separately and never
 * counted as a failure — an account QuickBooks itself has switched off is
 * expected to be absent from nf_accounts, not a gap to fill. Found the
 * hard way once already: 10400/10410/10420 ("Cash with Directors") are
 * real rows in the client's file, HIDDEN=Y, superseded by
 * 12600/12610/12620 — a naive re-run that didn't know this would report
 * them as missing and risk being "fixed" by adding back the exact bug
 * ("director cash treated as company cash") this task's own brief cites
 * as already corrected once.
 *
 * Exit (via process.exitCode): 0 clean · 1 real differences found · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const ci = args.indexOf('--company');
const COMPANY = ci >= 0 ? args[ci + 1] : AWAMI;

if (!file) {
  console.error('usage: node scripts/nf/verify-nf-qb-accounts.js <chart.iif> [--company <uuid>]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error(`not found: ${file}`); process.exit(2); }

// Owner, 2026-09-18: 10400/10410/10420 ("Cash with Directors") are retired
// — replaced by 12600/12610/12620, the correction this task's own brief
// cites (director cash is a receivable, never company cash). Only the two
// children carry HIDDEN=Y in the raw file; the parent (10400) does not —
// QuickBooks apparently won't hide a parent while a child still has
// history, or nobody bothered. Grouped explicitly here so the parent gets
// the same "expected absent" treatment as its children, not just whichever
// rows happen to carry the flag literally.
const KNOWN_RETIRED = new Set(['10400', '10410', '10420']);

function parseIif(text) {
  const lines = text.split(/\r?\n/).filter(l => l.startsWith('ACCNT\t'));
  return lines.map(line => {
    const f = line.split('\t');
    let name = f[1];
    if (name && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
    return { name, type: f[4], accnum: f[7], hidden: (f[11] || '').toUpperCase() === 'Y' };
  });
}

(async () => {
  const text = fs.readFileSync(file, 'utf8');
  if (!/^!(ACCNT|HDR)/m.test(text)) {
    console.error('not an IIF chart-of-accounts export (no !ACCNT/!HDR header)');
    process.exit(2);
  }
  const qb = parseIif(text);
  console.log(`[verify-nf-qb-accounts] file ${path.basename(file)} · company ${COMPANY}`);
  console.log(`  parsed ${qb.length} account(s) from the real export`);

  const nf = await q(`select code, nf_account_path('${COMPANY}'::uuid, code) as full_path, qb_type, active
                        from nf_accounts where company_id = '${COMPANY}' order by code`);
  console.log(`  parsed ${nf.length} account(s) from nf_accounts\n`);

  const qbByCode = new Map(qb.filter(a => a.accnum).map(a => [a.accnum, a]));
  const nfByCode = new Map(nf.map(a => [a.code, a]));
  const allCodes = new Set([...qbByCode.keys(), ...nfByCode.keys()]);

  let matched = 0, mismatched = [], onlyQbActive = [], onlyQbHidden = [], onlyNf = [];
  for (const code of [...allCodes].sort()) {
    const b = qbByCode.get(code), n = nfByCode.get(code);
    if (b && !n) { (b.hidden || KNOWN_RETIRED.has(code) ? onlyQbHidden : onlyQbActive).push({ code, name: b.name }); continue; }
    if (n && !b) { onlyNf.push({ code, path: n.full_path }); continue; }
    if (b.name !== n.full_path) mismatched.push({ code, qb: b.name, nf: n.full_path });
    else matched++;
  }

  console.log(`  exact match (code + full colon-path): ${matched}`);
  let problems = mismatched.length + onlyQbActive.length + onlyNf.length;

  if (mismatched.length) {
    console.log(`\n── NAME MISMATCH — the export would create a duplicate account (${mismatched.length})`);
    mismatched.forEach(m => console.log(`   ${m.code}  nf_accounts: "${m.nf}"  vs  QuickBooks: "${m.qb}"`));
  }
  if (onlyQbActive.length) {
    console.log(`\n── ACTIVE IN QUICKBOOKS, MISSING FROM nf_accounts — a real gap (${onlyQbActive.length})`);
    onlyQbActive.forEach(m => console.log(`   ${m.code}  "${m.name}"`));
  }
  if (onlyQbHidden.length) {
    console.log(`\n── HIDDEN=Y in QuickBooks, absent from nf_accounts — expected, not a failure (${onlyQbHidden.length})`);
    onlyQbHidden.forEach(m => console.log(`   ${m.code}  "${m.name}"`));
  }
  if (onlyNf.length) {
    console.log(`\n── IN nf_accounts, NOT IN QUICKBOOKS — the export would create these (${onlyNf.length})`);
    onlyNf.forEach(m => console.log(`   ${m.code}  "${m.path}"`));
  }

  console.log(problems ? `\n✗ ${problems} real difference(s) — see above.` : '\n✅ PASS — nf_accounts matches the real QuickBooks chart exactly.');
  process.exitCode = problems ? 1 : 0;
})().catch(e => { console.error('COULD NOT RUN —', e.message); process.exitCode = 2; });
