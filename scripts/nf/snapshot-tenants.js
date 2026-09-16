/**
 * NexuFinance v1 — proves an apply touched nothing but nf_ objects. Read-only.
 *
 *   node scripts/nf/snapshot-tenants.js --out before.jsonl
 *   … apply …
 *   node scripts/nf/snapshot-tenants.js --out after.jsonl --compare before.jsonl
 *
 * Streams to disk: one JSON line per table, written the moment that table is
 * counted, then one line per fingerprint. In --compare mode each line is
 * checked against the baseline as soon as it is captured, so nothing
 * accumulates in memory and a run that dies still leaves its lines on disk.
 *
 * Captures, for EVERY tenant (not a list of names that could be wrong):
 *   · row count per company for every public base table with a company_id
 *   · payments: count and sum(amount) per company
 *   · md5 fingerprints of every non-nf_ trigger, function body, policy and
 *     column list in public
 * nf_ tables are excluded by name and reported on their own line.
 *
 * VERDICTS in --compare mode
 *   · fingerprints and payments (count + sum per tenant): must be IDENTICAL.
 *   · row counts: RMS is live, so people add rows while this runs (seen on the
 *     first clean compare, 2026-09-16: two reservation requests from the
 *     availability link and sales-app location pings). A tenant's count may only
 *     go UP, and by no more than the rows in that table timestamped after the
 *     baseline started — then it is EXPLAINED, with the evidence printed. A
 *     decrease, an increase larger than the timestamped rows, or a table with no
 *     timestamp column is DIFFERS.
 *
 * Exit (via process.exitCode): 0 captured / identical-or-explained · 1 differs · 2 could not run.
 */
'use strict';

const fs = require('fs');
const { q } = require('../_sbq');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

const FINGERPRINTS = {
  payments: `select coalesce(json_object_agg(c, json_build_object('n', n, 'sum', s)), '{}') j from
               (select company_id::text c, count(*) n, sum(amount)::text s from public.payments group by 1 order by 1) x`,
  trigger_count: `select count(*) j from pg_trigger where not tgisinternal and tgname not like 'nf\\_%'`,
  triggers: `select md5(string_agg(tgrelid::regclass::text||'.'||tgname||':'||pg_get_triggerdef(oid), '|' order by tgrelid::regclass::text, tgname)) j
               from pg_trigger where not tgisinternal and tgname not like 'nf\\_%'`,
  function_count: `select count(*) j from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname not like 'nf\\_%' and p.proname not like '\\_nf\\_%'`,
  functions: `select md5(string_agg(p.oid::regprocedure::text||':'||pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text)) j
               from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                and p.proname not like 'nf\\_%' and p.proname not like '\\_nf\\_%'`,
  policies: `select md5(string_agg(tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by tablename, policyname)) j
               from pg_policies where schemaname = 'public' and tablename not like 'nf\\_%'`,
  columns: `select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''), '|' order by table_name, ordinal_position)) j
               from information_schema.columns where table_schema = 'public' and table_name not like 'nf\\_%'`,
};

function loadBaseline(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    map.set(r.key, r.value);
  }
  return map;
}

