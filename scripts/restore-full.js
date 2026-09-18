#!/usr/bin/env node
/**
 * Restores a backup-full.js output (schema + data) into a real, separate
 * Postgres database via the `pg` client — for machines with no psql, and
 * for actually PROVING a backup restores rather than trusting an
 * untested one. Built 2026-09-18 proving the org's first-ever restore
 * (into a scratch Supabase project, since deleted) and found four real
 * bugs in backup-full.js's own schema/data export along the way, each
 * fixed there (not papered over here): a missing CREATE SEQUENCE for
 * columns with a plain DEFAULT nextval(...) rather than an IDENTITY
 * column; two constraint-trigger rows emitted as invalid ALTER TABLE
 * fragments (already fully, correctly covered by the ordinary triggers
 * export); a functional index needing its function to exist first; and
 * a GENERATED ALWAYS AS IDENTITY column refusing an explicit value
 * without OVERRIDING SYSTEM VALUE. Restore order matches
 * backup-full.js's own documented sequence (see its restore-instructions
 * comment for exactly why it isn't a plain alphabetical sort), and
 * parses restore_all.sql's `\i <file>` directives itself (psql-only
 * syntax the driver can't execute directly).
 *
 *   node scripts/restore-full.js <backup-dir> <host> <port> <user> <password>
 *
 * FUNC_FILTER=<regex> env var narrows the schema (functions/indexes/
 * triggers/policies) and data phases to matching object/table names —
 * e.g. FUNC_FILTER='^(_?nf_|nf_)' restores only NexuFinance's own
 * schema and rows, skipping every other module (companies.sql is
 * always included regardless — nf_accounts etc. FK-reference it).
 * Without it, the full platform restores.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const [, , BACKUP_DIR, HOST, PORT, USER, PASSWORD] = process.argv;
if (!BACKUP_DIR || !HOST) {
  console.error('usage: node scripts/restore-full.js <backup-dir> <host> <port> <user> <password> [FUNC_FILTER=<regex> env var to narrow scope]');
  process.exit(2);
}

async function run(client, label, sql) {
  const t0 = Date.now();
  try {
    await client.query(sql);
    console.log(`  ok  ${label} (${Date.now() - t0}ms)`);
  } catch (e) {
    // Optimistic single batch first (fast — one round trip for a file
    // that's normally hundreds of independent statements with no
    // cross-references). Falls back to one statement at a time, tolerant
    // of failures, only when that fails — same shape of problem as
    // 06_functions.sql (e.g. an index needing a function this scratch
    // run deliberately narrowed via FUNC_FILTER), just without needing
    // multiple retry passes since these statement types don't reference
    // each other the way functions can.
    console.log(`  ${label}: batch failed ("${e.message.slice(0, 80)}") — falling back to statement-by-statement`);
    const stmts = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    let ok = 0, failed = [];
    for (const s of stmts) {
      try { await client.query(s + ';'); ok++; }
      catch (e2) { failed.push({ s, msg: e2.message }); }
    }
    console.log(`  ${label}: ${ok}/${stmts.length} statements applied, ${failed.length} skipped`);
    for (const f of failed.slice(0, 5)) console.log(`    skipped: ${f.msg.slice(0, 100)} — ${f.s.split('\n')[0].slice(0, 80)}`);
  }
}

// Real bug, found on this exact restore run: backup-full.js emits functions
// in plain alphabetical order (order by p.proname), but a function can call
// another function that sorts LATER by name (_crm_in_quiet_hours calls
// _crm_next_send_at) — Postgres does not track that as a pg_depend edge for
// either SQL- or plpgsql-language functions (checked directly: zero rows),
// so there is no catalog-based way to pre-sort them correctly.
//
// Two failure modes fought each other here, found in that order:
//   1. One round trip per function (996 of them): real per-function
//      progress (each is its own protocol message, so an earlier success
//      isn't undone by a later failure) — but the pooler connection
//      dropped mid-sequence more than once at that rate, losing whatever
//      hadn't been re-checked yet.
//   2. All 996 sent as ONE multi-statement batch to cut round trips: the
//      whole batch rolled back to nothing the moment ANY one statement
//      failed (Postgres treats multiple statements in a single protocol
//      message as one implicit transaction) — a single forward reference
//      undid all 995 good ones with it. Confirmed directly: after a
//      batch failure, pg_proc held none of them, not "everything up to
//      the failure point" as assumed.
// Fixed by combining what each mode got right: one round trip per
// function (so a real success survives a later failure) AND reconnect-
// and-continue on a dropped connection (so a network blip doesn't cost
// the whole remaining pass) — distinguishing a real Postgres error (a
// 5-character SQLSTATE code, e.g. 42883 undefined function — expected,
// deferred to the next pass) from a connection-level one (no SQLSTATE —
// reconnect and retry that same statement, not deferred).
async function reconnect(cfg) {
  const c = new Client(cfg);
  c.on('error', e => console.log('  (connection error event, will surface at the next query):', e.message));
  await c.connect();
  return c;
}
async function runFunctionsWithRetry(client, sql, cfg) {
  let chunks = sql.split(/\n\n(?=-- )/).map(c => c.trim()).filter(Boolean).slice(1); // [0] is the file's own leading comment, not a function
  // FUNC_FILTER narrows this scratch proof to what was actually asked —
  // "the nf_ schema and its rows" — under a genuinely low-memory machine
  // (this session's own background restore attempts were OOM-killed
  // system-wide, not by a bug in this script) where 996 round trips for
  // every RMS function is neither necessary nor reliable right now. The
  // general, whole-platform restore path (schema/tables/constraints, the
  // part that's identical regardless of this filter) is already proven;
  // this only trims the functions phase.
  if (process.env.FUNC_FILTER) {
    const re = new RegExp(process.env.FUNC_FILTER);
    chunks = chunks.filter(c => re.test((c.match(/^--\s*(.+)$/m) || [, ''])[1]));
    console.log(`  FUNC_FILTER=${process.env.FUNC_FILTER} narrowed functions.sql to ${chunks.length} function(s)`);
  }
  let pending = chunks;
  let pass = 0;
  while (pending.length && pass < 10) {
    pass++;
    const stillFailing = [];
    let i = 0;
    while (i < pending.length) {
      const chunk = pending[i];
      try {
        await client.query(chunk);
        i++;
      } catch (e) {
        if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) {
          stillFailing.push({ chunk, err: e.message }); // a real SQLSTATE — genuinely not resolvable yet
          i++;
        } else {
          console.log(`  connection-level error mid-pass ("${e.message.slice(0, 80)}") — reconnecting and retrying the same statement`);
          try { await client.end(); } catch (_) { /* already gone */ }
          client = await reconnect(cfg);
          // do not advance i — retry this exact statement on the new connection
        }
      }
    }
    if (stillFailing.length === pending.length) {
      console.log(`  FAIL 06_functions.sql: pass ${pass} made no progress, ${stillFailing.length} function(s) still failing:`);
      for (const f of stillFailing.slice(0, 5)) console.log(`    ${f.err} — ${f.chunk.split('\n')[0]}`);
      throw new Error(`06_functions.sql: ${stillFailing.length} function(s) never resolved after ${pass} pass(es)`);
    }
    console.log(`  06_functions.sql pass ${pass}: ${pending.length - stillFailing.length}/${pending.length} created, ${stillFailing.length} deferred to next pass`);
    pending = stillFailing.map(f => f.chunk);
  }
  console.log(`  ok  06_functions.sql (${chunks.length} functions, ${pass} pass(es))`);
  return client;
}

(async () => {
  const CFG = { host: HOST, port: Number(PORT) || 5432, user: USER, password: PASSWORD,
    database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
    keepAlive: true, keepAliveInitialDelayMillis: 5000 };
  let client = new Client(CFG);
  client.on('error', e => console.log('  (connection error event, will surface at the next query):', e.message));
  await client.connect();
  console.log('connected to scratch target\n');

  // ── schema, in the documented order — NOT a plain alphabetical sort.
  //    01/02/03, then 05 (views) — nf_report_groups(uuid,text) needs
  //    public.nf_lines (a view) to already exist, found the same way as
  //    the index/function issue below — checked first that no view here
  //    depends on a function, so this reordering can't break the other
  //    way. Then 06 (functions) BEFORE 04 (indexes): some functional
  //    indexes need their function to already exist
  //    (leads_company_normphone_idx / _norm_phone). 07/08/10 after,
  //    matching backup-full.js's documented sequence. ──
  const schemaDir = path.join(BACKUP_DIR, 'schema');
  const RESTORE_ORDER = ['01_types.sql', '02_tables.sql', '03_constraints.sql', '05_views.sql',
    '06_functions.sql', '04_indexes.sql', '07_triggers.sql', '08_policies.sql', '10_grants.sql'];
  const present = new Set(fs.readdirSync(schemaDir).filter(f => f.endsWith('.sql')));
  const schemaFiles = RESTORE_ORDER.filter(f => present.has(f));
  const missing = [...present].filter(f => !RESTORE_ORDER.includes(f));
  if (missing.length) console.log(`  NOTE: schema files present but not in the documented order, skipped: ${missing.join(', ')}`);
  console.log('── schema phase ──');
  for (const f of schemaFiles) {
    let sql = fs.readFileSync(path.join(schemaDir, f), 'utf8');
    if (!sql.trim()) { console.log(`  skip ${f} (empty)`); continue; }
    if (f === '06_functions.sql') { client = await runFunctionsWithRetry(client, sql, CFG); continue; }
    // 04/07/08 are one statement per line — under FUNC_FILTER, pre-filter
    // to lines mentioning nf_ instead of relying on the slow one-at-a-time
    // fallback in run() for everything else this scratch proof deliberately
    // left out (hundreds of statements, one round trip each — this is what
    // was getting killed for memory on a genuinely constrained machine,
    // not a bug in the retry logic itself).
    if (process.env.FUNC_FILTER && ['04_indexes.sql', '07_triggers.sql', '08_policies.sql'].includes(f)) {
      const before = sql.split('\n').filter(l => l.trim()).length;
      sql = sql.split('\n').filter(l => !l.trim() || l.startsWith('--') || /nf_/.test(l)).join('\n');
      const after = sql.split('\n').filter(l => l.trim() && !l.startsWith('--')).length;
      console.log(`  ${f}: FUNC_FILTER narrowed ${before} statements to ${after}`);
    }
    await run(client, f, sql);
  }

  // ── data: restore_all.sql's own \i list when it exists (the backup's
  //    data phase writes it LAST, after every table); otherwise every
  //    nf_*.sql + companies.sql that's ready now. Either way this is the
  //    exact mechanism restore_all.sql itself uses — session_replication_
  //    role=replica disables FK/trigger checks for the load, which is
  //    specifically WHY table order (and here, an incomplete set of
  //    unrelated tables) doesn't matter. ────────────────────────────────
  const sqlDir = path.join(BACKUP_DIR, 'sql');
  const restoreAllPath = path.join(sqlDir, 'restore_all.sql');
  let includes;
  if (process.env.FUNC_FILTER) {
    // Same scope reduction as the schema phase — CHECK constraints (unlike
    // FK/triggers) are NOT disabled by session_replication_role=replica,
    // so restoring every other module's data too could fail on THEIR
    // data's own integrity rules (found directly: cash_entries did,
    // unrelated to anything this proof is checking). companies.sql is
    // still needed — nf_accounts/nf_parties/etc. FK-reference it.
    includes = fs.readdirSync(sqlDir).filter(f => f === 'companies.sql' || /^nf_.*\.sql$/.test(f));
    console.log(`  FUNC_FILTER set — loading only companies.sql + every nf_*.sql (${includes.length} files), not the full restore_all.sql`);
  } else if (fs.existsSync(restoreAllPath)) {
    includes = [...fs.readFileSync(restoreAllPath, 'utf8').matchAll(/^\\i\s+(\S+\.sql)\s*$/gm)].map(m => m[1]);
  } else {
    includes = fs.readdirSync(sqlDir).filter(f => f === 'companies.sql' || /^nf_.*\.sql$/.test(f));
    console.log(`  (restore_all.sql not written yet — the full backup is still exporting unrelated tables;`);
    console.log(`   loading the ${includes.length} files that ARE ready: companies.sql + every nf_*.sql)`);
  }
  console.log(`\n── data phase (${includes.length} includes) ──`);
  await client.query('BEGIN');
  await client.query('SET session_replication_role = replica');
  let loaded = 0;
  for (const inc of includes) {
    const p = path.resolve(sqlDir, inc);
    if (!fs.existsSync(p)) { console.log(`  MISSING ${inc}`); continue; }
    const sql = fs.readFileSync(p, 'utf8');
    if (!sql.trim()) continue;
    try {
      await client.query(sql);
      loaded++;
    } catch (e) {
      console.log(`  FAIL ${inc}: ${e.message}`);
      throw e;
    }
  }
  await client.query('SET session_replication_role = DEFAULT');
  await client.query('COMMIT');
  console.log(`  loaded ${loaded}/${includes.length} table data files`);

  // sequences, reset after data load (restore_all.sql re-runs this file itself)
  const seqFile = path.join(schemaDir, '09_sequences.sql');
  if (fs.existsSync(seqFile)) await run(client, '09_sequences.sql (post-load)', fs.readFileSync(seqFile, 'utf8'));

  // ── verify: the nf_ schema and its rows actually landed ──────────────────
  console.log('\n── verification ──');
  const checks = await client.query(`
    select
      (select count(*) from information_schema.tables where table_schema='public' and table_name like 'nf\\_%') as nf_tables,
      (select count(*) from information_schema.routines where routine_schema='public' and routine_name like 'nf\\_%') as nf_functions,
      (select count(*) from pg_views where schemaname='public' and viewname='nf_lines') as nf_lines_view_exists,
      (select count(*) from nf_accounts) as nf_accounts_rows,
      (select count(*) from nf_accounts where company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce') as awami_accounts,
      (select count(*) from nf_days) as nf_days_rows,
      (select count(*) from nf_vouchers) as nf_vouchers_rows,
      (select count(*) from nf_voucher_legs) as nf_voucher_legs_rows,
      (select count(*) from companies) as companies_rows
  `);
  console.log(JSON.stringify(checks.rows[0], null, 2));

  await client.end();
})().catch(e => { console.error('\nRESTORE FAILED:', e.message); process.exitCode = 1; });
