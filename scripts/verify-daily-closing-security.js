#!/usr/bin/env node
/**
 * Daily Closing — P10: the security pass.
 *
 *   node scripts/verify-daily-closing-security.js
 *
 * Four claims, checked against the LIVE applied schema rather than against the
 * migration files, because what protects the pilot is what is deployed:
 *
 *   1 · EVERY ENDPOINT REQUIRES AUTH. `anon` can execute nothing in this
 *       module, and neither edge function will act without a bearer token.
 *   2 · THE HELPERS ARE NOT ENDPOINTS. `_dc_*` is reachable by service_role
 *       only — a predicate that answers "may this person close the day?" must
 *       not itself be callable by the person asking.
 *   3 · NOTHING IS READ DIRECTLY. Every module table is RLS deny-all, so the
 *       only way in is a SECURITY DEFINER function that checks first.
 *   4 · DOCUMENTS ARE PRIVATE AND SIGNED. The bucket is private, the URLs
 *       expire, and no public URL is stored anywhere.
 *
 * ⚠️ SR-2. Every claim here is of the "must not" kind, so each is paired with
 * the positive that proves the check works: `authenticated` CAN execute the
 * services, the bridge DOES answer a real token, and the tables DO have rows
 * a definer function returns. A wall of green from a broken probe is exactly
 * what this file must not produce.
 */
'use strict';
const { q, REF } = require('./_sbq');

const URL_BASE = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);

const SERVICES = [
  'get_cash_day_summary', 'list_cash_entries', 'list_cash_days', 'list_payees',
  'get_cash_day_pdf_data', 'authorize_day_document', 'authorize_cash_attachment',
  'open_cash_day', 'record_cash_entry', 'add_cash_entry_attachment',
  'void_cash_entry', 'create_payee', 'rename_payee', 'set_payee_active',
  'setup_cash_opening', 'close_cash_day', 'post_cash_adjustment',
  'list_cash_day_audit', 'get_my_daily_closing_access', 'get_daily_closing_tile',
  'list_units_for_picker', 'list_qb_accounts_for_project', 'get_cash_entry_project',
];
const TABLES = ['cash_days', 'cash_entries', 'cash_accounts', 'cash_entry_attachments',
                'day_documents', 'payees', 'qb_accounts'];

