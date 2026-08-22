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

const PAGE = 2000;
const log = (...a) => console.log(...a);
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

  const companies = await q('select id, company_name from companies order by company_name');
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
  w(S('01_types.sql'), '-- enum types\n' + Object.entries(byEnum).map(([n, v]) =>
    'CREATE TYPE public.' + ident(n) + ' AS ENUM (' + v.map(qstr).join(', ') + ');').join('\n') + '\n');

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

  const cons = await q(
    "select c.conrelid::regclass::text as tbl, c.conname, c.contype, pg_get_constraintdef(c.oid) as def " +
    "from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' " +
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
  const perCompany = {};
  const shared = {};
  let grandRows = 0;

  const needRows = doPhase('data') || doPhase('excel');
  for (const t of (needRows ? tables : [])) {
    if (SKIP_AUDIT && (t === 'audit_logs' || t === 'audit_log_archive')) { log('  ' + t + ' - skipped'); continue; }
    const tcols = cols[t];
    const hasCid = tcols.some(c => c.col === 'company_id');

    const dataFile = path.join(ROOT, 'data', t + '.json');
    let rows = [];
    let cached = false;
    if (RESUME && fs.existsSync(dataFile)) {
      try { rows = JSON.parse(fs.readFileSync(dataFile, 'utf8')); cached = true; } catch { rows = []; }
    }
    if (!cached) {
      let page = PAGE, off = 0;
      for (;;) {
        let batch;
        try {
          batch = await q('select * from public.' + ident(t) + ' order by ctid limit ' + page + ' offset ' + off);
        } catch (e) {
          if (page > 50) { page = Math.floor(page / 4); continue; }   // response too big -> smaller pages
          throw e;
        }
        rows.push(...batch);
        if (batch.length < page) break;
        off += batch.length;
        process.stdout.write('\r  ' + t + ' ... ' + rows.length);
      }
      fs.writeFileSync(dataFile, JSON.stringify(rows, null, rows.length > 5000 ? 0 : 1));
    }
    grandRows += rows.length;
    manifest.tables[t] = rows.length;

    if (rows.length && !(cached && fs.existsSync(path.join(ROOT, 'sql', t + '.sql')))) {
      // generated (computed) columns cannot be inserted into - Postgres recomputes them
      const names = tcols.filter(c => c.gen !== 's').map(c => c.col);
      const typs = Object.fromEntries(tcols.map(c => [c.col, c.typ]));
      const head = 'INSERT INTO public.' + ident(t) + ' (' + names.map(ident).join(', ') + ') VALUES\n';
      const out = ['-- ' + t + ': ' + rows.length + ' rows\n'];
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const vals = rows.slice(i, i + CHUNK)
          .map(r => '(' + names.map(n => lit(r[n], typs[n])).join(', ') + ')').join(',\n');
        out.push(head + vals + '\nON CONFLICT DO NOTHING;\n');
      }
      w(path.join(ROOT, 'sql', t + '.sql'), out.join('\n'));
    }

    if (!EXCEL_EXCLUDE.has(t)) {
      if (hasCid) {
        for (const r of rows) {
          const c = r.company_id || '_null';
          perCompany[c] = perCompany[c] || {};
          (perCompany[c][t] = perCompany[c][t] || []).push(r);
        }
      } else if (rows.length) {
        shared[t] = rows;
      }
    }
    process.stdout.write('\r  ' + t.padEnd(44) + String(rows.length).padStart(7) + ' rows' +
      (cached ? '  (already on disk)' : '') + '\n');
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
  function workbook(file, byTable, title) {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const names = Object.keys(byTable).filter(t => byTable[t].length).sort();
    const idxRows = [[title], ['Taken', new Date().toISOString()], [], ['Sheet', 'Table', 'Rows']];
    for (const t of names) idxRows.push([t.slice(0, 31), t, byTable[t].length]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(idxRows), sheetName(used, '00_INDEX'));
    for (const t of names) {
      const rows = byTable[t];
      const hdr = Object.keys(rows[0]);
      const aoa = [hdr, ...rows.map(r => hdr.map(h => clean(r[h])))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(used, t));
    }
    XLSX.writeFile(wb, file);
    return names.length;
  }

  const nameOf = id => (companies.find(c => c.id === id) || {}).company_name || id;
  const safe = s => String(s).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
  for (const [cid, byTable] of Object.entries(perCompany)) {
    const label = cid === '_null' ? 'NO_COMPANY_ID' : nameOf(cid);
    const f = path.join(ROOT, 'excel', safe(label) + '.xlsx');
    const n = workbook(f, byTable, 'Nexunova RMS backup - ' + label);
    const total = Object.values(byTable).reduce((a, b) => a + b.length, 0);
    log('  ' + path.basename(f).padEnd(40) + n + ' sheets, ' + total.toLocaleString() + ' rows');
  }
  const sharedSheets = workbook(path.join(ROOT, 'excel', '_SHARED.xlsx'), shared,
    'Nexunova RMS backup - shared / platform tables');
  log('  _SHARED.xlsx'.padEnd(42) + sharedSheets + ' sheets\n');
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

  // ---------- 6. manifest + restore notes ----------
  manifest.duration_sec = Math.round((Date.now() - started) / 1000);
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
    '## Full restore into a fresh Postgres / new Supabase project\n\n' +
    '```bash\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/01_types.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/02_tables.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/03_constraints.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/04_indexes.sql\n' +
    'cd sql && psql "<connection string>" -f restore_all.sql && cd ..\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/05_views.sql\n' +
    'psql "<connection string>" -v ON_ERROR_STOP=1 -f schema/06_functions.sql\n' +
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

  const du = d => fs.readdirSync(d, { withFileTypes: true })
    .reduce((a, e) => a + (e.isDirectory() ? du(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  log('DONE in ' + manifest.duration_sec + 's - ' + (du(ROOT) / 1048576).toFixed(1) + ' MB at\n' + ROOT);
})().catch(e => { console.error('\nBACKUP FAILED:', e.message); process.exit(1); });
