/**
 * Daily Closing — diff qb_accounts against the real QuickBooks chart.
 *
 *   node scripts/verify-qb-accounts.js <file> [--company <uuid>]
 *
 * WHY THIS EXISTS. The Phase-3 IIF export writes an account by NAME, and
 * QuickBooks does not reject a name it does not recognise — it silently creates
 * a new account. One wrong character in `Advance from Customers` and every
 * client receipt for a month lands in an account nobody is looking at, found
 * only when a reconciliation fails. Our 53 rows were transcribed from
 * BLUEPRINT.md §A14, which is itself a transcription. This closes that loop
 * while the cash book is still empty and a fix costs nothing.
 *
 * ── WHAT TO EXPORT FROM QUICKBOOKS ────────────────────────────────────────
 *
 * PREFERRED — an IIF export of the chart. It is byte-exact, it is the same
 * format the Phase-3 export will be matched against, and it carries the account
 * type as QuickBooks records it:
 *
 *   QuickBooks Desktop
 *     File → Utilities → Export → Lists to IIF Files…
 *     tick ONLY "Chart of Accounts"
 *     save as  migration_work/qb_chart.iif
 *
 * ACCEPTED — a CSV, if IIF is awkward:
 *
 *   Reports → List → Account Listing → Excel/CSV
 *   Keep at least a NAME column and a TYPE column; an account-number column is
 *   used if present. A header row is required. Column names are matched
 *   case-insensitively against: name / account / full name  ·  type / account
 *   type  ·  number / account number / acct #.
 *
 * Either file may live anywhere; pass the path. Nothing is uploaded and nothing
 * is written to the database — this reads and compares.
 *
 * ── WHAT IT REPORTS ───────────────────────────────────────────────────────
 *   · names in QuickBooks that are not in qb_accounts
 *   · names in qb_accounts that are not in QuickBooks   ← the dangerous one
 *   · same number, different name (a rename)
 *   · same name, different type
 *   · any name over 31 characters, on either side
 *   · whether QuickBooks names carry a number prefix ("1010 · Cash in Hand"),
 *     because if they do, the IIF export must emit the prefixed form
 *   · sub-accounts (Parent:Child), which §A14 does not model
 *
 * Exits non-zero if anything differs, so it can gate a deploy later.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const ci = args.indexOf('--company');
const COMPANY = ci >= 0 ? args[ci + 1] : AWAMI;

if (!file) {
  console.error('usage: node scripts/verify-qb-accounts.js <qb_chart.iif|chart.csv> [--company <uuid>]');
  console.error('\nSee the header of this file for exactly what to export from QuickBooks.');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`not found: ${file}`);
  process.exit(2);
}

// ── parsing ────────────────────────────────────────────────────────────────
// A QuickBooks account name may arrive as "1010 · Cash in Hand", "1010 - Cash
// in Hand", "1010 Cash in Hand" or plain "Cash in Hand", depending on whether
// "Use account numbers" is on. Split the prefix off so names compare, but
// remember that it was there — it changes what the IIF export must write.
function splitNumber(full) {
  const m = /^\s*(\d{4})\s*(?:[·\-–—:.]|\s)\s*(.+)$/.exec(full);
  if (m) return { number: m[1], name: m[2].trim(), prefixed: true };
  return { number: null, name: String(full).trim(), prefixed: false };
}

function parseIif(text) {
  const lines = text.split(/\r?\n/);
  let cols = null;
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    const tag = (f[0] || '').trim().toUpperCase();
    if (tag === '!ACCNT') { cols = f.map(c => c.trim().toUpperCase()); continue; }
    if (tag !== 'ACCNT' || !cols) continue;
    const get = k => { const i = cols.indexOf(k); return i >= 0 ? (f[i] || '').trim() : ''; };
    const raw = get('NAME');
    if (!raw) continue;
    const sp = splitNumber(raw);
    out.push({
      raw,
      number: get('ACCNUM') || sp.number,
      name: sp.name,
      type: (get('ACCNTTYPE') || '').toUpperCase(),
      prefixed: sp.prefixed,
      // QuickBooks marks an inactive account HIDDEN=Y. The Awami file carries
      // 27 default contractor-template accounts switched off; they are expected
      // in the export and are NOT a diff failure. They are reported separately
      // because posting to an inactive account is refused at import — so one of
      // OURS turning up hidden would be a real problem.
      hidden: (get('HIDDEN') || '').toUpperCase() === 'Y',
    });
  }
  return out;
}

// Minimal RFC-4180 CSV reader — quoted fields, doubled quotes, embedded commas.
function parseCsvRows(text) {
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const pick = names => head.findIndex(h => names.includes(h));
  const iName = pick(['name', 'account', 'full name', 'account name']);
  const iType = pick(['type', 'account type']);
  const iNum = pick(['number', 'account number', 'acct #', 'acct#', 'account #']);
  const iAct = pick(['active', 'active status', 'status']);
  if (iName < 0) {
    throw new Error('CSV has no name column (looked for: name, account, full name, account name)');
  }
  return rows.slice(1).map(r => {
    const raw = (r[iName] || '').trim();
    const sp = splitNumber(raw);
    return {
      raw,
      number: (iNum >= 0 ? (r[iNum] || '').trim() : '') || sp.number,
      name: sp.name,
      type: (iType >= 0 ? (r[iType] || '').trim() : '').toUpperCase(),
      prefixed: sp.prefixed,
      hidden: iAct >= 0 ? /^(n|no|false|inactive|hidden)$/i.test((r[iAct] || '').trim()) : false,
    };
  }).filter(a => a.raw);
}

// ── report ─────────────────────────────────────────────────────────────────
let problems = 0;
// fatal=false for sections that are worth SEEING but are not defects — a chart
// QuickBooks holds and we do not seed is normal (it ships with built-ins like
// Retained Earnings), whereas a name WE hold that QuickBooks does not is the
// thing that silently creates a duplicate account.
const section = (title, rows, render, fatal = true) => {
  if (!rows.length) return;
  if (fatal) problems += rows.length;
  console.log(`\n── ${title} (${rows.length})`);
  rows.forEach(r => console.log('   ' + render(r)));
};

(async () => {
  const text = fs.readFileSync(file, 'utf8');
  const isIif = path.extname(file).toLowerCase() === '.iif' || /^!(ACCNT|HDR)/m.test(text);
  let qb;
  try { qb = isIif ? parseIif(text) : parseCsv(text); }
  catch (e) { console.error('could not parse ' + file + ': ' + e.message); process.exit(2); }

  console.log(`[verify-qb-accounts] project ${REF}`);
  console.log(`  file    ${file}  (${isIif ? 'IIF' : 'CSV'})`);
  console.log(`  company ${COMPANY}`);
  console.log(`  parsed  ${qb.length} account(s) from QuickBooks`);

  if (!qb.length) {
    console.error('\nno accounts parsed — is this the chart-of-accounts export?');
    process.exit(2);
  }

  const res = await q(
    `select number, name, qb_type, is_active from public.qb_accounts
      where company_id = '${COMPANY}' order by number`);
  let db = Array.isArray(res) ? res : (res.rows || []);
  let dbSource = 'qb_accounts (live)';

  // Before P2 is applied, qb_accounts is empty. Fall back to the seeder's own
  // VALUES block, which is the source of truth the table is filled FROM — so
  // the chart can be checked against QuickBooks without waiting on a deploy.
  if (!db.length) {
    const seed = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations',
                '20260904a_the_chart_and_the_people_paid.sql'), 'utf8');
    const rows = [...seed.matchAll(/^\s*\('(\d{4})',\s*'((?:[^']|'')*)',\s*'([A-Z]+)'\)/gm)];
    db = rows.map(m => ({ number: m[1], name: m[2].replace(/''/g, "'"), qb_type: m[3], is_active: true }));
    dbSource = '20260904a seeder (qb_accounts is empty — P2 not applied yet)';
  }
  console.log(`  parsed  ${db.length} account(s) from ${dbSource}\n`);

  const key = s => String(s || '').trim().toLowerCase();
  const active = qb.filter(a => !a.hidden);
  const hidden = qb.filter(a => a.hidden);
  const qbByName = new Map(qb.map(a => [key(a.name), a]));
  const qbByNum = new Map(qb.filter(a => a.number).map(a => [String(a.number).trim(), a]));
  const dbByName = new Map(db.map(a => [key(a.name), a]));

  console.log(`  of those, ${active.length} active and ${hidden.length} inactive (HIDDEN=Y)`);

  // The one that matters most: we hold a name QuickBooks does not have, so the
  // export would silently create it.
  section('IN THE CHART BUT NOT IN QUICKBOOKS — the export would create these',
    db.filter(a => !qbByName.has(key(a.name))),
    a => `${a.number}  "${a.name}"` +
         (qbByNum.has(String(a.number).trim())
           ? `   ← same number in QB is "${qbByNum.get(String(a.number).trim()).name}"`
           : '   ← number not in QB either'));

  // One of OURS that exists in QuickBooks but is switched off. Posting to an
  // inactive account is refused at import, so this IS a failure.
  section('OURS, BUT INACTIVE IN QUICKBOOKS — an import would be refused',
    db.filter(a => { const m = qbByName.get(key(a.name)); return m && m.hidden; }),
    a => `${a.number}  "${a.name}"   ← reactivate it in QuickBooks`);

  // Everything else QuickBooks holds that we do not seed. Inactive ones are
  // expected (the contractor template) and are reported below, not here.
  section('IN QUICKBOOKS BUT NOT IN THE CHART — informational, not a defect',
    active.filter(a => !dbByName.has(key(a.name))),
    a => `${a.number || '····'}  "${a.name}"${a.type ? '  [' + a.type + ']' : ''}`,
    false);

  // Informational only — deliberately NOT counted as problems.
  if (hidden.length) {
    console.log(`\n── INACTIVE IN QUICKBOOKS, not seeded — expected, not a failure (${hidden.length})`);
    const shown = hidden.filter(a => !dbByName.has(key(a.name)));
    shown.slice(0, 8).forEach(a =>
      console.log(`   ${a.number || '····'}  "${a.name}"${a.type ? '  [' + a.type + ']' : ''}`));
    if (shown.length > 8) console.log(`   … and ${shown.length - 8} more`);
    console.log('   (default contractor-template accounts switched off in the company file)');
  }

  section('SAME NUMBER, DIFFERENT NAME',
    db.filter(a => {
      const m = qbByNum.get(String(a.number).trim());
      return m && key(m.name) !== key(a.name);
    }),
    a => `${a.number}  db "${a.name}"  ≠  qb "${qbByNum.get(String(a.number).trim()).name}"`);

  section('SAME NAME, DIFFERENT TYPE',
    db.filter(a => {
      const m = qbByName.get(key(a.name));
      return m && m.type && m.type !== String(a.qb_type).toUpperCase();
    }),
    a => `${a.number}  "${a.name}"  db ${a.qb_type}  ≠  qb ${qbByName.get(key(a.name)).type}`);

  section('NAME OVER 31 CHARACTERS — QuickBooks will not hold these',
    [...db.filter(a => a.name.length > 31).map(a => ({ src: 'db', n: a.name })),
     ...qb.filter(a => a.name.length > 31).map(a => ({ src: 'qb', n: a.name }))],
    r => `${r.src}  ${r.n.length} chars  "${r.n}"`);

  section('SUB-ACCOUNTS — §A14 does not model a parent:child chart',
    qb.filter(a => a.raw.includes(':')),
    a => `"${a.raw}"`);

  // Not a difference, but it decides what the Phase-3 export must write.
  const prefixed = qb.filter(a => a.prefixed).length;
  const withNum = qb.filter(a => a.number).length;
  console.log('\n── what Phase 3 must write in the ACCNT field');
  if (prefixed === 0) {
    console.log('   NAME is the BARE account name ("Cash in Hand") in all ' + qb.length + ' rows.');
    console.log(`   The number lives in its own ACCNUM column (${withNum} of ${qb.length} rows carry one).`);
    console.log('   → Phase 3 emits the BARE name, exactly as BLUEPRINT §A14 shows.');
    console.log('     "Use account numbers" being ON changes what the QuickBooks UI DISPLAYS;');
    console.log('     it does not change the IIF NAME field, and an IIF export is what an IIF');
    console.log('     import reads back. The export above is the round-trip evidence.');
  } else if (prefixed === qb.length) {
    console.log(`   ALL ${prefixed} names are prefixed ("1010 · Cash in Hand").`);
    console.log('   → Phase 3 must emit the PREFIXED form, NOT the bare name in §A14\'s');
    console.log('     example, or every line creates a duplicate account.');
    problems++;
  } else {
    console.log(`   MIXED — ${prefixed} of ${qb.length} names are prefixed. Resolve before P16.`);
    problems++;
  }

  console.log('');
  if (problems === 0) {
    console.log('✅ PASS — qb_accounts matches the QuickBooks chart, every name fits in 31');
    console.log('   characters, and the export can safely match on name.');
    return;
  }
  console.log(`❌ ${problems} thing(s) to resolve before the Phase-3 export is trusted.`);
  console.log('   Fixing a name is cheap: correct it in 20260904a and re-run');
  console.log('   seed_daily_closing_chart() — it updates in place (test 04).');
  process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exit(2); });
