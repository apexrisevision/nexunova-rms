#!/usr/bin/env node
/**
 * NexuFinance — IIF export, Part 2: the pre-export validation gate + the
 * actual .iif file writer. Part 1 (export-state tracking, docs/PLAN.md
 * §25) is schema only; this is where a file actually gets generated.
 *
 *   node scripts/nf/iif-export.js <from> <to> --qb-chart <fresh_chart.iif> [--out <dir>] [--company <uuid>]
 *
 * DRY RUN ONLY. This script never calls nf_iif_record_batch — it reads
 * candidates (nf_iif_list_candidates), validates, and if everything
 * passes, writes the .iif file and a validation report. Marking those
 * vouchers as exported is a deliberately separate step
 * (scripts/nf/iif-record-batch.js), run only after the owner has looked
 * at the file and the validation output and says go — per the owner's
 * own instruction: "nothing gets imported into QuickBooks on your own
 * judgment."
 *
 * FORMAT, confirmed against real ground truth before writing a single
 * line of this — not assumed: docs/reference/Awami_Entries_import.iif's
 * own JV-0001 ("Token 102 received by FMH office - Cash" / "Token 102 -
 * unit GF-129", 2026-07-10) matches this project's own live
 * nf_voucher_legs for that exact voucher exactly, figure for figure.
 * That gives:
 *   - AMOUNT = debit - credit (positive = debit, negative = credit —
 *     the file's own FMH leg is debit 10000/credit 0 -> +10000.00; the
 *     Token Money leg is debit 0/credit 10000 -> -10000.00).
 *   - ACCNT = the account's full colon-path (QuickBooks' own hierarchy,
 *     same computation verify-nf-qb-accounts.js already uses).
 *   - NAME = the leg's party name, with ":unit-code" appended ONLY for
 *     21100 Token Money legs where a unit is identifiable from the memo
 *     (same "unit ([A-Za-z0-9-]+)" extraction as the Token Register,
 *     docs/PLAN.md §20 — confirmed reused correctly, not re-derived).
 *     Every other leg's NAME is the plain party name (or blank).
 *   - CLASS = the leg's floor's qb_class.
 *   - DOCNUM = the MANUAL (paper) voucher number where there is one, else
 *     voucher_no; the SYSTEM number (voucher_no) is appended to the first
 *     line's MEMO as "[NF CPV-000012]" (docs/PLAN.md §44). MEMO = the leg's
 *     own memo.
 *   - First leg -> TRNS, remaining legs -> SPL, then ENDTRNS.
 *
 * VALIDATION GATE — the file is not written unless ALL of these pass:
 *   1. every candidate voucher balances (debit=credit), checked directly
 *      against nf_voucher_legs, not assumed from nf_post_voucher's own
 *      enforcement at posting time — defence in depth, the whole point
 *      of a gate that runs again right before something leaves this
 *      system.
 *   2. every account CODE these vouchers' legs use has a full colon-path
 *      that byte-matches a FRESH QuickBooks chart file supplied via
 *      --qb-chart — never the cached docs/reference/QB_COA_Awami.IIF,
 *      which goes stale the moment someone renames an account by hand in
 *      QuickBooks (the owner's own words). Reuses the exact parsing/
 *      matching logic already proven in verify-nf-qb-accounts.js.
 *   3. no candidate voucher has a prior nf_iif_batch_vouchers row —
 *      nf_iif_list_candidates already excludes these, this re-checks it
 *      directly rather than trusting that query alone.
 *   4. every candidate voucher's own date falls inside [from, to] —
 *      re-checked directly rather than trusting the candidate query's
 *      own WHERE clause alone.
 *   5. every receipt/payment has its MANUAL voucher number, which is the
 *      DOCNUM QuickBooks receives (docs/PLAN.md §44).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { q } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [FROM, TO] = positional;
function flag(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const QB_CHART = flag('chart', flag('qb-chart'));
const OUT_DIR = flag('out', 'D:\\Claude Cowork');
const COMPANY = flag('company', AWAMI);
const AS_USER = flag('as');

if (!FROM || !TO || !QB_CHART || !AS_USER) {
  console.error('usage: node scripts/nf/iif-export.js <from YYYY-MM-DD> <to YYYY-MM-DD> --qb-chart <fresh_chart.iif> --as <accountant_or_director_user_id> [--out <dir>] [--company <uuid>]');
  console.error('  --as is required: nf_iif_list_candidates checks real membership/role, same as every other nf_ RPC, and needs to know who is asking, not run as an anonymous privileged connection.');
  process.exit(2);
}
if (!fs.existsSync(QB_CHART)) { console.error(`chart file not found: ${QB_CHART}`); process.exit(2); }

// This script runs over the Management API's privileged connection, not
// a real signed-in session — same channel import-awami-history.js uses,
// for the same reason (no separate login flow needed for an operational
// CLI tool). auth.uid() still resolves correctly from this GUC
// regardless of which role is actually running the query, so
// nf_require_role's real membership/role check still enforces exactly
// what it should: this only works because --as really is an accountant
// or director member of this company, not because the channel is
// privileged.
//
// set_config(..., true) is transaction-local, and q() is one HTTP
// request per call (scripts/_sbq.js — no session persists between
// calls), so the claim has to be set in the SAME statement batch as
// whatever role-gated RPC needs it, every single time — never as a
// separate earlier q() call, which would silently lose it.
function qAs(sql) {
  return q(`SELECT set_config('request.jwt.claims', '{"sub":"${AS_USER}","role":"authenticated"}', true); ${sql}`);
}

function parseIifChart(text) {
  const lines = text.split(/\r?\n/).filter(l => l.startsWith('ACCNT\t'));
  return lines.map(line => {
    const f = line.split('\t');
    let name = f[1];
    if (name && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
    return { name, accnum: f[7], hidden: (f[11] || '').toUpperCase() === 'Y' };
  });
}

function iifDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function iifField(s) {
  // IIF is tab-delimited; a field containing a tab or newline would
  // corrupt the row structure. None of this data should ever contain
  // one, but a memo is free text someone typed, so strip rather than
  // silently emit a broken file.
  return String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ').trim();
}

(async () => {
  console.log(`[iif-export] company ${COMPANY} · ${FROM} .. ${TO}`);
  const problems = [];

  // ── candidates ──────────────────────────────────────────────────────────
  const [{ nf_iif_list_candidates: candidates }] = await qAs(
    `SELECT public.nf_iif_list_candidates('${COMPANY}'::uuid, '${FROM}'::date, '${TO}'::date) AS nf_iif_list_candidates`
  );
  console.log(`  candidates: ${candidates.length} voucher(s)`);
  if (!candidates.length) {
    console.log('\nNo exportable vouchers in this range. Nothing to validate or write.');
    process.exitCode = 0;
    return;
  }
  const ids = candidates.map(c => `'${c.id}'`).join(',');

  // ── gate 1: every candidate voucher balances ──────────────────────────
  const unbalanced = await q(`
    SELECT v.voucher_no, sum(l.debit) d, sum(l.credit) c
      FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id
     WHERE l.voucher_id IN (${ids})
     GROUP BY v.voucher_no
    HAVING round(sum(l.debit) * 100) <> round(sum(l.credit) * 100)`);
  if (unbalanced.length) {
    problems.push(`GATE 1 FAILED — ${unbalanced.length} voucher(s) do not balance: ${unbalanced.map(u => `${u.voucher_no} (debit ${u.d} / credit ${u.c})`).join(', ')}`);
  } else {
    console.log('  gate 1 (every voucher balances): PASS');
  }

  // ── gate 2: every account code's colon-path matches the FRESH chart ──
  const chartText = fs.readFileSync(QB_CHART, 'utf8');
  if (!/^!(ACCNT|HDR)/m.test(chartText)) {
    problems.push(`GATE 2 FAILED — ${QB_CHART} is not a QuickBooks chart-of-accounts IIF export (no !ACCNT/!HDR header)`);
  } else {
    const qbAccounts = parseIifChart(chartText);
    const qbByCode = new Map(qbAccounts.filter(a => a.accnum).map(a => [a.accnum, a]));
    const nfPaths = await q(`
      WITH RECURSIVE up AS (
        SELECT DISTINCT a.code, a.code AS leaf_code, a.name, a.parent_code, 0 AS depth
          FROM nf_accounts a
          JOIN nf_voucher_legs l ON l.account_code = a.code AND l.voucher_id IN (${ids})
         WHERE a.company_id = '${COMPANY}'
        UNION ALL
        SELECT a.code, up.leaf_code, a.name, a.parent_code, up.depth + 1
          FROM nf_accounts a JOIN up ON a.code = up.parent_code
         WHERE a.company_id = '${COMPANY}' AND up.depth < 20
      ), paths AS (
        SELECT leaf_code, string_agg(name, ':' ORDER BY depth DESC) AS full_path FROM up GROUP BY leaf_code
      )
      SELECT leaf_code AS code, full_path FROM paths`);
    const nfByCode = new Map(nfPaths.map(a => [a.code, a.full_path]));
    const codeMismatches = [];
    for (const [code, fullPath] of nfByCode) {
      const qbAcct = qbByCode.get(code);
      if (!qbAcct) { codeMismatches.push(`${code} "${fullPath}" — not found in the fresh chart at all`); continue; }
      if (qbAcct.name !== fullPath) codeMismatches.push(`${code} — ours: "${fullPath}"  fresh QuickBooks: "${qbAcct.name}"`);
    }
    if (codeMismatches.length) {
      problems.push(`GATE 2 FAILED — ${codeMismatches.length} account(s) used in this batch don't byte-match the fresh chart:\n    ${codeMismatches.join('\n    ')}`);
    } else {
      console.log(`  gate 2 (every account name matches the fresh chart): PASS (${nfByCode.size} account(s) checked)`);
    }
  }

  // ── gate 3: none already exported ─────────────────────────────────────
  const [{ n: alreadyExported }] = await q(`SELECT count(*)::int n FROM nf_iif_batch_vouchers WHERE voucher_id IN (${ids})`);
  if (alreadyExported > 0) {
    problems.push(`GATE 3 FAILED — ${alreadyExported} candidate voucher(s) already have an export record (nf_iif_list_candidates should have excluded these — this is a defence-in-depth check catching a real bug if it fires)`);
  } else {
    console.log('  gate 3 (no candidate already exported): PASS');
  }

  // ── gate 4: every voucher's date is really inside the requested range ─
  const [{ n: outOfRange }] = await q(`SELECT count(*)::int n FROM nf_vouchers WHERE id IN (${ids}) AND (voucher_date < '${FROM}'::date OR voucher_date > '${TO}'::date)`);
  if (outOfRange > 0) {
    problems.push(`GATE 4 FAILED — ${outOfRange} candidate voucher(s) fall outside ${FROM}..${TO} (nf_iif_list_candidates should have excluded these)`);
  } else {
    console.log('  gate 4 (every voucher date is inside the requested range): PASS');
  }

  // ── gate 5: every receipt/payment has its manual number (docs/PLAN.md §44)
  // The manual (paper) number is the DOCNUM QuickBooks receives. The day
  // cannot close without it, but a voucher on a still-open day is a
  // candidate too — and one without it would reach QuickBooks under its
  // system number instead, silently.
  const pendingRows = await q(`SELECT voucher_no FROM nf_vouchers WHERE id IN (${ids}) AND manual_no IS NULL
      AND upper(split_part(voucher_no, '-', 1)) IN ('CRV','BRV','CPV','BPV') ORDER BY voucher_no`);
  if (pendingRows.length > 0) {
    problems.push(`GATE 5 FAILED — ${pendingRows.length} receipt/payment voucher(s) have no manual voucher number yet: ${pendingRows.map(r => r.voucher_no).join(', ')}`);
  } else {
    console.log('  gate 5 (every receipt/payment has its manual number): PASS');
  }

  if (problems.length) {
    console.log(`\n✗ VALIDATION FAILED — no file written.\n`);
    problems.forEach(p => console.log('  ' + p));
    process.exitCode = 1;
    return;
  }

  // ── all gates passed — build the file ─────────────────────────────────
  const legs = await q(`
    SELECT l.voucher_id, v.voucher_no, v.manual_no, v.voucher_date, l.line_no, l.debit, l.credit, l.memo, v.narration,
           a.code AS account_code, f.qb_class AS floor_class, pt.name AS party_name
      FROM nf_voucher_legs l
      JOIN nf_vouchers v ON v.id = l.voucher_id
      JOIN nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
      JOIN nf_floors f ON f.company_id = l.company_id AND f.code = l.floor_code
      LEFT JOIN nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.voucher_id IN (${ids})
     ORDER BY v.voucher_date, v.sort, v.created_at, l.line_no`);

  const pathRows = await q(`
    WITH RECURSIVE up AS (
      SELECT DISTINCT a.code, a.code AS leaf_code, a.name, a.parent_code, 0 AS depth
        FROM nf_accounts a
        JOIN nf_voucher_legs l ON l.account_code = a.code AND l.voucher_id IN (${ids})
       WHERE a.company_id = '${COMPANY}'
      UNION ALL
      SELECT a.code, up.leaf_code, a.name, a.parent_code, up.depth + 1
        FROM nf_accounts a JOIN up ON a.code = up.parent_code
       WHERE a.company_id = '${COMPANY}' AND up.depth < 20
    ), paths AS (
      SELECT leaf_code, string_agg(name, ':' ORDER BY depth DESC) AS full_path FROM up GROUP BY leaf_code
    )
    SELECT leaf_code AS code, full_path FROM paths`);
  const pathByCode = new Map(pathRows.map(r => [r.code, r.full_path]));

  const byVoucher = new Map();
  for (const l of legs) {
    if (!byVoucher.has(l.voucher_id)) byVoucher.set(l.voucher_id, []);
    byVoucher.get(l.voucher_id).push(l);
  }

  const HDR = ['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join('\t');
  const SPLHDR = ['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join('\t');
  const lines = [HDR, SPLHDR, '!ENDTRNS'];

  function nameFor(l) {
    if (l.account_code === '21100') {
      const unit = /unit ([A-Za-z0-9-]+)/.exec(l.memo || '');
      if (unit) return `${l.party_name || ''}:${unit[1]}`;
    }
    return l.party_name || '';
  }

  for (const [, voucherLegs] of byVoucher) {
    voucherLegs.forEach((l, i) => {
      const amount = (Number(l.debit) - Number(l.credit)).toFixed(2);
      const row = [
        i === 0 ? 'TRNS' : 'SPL', '', 'GENERAL JOURNAL', iifDate(l.voucher_date),
        iifField(pathByCode.get(l.account_code) || l.account_code), iifField(nameFor(l)), iifField(l.floor_class),
        // DOCNUM is the MANUAL (paper) number — owner, 2026-09-21: "manual
        // DOCNUM mai". The SYSTEM number rides in the first line's memo, so
        // the voucher can be found from QuickBooks too (docs/PLAN.md §44).
        // A voucher with no manual number (imported history, a transfer)
        // keeps its one number as DOCNUM, as before.
        amount, iifField(l.manual_no || l.voucher_no),
        iifField((l.memo || l.narration || '') + (i === 0 && l.manual_no ? ' [NF ' + l.voucher_no + ']' : '')),
      ].join('\t');
      lines.push(row);
    });
    lines.push('ENDTRNS');
  }
  const content = lines.join('\r\n') + '\r\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fileName = `NexuFinance_IIF_${FROM}_to_${TO}.iif`;
  const outPath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(outPath, content);
  const checksum = crypto.createHash('sha256').update(chartText).digest('hex').slice(0, 16);

  console.log(`\n✅ ALL GATES PASSED`);
  console.log(`  wrote ${outPath} (${candidates.length} voucher(s), ${legs.length} leg(s), ${(content.length / 1024).toFixed(1)} KB)`);
  console.log(`  qb_chart_file: ${path.basename(QB_CHART)}  qb_chart_checksum: ${checksum}`);
  console.log(`\nDRY RUN — no voucher has been marked exported. Review the file, then run:`);
  console.log(`  node scripts/nf/iif-record-batch.js ${FROM} ${TO} --file "${outPath}" --qb-chart "${QB_CHART}" --checksum ${checksum}`);
  console.log(`only after you've looked at it and said go.`);
})().catch(e => { console.error('FAILED:', e.message); process.exitCode = 2; });