(async () => {
  const out = arg('--out');
  const compare = arg('--compare');
  if (!out) { console.log('usage: --out <file.jsonl> [--compare <baseline.jsonl>]'); process.exitCode = 2; return; }

  let base = null;
  if (compare) {
    try { base = loadBaseline(compare); } catch (e) { console.log('COULD NOT RUN — baseline:', e.message); process.exitCode = 2; return; }
    if (!base.get('meta:started_at')) { console.log('COULD NOT RUN — the baseline has no meta:started_at line; capture it again.'); process.exitCode = 2; return; }
  }

  const fd = fs.openSync(out, 'w');
  const write = (key, value) => fs.writeSync(fd, JSON.stringify({ key, value }) + '\n');
  write('meta:started_at', new Date().toISOString());

  const seen = new Set();
  const countChanges = [];
  let strictDiffs = 0, same = 0;

  const verdict = (key, value) => {
    write(key, value);
    seen.add(key);
    if (!base) return;
    const before = base.has(key) ? base.get(key) : undefined;
    if (JSON.stringify(before) === JSON.stringify(value)) { same++; console.log(`  same      ${key}`); return; }
    if (key.startsWith('count:') && before && typeof before === 'object') {
      const tenants = new Set([...Object.keys(before), ...Object.keys(value)]);
      const d = [...tenants].filter(t => before[t] !== value[t]).map(t => ({ t, from: before[t] ?? 0, to: value[t] ?? 0 }));
      countChanges.push({ key, d });
      console.log(`  changed   ${key}  ${d.map(x => `${x.t}: ${x.from} → ${x.to}`).join(' · ')}  (judged at the end)`);
      return;
    }
    strictDiffs++;
    console.log(`  DIFFERS   ${key}  ${JSON.stringify(before)} → ${JSON.stringify(value)}`);
  };

  let tableCount = 0;
  try {
    const tables = await q(`select c.table_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'company_id' and c.table_name not like 'nf\\_%'
       order by 1`);
    tableCount = tables.length;
    for (const { table_name } of tables) {
      const rows = await q(`select coalesce(company_id::text, 'null') as c, count(*)::int as n from public."${table_name}" group by 1 order by 1`);
      verdict(`count:${table_name}`, Object.fromEntries(rows.map(r => [r.c, r.n])));
    }
    for (const [key, sql] of Object.entries(FINGERPRINTS)) {
      const [row] = await q(sql);
      verdict(`fp:${key}`, row.j);
    }
    const [nf] = await q(`select coalesce(json_agg(relname order by relname), '[]') j from pg_class
                           where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'nf\\_%'`);
    write('nf_tables', nf.j);
    console.log(`\ncaptured ${tableCount} tenant tables + ${Object.keys(FINGERPRINTS).length} fingerprints → ${out}`);
    console.log(`nf_ tables now: ${JSON.stringify(nf.j)}${base ? ` (baseline: ${JSON.stringify(base.get('nf_tables'))})` : ''}`);
  } catch (e) {
    fs.closeSync(fd);
    console.log('COULD NOT RUN —', e.message, '(every line above was written to disk before this point)');
    process.exitCode = 2;
    return;
  }
  fs.closeSync(fd);
  if (!base) return;

  // ── judge row-count changes against timestamps ──────────────────────────────
  const baseStart = base.get('meta:started_at');
  let unexplained = 0, explained = 0;
  for (const { key, d } of countChanges) {
    const table = key.slice('count:'.length);
    const cols = await q(`select column_name c from information_schema.columns
                          where table_schema = 'public' and table_name = '${table}'
                            and column_name in ('created_at', 'changed_at', 'recorded_at')`);
    const tc = ['created_at', 'changed_at', 'recorded_at'].find(c => cols.some(r => r.c === c));
    for (const x of d) {
      const delta = x.to - x.from;
      if (delta < 0) { unexplained++; console.log(`  DIFFERS   ${key} ${x.t}: ${x.from} → ${x.to} — rows disappeared`); continue; }
      if (!tc) { unexplained++; console.log(`  DIFFERS   ${key} ${x.t}: +${delta} — the table has no created_at/changed_at/recorded_at to explain it`); continue; }
      const cond = x.t === 'null' ? 'company_id is null' : `company_id = '${x.t}'`;
      const [ev] = await q(`select count(*)::int n, max("${tc}")::text latest from public."${table}"
                             where ${cond} and "${tc}" >= '${baseStart}'::timestamptz`);
      if (ev.n >= delta) {
        explained++;
        console.log(`  EXPLAINED ${key} ${x.t}: +${delta}; ${ev.n} row(s) have ${tc} after the baseline started (latest ${ev.latest})`);
      } else {
        unexplained++;
        console.log(`  DIFFERS   ${key} ${x.t}: +${delta}, but only ${ev.n} row(s) have ${tc} after the baseline started`);
      }
    }
  }

  const vanished = [...base.keys()].filter(k => k !== 'nf_tables' && !k.startsWith('meta:') && !seen.has(k));
  vanished.forEach(k => { strictDiffs++; console.log(`  DIFFERS   ${k}  present in the baseline, not captured now`); });

  const bad = strictDiffs + unexplained;
  if (bad) {
    console.log(`\nDIFFERS outside nf_: ${strictDiffs} fingerprint/payment/shape difference(s), ${unexplained} unexplained row-count change(s).`);
  } else {
    console.log(`\nPASS outside nf_: ${same} items identical, including every fingerprint (triggers, functions, policies, columns) ` +
                `and every tenant's payment count and sum; ${explained} row-count increase(s) explained by rows timestamped after the baseline started.`);
  }
  process.exitCode = bad ? 1 : 0;
})();
