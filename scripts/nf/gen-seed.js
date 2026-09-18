/**
 * NexuFinance v1 — builds the company seed from the two references.
 *
 *   node scripts/nf/gen-seed.js            write supabase/migrations/20260916d_nf_seed_awami.sql
 *   node scripts/nf/gen-seed.js --check    assert only; write nothing
 *
 * Also used as a module by the test harness, so the test tenant is seeded with
 * exactly what Awami would be.
 *
 * Exit codes: 0 all assertions held · 1 an assertion failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readHtml, readCoa, ROOT } = require('./reference');

const AWAMI_COMPANY_ID = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const OUT = path.join(ROOT, 'supabase', 'migrations', '20260916d_nf_seed_awami.sql');

// Owner, 2026-09-16 (Q9): 10400/10410/10420 are receivables, not cash.
// Descriptions are carried over from the rows they replace. Name corrected
// 2026-09-18 against the real Awami QuickBooks export (QB_COA_Awami.IIF,
// QuickBooks Enterprise 34.0D, 113 accounts) — QuickBooks calls this
// "Due from Directors", not "Receivable from Directors"; QuickBooks wins.
const RECEIVABLE_OVERRIDE = {
  remove: ['10400', '10410', '10420'],
  insertAfter: '12500',
  add: [
    { code: '12600', name: 'Due from Directors',        qb_type: 'Other Current Asset', parent: '12000', from: '10400' },
    { code: '12610', name: 'Syed Yousaf Shah',          qb_type: 'Other Current Asset', parent: '12600', from: '10410' },
    { code: '12620', name: 'Naeem Hussain',             qb_type: 'Other Current Asset', parent: '12600', from: '10420' },
  ],
};

// Owner, 2026-09-18: reconciled the whole chart against the real Awami
// QuickBooks export for the first time (an earlier comparison used the
// wrong company file entirely — discarded). 106 of 110 accounts matched
// exactly, by full colon-path, proving nf_account_path's materialized-path
// logic correct against its own authoritative reference. Two real,
// isolated gaps found, both one-off — not evidence either reference
// account family (the "QuickBooks makes this itself" placeholders, or the
// COA sheet generally) is systematically wrong:
//   · 66000 "Payroll Expenses" (EXP) is real and active in the client's
//     file but was never in the reference sheet at all — a different
//     account from 24000 "Payroll Liabilities", which the sheet does have
//     and which does match. Added as a real, postable head.
//   · 80000 "Ask My Accountant" is in the reference sheet (marked
//     "QuickBooks makes this itself"), assumed present the way 24000/30000
//     genuinely are in every QB company file — but this real file simply
//     does not have it. Removed; nothing here ever posted to it (is_head
//     was already false).
// 10400/10410/10420 ("Cash with Directors") are deliberately NOT restored
// even though the real file still lists them: they are HIDDEN=Y there —
// QuickBooks's own record of the same correction RECEIVABLE_OVERRIDE
// already makes, retired in favour of 12600/12610/12620. Reintroducing
// them would resurrect the exact bug ("director cash treated as company
// cash") this override exists to avoid.
const QB_RECONCILE_OVERRIDE = {
  remove: ['80000'],
  insertAfter: '60500',
  add: [
    { code: '66000', name: 'Payroll Expenses', qb_type: 'Expense', parent: null, description: 'Payroll expenses' },
  ],
};

// The reference has no QuickBooks class names; the sheet's Classes list does,
// in the same order. Only the last differs in spelling.
const FLOOR_TO_CLASS_EXCEPTIONS = { 'P-W': 'Project-wide' };

function buildSeed() {
  const ref = readHtml();
  const coa = readCoa();
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };

  // ── chart: resolve parents by name, apply the owner's override ───────────
  const byName = new Map();
  for (const a of coa.accounts) {
    check(!byName.has(a.name), `COA account name is not unique: ${a.name}`);
    byName.set(a.name, a.code);
  }
  let accounts = coa.accounts.map(a => {
    const parentName = a.parent_path ? a.parent_path.split(':').pop() : null;
    const parent_code = parentName ? byName.get(parentName) : null;
    check(!parentName || parent_code, `parent "${parentName}" of ${a.code} not found`);
    return { code: a.code, name: a.name, qb_type: a.qb_type, parent_code: parent_code || null, description: a.description };
  });
  check(accounts.length === 110, `sheet should hold 110 accounts, holds ${accounts.length}`);

  const removed = Object.fromEntries(accounts.filter(a => RECEIVABLE_OVERRIDE.remove.includes(a.code)).map(a => [a.code, a]));
  check(Object.keys(removed).length === 3, 'the three 104xx accounts were not all found in the sheet');
  accounts = accounts.filter(a => !RECEIVABLE_OVERRIDE.remove.includes(a.code));
  const at = accounts.findIndex(a => a.code === RECEIVABLE_OVERRIDE.insertAfter) + 1;
  check(at > 0, `anchor ${RECEIVABLE_OVERRIDE.insertAfter} not found`);
  accounts.splice(at, 0, ...RECEIVABLE_OVERRIDE.add.map(x => ({
    code: x.code, name: x.name, qb_type: x.qb_type, parent_code: x.parent,
    description: removed[x.from] ? removed[x.from].description : null,
  })));

  check(accounts.some(a => a.code === QB_RECONCILE_OVERRIDE.remove[0]), '80000 not found before removing it');
  accounts = accounts.filter(a => !QB_RECONCILE_OVERRIDE.remove.includes(a.code));
  const at2 = accounts.findIndex(a => a.code === QB_RECONCILE_OVERRIDE.insertAfter) + 1;
  check(at2 > 0, `anchor ${QB_RECONCILE_OVERRIDE.insertAfter} not found`);
  accounts.splice(at2, 0, ...QB_RECONCILE_OVERRIDE.add.map(x => ({
    code: x.code, name: x.name, qb_type: x.qb_type, parent_code: x.parent, description: x.description,
  })));

  // ── Vias: the reference's ACCTS, one per money position ───────────────────
  const vias = {};
  for (const [via, label, code] of ref.ACCTS) vias[code] = { via, via_label: label };
  check(Object.keys(vias).join() === '10100,10200,10300', `ACCTS changed: ${Object.keys(vias)}`);

  // ── heads: the reference's list, plus the two receivables (owner Q4) ─────
  const headCodes = new Set([...ref.heads.map(h => h.code), '12610', '12620', '66000']);
  check(ref.heads.length === 76, `reference HEADS should hold 76, holds ${ref.heads.length}`);

  const children = new Set(accounts.filter(a => a.parent_code).map(a => a.parent_code));
  for (const a of accounts) {
    // Double-entry (owner decision, 2026-09-18): a via-account (Cash/Petty/
    // Bank) is now a normal postable head too — a voucher names both sides
    // explicitly, so a transfer between two via-accounts (e.g. a bank
    // withdrawal into the till) needs both legs to be headable. Single-entry
    // never allowed this (via was always the implicit OTHER side of a
    // line); see supabase/migrations/20260918a's drop of
    // nf_accounts_head_not_via for the full reasoning. Any company seeded
    // from here on gets this correctly from the start, not via a one-time
    // UPDATE the way already-existing rows were migrated.
    a.is_head = headCodes.has(a.code) || !!vias[a.code];
    a.via = vias[a.code] ? vias[a.code].via : null;
    a.via_label = vias[a.code] ? vias[a.code].via_label : null;
  }

  // Every head exists in the chart, is a leaf, and is not a Via.
  const codes = new Set(accounts.map(a => a.code));
  for (const c of headCodes) {
    check(codes.has(c), `head ${c} is not in the chart`);
    check(!children.has(c), `head ${c} has children`);
    check(!vias[c], `head ${c} is a Via`);
  }
  // Every reference head name matches the chart.
  for (const h of ref.heads) {
    const a = accounts.find(x => x.code === h.code);
    check(a && a.name === h.name, `head ${h.code}: reference "${h.name}" vs chart "${a && a.name}"`);
  }
  // The leaves that are NOT heads are the QuickBooks-managed / unused ones
  // — the Vias moved OUT of this list under double-entry (they are heads
  // now too, see above).
  const leavesNotHeads = accounts.filter(a => !children.has(a.code) && !a.is_head).map(a => a.code).sort();
  const expectLeavesNotHeads = ['11000', '24000', '30000', '32000'];
  check(JSON.stringify(leavesNotHeads) === JSON.stringify(expectLeavesNotHeads),
        `leaves that are not heads: ${leavesNotHeads.join(',')} (expected ${expectLeavesNotHeads.join(',')})`);

  check(accounts.length === 110, `seed should hold 110 accounts, holds ${accounts.length}`);
  check(accounts.filter(a => a.is_head).length === 82, `seed should hold 82 heads (78 + the 3 via-accounts + 66000 Payroll Expenses), holds ${accounts.filter(a => a.is_head).length}`);
  check(!accounts.some(a => a.code.startsWith('104')), 'a 104xx code survived');
  for (const c of ['12610', '12620']) {
    const a = accounts.find(x => x.code === c);
    check(a && a.qb_type === 'Other Current Asset' && a.is_head && !a.via && a.parent_code === '12600',
          `${c} is not an Other Current Asset head under 12600`);
  }
  // Parents come before children (the seed inserts in this order; the FK is immediate).
  const seen = new Set();
  for (const a of accounts) {
    check(!a.parent_code || seen.has(a.parent_code), `${a.code} appears before its parent ${a.parent_code}`);
    seen.add(a.code);
  }

  // ── floors ───────────────────────────────────────────────────────────────
  check(ref.FLOORS.length === coa.classes.length, `reference has ${ref.FLOORS.length} floors, sheet ${coa.classes.length} classes`);
  const floors = ref.FLOORS.map((code, i) => {
    const qb = FLOOR_TO_CLASS_EXCEPTIONS[code] || code;
    check(coa.classes[i] === qb, `floor ${code} → class "${qb}" but the sheet has "${coa.classes[i]}" at position ${i + 1}`);
    return { code, qb_class: coa.classes[i] };
  });

  // ── report categories: the reference's if-chains as ordered rules ─────────
  const rule = (side, match_kind, pattern, label) => ({ side, match_kind, pattern, label });
  const IN = [
    rule('IN', 'exact', '21100', 'New tokens'),
    rule('IN', 'exact', '40100', 'Sales instalments'),
    rule('IN', 'exact', '21200', 'Advertising units'),
    rule('IN', 'exact', '40200', 'Advertising units'),
    rule('IN', 'exact', '40300', 'Transfer and processing fees'),
    rule('IN', 'exact', '40400', 'Forfeited tokens'),
    rule('IN', 'prefix', '22', 'From group companies'),
    rule('IN', 'prefix', '25', 'Loans received'),
    rule('IN', 'prefix', '26', 'Loans received'),
    rule('IN', 'exact', '31100', 'Capital introduced'),
    rule('IN', 'fallback', null, 'Other receipts'),
  ];
  const OUT = [
    rule('OUT', 'prefix', '51', 'Land'),
    rule('OUT', 'prefix', '52', 'Construction'),
    rule('OUT', 'prefix', '53', 'Approvals, design and consultants'),
    rule('OUT', 'prefix', '54', 'Dealer commission'),
    rule('OUT', 'prefix', '60', 'Marketing'),
    rule('OUT', 'exact', '70100', 'Salaries and security'),
    rule('OUT', 'exact', '70200', 'Salaries and security'),
    rule('OUT', 'prefix', '70', 'Office running'),
    rule('OUT', 'prefix', '85', 'Bank charges'),
    rule('OUT', 'prefix', '12', 'Advances given'),
    rule('OUT', 'exact', '21300', 'Customer refunds'),
    rule('OUT', 'prefix', '22', 'To group companies'),
    rule('OUT', 'prefix', '15', 'Office assets'),
    rule('OUT', 'prefix', '16', 'Office assets'),
    rule('OUT', 'prefix', '25', 'Loan repayments'),
    rule('OUT', 'prefix', '26', 'Loan repayments'),
    rule('OUT', 'exact', '31200', 'Drawings'),
    rule('OUT', 'fallback', null, 'Other expenses'),
  ];
  const categories = [...IN, ...OUT].map((r, i) => ({ ...r, priority: i + 1 }));
  const classify = (side, h) => categories.filter(c => c.side === side)
    .find(c => c.match_kind === 'fallback' || (c.match_kind === 'exact' ? h === c.pattern : h.startsWith(c.pattern))).label;

  // Parity with the reference functions, run as written, over every head.
  for (const c of headCodes) {
    check(classify('IN', c) === ref.catIn(c), `IN category for ${c}: rules say "${classify('IN', c)}", reference says "${ref.catIn(c)}"`);
    check(classify('OUT', c) === ref.catOut(c), `OUT category for ${c}: rules say "${classify('OUT', c)}", reference says "${ref.catOut(c)}"`);
  }

  // Detector self-test (SR-2): the parity check above must be able to fail.
  // Three planted mistakes, each of which it has to catch.
  const planted = [
    ['70 before 70100', cs => { const a = cs.findIndex(c => c.pattern === '70100'); const b = cs.findIndex(c => c.pattern === '70' && c.side === 'OUT'); [cs[a], cs[b]] = [cs[b], cs[a]]; }],
    ['21100 relabelled', cs => { cs.find(c => c.pattern === '21100').label = 'Tokens'; }],
    ['12 prefix dropped', cs => { cs.splice(cs.findIndex(c => c.side === 'OUT' && c.pattern === '12'), 1); }],
  ];
  for (const [name, mutate] of planted) {
    const cs = categories.filter(c => c.side === (name.startsWith('21100') ? 'IN' : 'OUT')).map(c => ({ ...c }));
    mutate(cs);
    const side = cs[0].side;
    const fn = side === 'IN' ? ref.catIn : ref.catOut;
    const cls = h => cs.find(c => c.match_kind === 'fallback' || (c.match_kind === 'exact' ? h === c.pattern : h.startsWith(c.pattern))).label;
    const caught = [...headCodes].some(h => cls(h) !== fn(h));
    check(caught, `self-test: the category parity check did not catch "${name}"`);
  }

  // ── settings ─────────────────────────────────────────────────────────────
  check(ref.BIG === 50000, `reference BIG is ${ref.BIG}, the brief says 50,000`);
  check(ref.pdcDays === 7, `reference PDC window is ${ref.pdcDays} days, the brief says 7`);
  const settings = {
    large_payment_threshold: ref.BIG, pdc_due_days: ref.pdcDays,
    company_line: ref.coLine, report_title: ref.reportTitle, mark: ref.mark,
  };
  check(settings.company_line === 'Fourteen Group of Companies · Awami Market, Karkhano, Peshawar',
        `company line read as "${settings.company_line}"`);

  return {
    failures,
    seed: {
      settings,
      accounts: accounts.map(({ code, name, qb_type, parent_code, description, is_head, via, via_label }) =>
        ({ code, name, qb_type, parent_code, description, is_head, via, via_label })),
      floors,
      categories,
    },
    ref,
  };
}

function seedSql(companyId, seed) {
  const json = JSON.stringify(seed);
  if (json.includes('$nfseed$')) throw new Error('seed JSON contains the dollar-quote tag');
  return `SELECT public._nf_seed_company('${companyId}'::uuid, $nfseed$${json}$nfseed$::jsonb);`;
}

module.exports = { buildSeed, seedSql, AWAMI_COMPANY_ID };

if (require.main === module) {
  let built;
  try {
    built = buildSeed();
  } catch (e) {
    console.error('COULD NOT RUN —', e.message);
    process.exit(2);
  }
  const { failures, seed } = built;
  console.log(`[gen-seed] accounts ${seed.accounts.length} · heads ${seed.accounts.filter(a => a.is_head).length} · ` +
              `vias ${seed.accounts.filter(a => a.via).length} · floors ${seed.floors.length} · categories ${seed.categories.length}`);
  if (failures.length) {
    console.error(`FAIL — ${failures.length} assertion(s):`);
    failures.forEach(f => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('PASS — every assertion held (chart, override, heads = reference 76 + 2 + 66000, floors = sheet classes, categories = reference catIn/catOut over every head).');
  if (process.argv.includes('--check')) process.exit(0);

  const sql = `-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance v1 · d · seed Awami Market
--
-- GENERATED by scripts/nf/gen-seed.js — do not edit by hand; re-run the script.
-- Source: docs/reference/Awami_Market_COA.xlsx and docs/reference/awami-daily-closing.html,
-- with the owner's override of 2026-09-16 (10400/10410/10420 → 12600/12610/12620).
--
-- Writes nf_settings, nf_accounts (110), nf_floors (9) and nf_report_categories
-- (29) for Awami Market only. No days, no lines, no members: the members wait
-- for their names, and the first day is started from the app by a director.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
${seedSql(AWAMI_COMPANY_ID, seed)}
COMMIT;
`;
  fs.writeFileSync(OUT, sql);
  console.log('wrote ' + path.relative(ROOT, OUT));
}
