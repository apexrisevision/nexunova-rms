/**
 * NexuFinance v1 — Phase 1 apply. The four files are NAMED here; nothing is
 * discovered by listing a folder, so no other migration can be picked up.
 *
 *   node scripts/nf/apply-phase1.js                       dry run (default): prints exactly what would run, sends nothing
 *   node scripts/nf/apply-phase1.js --apply --owner-ok    applies the four files in ONE transaction, then the write guard
 *
 * Refuses to run (dry or real) if:
 *   · any of the four is missing, or differs from its committed version in HEAD
 *     (what runs is what was reviewed and committed, byte for byte)
 *   · a file contains a statement that touches a public object outside nf_
 *     (checked on CREATE/ALTER/DROP/INSERT/UPDATE/DELETE targets)
 * All-or-nothing: if any file or the write guard fails, none of it is applied. Every other migration in the folder is
 * listed as NOT APPLIED so the exclusion is visible, not assumed.
 *
 * Exit (via process.exitCode): 0 ok · 1 refused or failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { GUARD_BLOCK } = require('./write-guard');

const ROOT = path.resolve(__dirname, '..', '..');
const APPLY = [
  'supabase/migrations/20260916a_nf_tables.sql',
  'supabase/migrations/20260916b_nf_guards.sql',
  'supabase/migrations/20260916c_nf_rpcs.sql',
  'supabase/migrations/20260916d_nf_seed_awami.sql',
];

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Top-level statements only: comments and dollar-quoted bodies are removed
// first, so a function body's own INSERT/UPDATE (all on nf_ tables, and run
// only when called) is not mistaken for a statement this file executes.
function targetsOutsideNf(sql) {
  let bare = sql.replace(/--[^\n]*/g, '').replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$');
  const bad = [];
  const judge = (kind, obj) => {
    const o = obj.replace(/"/g, '').replace(/^public\./, '').replace(/^pg_temp\./, 'pg_temp:');
    if (!/^_?nf_/.test(o)) bad.push(`${kind} ${o}`);
  };
  // triggers, indexes and policies: the table after ON is what they touch
  bare = bare.replace(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+[\w"]+[\s\S]*?\bON\s+([\w."]+)[\s\S]*?;/gi, (_, t) => { judge('TRIGGER ON', t); return ';'; });
  bare = bare.replace(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+[\w"]+\s+ON\s+([\w."]+)[\s\S]*?;/gi, (_, t) => { judge('INDEX ON', t); return ';'; });
  bare = bare.replace(/CREATE\s+POLICY\s+[\w"]+\s+ON\s+([\w."]+)[\s\S]*?;/gi, (_, t) => { judge('POLICY ON', t); return ';'; });
  const re = /\b(CREATE(?:\s+OR\s+REPLACE)?\s+(?:TABLE|FUNCTION|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|FUNCTION|VIEW|TRIGGER|INDEX|POLICY)|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([\w."]+)/gi;
  let m;
  while ((m = re.exec(bare))) judge(m[1].replace(/\s+/g, ' ').toUpperCase(), m[2]);
  return bad;
}

// The check above must be seen to fire (SR-2) before its silence means anything.
function selfTest() {
  const mustCatch = [
    'UPDATE public.payments SET amount = 0;',
    'CREATE TRIGGER t AFTER INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.nf_x();',
    'ALTER TABLE public.app_users ADD COLUMN x int;',
    'INSERT INTO companies (id) VALUES (gen_random_uuid());',
    'CREATE INDEX i ON public.units (id);',
    'CREATE OR REPLACE FUNCTION public.record_payment() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;',
  ];
  const mustPass = [
    'CREATE TRIGGER nf_t BEFORE INSERT OR UPDATE OR DELETE ON public.nf_lines FOR EACH ROW EXECUTE FUNCTION public.nf_g();',
    'CREATE TRIGGER nf_p AFTER INSERT OR UPDATE OF transfer_to_bank ON public.nf_days FOR EACH ROW EXECUTE FUNCTION public.nf_g();',
    'CREATE FUNCTION public.nf_f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.payments SET x = 1; END $$;',
    "SELECT public._nf_seed_company('00000000-0000-0000-0000-000000000000'::uuid, $nfseed${}$nfseed$::jsonb);",
  ];
  const missed = mustCatch.filter(s => targetsOutsideNf(s).length === 0);
  const falseAlarms = mustPass.filter(s => targetsOutsideNf(s).length > 0);
  return { missed, falseAlarms };
}

(async () => {
  const real = process.argv.includes('--apply');
  if (real && !process.argv.includes('--owner-ok')) {
    console.log('REFUSED — --apply needs --owner-ok, and the owner\'s OK in the conversation before it is typed.');
    process.exitCode = 1; return;
  }
  console.log(`[apply-phase1] mode: ${real ? 'APPLY' : 'DRY RUN — nothing is sent to the database'}\n`);

  // Owner condition 3a: every SECURITY DEFINER function must pin its search_path.
  const searchPathCheck = sql => {
    const bad = [];
    // one entry per CREATE FUNCTION header, up to its AS $...$ body marker
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(([\s\S]*?)\)\s*([\s\S]*?)AS\s*\$/gi;
    let m, total = 0, definers = 0;
    while ((m = re.exec(sql))) {
      total++;
      const header = m[3];
      if (!/SECURITY\s+DEFINER/i.test(header)) continue;
      definers++;
      if (!/SET\s+search_path\s+TO\s+[\w ,]*public/i.test(header)) bad.push(m[1]);
    }
    return { total, definers, bad };
  };

  // Owner condition 3b: the rollback was rehearsed and left no nf_ object.
  const rehearsalLog = arg => { const i = process.argv.indexOf(arg); return i > 0 ? process.argv[i + 1] : null; };
  const evidence = rehearsalLog('--rehearsal-log');

  let refused = false;
  const st = selfTest();
  console.log(`  detector self-test: ${st.missed.length ? '✗ missed ' + JSON.stringify(st.missed) : 'caught all 6 planted outside-nf_ statements'} · ` +
              `${st.falseAlarms.length ? '✗ false alarms ' + JSON.stringify(st.falseAlarms) : 'silent on all 4 nf_-only statements'}\n`);
  if (st.missed.length || st.falseAlarms.length) refused = true;
  const plan = [];
  for (const [i, rel] of APPLY.entries()) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log(`  ✗ ${rel} — missing`); refused = true; continue; }
    const disk = fs.readFileSync(abs);
    let committed;
    try { committed = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26 }); }
    catch { console.log(`  ✗ ${rel} — not in HEAD`); refused = true; continue; }
    const same = sha(disk) === sha(committed);
    const sql = disk.toString('utf8');
    const outside = targetsOutsideNf(sql);
    // seed file: its only statement is a call to the nf_ seeder
    const counts = {
      tables: (sql.match(/^CREATE TABLE/gim) || []).length,
      functions: (sql.match(/^CREATE (?:OR REPLACE )?FUNCTION/gim) || []).length,
      triggers: (sql.match(/^CREATE (?:CONSTRAINT )?TRIGGER/gim) || []).length,
      policies: (sql.match(/^CREATE POLICY/gim) || []).length,
      seedCalls: (sql.match(/_nf_seed_company\(/g) || []).length,
    };
    console.log(`  ${i + 1}. ${rel}`);
    console.log(`     ${disk.length} bytes · sha256 ${sha(disk).slice(0, 16)}… · ${same ? 'identical to HEAD' : '✗ DIFFERS FROM HEAD'}`);
    console.log(`     contains: ${JSON.stringify(counts)}`);
    console.log(`     statements on objects outside nf_: ${outside.length ? '✗ ' + outside.join('; ') : 'none'}`);
    const sp = searchPathCheck(sql);
    console.log(`     functions: ${sp.total} · SECURITY DEFINER: ${sp.definers} · search_path pinned on all of them: ` +
                `${sp.bad.length ? '✗ NOT ' + sp.bad.join(', ') : sp.definers ? 'yes' : '(none in this file)'}`);
    if (!same || outside.length || sp.bad.length) refused = true;
    plan.push({ rel, sql });
  }

  const listed = new Set(APPLY.map(p => path.basename(p)));
  const others = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.startsWith('20260916') && !listed.has(f));
  console.log('\n  other 20260916* files in the folder — NOT APPLIED by this script:');
  others.forEach(f => {
    const hits = targetsOutsideNf(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8'));
    console.log(`     · ${f}  (outside-nf_ statements the detector sees in it: ${hits.length ? hits.slice(0, 4).join('; ') + (hits.length > 4 ? ` … ${hits.length} total` : '') : 'none'})`);
  });

  // the rehearsal's own evidence, read from its log rather than asserted here
  if (evidence) {
    const log = fs.existsSync(evidence) ? fs.readFileSync(evidence, 'utf8') : '';
    const rb = /PASS\s+RB01/.test(log);
    const clean = /0 failed · 0 missing/.test(log);
    const mut = /all \d+ mutants killed/.test(log);
    const live = /→ nothing from this run exists on live/.test(log);
    console.log(`\n  rehearsal evidence (${path.basename(evidence)}):`);
    console.log(`     RB01 — the rollback file ran and left 0 nf_ tables and 0 nf_ functions: ${rb ? 'PASS' : '✗ not found'}`);
    console.log(`     every assertion passed: ${clean ? 'yes' : '✗ no'} · every mutant killed: ${mut ? 'yes' : '✗ no'} · live clean afterwards: ${live ? 'yes' : '✗ no'}`);
    if (!(rb && clean && mut && live)) refused = true;
  } else if (real) {
    console.log('\n  ✗ --apply needs --rehearsal-log <file> so the rollback rehearsal can be confirmed.');
    refused = true;
  }

  if (refused) { console.log('\nREFUSED — see ✗ above. Nothing was sent.'); process.exitCode = 1; return; }

  // ONE transaction: the four files' own BEGIN/COMMIT are removed, the whole is
  // wrapped once, and the write guard runs last. Any failure — a file, or the
  // guard finding a write outside nf_ — rolls back all four.
  const bodies = plan.map(({ rel, sql }) => {
    const stripped = sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped)) throw new Error(`${rel}: a BEGIN/COMMIT survived stripping`);
    return `\n-- ══════ ${rel} ══════\n${stripped}`;
  });
  const batch = ['BEGIN;', ...bodies, GUARD_BLOCK, 'COMMIT;'].join('\n');
  const batchFile = path.join(ROOT, 'migration_work', '_nf_apply_batch.sql');
  fs.writeFileSync(batchFile, batch);
  const wraps = (batch.match(/^\s*BEGIN\s*;\s*$/gim) || []).length + '/' + (batch.match(/^\s*COMMIT\s*;\s*$/gim) || []).length;
  console.log(`\n  the request: ONE transaction (top-level BEGIN/COMMIT count ${wraps}), four files in order, then the write guard`);
  console.log(`  (pg_stat_xact_user_tables: abort if this transaction wrote any table outside nf_).`);
  console.log(`  exact bytes: ${path.relative(ROOT, batchFile)} · ${batch.length} bytes · sha256 ${sha(Buffer.from(batch)).slice(0, 16)}…`);

  if (!real) { console.log(`\nDRY RUN OK — exactly these ${plan.length} files would run, in this order, in one transaction. Nothing was sent.`); return; }

  const { q } = require('../_sbq');
  const t0 = Date.now();
  try {
    await q(batch, 1);
  } catch (e) {
    console.log(`  ✗ FAILED after ${Date.now() - t0} ms: ${e.message}\nNOTHING APPLIED — the transaction rolled back as a whole.`);
    process.exitCode = 1; return;
  }
  console.log(`\nAPPLIED in ${Date.now() - t0} ms — the four nf_ files, one transaction, write guard passed.`);
})();
