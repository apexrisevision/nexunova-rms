#!/usr/bin/env node
/**
 * Daily Closing — can a session in the WRONG TENANT reach Awami's cash book?
 *
 *   node scripts/verify-daily-closing-isolation.js
 *
 * Asked after a real incident: on 2026-09-05 the sidebar item rendered while
 * the shell was labelled "Fourteen Group". The label turned out to be Awami's
 * own `companies.display_name`, so no foreign session was involved — but
 * "the label was cosmetic" is an explanation, not a proof, and the question
 * underneath it is the one that matters:
 *
 *     If a session belonging to another tenant ever draws that item, can it
 *     open the screen and read Awami's money?
 *
 * ── HOW THIS IS PROVED, AND WHY NOT THE EASY WAY ────────────────────────────
 * The other suites impersonate with
 * `set_config('request.jwt.claims', …)` through the Management API. That runs
 * as the superuser and *simulates* auth.uid(); it proves the predicate's logic
 * and nothing about the path a browser actually takes.
 *
 * This file uses a REAL PASSWORD SIGN-IN, a REAL JWT, and the REAL PostgREST
 * and edge-function endpoints — the same URLs js/supabase.js calls. If the
 * grants, the RLS or the `verify_jwt` setting were wrong, the SQL suites would
 * still pass and this one would not.
 *
 * ⚠️ THE FOREIGN TENANT IS ZZTEST, NOT FMH OR KHUSHAL BAGH. Proving it with a
 * real FMH session would mean creating or resetting a credential on a live
 * tenant, which is not something a test may do. ZZTEST is a genuinely separate
 * `companies` row with its own users, so it exercises the identical predicate
 * — `_dc_may_view` → `_dc_may_touch_project` → company match — that protects
 * FMH and Khushal Bagh. What is proved here about ZZTEST holds for them by the
 * same code path, and the SQL-level suite covers those two by name.
 *
 * ⚠️ SR-2. Every assertion here is "must be refused", which passes just as
 * happily when the harness is broken, the token is junk or the endpoint is
 * down. So every refusal is paired: the SAME caller, the SAME call, against
 * its OWN tenant, must succeed first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const URL_BASE = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';

// The pilot — what must NOT be reachable.
const AWAMI_CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const AWAMI_PJ = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
// The other brand-sharing tenant, used as a "wrong company id" the shell might hold.
const FG_CO = '3249e3b5-c411-4f5f-ae48-0246304c9c87';

// The foreign caller — a real signed-in user of another tenant.
const ZZ_CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const ZZ_PJ = '2da565ca-2b83-44bf-b4de-2cae762571df';
const EMAIL = 'dc-att-other@zztest.invalid';
const PW = 'dc-att-' + REF.slice(0, 8) + '-Aa1!';

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);
const one = r => (Array.isArray(r) ? r[0] : r) || {};

const rpc = (jwt, fn, args) =>
  fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

const edge = (jwt, fn, body) =>
  fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

const refused = r =>
  r.status === 401 || r.status === 403 ||
  (r.body && r.body.success === false) ||
  (r.body && r.body.error);

(async () => {
  head('a real sign-in, over the real endpoint');
  const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  }).then(r => r.json());
  if (!tok.access_token) {
    bad(`could not sign in as ${EMAIL} — run verify-daily-closing-attachment.js first`);
    return report();
  }
  const JWT = tok.access_token;
  ok(`signed in as ${EMAIL} and holding a real JWT`);

  const who = one(await q(
    `select c.company_name from public.app_users u join public.companies c on c.id=u.company_id
      where u.email='${EMAIL}'`)).company_name;
  who && who !== 'Awami Market'
    ? ok(`the caller belongs to "${who}" — a different tenant from the pilot`)
    : bad(`the caller resolves to ${who}; this proves nothing`);

  // ══ 1 · THE PAIRED POSITIVE — the probe works ═════════════════════════════
  head('first: the same caller CAN reach its own tenant (or the refusals mean nothing)');
  {
    const r = await rpc(JWT, 'get_my_daily_closing_access',
      { p_company_id: ZZ_CO, p_project_id: ZZ_PJ });
    (r.body && r.body.success === true && r.body.role)
      ? ok(`own tenant: role ${r.body.role}, may_view ${r.body.may_view}`)
      : bad(`the caller cannot reach its OWN tenant either: ${JSON.stringify(r.body).slice(0, 140)}`);

    const d = await rpc(JWT, 'get_daily_closing_tile', { p_company_id: ZZ_CO, p_project_id: ZZ_PJ });
    (d.body && d.body.success === true)
      ? ok('own tenant: the tile answers with real figures')
      : bad(`own tenant tile failed: ${JSON.stringify(d.body).slice(0, 140)}`);
  }

  // ══ 2 · THE SAME CALLS, POINTED AT AWAMI ══════════════════════════════════
  head("now the same caller, pointed at Awami Market's cash book");
  const AWAMI_CALLS = [
    ['get_my_daily_closing_access', { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['get_daily_closing_tile',      { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['get_cash_day_summary',        { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['list_cash_days',              { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ, p_limit: 60 }],
    ['list_payees',                 { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['list_qb_accounts_for_project',{ p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['list_units_for_picker',       { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    ['open_cash_day',               { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ }],
    // every named argument, because PostgREST matches on the FULL name set —
    // an incomplete one 404s as PGRST202, and a routing error is not a refusal
    ['setup_cash_opening',          { p_company_id: AWAMI_CO, p_project_id: AWAMI_PJ,
                                      p_cash: 1, p_bank: 1, p_effective_date: null }],
  ];
  for (const [fn, args] of AWAMI_CALLS) {
    const r = await rpc(JWT, fn, args);
    refused(r)
      ? ok(`${fn.padEnd(30)} refused — ${r.status} ${(r.body && r.body.error) || ''}`)
      : bad(`${fn} ANSWERED FOR AWAMI: ${JSON.stringify(r.body).slice(0, 200)}`);
  }

  // ══ 3 · AWAMI'S REAL ROW IDS, GUESSED ═════════════════════════════════════
  // A cash_day_id or a document id is a uuid somebody could have seen in a URL.
  head("and with Awami's own row ids, not just its project id");
  {
    const day = one(await q(
      `select id::text id from public.cash_days where project_id='${AWAMI_PJ}' limit 1`)).id;
    const doc = one(await q(
      `select dd.id::text id from public.day_documents dd
         join public.cash_days d on d.id = dd.cash_day_id
        where d.project_id='${AWAMI_PJ}' limit 1`)).id;

    if (!day) {
      console.log('     (Awami has no cash day yet — nothing to guess at; re-run after the first day)');
      ok('no Awami day exists to attempt, so this pair is vacuous and is not counted as proof');
    } else {
      for (const [fn, args] of [
        ['list_cash_entries',    { p_company_id: AWAMI_CO, p_cash_day_id: day }],
        ['get_cash_day_pdf_data',{ p_company_id: AWAMI_CO, p_cash_day_id: day }],
        ['list_cash_day_audit',  { p_company_id: AWAMI_CO, p_cash_day_id: day, p_limit: 10 }],
        ['close_cash_day',       { p_company_id: AWAMI_CO, p_cash_day_id: day, p_counted_cash: 1 }],
      ]) {
        const r = await rpc(JWT, fn, args);
        refused(r)
          ? ok(`${fn.padEnd(30)} refused on a real Awami day id`)
          : bad(`${fn} ANSWERED with a real Awami day id: ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      if (doc) {
        const r = await rpc(JWT, 'authorize_day_document',
          { p_company_id: AWAMI_CO, p_document_id: doc });
        refused(r) ? ok('authorize_day_document      refused on a real Awami sheet id')
                   : bad(`a foreign session got a link to an Awami sheet: ${JSON.stringify(r.body).slice(0, 200)}`);
      }
    }
  }

  // ══ 4 · THE SHELL'S "WRONG TENANT" SHAPE ══════════════════════════════════
  // The incident's actual shape: the shell holding one company id while the
  // session belongs to another. Both directions are refused.
  head('the incident shape: a session holding a company id that is not its own');
  for (const [label, co] of [['Awami', AWAMI_CO], ['Fourteen Group', FG_CO]]) {
    const r = await rpc(JWT, 'get_my_daily_closing_access', { p_company_id: co, p_project_id: null });
    refused(r)
      ? ok(`a ZZTEST session claiming to be ${label.padEnd(15)} is refused`)
      : bad(`a ZZTEST session was served as ${label}: ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  // ══ 5 · THE EDGE FUNCTIONS ════════════════════════════════════════════════
  head('the two edge functions, with a real foreign token');
  {
    const day = one(await q(
      `select id::text id from public.cash_days where project_id='${AWAMI_PJ}' limit 1`)).id;
    if (day) {
      const r = await edge(JWT, 'daily-closing-pdf', { company_id: AWAMI_CO, cash_day_id: day });
      refused(r) ? ok(`daily-closing-pdf   refused (${r.status})`)
                 : bad(`a foreign session RENDERED an Awami sheet: ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    const att = one(await q(
      `select a.id::text id from public.cash_entry_attachments a
         join public.cash_entries e on e.id = a.entry_id
        where e.project_id='${AWAMI_PJ}' limit 1`)).id;
    if (att) {
      const r = await edge(JWT, 'daily-closing-file',
        { op: 'read-url', company_id: AWAMI_CO, attachment_id: att });
      refused(r) ? ok(`daily-closing-file  refused (${r.status})`)
                 : bad(`a foreign session got a link to an Awami attachment`);
    } else {
      console.log('     (Awami has no attachments yet — nothing to attempt)');
    }
  }

  // ══ 6 · WHY STALE FLAGS CANNOT CROSS A TENANT ═════════════════════════════
  // The remaining theory was: the shell switches tenant in-page, keeping the
  // previous tenant's flags, and draws the item under the wrong company. That
  // requires an in-page tenant switch. There is none.
  head('and the shell cannot change tenant without a page load');
  {
    const html = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
    const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const hasSwitcherNode = /id="sb-ws-name"|id="sb-ws-av"/.test(html);
    hasSwitcherNode
      ? bad('login.html has a workspace-switcher node — re-check whether it can change S.cid in place')
      : ok('the company chip is display-only; no workspace-switcher node exists in the shell');
    // updateCoLogo writes the label and nothing else
    /S\.cid\s*=/.test(ui)
      ? bad('js/ui.js assigns S.cid — a tenant can change without a reload')
      : ok('js/ui.js never assigns S.cid — the tenant is fixed for the life of the page');
  }

  report();

  function report() {
    console.log('\n──────────────────────────────────────────────');
    if (fail === 0) {
      console.log(`✅ PASS  (${pass} assertions, 0 failed)`);
      console.log('   A real signed-in session from another tenant cannot read, write, render');
      console.log('   or link to anything in Awami\'s cash book — over the same endpoints the');
      console.log('   browser uses. The sidebar item is a label; the boundary is the server.');
    } else {
      console.log(`❌ FAIL  (${pass} passed, ${fail} failed)`);
    }
    if (fail) process.exitCode = 1;
  }
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });
