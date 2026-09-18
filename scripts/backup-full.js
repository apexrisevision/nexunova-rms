#!/usr/bin/env node
/**
 * Nexunova RMS - full off-platform backup.
 *
 * Does NOT rely on Supabase's own backups (the free plan gives no downloadable
 * dump). It reads every row of every public table through the Supabase
 * Management API (token comes from .mcp.json) and writes, into
 * backups/BACKUP_<stamp>/:
 *
 *   schema/      DDL: types, tables, constraints, indexes, views, functions,
 *                triggers, RLS policies, sequence positions, grants
 *   data/        one JSON file per table - exact rows, all tenants
 *   sql/         one INSERT script per table + restore_all.sql
 *   excel/       one human-readable .xlsx per tenant (KBH / FMH / Awami ...)
 *                plus _SHARED.xlsx for tables that carry no company_id
 *   storage/     the actual files from Supabase Storage
 *   MANIFEST.json
 *
 * Usage:
 *   node scripts/backup-full.js                 full backup
 *   node scripts/backup-full.js --skip-audit    skip audit_logs (the 74 MB table)
 *   node scripts/backup-full.js --no-storage    skip file downloads
 *   node scripts/backup-full.js --out D:/path   write somewhere else (e.g. a USB drive)
 */

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq.js');

// ── Finding O (2026-09-16) ──────────────────────────────────────────────────
// This script used to hold the whole database in memory (every table's rows,
// and then every row again per tenant for the Excel phase). On 2026-09-16 the
// OS killed it mid-run; a killed process runs no catch, so it wrote no manifest,
// printed no error, and the shell reported exit 0. 236 MB of half a backup looked
// exactly like a good one.
//
// Now: pages are streamed to disk and never accumulated, the heap limit is
// raised explicitly, row counts taken at the start are checked at the end, the
// manifest is written last, and a DONE file is the final action.
//
//   A directory without DONE *and* MANIFEST.json is a FAILED backup,
//   whatever the exit code says.  `--verify <dir>` answers that question.
// ────────────────────────────────────────────────────────────────────────────

// Raise the heap before doing any work: re-exec once, with the same arguments.
if (!process.env.NXN_BACKUP_CHILD) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NXN_BACKUP_CHILD: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

// A crash or a rejected promise must fail loudly, not end the run quietly.
process.on('unhandledRejection', e => { console.error('\nBACKUP FAILED (unhandled rejection):', e && e.message || e); process.exit(1); });
process.on('uncaughtException', e => { console.error('\nBACKUP FAILED (uncaught exception):', e && e.message || e); process.exit(1); });

const args = process.argv.slice(2);
const SKIP_AUDIT = args.includes('--skip-audit');
const NO_STORAGE = args.includes('--no-storage');
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const p2 = n => String(n).padStart(2, '0');
const now = new Date();   // folder is stamped in local (Pakistan) time, not UTC
const STAMP = '' + now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) +
  '_' + p2(now.getHours()) + p2(now.getMinutes());
// --into <existing BACKUP_ dir> continues an interrupted run: any table whose
// data/<table>.json is already written is re-read from disk instead of re-queried.
const INTO = arg('--into');
const OUT = arg('--out');
const ROOT = INTO ? path.resolve(INTO)
  : OUT ? path.resolve(OUT, 'BACKUP_' + STAMP)
  : path.join(__dirname, '..', 'backups', 'BACKUP_' + STAMP);
const RESUME = !!INTO;

// audit_logs is a 74 MB append-only trail - kept in data/ and sql/, left out of
// the Excel workbooks so they stay openable.
const EXCEL_EXCLUDE = new Set(['audit_logs', 'audit_log_archive']);

// --only schema,data,excel,storage lets a long run be finished in stages
// (together with --into). Default: every phase.
const ONLY = arg('--only');
const doPhase = p => !ONLY || ONLY.split(',').map(s => s.trim()).includes(p);

const PAGE = 1000;                     // rows per request, ordered by primary key
const DONE_FILE = 'DONE';
const log = (...a) => console.log(...a);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const mem = () => {
  const m = process.memoryUsage();
  return 'heap ' + mb(m.heapUsed) + ' · rss ' + mb(m.rss);
};

