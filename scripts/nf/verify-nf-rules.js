/**
 * NexuFinance v1 — R1–R8 over the real wire, AFTER the migrations are applied.
 *
 *   node scripts/nf/verify-nf-rules.js > "$SCRATCH/nf-rules.log" 2>&1
 *
 * What verify-nf-schema.js could not see, this one does: real users created in
 * Supabase Auth, real password sign-ins, real JWTs verified by the gateway,
 * PostgREST routing every call, anon with no token at all, and direct REST
 * writes to the tables. Nothing is seeded that the thing under test acquires:
 * each opening after the first is read back from the server (SR-5, SR-7).
 *
 * Tenant: a fresh `ZZTEST-NF-<run>` company, seeded with gen-seed.js — the
 * same seed Awami gets. **The Awami tenant is never written.** Its nf_ row
 * counts are read before and after and must be identical.
 *
 * Cleanup (owner, 2026-09-16): always runs, then is VERIFIED BY QUERY and
 * printed — nf_ rows for the test company, the company row, the auth users.
 *
 * RACES (owner, 2026-09-16): R1 and R2 are also driven from two database
 * connections at once, with the overlap proven from pg_stat_activity (side 2
 * waiting on a Lock whose blocker is side 1's pid). R1: two payments that each
 * fit but not together → exactly one accepted. A paired race that fits → both
 * accepted. R2: the same voucher twice → exactly one row.
 *
 * The service-role key is fetched from the Management API into memory for
 * creating and deleting the test users. It is never written anywhere.
 *
 * Exit (via process.exitCode): 0 held · 1 something failed (including cleanup) · 2 could not run
 * (e.g. the migrations are not applied yet).
 */
'use strict';

const crypto = require('crypto');
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require('./gen-seed');

const URL_ = `https://${REF}.supabase.co`;
const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${pass ? '' : detail}`); };

async function keys() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const list = await r.json();
  const anon = list.find(k => k.name === 'anon');
  const svc = list.find(k => k.name === 'service_role');
  if (!anon || !svc) throw new Error('anon or service_role key not found');
  return { anon: anon.api_key, svc: svc.api_key };
}

async function http(method, path, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

// Every RPC body is built here and its whole shape asserted before it is sent
// (SR-9): an undefined argument would be dropped silently by JSON.stringify.
function rpc(K, jwt, name, args) {
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) throw new Error(`rpc ${name}: argument ${k} is undefined — refusing to send a reshaped request`);
  }
  return http('POST', `/rest/v1/rpc/${name}`, { key: K.anon, jwt, body: args });
}
const code = r => (r.json && typeof r.json === 'object' && r.json.message) || null;

// ── two-connection race ────────────────────────────────────────────────────
// Each side is its own Management API request, i.e. its own database backend
// and its own transaction, calling the real public.nf_save_line as the
// accountant (JWT claims + SET LOCAL ROLE authenticated). Side 1 writes, then
// holds its transaction open; side 2 starts while side 1 still holds it. A third
// connection samples pg_stat_activity to PROVE side 2 was blocked by side 1 —
// without that, "one accepted, one refused" could come from two calls that
// never overlapped, and the test would say nothing about locking.
const { REF: _REF, TOKEN: _TOKEN } = require('../_sbq');
async function rawSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  let msg = text; try { const j = JSON.parse(text); msg = Array.isArray(j) ? text : (j.message || text); } catch { /* keep text */ }
  return { status: r.status, msg };
}

const lineSide = ({ userId, dayId, a, b }) => (tag, n, hold) => {
  const line = n === 1 ? a : b;
  return `/* ${tag}-${n} */
BEGIN;
SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: 'authenticated' })}', true);
SET LOCAL ROLE authenticated;
SELECT public.nf_save_line('${dayId}'::uuid, NULL, 'OUT', '${line.voucher}', 'race ${tag}-${n}', '81300', 'P-W', 'Cash', ${line.amount}, NULL);
${hold ? `SELECT pg_sleep(${hold / 1000});` : ''}
COMMIT;`;
};

async function race({ tag, sides, holdMs = 4000, staggerMs = 1500 }) {
  const side = (n, _unused, hold) => sides(tag, n, hold);

  const samples = [];
  let done = false;
  const observer = (async () => {
    while (!done) {
      const r = await rawSql(`select coalesce(json_agg(json_build_object(
          'side', substring(query from '${tag}-([12])'), 'pid', pid, 'wait', wait_event_type, 'blockers', pg_blocking_pids(pid))), '[]') j
        from pg_stat_activity where query like '%${tag}-%' and query not like '%pg_stat_activity%' and pid <> pg_backend_pid()`);
      if (r.status === 201) { try { samples.push(JSON.parse(r.msg)[0].j); } catch { /* ignore a malformed sample */ } }
      await new Promise(res => setTimeout(res, 250));
    }
  })();

  const t0 = Date.now();
  const p1 = rawSql(side(1, null, holdMs)).then(r => ({ ...r, ms: Date.now() - t0 }));
  await new Promise(res => setTimeout(res, staggerMs));
  const t2 = Date.now();
  const p2 = rawSql(side(2, null, 0)).then(r => ({ ...r, ms: Date.now() - t2 }));
  const [r1, r2] = await Promise.all([p1, p2]);
  done = true;
  await observer;

  const pid1 = samples.flat().find(s => s.side === '1')?.pid;
  const blockedBy1 = samples.flat().some(s => s.side === '2' && s.wait === 'Lock' && pid1 && (s.blockers || []).includes(pid1));
  return { r1, r2, pid1, blockedBy1, samples: samples.length };
}

module.exports = { race, rawSql };

async function nfCounts(companyId) {
  const [row] = await q(`select json_build_object(
      'members', (select count(*) from nf_members where company_id='${companyId}'),
      'settings', (select count(*) from nf_settings where company_id='${companyId}'),
      'accounts', (select count(*) from nf_accounts where company_id='${companyId}'),
      'floors', (select count(*) from nf_floors where company_id='${companyId}'),
      'categories', (select count(*) from nf_report_categories where company_id='${companyId}'),
      'days', (select count(*) from nf_days where company_id='${companyId}'),
      'lines', (select count(*) from nf_lines where company_id='${companyId}'),
      'pdcs', (select count(*) from nf_pdcs where company_id='${companyId}'),
      'audit', (select count(*) from nf_audit where company_id='${companyId}')) j`);
  return row.j;
}

if (require.main === module) (async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-rules] project ${REF} · run ${run}`);

  // ── can it run? ────────────────────────────────────────────────────────────
  let K;
  try {
    const [probe] = await q(`select to_regclass('public.nf_days') is not null as applied`);
    if (!probe.applied) { console.log('COULD NOT RUN — the nf_ migrations are not applied. Nothing was verified.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }

  const awamiBefore = await nfCounts(AWAMI_COMPANY_ID);
  console.log(`  Awami nf_ rows before: ${JSON.stringify(awamiBefore)}`);

  // ── SEC-VIEW-INVOKER: every view over an RLS-protected table must be
  //    security_invoker, catalog-wide, not just nf_ (owner, 2026-09-18) ──
  // Found the hard way once already (nf_lines let an outsider read every
  // company's cash book — a Postgres view runs as its OWNER by default,
  // not the querying role, so RLS on the underlying tables was silently
  // never evaluated). This makes sure that specific class of bug cannot
  // reappear by accident, on nf_lines or on any future view anywhere in
  // this database — not scoped to nf_, on purpose.
  {
    const viewQuery = `
      SELECT v.table_schema || '.' || v.table_name AS view_name, c.reloptions
        FROM information_schema.views v
        JOIN pg_class c ON c.relname = v.table_name AND c.relnamespace = v.table_schema::regnamespace
        JOIN information_schema.view_table_usage vtu ON vtu.view_schema = v.table_schema AND vtu.view_name = v.table_name
        JOIN pg_class t ON t.relname = vtu.table_name AND t.relnamespace = vtu.table_schema::regnamespace AND t.relkind = 'r'
       WHERE t.relrowsecurity
       GROUP BY v.table_schema, v.table_name, c.reloptions`;
    const bad = r => r.filter(x => !(x.reloptions || []).some(o => o === 'security_invoker=true'));

    // SR-2: prove the detector actually fires before trusting its silence —
    // a real view, over a real RLS table, deliberately missing the option.
    const mutantName = `_zztest_sec_view_${run}`;
    await q(`CREATE VIEW public.${mutantName} AS SELECT code, company_id FROM public.nf_accounts LIMIT 0`);
    const withMutant = bad(await q(viewQuery));
    await q(`DROP VIEW public.${mutantName}`);
    ok('SEC-VIEW-INVOKER self-test', withMutant.some(x => x.view_name === `public.${mutantName}`),
      `planted mutant not caught: ${JSON.stringify(withMutant.map(x => x.view_name))}`);

    const rows = bad(await q(viewQuery));
    ok('SEC-VIEW-INVOKER', rows.length === 0,
      rows.length ? `views over an RLS table without security_invoker=true: ${rows.map(x => x.view_name).join(', ')}` : '');
  }

  // ── SEC-RPC-PUBLIC / SEC-RPC-ROLE-CHECK: the RPC-grants sibling of
  //    SEC-VIEW-INVOKER (owner, 2026-09-18, after the nf__upsert_transfer_
  //    voucher / nf_ledger_position finding). 20260916c's grant sweep and
  //    this session's own 20260918n/o fix ran ONCE each — every function
  //    added afterward inherits Postgres's ordinary default (EXECUTE
  //    granted to PUBLIC on CREATE FUNCTION) unless something revokes it
  //    by hand. Standing rule from here: a discovered invariant becomes an
  //    automated, catalog-wide, self-tested check in the same commit that
  //    fixes it — never a one-time sweep again.
  {
    const publicQuery = `
      SELECT p.proname
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND (p.proname LIKE 'nf\\_%' OR p.proname LIKE '\\_nf\\_%')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public', p.oid, 'EXECUTE'))`;

    // SR-2: a freshly created function is PUBLIC-executable by Postgres's
    // own default — no explicit GRANT needed to plant this mutant, which
    // is exactly what makes the underlying bug easy to introduce by
    // accident and this check worth having.
    const pubMutant = `nf_zztest_pub_${run}`;
    await q(`CREATE FUNCTION public.${pubMutant}(p_company_id uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT p_company_id $$`);
    const withPubMutant = await q(publicQuery);
    await q(`DROP FUNCTION public.${pubMutant}(uuid)`);
    ok('SEC-RPC-PUBLIC self-test', withPubMutant.some(x => x.proname === pubMutant),
      `planted mutant not caught: ${JSON.stringify(withPubMutant.map(x => x.proname))}`);

    const pubRows = await q(publicQuery);
    ok('SEC-RPC-PUBLIC', pubRows.length === 0,
      pubRows.length ? `nf_ function(s) executable by PUBLIC/anon: ${pubRows.map(x => x.proname).join(', ')}` : '');

    // Only functions actually reachable (anon or authenticated) are
    // required to check — one with zero grants at all is already fully
    // closed at the grant layer and isn't the same bug shape. nf_is_member
    // and nf_require_role are the check primitives themselves, excluded
    // for the same reason a lock can't require itself to already be open.
    const roleCheckQuery = `
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname LIKE 'nf\\_%' AND p.proname NOT LIKE '\\_nf\\_%'
         AND p.proname NOT IN ('nf_require_role','nf_is_member')
         AND p.prorettype::regtype::text <> 'trigger'
         AND EXISTS (SELECT 1 FROM unnest(p.proargtypes) t WHERE t = 'uuid'::regtype)
         AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         AND p.prosrc NOT LIKE '%nf_require_role%' AND p.prosrc NOT LIKE '%nf_is_member%'`;

    // SR-2: a mutant that IS reachable (granted to authenticated) and
    // takes a company_id but never checks it — the exact shape
    // nf__upsert_transfer_voucher and nf_ledger_position were.
    const roleMutant = `nf_zztest_role_${run}`;
    await q(`CREATE FUNCTION public.${roleMutant}(p_company_id uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT p_company_id $$;
             GRANT EXECUTE ON FUNCTION public.${roleMutant}(uuid) TO authenticated`);
    const withRoleMutant = await q(roleCheckQuery);
    await q(`DROP FUNCTION public.${roleMutant}(uuid)`);
    ok('SEC-RPC-ROLE-CHECK self-test', withRoleMutant.some(x => x.proname === roleMutant),
      `planted mutant not caught: ${JSON.stringify(withRoleMutant.map(x => x.proname))}`);

    const roleRows = await q(roleCheckQuery);
    ok('SEC-RPC-ROLE-CHECK', roleRows.length === 0,
      roleRows.length ? `reachable nf_ function(s) with no internal nf_require_role/nf_is_member check: ${roleRows.map(x => x.proname).join(', ')}` : '');

    // SEC-TABLE-RLS / SEC-TABLE-ANON (2026-09-19, blueprint conformance
    // pass). The two checks above only ever looked at FUNCTIONS. A table
    // created by a migration gets Supabase's own default: RLS OFF and full
    // SELECT/INSERT/UPDATE/DELETE granted to anon and authenticated, which
    // PostgREST exposes directly — exactly how nf_iif_batches and
    // nf_iif_batch_vouchers (20260919h) shipped: the public anon key could
    // read every export batch and INSERT a row marking any real voucher as
    // exported, which after 20260919k also LOCKS it. Proven with a real
    // rolled-back insert against JV-0018 before 20260919l closed it.
    // Standing rule, same as above: catalog-wide, self-tested, never a
    // one-time sweep.
    const tblMutant = `nf_zztest_tbl_${run}`;
    const rlsQuery = `
      SELECT c.relname
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND (c.relname LIKE 'nf\\_%' OR c.relname LIKE '\\_nf\\_%')
         AND NOT c.relrowsecurity`;
    const anonQuery = `
      SELECT c.relname
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v')
         AND (c.relname LIKE 'nf\\_%' OR c.relname LIKE '\\_nf\\_%')
         AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
           OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))`;
    const authWriteQuery = `
      SELECT c.relname
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND (c.relname LIKE 'nf\\_%' OR c.relname LIKE '\\_nf\\_%')
         AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
           OR has_table_privilege('authenticated', c.oid, 'DELETE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))`;
    // SR-2: the mutant is a plain CREATE TABLE with nothing else — the
    // default grants and RLS-off state are what Postgres/Supabase hand
    // out unasked, which is the whole reason the check exists.
    await q(`CREATE TABLE public.${tblMutant} (id int)`);
    const [mRls, mAnon, mAuth] = await Promise.all([q(rlsQuery), q(anonQuery), q(authWriteQuery)]);
    await q(`DROP TABLE public.${tblMutant}`);
    ok('SEC-TABLE-RLS self-test', mRls.some(x => x.relname === tblMutant), 'planted RLS-off table not caught');
    ok('SEC-TABLE-ANON self-test', mAnon.some(x => x.relname === tblMutant), 'planted anon-readable table not caught');
    ok('SEC-TABLE-AUTH-WRITE self-test', mAuth.some(x => x.relname === tblMutant), 'planted authenticated-writable table not caught');
    const [rlsRows, anonRows, authRows] = await Promise.all([q(rlsQuery), q(anonQuery), q(authWriteQuery)]);
    ok('SEC-TABLE-RLS', rlsRows.length === 0, rlsRows.length ? `nf_ table(s) without row security: ${rlsRows.map(x => x.relname).join(', ')}` : '');
    ok('SEC-TABLE-ANON', anonRows.length === 0, anonRows.length ? `nf_ table/view(s) reachable by the public anon role: ${anonRows.map(x => x.relname).join(', ')}` : '');
    ok('SEC-TABLE-AUTH-WRITE', authRows.length === 0, authRows.length ? `nf_ table(s) directly writable by authenticated (bypasses the RPCs): ${authRows.map(x => x.relname).join(', ')}` : '');
  }

  const C = crypto.randomUUID();
  const companyName = `ZZTEST-NF-${run}`;
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = {};
  const roles = { D: 'director', A: 'accountant', V: 'viewer', O: null };

  try {
    // ── fixtures: company, seed, four real auth users, members ───────────────
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNF${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    for (const who of Object.keys(roles)) {
      const email = `nf-${who.toLowerCase()}-${run}@zztest-nf.invalid`;
      const password = crypto.randomBytes(18).toString('base64url');
      const r = await http('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
      if (r.status >= 300) throw new Error(`create user ${who}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
      users[who] = { id: r.json.id, email, password };
    }
    for (const [who, role] of Object.entries(roles)) {
      if (!role) continue;
      await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}', '${users[who].id}', '${role}', 'Test ${role}', true)`);
    }
    for (const who of Object.keys(roles)) {
      const r = await http('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email: users[who].email, password: users[who].password } });
      if (r.status !== 200 || !r.json.access_token) throw new Error(`sign-in ${who}: HTTP ${r.status}`);
      users[who].jwt = r.json.access_token;
    }
    console.log('  fixtures: company, seed, 4 users signed in with real passwords\n');
    const D = users.D.jwt, A = users.A.jwt, V = users.V.jwt, O = users.O.jwt;

    // ── golden day, entered as a person would ─────────────────────────────────
    const s = built.ref.sample;
    let r = await rpc(K, D, 'nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno,
      p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
    ok('H-G01', r.status === 200 && r.json.day.status === 'OPEN', JSON.stringify(r.json));
    const day1 = r.json.day.id;
    let last;
    for (const [side, rows] of [['IN', s.in], ['OUT', s.out]]) {
      for (const x of rows.filter(x => Number(x.a))) {
        const args = { p_day_id: day1, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
          p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null };
        // 21100 (Token Money) pools many customers — requires a party since
        // 20260918a/c; a real name, not a placeholder, so H-G02 stays an
        // honest test of the actual resolve-or-create path
        if (x.h === '21100') args.p_party_name = 'Golden Day Test Customer';
        last = await rpc(K, A, 'nf_save_line', args);
        ok(`H-G02 ${x.v}`, last.status === 200, JSON.stringify(last.json));
      }
    }
    r = await rpc(K, A, 'nf_set_transfers', { p_day_id: day1, p_to_bank: Number(s.tBank), p_to_petty: null, p_version: last.json.day.version });
    ok('H-G03', r.status === 200, JSON.stringify(r.json));
    const den = Object.fromEntries(Object.entries(s.den).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    r = await rpc(K, A, 'nf_save_count', { p_day_id: day1, p_denoms: den, p_version: r.json.day.version });
    ok('H-G04', r.status === 200 && Number(r.json.day.counted_cash) === 313000, JSON.stringify(r.json.day));
    const pos = Object.fromEntries(r.json.position.rows.map(x => [x.via, Number(x.closing)]));
    ok('H-G05', pos.Cash === 313000 && pos.Petty === 13500 && pos.Bank === 2108960
      && Number(r.json.position.total.closing) === 2435460 && Number(r.json.position.net) === 665460 && r.json.balanced === true,
      JSON.stringify(r.json.position));
    r = await rpc(K, A, 'nf_close_day', { p_day_id: day1, p_version: r.json.day.version, p_variance_reason: null });
    ok('H-G06 accountant closes a balanced day', r.status === 200 && r.json.day.status === 'CLOSED', JSON.stringify(r.json));

    // ── carry forward: nothing typed ─────────────────────────────────────────
    r = await rpc(K, A, 'nf_start_next_day', { p_company_id: C, p_date: null });
    const open2 = r.status === 200 ? Object.fromEntries(r.json.position.rows.map(x => [x.via, Number(x.opening)])) : {};
    ok('H-C01', open2.Cash === 313000 && open2.Petty === 13500 && open2.Bank === 2108960 && r.json.day.closing_no === 'DC-002', JSON.stringify(r.json));
    const day2 = r.json.day.id;

    // ── R1, R2, R3, R4 over HTTP ─────────────────────────────────────────────
    const line = (jwt, side, v, head, floor, via, amt, extra = {}) => rpc(K, jwt, 'nf_save_line',
      { p_day_id: day2, p_line_id: null, p_side: side, p_voucher_no: v, p_description: 'http', p_head: head, p_floor: floor, p_via: via, p_amount: amt, p_version: null, ...extra });
    r = await line(A, 'OUT', 'CPV-1222', '81300', 'P-W', 'Cash', 313000.01);
    ok('H-R1 the CPV-1222 invariant', code(r) === 'NF:NEGATIVE_POSITION', JSON.stringify(r.json));
    r = await line(A, 'IN', 'CRV-001', '21100', 'GF', 'Cash', 1);
    ok('H-R2 duplicate across days', code(r) === 'NF:DUPLICATE_VOUCHER', JSON.stringify(r.json));
    r = await line(A, 'IN', 'CRV-900', '10000', 'GF', 'Cash', 1);
    ok('H-R3 parent head', code(r) === 'NF:HEAD_NOT_POSTABLE', JSON.stringify(r.json));
    r = await line(A, 'IN', 'CRV-900', '21100', 'GF', 'Cash', 1.005);
    ok('H-R3 three decimals', code(r) === 'NF:AMOUNT_SCALE', JSON.stringify(r.json));
    r = await line(A, 'OUT', 'CPV-900', '81300', 'P-W', '12610', 1);
    ok('H-R4 director receivable as a Via', code(r) === 'NF:VIA_UNKNOWN', JSON.stringify(r.json));
    r = await line(A, 'OUT', 'CPV-900', '12610', 'P-W', 'Cash', 1000);
    ok('H-R4 director receivable as a head', r.status === 200, JSON.stringify(r.json));

    // ── roles and the doors past the RPCs ────────────────────────────────────
    r = await line(V, 'IN', 'CRV-901', '21100', 'GF', 'Cash', 1);
    ok('H-V viewer writes', code(r) === 'NF:NOT_ALLOWED', JSON.stringify(r.json));
    r = await rpc(K, V, 'nf_get_report', { p_day_id: day1 });
    ok('H-V viewer reads the report', r.status === 200 && Number(r.json.total_close) === 2435460, JSON.stringify(r.json).slice(0, 300));
    r = await rpc(K, O, 'nf_get_day', { p_company_id: C, p_date: null });
    ok('H-O outsider', code(r) === 'NF:NOT_ALLOWED', JSON.stringify(r.json));
    r = await http('GET', `/rest/v1/nf_lines?company_id=eq.${C}&select=id`, { key: K.anon, jwt: O });
    ok('H-O outsider table read (RLS)', r.status === 200 && Array.isArray(r.json) && r.json.length === 0, JSON.stringify(r.json));
    r = await http('GET', `/rest/v1/nf_lines?company_id=eq.${C}&select=id`, { key: K.anon, jwt: V });
    ok('H-V member table read (paired allow)', r.status === 200 && r.json.length > 0, JSON.stringify(r.json));
    r = await http('POST', '/rest/v1/rpc/nf_get_day', { key: K.anon, body: { p_company_id: C, p_date: null } });
    ok('H-AN anon RPC', r.status === 401 || r.status === 403 || /permission denied/.test(JSON.stringify(r.json)), `${r.status} ${JSON.stringify(r.json)}`);
    r = await http('PATCH', `/rest/v1/nf_lines?day_id=eq.${day2}`, { key: K.anon, jwt: A, body: { amount: 1 } });
    // nf_lines is a view now (double-entry, 20260918d) — a direct write is
    // still refused, just by a different, equally final mechanism: Postgres
    // itself refuses to update a view with no INSTEAD OF trigger, before
    // RLS even gets a say. Both are "the table cannot be written to
    // directly" — this accepts either shape.
    ok('H-T accountant PATCHes the table directly',
       r.status === 401 || r.status === 403 || /permission denied/.test(JSON.stringify(r.json)) ||
       (r.status === 500 && /cannot update view/.test(JSON.stringify(r.json))),
       `${r.status} ${JSON.stringify(r.json)}`);

    // ── R6 / R7 ───────────────────────────────────────────────────────────────
    let d2 = (await rpc(K, A, 'nf_get_day', { p_company_id: C, p_date: null })).json;
    r = await rpc(K, A, 'nf_save_count', { p_day_id: day2, p_denoms: { coins: 1 }, p_version: d2.day.version });
    r = await rpc(K, A, 'nf_close_day', { p_day_id: day2, p_version: r.json.day.version, p_variance_reason: 'x' });
    ok('H-R6 accountant variance close', code(r) === 'NF:VARIANCE_NEEDS_DIRECTOR', JSON.stringify(r.json));
    d2 = (await rpc(K, D, 'nf_get_day', { p_company_id: C, p_date: null })).json;
    r = await rpc(K, D, 'nf_close_day', { p_day_id: day2, p_version: d2.day.version, p_variance_reason: 'Counted twice' });
    ok('H-R6 director variance close with reason', r.status === 200 && r.json.day.status === 'CLOSED' && Number(r.json.day.variance) !== 0, JSON.stringify(r.json.day));
    r = await line(A, 'IN', 'CRV-902', '21100', 'GF', 'Cash', 1);
    ok('H-R7 lock', code(r) === 'NF:DAY_LOCKED', JSON.stringify(r.json));
    r = await rpc(K, A, 'nf_reopen_day', { p_day_id: day2, p_reason: 'x', p_version: d2.day.version + 1 });
    ok('H-R7 accountant reopen', code(r) === 'NF:NOT_ALLOWED', JSON.stringify(r.json));
    const v2 = (await rpc(K, D, 'nf_get_day', { p_company_id: C, p_date: null })).json.day.version;
    r = await rpc(K, D, 'nf_reopen_day', { p_day_id: day1, p_reason: 'older', p_version: 0 });
    ok('H-R7 reopen a non-latest day', code(r) === 'NF:LATER_DAY_EXISTS' || code(r) === 'NF:VERSION_CONFLICT', JSON.stringify(r.json));
    r = await rpc(K, D, 'nf_reopen_day', { p_day_id: day2, p_reason: 'wrong count', p_version: v2 });
    ok('H-R7 director reopen', r.status === 200 && r.json.day.status === 'OPEN' && r.json.day.reopen_count === 1, JSON.stringify(r.json.day));
    r = await rpc(K, D, 'nf_list_audit', { p_day_id: day2 });
    ok('H-R7 reopen logged', r.status === 200 && r.json.some(a => a.action === 'REOPEN' && a.reason === 'wrong count'), JSON.stringify(r.json).slice(0, 400));

    // ── RACES: two connections at once (day 2 is open again) ───────────────────
    console.log('\n── races (two database connections, overlap proven from pg_stat_activity)');
    // nf_position_row -> nf_ledger_position now requires an authenticated,
    // company-member session (20260918o) — reading it over the raw-SQL
    // Management API (no JWT, auth.uid() is NULL there) would now be
    // rejected, same as it should be for anyone else. Goes through the
    // real, already-authenticated RPC surface instead.
    const cashNow = async () => {
      const r = await rpc(K, D, 'nf_get_report', { p_day_id: day2 });
      if (r.status !== 200) throw new Error('cashNow: nf_get_report failed: ' + JSON.stringify(r.json));
      return Number(r.json.accounts.find(a => a.via === 'Cash').closing);
    };
    const vouchersOnDay2 = async list => (await q(`select coalesce(json_agg(voucher_key order by voucher_key), '[]') j
        from public.nf_lines where day_id = '${day2}' and voucher_key in (${list.map(v => `'${v}'`).join(',')})`))[0].j;
    const describe = x => `side1 HTTP ${x.r1.status} in ${x.r1.ms} ms: ${String(x.r1.msg).slice(0, 120)} | side2 HTTP ${x.r2.status} in ${x.r2.ms} ms: ${String(x.r2.msg).slice(0, 160)} | pid1 ${x.pid1} · side2 blocked by side1: ${x.blockedBy1} · ${x.samples} samples`;

    // R1: each payment fits alone; together they would take Cash below zero.
    const X = await cashNow();
    const each = Math.floor(X * 0.6 * 100) / 100;
    let x = await race({ tag: `nf-race-${run}-r1`, sides: lineSide({ userId: users.A.id, dayId: day2, a: { voucher: 'CPV-R1A', amount: each }, b: { voucher: 'CPV-R1B', amount: each } }) });
    ok('RACE-R1 overlap', x.blockedBy1, describe(x));
    ok('RACE-R1 one accepted, one refused', x.r1.status === 201 && x.r2.status !== 201 && /NF:NEGATIVE_POSITION/.test(x.r2.msg), describe(x));
    const afterR1 = await cashNow();
    const v1 = await vouchersOnDay2(['CPV-R1A', 'CPV-R1B']);
    ok('RACE-R1 state', JSON.stringify(v1) === '["CPV-R1A"]' && afterR1 === Math.round((X - each) * 100) / 100 && afterR1 >= 0,
       `cash before ${X}, each ${each}, cash after ${afterR1}, vouchers ${JSON.stringify(v1)}`);

    // Paired allow: two payments that fit together are both accepted — and the
    // second still waited, so the lock serialises writers whether or not money is short.
    x = await race({ tag: `nf-race-${run}-ok`, sides: lineSide({ userId: users.A.id, dayId: day2, a: { voucher: 'CPV-OKA', amount: 1 }, b: { voucher: 'CPV-OKB', amount: 1 } }) });
    ok('RACE-OK overlap', x.blockedBy1, describe(x));
    ok('RACE-OK both accepted', x.r1.status === 201 && x.r2.status === 201, describe(x));
    ok('RACE-OK state', JSON.stringify(await vouchersOnDay2(['CPV-OKA', 'CPV-OKB'])) === '["CPV-OKA","CPV-OKB"]', 'vouchers');

    // R2: the same voucher from two connections at once.
    x = await race({ tag: `nf-race-${run}-r2`, sides: lineSide({ userId: users.A.id, dayId: day2, a: { voucher: 'CPV-R2', amount: 1 }, b: { voucher: 'CPV-R2', amount: 1 } }) });
    ok('RACE-R2 overlap', x.blockedBy1, describe(x));
    ok('RACE-R2 one accepted, one refused', x.r1.status === 201 && x.r2.status !== 201 && /NF:DUPLICATE_VOUCHER/.test(x.r2.msg), describe(x));
    const [cnt] = await q(`select count(*)::int n from public.nf_lines where company_id = '${C}' and voucher_key = 'CPV-R2'`);
    ok('RACE-R2 state', cnt.n === 1, `rows with CPV-R2: ${cnt.n}`);
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    // ── cleanup, then prove it ────────────────────────────────────────────────
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    for (const [who, u] of Object.entries(users)) {
      const r = await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user ${who}: HTTP ${r.status}`);
    }
    const ids = Object.values(users).map(u => `'${u.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    const [left] = await q(`select json_build_object(
        'company', (select count(*) from companies where id = '${C}' or company_name = '${companyName}'),
        'auth_users', (select count(*) from auth.users where id in (${ids})),
        'nf_rows', (select count(*) from nf_members where company_id='${C}') + (select count(*) from nf_days where company_id='${C}')
                 + (select count(*) from nf_lines where company_id='${C}') + (select count(*) from nf_pdcs where company_id='${C}')
                 + (select count(*) from nf_audit where company_id='${C}') + (select count(*) from nf_accounts where company_id='${C}')
                 + (select count(*) from nf_settings where company_id='${C}') + (select count(*) from nf_floors where company_id='${C}')
                 + (select count(*) from nf_report_categories where company_id='${C}')) j`);
    console.log(`  verified by query: ${JSON.stringify(left.j)}`);
    ok('CLEANUP', left.j.company === 0 && left.j.auth_users === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));

    const awamiAfter = await nfCounts(AWAMI_COMPANY_ID);
    console.log(`  Awami nf_ rows after:  ${JSON.stringify(awamiAfter)}`);
    ok('AWAMI-UNTOUCHED', JSON.stringify(awamiBefore) === JSON.stringify(awamiAfter), `${JSON.stringify(awamiBefore)} → ${JSON.stringify(awamiAfter)}`);

    // IIF export-state invariant (supabase/migrations/20260919h,
    // 2026-09-19): no voucher whose narration or created_by marks it as
    // a historical import may be iif_exportable — every one of those
    // already exists in QuickBooks, and exporting it back would
    // double-post the client's own history. Checked directly against
    // real Awami data, not the ZZTEST fixture, since that's the only
    // company this invariant currently has real rows to check.
    const [badExportable] = await q(`
      select count(*)::int n from nf_vouchers
       where company_id = '${AWAMI_COMPANY_ID}'
         and iif_exportable
         and (narration ilike '%Imported from QuickBooks history%'
              or created_by = '50e3d1be-ef2f-421c-a0f9-2fd2296176e4'::uuid)`);
    ok('IIF-IMPORTED-NOT-EXPORTABLE', badExportable.n === 0, `${badExportable.n} imported voucher(s) incorrectly marked iif_exportable`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    // exitCode, not exit(): on Windows, exit() with fetch sockets open aborts in libuv (seen: 127)
    process.exitCode = failed.length ? 1 : 0;
  }
})();
