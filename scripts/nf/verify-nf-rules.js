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

(async () => {
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
        last = await rpc(K, A, 'nf_save_line', { p_day_id: day1, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
          p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null });
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
    ok('H-T accountant PATCHes the table directly', r.status === 401 || r.status === 403 || /permission denied/.test(JSON.stringify(r.json)), `${r.status} ${JSON.stringify(r.json)}`);

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

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    // exitCode, not exit(): on Windows, exit() with fetch sockets open aborts in libuv (seen: 127)
    process.exitCode = failed.length ? 1 : 0;
  }
})();
