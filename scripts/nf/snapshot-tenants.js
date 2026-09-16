/**
 * NexuFinance v1 — proves an apply touched nothing but nf_ objects. Read-only.
 *
 *   node scripts/nf/snapshot-tenants.js --out before.json
 *   … apply …
 *   node scripts/nf/snapshot-tenants.js --out after.json --compare before.json
 *
 * Captures, for EVERY tenant (not a list of names that could be wrong):
 *   · row count per company for every public base table with a company_id
 *   · payments: count and sum(amount) per company
 *   · md5 fingerprints of every non-nf_ trigger, function body, policy and
 *     table column list in public
 *
 * The one expected difference after applying 20260916a–d is nothing at all
 * outside nf_: the nf_ tables are excluded from the tenant counts and the
 * fingerprints by name, and are reported separately.
 *
 * Exit (via process.exitCode): 0 identical / captured · 1 differs · 2 could not run.
 */
'use strict';

const fs = require('fs');
const { q } = require('../_sbq');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

(async () => {
  const out = arg('--out');
  const compare = arg('--compare');
  if (!out) { console.log('usage: --out <file> [--compare <file>]'); process.exitCode = 2; return; }

  let snap;
  try {
    const tables = await q(`select c.table_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'company_id' and c.table_name not like 'nf\\_%'
       order by 1`);
    const counts = {};
    // one query per table keeps each request small and a failure attributable
    for (const { table_name } of tables) {
      const rows = await q(`select company_id::text as c, count(*)::int as n from public."${table_name}" group by 1 order by 1`);
      counts[table_name] = Object.fromEntries(rows.map(r => [r.c, r.n]));
    }
    const [fp] = await q(`select json_build_object(
        'payments', (select json_object_agg(company_id, json_build_object('n', n, 'sum', s)) from
                       (select company_id::text, count(*) n, sum(amount)::text s from public.payments group by 1) x),
        'triggers', (select md5(string_agg(tgrelid::regclass::text||'.'||tgname||':'||pg_get_triggerdef(oid), '|' order by 1))
                       from pg_trigger where not tgisinternal and tgname not like 'nf\\_%'),
        'trigger_count', (select count(*) from pg_trigger where not tgisinternal and tgname not like 'nf\\_%'),
        'functions', (select md5(string_agg(p.oid::regprocedure::text||':'||pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text))
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                        and p.proname not like 'nf\\_%' and p.proname not like '\\_nf\\_%'),
        'function_count', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                        and p.proname not like 'nf\\_%' and p.proname not like '\\_nf\\_%'),
        'policies', (select md5(string_agg(tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by 1))
                       from pg_policies where schemaname = 'public' and tablename not like 'nf\\_%'),
        'columns', (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''), '|' order by table_name, ordinal_position))
                       from information_schema.columns where table_schema = 'public' and table_name not like 'nf\\_%'),
        'nf_tables', (select coalesce(json_agg(relname order by relname), '[]') from pg_class
                       where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'nf\\_%')) j`);
    snap = { taken_at: new Date().toISOString(), counts, ...fp.j };
  } catch (e) {
    console.log('COULD NOT RUN —', e.message);
    process.exitCode = 2;
    return;
  }

  fs.writeFileSync(out, JSON.stringify(snap, null, 2));
  const tenants = new Set(Object.values(snap.counts).flatMap(o => Object.keys(o)));
  console.log(`captured ${Object.keys(snap.counts).length} tables × ${tenants.size} tenants · triggers ${snap.trigger_count} · functions ${snap.function_count} · nf_ tables ${snap.nf_tables.length} → ${out}`);

  if (!compare) return;
  const before = JSON.parse(fs.readFileSync(compare, 'utf8'));
  const diffs = [];
  for (const k of ['payments', 'triggers', 'trigger_count', 'functions', 'function_count', 'policies', 'columns']) {
    if (JSON.stringify(before[k]) !== JSON.stringify(snap[k])) diffs.push(k);
  }
  const allTables = new Set([...Object.keys(before.counts), ...Object.keys(snap.counts)]);
  for (const t of allTables) {
    if (JSON.stringify(before.counts[t] || null) !== JSON.stringify(snap.counts[t] || null)) diffs.push(`counts.${t}`);
  }
  console.log(`nf_ tables: before ${JSON.stringify(before.nf_tables)} → after ${JSON.stringify(snap.nf_tables)}`);
  if (diffs.length) {
    console.log(`DIFFERS outside nf_: ${diffs.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('IDENTICAL outside nf_: every tenant\'s row counts, payment totals, triggers, functions, policies and columns.');
  }
})();