// ── --verify <dir> : is this directory a finished backup? ───────────────────
if (args.includes('--verify')) {
  const dir = path.resolve(args[args.indexOf('--verify') + 1] || '.');
  const problems = [];
  const has = f => fs.existsSync(path.join(dir, f));
  if (!has(DONE_FILE)) problems.push('no DONE marker');
  if (!has('MANIFEST.json')) problems.push('no MANIFEST.json');
  let man = null;
  if (has('MANIFEST.json')) {
    try { man = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')); }
    catch (e) { problems.push('MANIFEST.json is not readable: ' + e.message); }
  }
  if (man) {
    if (!man.complete) problems.push('MANIFEST.json does not say complete');
    for (const [t, n] of Object.entries(man.tables || {})) {
      const f = path.join(dir, 'data', t + '.json');
      if (!fs.existsSync(f)) { problems.push('data/' + t + '.json missing'); continue; }
      let rows;
      try { rows = JSON.parse(fs.readFileSync(f, 'utf8')).length; }
      catch (e) { problems.push('data/' + t + '.json unreadable: ' + e.message); continue; }
      if (rows !== n) problems.push(`data/${t}.json holds ${rows} rows, the manifest says ${n}`);
    }
    if (man.mismatches && man.mismatches.length) problems.push(man.mismatches.length + ' table(s) did not match the live counts');
  }
  console.log('[verify] ' + dir);
  if (man) console.log('  taken ' + man.taken_at + ' · ' + Object.keys(man.tables || {}).length + ' tables · ' +
    Object.values(man.tables || {}).reduce((a, b) => a + b, 0).toLocaleString() + ' rows');
  if (problems.length) {
    console.log('  FAILED — ' + problems.length + ' problem(s):');
    problems.slice(0, 20).forEach(p => console.log('    ✗ ' + p));
    process.exit(1);
  }
  console.log('  PASS — DONE marker present, manifest complete, every table file matches its manifest count.');
  process.exit(0);
}
const mk = d => { fs.mkdirSync(d, { recursive: true }); return d; };
const w = (f, s) => fs.writeFileSync(f, s, 'utf8');

// -- SQL literal encoding ------------------------------------------------
const qstr = s => "'" + String(s).replace(/'/g, "''") + "'";
const NUMERIC = /^(smallint|integer|bigint|numeric|real|double precision|money|oid)(\(.*\))?$/;

function pgArray(v) {
  const parts = v.map(el => {
    if (el === null || el === undefined) return 'NULL';
    const s = typeof el === 'object' ? JSON.stringify(el) : String(el);
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  });
  return '{' + parts.join(',') + '}';
}

function lit(v, typ) {
  if (v === null || v === undefined) return 'NULL';
  if (typ.endsWith('[]')) return qstr(Array.isArray(v) ? pgArray(v) : v) + '::' + typ;
  if (typ === 'boolean') return v ? 'true' : 'false';
  if (typ === 'json' || typ === 'jsonb') return qstr(JSON.stringify(v)) + '::' + typ;
  if (NUMERIC.test(typ)) {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : qstr(String(v)) + '::' + typ;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return v;
  }
  if (typeof v === 'object') return qstr(JSON.stringify(v));
  return qstr(v);
}

const ident = n => '"' + String(n).replace(/"/g, '""') + '"';

// -- main ----------------------------------------------------------------
(async function main() {
  const started = Date.now();
  log('Nexunova RMS backup - project ' + REF);
  log('Output: ' + ROOT + '\n');
  mk(ROOT); mk(path.join(ROOT, 'schema')); mk(path.join(ROOT, 'data'));
  mk(path.join(ROOT, 'sql')); mk(path.join(ROOT, 'excel'));

  // ---------- 1. inventory ----------
  const tables = (await q(
    "select c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
    "where n.nspname = 'public' and c.relkind = 'r' order by c.relname")).map(r => r.tbl);

  const colRows = await q(
    "select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ, " +
    'a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as ident, ' +
    'a.attgenerated as gen, a.attnum ' +
    "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
    "join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped " +
    "left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum " +
    "where n.nspname = 'public' and c.relkind = 'r' order by c.relname, a.attnum");

  const cols = {};
  for (const r of colRows) (cols[r.tbl] = cols[r.tbl] || []).push(r);

  // Real gap, found backing up a non-RMS-shaped database for the first
  // time (the retired CRM project, 2026-09-18): this only ever assumed a
  // companies(id, company_name) table, which is an RMS convention, not a
  // guarantee about every Postgres database this tool might ever point
  // at. Used only for cosmetic per-tenant labeling in the Excel phase
  // (line ~534) - falls back to an empty list rather than crashing the
  // whole backup when it doesn't match, instead of assuming every target
  // is RMS-shaped.
  let companies = [];
  try { companies = await q('select id, company_name from companies order by company_name'); }
  catch (e) { log('  (no RMS-shaped companies(id, company_name) table - tenant labeling skipped: ' + e.message.split('\n')[0] + ')'); }
  log('Tables: ' + tables.length + ' | Tenants: ' + companies.length + '\n');

  // ---------- 2. schema DDL ----------
  let fnCount = 0;
  if (doPhase('schema')) {
  log('-- schema --');
  const S = f => path.join(ROOT, 'schema', f);

  const enums = await q(
    "select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid " +
    "join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' " +
    'order by t.typname, e.enumsortorder');
  const byEnum = {};
  for (const e of enums) (byEnum[e.typname] = byEnum[e.typname] || []).push(e.enumlabel);
  const typesSql = '-- enum types\n' + Object.entries(byEnum).map(([n, v]) =>
    'CREATE TYPE public.' + ident(n) + ' AS ENUM (' + v.map(qstr).join(', ') + ');').join('\n') + '\n';

  // Real bug, found 2026-09-18 restoring a backup for real (the org's
  // first-ever restore test, Pro plan, into a scratch project — "an
  // untested backup doesn't count"): a column whose DEFAULT is a plain
  // nextval('some_seq'::regclass) — the older pattern, distinct from a
  // GENERATED ... AS IDENTITY column, which creates its own sequence
  // automatically as part of CREATE TABLE — needs that sequence to
  // already exist, because casting text to regclass is a catalog lookup
  // done immediately, not deferred. 02_tables.sql emitted the DEFAULT
  // clause referencing the sequence but nothing anywhere ever emitted
  // CREATE SEQUENCE for it (09_sequences.sql only ever emitted setval(),
  // assuming the sequence already existed). On a truly empty target this
  // made 02_tables.sql fail outright on the first such table — audit_logs,
  // near the very start of the alphabetical table list — aborting the
  // rest of that file entirely (every table after it, all of nf_
  // included, was never created at all). Found immediately, at the first
  // real restore attempt, not by inspection.
  const seqDefaultTables = tables.filter(t => cols[t].some(c => c.def && /nextval\(/.test(c.def)));
  const seqNames = new Set();
  for (const t of seqDefaultTables) {
    for (const c of cols[t]) {
      const m = c.def && c.def.match(/nextval\('(?:[^'.]+\.)?"?([^'".]+)"?'::regclass\)/);
      if (m) seqNames.add(m[1]);
    }
  }
  let seqPrecreateSql = '';
  if (seqNames.size) {
    const seqDefs = await q(
      "select sequencename, data_type, start_value, min_value, max_value, increment_by, cycle, cache_size " +
      "from pg_sequences where schemaname = 'public' and sequencename = ANY(ARRAY[" +
      [...seqNames].map(qstr).join(',') + "])");
    seqPrecreateSql = '\n-- sequences a plain DEFAULT nextval(...) references directly (not one a\n' +
      '-- GENERATED ... AS IDENTITY column would create for itself) — must exist\n' +
      '-- before 02_tables.sql runs, since \'name\'::regclass is resolved immediately.\n' +
      seqDefs.map(s => 'CREATE SEQUENCE IF NOT EXISTS public.' + ident(s.sequencename) +
        ' AS ' + s.data_type + ' START WITH ' + s.start_value + ' INCREMENT BY ' + s.increment_by +
        ' MINVALUE ' + s.min_value + ' MAXVALUE ' + s.max_value + ' CACHE ' + s.cache_size +
        (s.cycle ? ' CYCLE' : ' NO CYCLE') + ';').join('\n') + '\n';
  }
  w(S('01_types.sql'), typesSql + seqPrecreateSql);

  const ddl = tables.map(t => {
    const body = cols[t].map(c => {
      let line = '  ' + ident(c.col) + ' ' + c.typ;
      if (c.gen === 's') line += ' GENERATED ALWAYS AS (' + c.def + ') STORED';
      else if (c.ident === 'a') line += ' GENERATED ALWAYS AS IDENTITY';
      else if (c.ident === 'd') line += ' GENERATED BY DEFAULT AS IDENTITY';
      else if (c.def) line += ' DEFAULT ' + c.def;
      if (c.notnull) line += ' NOT NULL';
      return line;
    }).join(',\n');
    return 'CREATE TABLE IF NOT EXISTS public.' + ident(t) + ' (\n' + body + '\n);';
  }).join('\n\n');
  w(S('02_tables.sql'), '-- table definitions\n' + ddl + '\n');

  // Real bug, found the same restore run as the sequence one above:
  // contype = 't' (a constraint TRIGGER — nf_voucher_balance_check and
  // nf_accounts_tree_guard, the deferred-constraint-trigger half of this
  // project's double-entry balance enforcement) was included here.
  // pg_get_constraintdef() for one returns only the fragment "TRIGGER
  // DEFERRABLE INITIALLY DEFERRED" — valid nowhere near an ALTER TABLE
  // ADD CONSTRAINT statement, which is a syntax error, not a different
  // dialect. A constraint trigger is fully, correctly captured already,
  // as a real CREATE CONSTRAINT TRIGGER statement, by the ordinary
  // triggers export a few steps later (07_triggers.sql) — pg_trigger
  // carries constraint triggers too. Excluded here as pure duplication
  // of something the other export already gets right, not patched to
  // "work" as an ALTER TABLE fragment it was never one to begin with.
  const cons = await q(
    "select c.conrelid::regclass::text as tbl, c.conname, c.contype, pg_get_constraintdef(c.oid) as def " +
    "from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' " +
    "and c.contype <> 't' " +
    "order by case c.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end, c.conrelid::regclass::text");
  w(S('03_constraints.sql'), '-- primary keys, uniques, checks, then foreign keys\n' +
    cons.map(c => 'ALTER TABLE ' + c.tbl + ' ADD CONSTRAINT ' + ident(c.conname) + ' ' + c.def + ';').join('\n') + '\n');

  const idx = await q("select indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname");
  w(S('04_indexes.sql'), '-- indexes (PK/unique indexes come from 03_constraints.sql)\n' +
    idx.map(i => i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, (m, u) => 'CREATE ' + (u || '') + 'INDEX IF NOT EXISTS ') + ';').join('\n') + '\n');

  const views = await q(
    "select c.relname, pg_get_viewdef(c.oid, true) as def, c.relkind from pg_class c " +
    "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m') order by c.relname");
  w(S('05_views.sql'), views.map(v => 'CREATE OR REPLACE ' + (v.relkind === 'm' ? 'MATERIALIZED ' : '') +
    'VIEW public.' + ident(v.relname) + ' AS\n' + v.def + '\n').join('\n') + '\n');

  const fns = await q(
    "select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def from pg_proc p " +
    "join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p') order by p.proname");
  w(S('06_functions.sql'), '-- every RPC / function in the public schema\n' +
    fns.map(f => '-- ' + f.sig + '\n' + f.def + ';\n').join('\n'));

  const trgs = await q(
    'select t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid ' +
    "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal " +
    'order by c.relname, t.tgname');
  w(S('07_triggers.sql'), trgs.map(t => t.def + ';').join('\n') + '\n');

  const pols = await q("select * from pg_policies where schemaname = 'public' order by tablename, policyname");
  w(S('08_policies.sql'), '-- row level security\n' +
    [...new Set(pols.map(p => p.tablename))].map(t =>
      'ALTER TABLE public.' + ident(t) + ' ENABLE ROW LEVEL SECURITY;').join('\n') + '\n\n' +
    pols.map(p => {
      let s = 'CREATE POLICY ' + ident(p.policyname) + ' ON public.' + ident(p.tablename);
      if (p.permissive === 'RESTRICTIVE') s += ' AS RESTRICTIVE';
      s += ' FOR ' + p.cmd + ' TO ' + String(p.roles).replace(/[{}]/g, '');
      if (p.qual) s += ' USING (' + p.qual + ')';
      if (p.with_check) s += ' WITH CHECK (' + p.with_check + ')';
      return s + ';';
    }).join('\n') + '\n');

  const seqs = await q("select sequencename, last_value from pg_sequences where schemaname = 'public'");
  w(S('09_sequences.sql'), '-- run AFTER the data is restored\n' +
    seqs.filter(s => s.last_value !== null).map(s =>
      "SELECT setval('public." + s.sequencename + "', " + s.last_value + ', true);').join('\n') + '\n');

  const grants = await q(
    'select grantee, privilege_type, table_name from information_schema.role_table_grants ' +
    "where table_schema = 'public' and grantee in ('anon','authenticated','service_role') order by table_name, grantee");
  w(S('10_grants.sql'), grants.map(g =>
    'GRANT ' + g.privilege_type + ' ON public.' + ident(g.table_name) + ' TO ' + g.grantee + ';').join('\n') + '\n');

  log('  types ' + Object.keys(byEnum).length + ' | tables ' + tables.length +
      ' | constraints ' + cons.length + ' | indexes ' + idx.length);
  fnCount = fns.length;
  log('  views ' + views.length + ' | functions ' + fns.length +
      ' | triggers ' + trgs.length + ' | policies ' + pols.length + '\n');
  }

  // ---------- 3. data ----------
  const prior = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')); } catch { return {}; }
  })();
  const manifest = {
    project: REF, taken_at: prior.taken_at || new Date().toISOString(), companies,
    tables: prior.tables || {}, storage: prior.storage || {}, functions: fnCount || prior.functions || 0
  };
  let grandRows = 0;
  const SHARDS = path.join(ROOT, '_shards');       // per-tenant spool for the Excel phase
  const sharedTables = [];                          // tables with no company_id, for _SHARED.xlsx

  const needRows = doPhase('data') || doPhase('excel');

  // Primary keys, for ordered paging. A table without one falls back to ctid.
  const pkRows = needRows ? await q(
    `select c.relname tbl, a.attname col, array_position(i.indkey::int2[], a.attnum) ord, format_type(a.atttypid, a.atttypmod) typ
       from pg_index i join pg_class c on c.oid = i.indrelid
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where i.indisprimary and c.relnamespace = 'public'::regnamespace
      order by 1, 3`) : [];
  const pks = {};
  for (const r of pkRows) (pks[r.tbl] = pks[r.tbl] || []).push(r);

  // Live row counts, taken NOW, so the manifest can be checked against them at the end.
  const liveCounts = {};
  if (needRows) {
    log('-- live row counts (the figure the manifest is checked against) --');
    for (let i = 0; i < tables.length; i += 25) {
      const chunk = tables.slice(i, i + 25);
      const rows = await q(chunk.map(t => `select ${qstr(t)} t, count(*)::bigint n from public.${ident(t)}`).join(' union all '));
      for (const r of rows) liveCounts[r.t] = Number(r.n);
    }
    log('  ' + Object.keys(liveCounts).length + ' tables · ' +
        Object.values(liveCounts).reduce((a, b) => a + b, 0).toLocaleString() + ' rows\n');
  }
  manifest.live_counts_at_start = liveCounts;
  manifest.started_at = new Date().toISOString();

  if (needRows) log('-- data (streamed: 1,000 rows per request, appended to disk, never held in memory) --');
  for (const t of (needRows ? tables : [])) {
    if (SKIP_AUDIT && (t === 'audit_logs' || t === 'audit_log_archive')) { log('  ' + t + ' - skipped'); continue; }
    const tcols = cols[t];
    const hasCid = tcols.some(c => c.col === 'company_id');
    const typs = Object.fromEntries(tcols.map(c => [c.col, c.typ]));
    const insertCols = tcols.filter(c => c.gen !== 's').map(c => c.col);
    // Real bug, found the same restore run as the sequence/constraint-
    // trigger/index-ordering ones: a GENERATED ALWAYS AS IDENTITY column
    // (nf_audit.id, location_history.id) refuses an explicit value in its
    // INSERT unless the statement says OVERRIDING SYSTEM VALUE - "cannot
    // insert a non-DEFAULT value into column \"id\"" on a truly fresh
    // target. GENERATED BY DEFAULT (ident === 'd') columns don't need
    // this - only ALWAYS does.
    const overriding = tcols.some(c => c.ident === 'a') ? ' OVERRIDING SYSTEM VALUE' : '';
    const head = 'INSERT INTO public.' + ident(t) + ' (' + insertCols.map(ident).join(', ') + ')' + overriding + ' VALUES\n';

    const dataFile = path.join(ROOT, 'data', t + '.json');
    const sqlFile = path.join(ROOT, 'sql', t + '.sql');
    if (RESUME && fs.existsSync(dataFile) && fs.existsSync(sqlFile)) {
      let n = 0;
      try { n = JSON.parse(fs.readFileSync(dataFile, 'utf8')).length; } catch { n = -1; }
      if (n >= 0) {
        manifest.tables[t] = n; grandRows += n;
        log('  ' + t.padEnd(44) + String(n).padStart(8) + ' rows  (already on disk)');
        continue;
      }
    }

    const pk = pks[t];
    const order = pk ? pk.map(c => ident(c.col)).join(', ') : 'ctid';
    const data = fs.createWriteStream(dataFile);
    const sqlOut = fs.createWriteStream(sqlFile);
    const shardStreams = new Map();
    data.write('[');
    sqlOut.write('-- ' + t + '\n');

    let n = 0, last = null, page = PAGE, valueBuf = [], bytes = 0;
    const flushSql = () => {
      if (!valueBuf.length) return;
      sqlOut.write(head + valueBuf.join(',\n') + '\nON CONFLICT DO NOTHING;\n\n');
      valueBuf = [];
    };
    for (;;) {
      let where = '';
      if (last) {
        if (pk) {
          where = ' where (' + pk.map(c => ident(c.col)).join(', ') + ') > (' +
                  pk.map(c => lit(last[c.col], c.typ)).join(', ') + ')';
        } else {
          where = ' where ctid > ' + qstr(last.__ctid) + '::tid';
        }
      }
      const select = pk ? 'select * from public.' + ident(t)
                        : 'select *, ctid::text __ctid from public.' + ident(t);
      let batch;
      try {
        batch = await q(select + where + ' order by ' + order + ' limit ' + page);
      } catch (e) {
        if (page > 50) { page = Math.floor(page / 4); continue; }   // response too big -> smaller pages
        data.destroy(); sqlOut.destroy();
        throw new Error(`${t}: ${e.message}`);
      }
      if (!batch.length) break;
      for (const r of batch) {
        const row = { ...r };
        delete row.__ctid;
        const line = JSON.stringify(row);
        bytes += line.length;
        data.write((n ? ',\n' : '\n') + line);
        valueBuf.push('(' + insertCols.map(c => lit(row[c], typs[c])).join(', ') + ')');
        if (valueBuf.length >= 200) flushSql();
        if (!EXCEL_EXCLUDE.has(t)) {
          const cid = hasCid ? (row.company_id || '_null') : null;
          if (cid) {
            let s = shardStreams.get(cid);
            if (!s) {
              mk(path.join(SHARDS, cid));
              s = fs.createWriteStream(path.join(SHARDS, cid, t + '.jsonl'));
              shardStreams.set(cid, s);
            }
            s.write(line + '\n');
          }
        }
        n++;
      }
      last = batch[batch.length - 1];
      if (batch.length < page) break;
      process.stdout.write('\r  ' + t.padEnd(44) + String(n).padStart(8) + ' rows · ' + mem() + '   ');
    }
    flushSql();
    data.write(n ? '\n]\n' : ']\n');
    await Promise.all([
      new Promise(res => data.end(res)),
      new Promise(res => sqlOut.end(res)),
      ...[...shardStreams.values()].map(s => new Promise(res => s.end(res))),
    ]);
    if (!n) fs.unlinkSync(sqlFile);
    if (!hasCid && n && !EXCEL_EXCLUDE.has(t)) sharedTables.push(t);

    grandRows += n;
    manifest.tables[t] = n;
    const flag = liveCounts[t] === undefined ? '' : (n === liveCounts[t] ? '' : `  ← live said ${liveCounts[t]}`);
    process.stdout.write('\r  ' + t.padEnd(44) + String(n).padStart(8) + ' rows · ' + mb(bytes).padStart(9) +
                         ' · ' + mem() + flag + '\n');
  }
  if (needRows) log('  -> ' + grandRows.toLocaleString() + ' rows across ' +
    Object.keys(manifest.tables).length + ' tables\n');

  if (doPhase('data')) w(path.join(ROOT, 'sql', 'restore_all.sql'),
    '-- Restore every table. FK checks are disabled for the load, so table order does not matter.\n' +
    '-- Usage:  psql "<connection string>" -v ON_ERROR_STOP=1 -f restore_all.sql\n\n' +
    'BEGIN;\nSET session_replication_role = replica;\n\n' +
    tables.filter(t => manifest.tables[t]).map(t => '\\i ' + t + '.sql').join('\n') +
    '\n\nSET session_replication_role = DEFAULT;\nCOMMIT;\n\n\\i ../schema/09_sequences.sql\n');

  // ---------- 4. Excel ----------
  if (doPhase('excel')) {
  log('-- excel --');
  const XLSX = require('xlsx');
  const clean = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 32000);
    if (typeof v === 'string' && v.length > 32000) return v.slice(0, 32000);
    return v;
  };
  const sheetName = (used, t) => {
    let n = t.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31);
    let i = 2;
    while (used.has(n)) { n = (t.slice(0, 28) + '_' + i++).slice(0, 31); }
    used.add(n);
    return n;
  };
  // Sheets are built one at a time from what the data phase spooled to disk, so
  // no tenant's rows — and never the whole database — sit in the heap (Finding O).
  const readJsonl = f => {
    const rows = [];
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
    return rows;
  };
  const readJsonArray = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };

  function workbook(file, sources, title) {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const names = Object.keys(sources).sort();
    const idxRows = [[title], ['Taken', new Date().toISOString()], [], ['Sheet', 'Table', 'Rows']];
    const counts = {};
    for (const t of names) {
      const rows = sources[t]();            // read, write the sheet, drop the rows
      if (!rows.length) continue;
      counts[t] = rows.length;
      idxRows.push([t.slice(0, 31), t, rows.length]);
      const hdr = Object.keys(rows[0]);
      const aoa = [hdr, ...rows.map(r => hdr.map(h => clean(r[h])))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(used, t));
    }
    // the index sheet goes first
    const idx = XLSX.utils.aoa_to_sheet(idxRows);
    const idxName = sheetName(used, '00_INDEX');
    XLSX.utils.book_append_sheet(wb, idx, idxName);
    wb.SheetNames = [idxName, ...wb.SheetNames.filter(n => n !== idxName)];
    XLSX.writeFile(wb, file);
    return { sheets: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  const nameOf = id => (companies.find(c => c.id === id) || {}).company_name || id;
  const safe = s => String(s).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
  const shardDirs = fs.existsSync(SHARDS) ? fs.readdirSync(SHARDS) : [];
  for (const cid of shardDirs) {
    const dir = path.join(SHARDS, cid);
    const sources = {};
    for (const f of fs.readdirSync(dir)) sources[f.replace(/\.jsonl$/, '')] = () => readJsonl(path.join(dir, f));
    const label = cid === '_null' ? 'NO_COMPANY_ID' : nameOf(cid);
    const file = path.join(ROOT, 'excel', safe(label) + '.xlsx');
    const r = workbook(file, sources, 'Nexunova RMS backup - ' + label);
    log('  ' + path.basename(file).padEnd(40) + r.sheets + ' sheets, ' + r.rows.toLocaleString() + ' rows · ' + mem());
  }
  const sharedSources = {};
  for (const t of sharedTables) sharedSources[t] = () => readJsonArray(path.join(ROOT, 'data', t + '.json'));
  const sh = workbook(path.join(ROOT, 'excel', '_SHARED.xlsx'), sharedSources,
    'Nexunova RMS backup - shared / platform tables');
  log('  _SHARED.xlsx'.padEnd(42) + sh.sheets + ' sheets, ' + sh.rows.toLocaleString() + ' rows\n');
  }

  // ---------- 5. storage ----------
  if (doPhase('storage') && !NO_STORAGE) {
    log('-- storage --');
    const objs = await q(
      "select o.name, o.bucket_id, b.public, (o.metadata->>'size')::bigint as size " +
      'from storage.objects o join storage.buckets b on b.id = o.bucket_id order by o.bucket_id, o.name');
    // Private buckets need a service key. Optional: put SUPABASE_SERVICE_KEY=... in
    // .env.local (gitignored) and private files get downloaded too.
    let SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
    if (!SERVICE_KEY) {
      try {
        const m = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
          .match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+)\s*$/m);
        if (m) SERVICE_KEY = m[1].trim().replace(/^["']|["']$/g, '');
      } catch { /* no .env.local - public buckets only */ }
    }
    if (SERVICE_KEY) log('  service key found - private buckets included');

    let ok = 0;
    const failed = [];
    for (const o of objs) {
      const dest = path.join(ROOT, 'storage', o.bucket_id, ...o.name.split('/'));
      mk(path.dirname(dest));
      // already downloaded by an earlier (interrupted) run
      if (fs.existsSync(dest) && (!o.size || fs.statSync(dest).size === Number(o.size))) {
        ok++;
        process.stdout.write('\r  ' + ok + '/' + objs.length + ' files');
        continue;
      }
      const enc = o.name.split('/').map(encodeURIComponent).join('/');
      const useAuth = !o.public && SERVICE_KEY;
      const url = 'https://' + REF + '.supabase.co/storage/v1/object/' +
        (useAuth ? '' : 'public/') + o.bucket_id + '/' + enc;
      try {
        const res = await fetch(url, useAuth
          ? { headers: { Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY } }
          : undefined);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        ok++;
      } catch (e) {
        failed.push({ bucket: o.bucket_id, name: o.name, size: o.size, private: !o.public, reason: e.message });
      }
      process.stdout.write('\r  ' + ok + '/' + objs.length + ' files');
    }
    log('\r  downloaded ' + ok + '/' + objs.length + ' files' +
      (failed.length ? ' - ' + failed.length + ' could not be fetched' : ''));
    manifest.storage = { total: objs.length, downloaded: ok, failed };
    if (failed.length) {
      mk(path.join(ROOT, 'storage'));
      w(path.join(ROOT, 'storage', '_MISSING.json'), JSON.stringify(failed, null, 2));
      log('  private buckets need a service key: ' + [...new Set(failed.map(f => f.bucket))].join(', '));
    }
    log('');
  }

  // ---------- 6. check every table against the live counts ----------
  // A table may legitimately hold MORE rows than the count taken at the start —
  // people keep using RMS while this runs — but only if those rows are newer than
  // the start. Anything else fails the backup (Finding O).
  const mismatches = [];
  if (doPhase('data')) {
    log('-- checking every table against the counts taken at the start --');
    const tsCols = await q(
      `select table_name tbl, column_name col from information_schema.columns
        where table_schema = 'public' and column_name in ('created_at','changed_at','recorded_at')`);
    const tsOf = {};
    for (const r of tsCols) if (!tsOf[r.tbl] || r.col === 'created_at') tsOf[r.tbl] = r.col;

    for (const [t, want] of Object.entries(liveCounts)) {
      if (SKIP_AUDIT && (t === 'audit_logs' || t === 'audit_log_archive')) continue;
      const got = manifest.tables[t];
      if (got === want) continue;
      const extra = got - want;
      if (extra > 0 && tsOf[t]) {
        const [row] = await q(`select count(*)::int n from public.${ident(t)} where ${ident(tsOf[t])} >= ${qstr(manifest.started_at)}::timestamptz`);
        if (row.n >= extra) { log(`  ${t}: ${want} → ${got} (+${extra}); ${row.n} row(s) newer than the start — fine`); continue; }
      }
      mismatches.push({ table: t, live_at_start: want, backed_up: got });
      log(`  ✗ ${t}: live said ${want}, the backup holds ${got}`);
    }
    log(mismatches.length ? `  ${mismatches.length} table(s) do not match\n` : '  every table matches\n');
  }
  manifest.mismatches = mismatches;

  // ---------- 7. manifest + restore notes, written LAST ----------
  manifest.duration_sec = Math.round((Date.now() - started) / 1000);
  manifest.finished_at = new Date().toISOString();
  manifest.complete = mismatches.length === 0;
  w(path.join(ROOT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

  const top = Object.entries(manifest.tables).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([t, n]) => '| ' + t + ' | ' + n.toLocaleString() + ' |').join('\n');
  w(path.join(ROOT, 'RESTORE.md'),
    '# Restore this backup\n\n' +
    'Taken: **' + manifest.taken_at + '** from Supabase project `' + REF + '`.\n' +
    'Contains ' + Object.values(manifest.tables).reduce((a, b) => a + b, 0).toLocaleString() + ' rows across ' +
    Object.keys(manifest.tables).length + ' tables and all ' + companies.length + ' tenants.\n\n' +
    '## What is in here\n\n' +
    '| Folder | What it is | Use it for |\n|---|---|---|\n' +
    '| `schema/` | DDL: types, tables, constraints, indexes, views, **all ' + manifest.functions +
      ' functions/RPCs**, triggers, RLS policies, sequences, grants | rebuilding an empty database |\n' +
    '| `sql/` | one INSERT script per table + `restore_all.sql` | putting the data back |\n' +
    '| `data/` | one JSON file per table, exact values | scripted/partial recovery, diffing |\n' +
    '| `excel/` | one workbook per tenant, one sheet per table | reading it by eye, sharing, manual re-entry |\n' +
    '| `storage/` | the actual uploaded files (receipts, documents, logos) | file recovery |\n\n' +
    // Real bugs, found 2026-09-18 on the org's first-ever restore test,
    // into a real scratch project:
    //  1. Some functional indexes (leads_company_normphone_idx, on
    //     _norm_phone(phone)) need their function to already exist -
    //     "function _norm_phone(text) does not exist" on a truly fresh
    //     target, since 04_indexes.sql used to run before
    //     06_functions.sql. Moved functions ahead of indexes below.
    //  2. nf_report_groups(uuid,text) needs public.nf_lines (a view) to
    //     already exist - moved views ahead of functions too. Checked
    //     first, both times, that nothing breaks the other way: no
    //     function here depends on a view, no view depends on a
    //     function, and there are no materialized views for an index to
    //     need.
    //  3. A function can call another function that sorts LATER
    //     alphabetically (06_functions.sql's own order) - Postgres does
    //     not track that as a catalog dependency for either SQL- or
    //     plpgsql-language functions (checked directly: zero pg_depend
    //     rows), so there is no way to pre-sort them correctly. A plain
    //     `-v ON_ERROR_STOP=1` run aborts entirely at the first forward
    //     reference. If schema/06_functions.sql fails this way, drop
    //     ON_ERROR_STOP and run it again - CREATE OR REPLACE FUNCTION is
    //     idempotent, and everything created before the failure point on
    //     the first pass makes the second pass's forward references
    //     resolve. Two passes has been enough every time this was hit.
    '## Full restore into a fresh Postgres / new Supabase project\n\n' +
    '```bash\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/01_types.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/02_tables.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/03_constraints.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/05_views.sql\n' +
    'psql "<connection string>" -f schema/06_functions.sql   # no ON_ERROR_STOP - see note 3 above; run twice if it errors\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/04_indexes.sql\n' +
    'cd sql && psql "<connection string>" -f restore_all.sql && cd ..\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/07_triggers.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/08_policies.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/10_grants.sql\n' +
    '```\n\n' +
    '`restore_all.sql` turns FK checks off for the load, so table order does not matter, and it\n' +
    'runs `schema/09_sequences.sql` at the end so the next generated id continues correctly.\n' +
    'Every INSERT ends in `ON CONFLICT DO NOTHING`, so re-running it is safe.\n\n' +
    '## Recovering just one table (the usual case)\n\n' +
    '```bash\n' +
    'psql "<connection string>" -c "SET session_replication_role = replica" -f sql/units.sql\n' +
    '```\n\n' +
    '## Not covered by this backup\n\n' +
    '- **auth users / passwords** live in Supabase `auth.*`, not in the public schema.\n' +
    '  A password reset is needed for each login after a restore into a new project.\n' +
    '- **Edge Functions, cron jobs and project settings** - those live in the repo and the dashboard.\n' +
    (manifest.storage && manifest.storage.failed && manifest.storage.failed.length
      ? '- **' + manifest.storage.failed.length + ' files in private storage buckets** - see `storage/_MISSING.json`.\n'
      : '') +
    '\n## Biggest tables in this snapshot\n\n| Table | Rows |\n|---|---|\n' + top + '\n');

  // the per-tenant spool is only needed while the workbooks are being written
  if (doPhase('excel') && fs.existsSync(SHARDS)) fs.rmSync(SHARDS, { recursive: true, force: true });

  const du = d => fs.readdirSync(d, { withFileTypes: true })
    .reduce((a, e) => a + (e.isDirectory() ? du(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);

  if (mismatches.length) {
    console.error('\nBACKUP FAILED: ' + mismatches.length + ' table(s) do not match the live counts taken at the start.');
    console.error(JSON.stringify(mismatches.slice(0, 10), null, 2));
    console.error('No DONE marker written. This directory is NOT a usable backup.');
    process.exit(1);
  }

  // The last action, and the only thing that makes this directory a backup.
  w(path.join(ROOT, DONE_FILE),
    'Finished ' + manifest.finished_at + '\n' +
    Object.keys(manifest.tables).length + ' tables · ' +
    Object.values(manifest.tables).reduce((a, b) => a + b, 0).toLocaleString() + ' rows\n' +
    'Verify with:  node scripts/backup-full.js --verify "' + ROOT + '"\n');
  log('DONE in ' + manifest.duration_sec + 's - ' + (du(ROOT) / 1048576).toFixed(1) + ' MB at\n' + ROOT);
  log('Verify with:  node scripts/backup-full.js --verify "' + ROOT + '"');
})().catch(e => { console.error('\nBACKUP FAILED:', e && e.stack || e); process.exit(1); });