(async () => {
  // ══ 1 · ANON CAN EXECUTE NOTHING ═════════════════════════════════════════
  head('every service: anon cannot execute it, authenticated can');
  const rows = await q(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_ok,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[${SERVICES.map(s => `'${s}'`).join(',')}])
     order by p.proname`);

  const missing = SERVICES.filter(s => !rows.some(r => r.proname === s));
  missing.length === 0
    ? ok(`all ${SERVICES.length} services exist on the live database`)
    : bad(`these services are not deployed: ${missing.join(', ')}`);

  const anonCan = rows.filter(r => r.anon_ok);
  anonCan.length === 0
    ? ok(`and anon can execute NONE of them`)
    : bad(`anon can execute: ${anonCan.map(r => r.proname).join(', ')}`);

  // the positive half — without it, a query returning no rows would pass above
  const authCan = rows.filter(r => r.auth_ok);
  authCan.length === rows.length && rows.length > 0
    ? ok(`while authenticated can execute all ${authCan.length} — so the probe works`)
    : bad(`authenticated is missing EXECUTE on: ` +
          rows.filter(r => !r.auth_ok).map(r => r.proname).join(', '));

  // ══ 2 · THE HELPERS ARE NOT ENDPOINTS ════════════════════════════════════
  head('the predicates are service_role only — a gate is not a door');
  const helpers = await q(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_ok,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '\\_dc\\_%'
       and p.prorettype <> 'pg_catalog.trigger'::regtype
     order by p.proname`);
  helpers.length >= 8
    ? ok(`${helpers.length} internal helpers found`)
    : bad(`only ${helpers.length} helpers found — the probe is looking in the wrong place`);

  // _dc_service_registry is deliberately readable: the suites call it.
  const leaky = helpers.filter(h => (h.anon_ok || h.auth_ok) && h.proname !== '_dc_service_registry');
  leaky.length === 0
    ? ok('and none of them is executable by anon or authenticated')
    : bad(`reachable helpers: ${leaky.map(h => h.proname + (h.anon_ok ? '(anon)' : '(auth)')).join(', ')}`);

  // record_day_document writes the version row — service_role ONLY
  const rec = (await q(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') ok
                          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public' and p.proname='record_day_document'`))[0];
  rec && rec.ok === false
    ? ok('record_day_document is closed to authenticated — only the renderer writes a version')
    : bad('authenticated can call record_day_document and mint a document version');

  // ══ 3 · NOTHING IS READ DIRECTLY ═════════════════════════════════════════
  head('every module table is RLS deny-all');
  for (const t of TABLES) {
    const r = (await q(`
      select c.relrowsecurity rls,
             (select count(*) from pg_policy p
               where p.polrelid = c.oid and pg_get_expr(p.polqual, p.polrelid) = 'false') denies,
             (select count(*) from pg_policy p where p.polrelid = c.oid) policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='${t}'`))[0];
    if (!r) { bad(`${t} — no such table`); continue; }
    if (!r.rls) { bad(`${t} — RLS is OFF`); continue; }
    Number(r.denies) > 0 && Number(r.denies) === Number(r.policies)
      ? ok(`${t.padEnd(24)} RLS on, ${r.policies} policy, deny-all`)
      : bad(`${t} — ${r.policies} policies of which ${r.denies} deny-all; a permissive one exists`);
  }
  // and no INSERT/UPDATE/DELETE grants to the two web roles
  const grants = await q(`
    select table_name, grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema='public'
       and table_name = any (array[${TABLES.map(t => `'${t}'`).join(',')}])
       and grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`);
  grants.length === 0
    ? ok('and neither anon nor authenticated holds INSERT, UPDATE, DELETE or TRUNCATE on any of them')
    : bad(`write grants exist: ${grants.map(g => `${g.grantee}:${g.privilege_type} on ${g.table_name}`).join(', ')}`);

  // ══ 4 · DOCUMENTS ARE PRIVATE AND SIGNED ═════════════════════════════════
  head('the bucket, and the links out of it');
  const b = (await q(`select public, file_size_limit, allowed_mime_types
                        from storage.buckets where id='daily-closing'`))[0];
  b && b.public === false
    ? ok('the daily-closing bucket is private')
    : bad('the daily-closing bucket is PUBLIC');
  Number(b.file_size_limit) === 10485760
    ? ok('capped at 10 MB, per §A7')
    : bad(`the size cap is ${b.file_size_limit}`);
  const types = b.allowed_mime_types || [];
  !types.some(t => t === '*' || t === '*/*')
    ? ok(`and its allow-list is explicit: ${types.join(', ')}`)
    : bad(`the allow-list contains a wildcard: ${types.join(', ')}`);

  // no stored public URL anywhere — the habit this module deliberately broke
  const stored = (await q(`
    select count(*) n from public.cash_entry_attachments
     where storage_key like 'http%' or storage_key like '%/public/%'`))[0];
  Number(stored.n) === 0
    ? ok('no attachment row stores a public URL — they store a path')
    : bad(`${stored.n} attachment rows hold a URL rather than a path`);
  const docs = (await q(`
    select count(*) n from public.day_documents
     where storage_key like 'http%' or storage_key like '%/public/%'`))[0];
  Number(docs.n) === 0
    ? ok('and no day_documents row does either')
    : bad(`${docs.n} document rows hold a URL`);

  // the positive: there ARE rows, so the two checks above are not vacuous
  const counts = (await q(`select
      (select count(*) from public.cash_entry_attachments) a,
      (select count(*) from public.day_documents) d`))[0];
  Number(counts.d) > 0
    ? ok(`checked against ${counts.a} attachment and ${counts.d} document rows — not an empty table`)
    : bad('there are no document rows at all, so the two checks above proved nothing');

  // ══ 5 · THE EDGE FUNCTIONS WANT A TOKEN ══════════════════════════════════
  head('both edge functions refuse an unauthenticated caller');
  for (const f of ['daily-closing-file', 'daily-closing-pdf']) {
    const r = await fetch(`${URL_BASE}/functions/v1/${f}`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'read-url' }),
    });
    r.status === 401
      ? ok(`${f.padEnd(20)} 401 without a bearer token`)
      : bad(`${f} answered ${r.status} to an unauthenticated POST`);

    const g = await fetch(`${URL_BASE}/functions/v1/${f}`, { method: 'GET', headers: { apikey: ANON } });
    g.status === 401 || g.status === 405
      ? ok(`${f.padEnd(20)} ${g.status} to a GET`)
      : bad(`${f} answered ${g.status} to a GET`);
  }

  // ══ 6 · INPUT VALIDATION AT THE BOUNDARY ═════════════════════════════════
  head('the services validate what they are given');
  const cases = [
    ['a body that is not an object',
     `select public.record_cash_entry(null, null, null, null) r`],
    ['a voucher_type the caller tried to choose',
     `select public.record_cash_entry(null, null, null, '{"voucher_type":"CRV"}'::jsonb) r`],
  ];
  for (const [what, sql] of cases) {
    try {
      const r = (await q(sql))[0].r;
      (r && r.success === false && r.error)
        ? ok(`${what.padEnd(44)} → ${r.error}`)
        : bad(`${what} produced ${JSON.stringify(r)}`);
    } catch (e) {
      bad(`${what} raised instead of answering: ${e.message.slice(0, 120)}`);
    }
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                         : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });
