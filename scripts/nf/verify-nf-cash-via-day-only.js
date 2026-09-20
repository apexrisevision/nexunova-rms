#!/usr/bin/env node
/**
 * NexuFinance v1 — "cash can only move through days" (20260920a), driven for
 * real. Closes docs/AUDIT_REPORT.md CRITICAL-1, CRITICAL-2 and HIGH-1.
 *
 * THE INVARIANT UNDER TEST
 *   An account with via IS NOT NULL (10100 Cash in Hand, 10200 Petty Cash,
 *   10300 Bank Al-Habib) may only appear on a leg of a DAY-ATTACHED voucher.
 *   A journal voucher (day_id IS NULL) can never touch one.
 *
 * WHY THE OLD SUITES COULD NOT HAVE CAUGHT THIS
 *   SR-5: verify-nf-journal-voucher.js only ever posted non-cash journal
 *   vouchers, so it supplied the safe case and therefore tested nothing about
 *   the unsafe one. This suite posts the UNSAFE shape on purpose, through the
 *   real RPC the screen uses (nf_jv_save), and demands a refusal.
 *   SR-11: verify-nf-rules.js's H-R4 asserted that 12610 IS a head — which is
 *   true either way — and never that a via account is ABSENT from the head
 *   list. "The control exists" is not "the control works": CVD-10 below flips
 *   is_head back on a via account and requires the CHECK to stop it.
 *
 * WHAT IT DOES *NOT* ASSUME
 *   Every refusal is demanded at the DATABASE, over real HTTP with a real
 *   JWT (SR-9), including one call that bypasses nf_jv_save entirely and
 *   posts through nf_post_voucher. A screen that declines to offer cash is
 *   not the guarantee; the guarantee is that the row cannot exist.
 *
 * AND THE OTHER DIRECTION
 *   The day path DEPENDS on via legs — nf_save_line posts one on every
 *   receipt and payment, nf_set_transfers posts vouchers where BOTH legs are
 *   via accounts. CVD-20..24 drive a real day end to end so that "cash is
 *   locked down" cannot quietly mean "cash stopped working".
 *   CVD-30 covers the one report that picked its accounts by is_head and
 *   would have gone silently EMPTY.
 *
 *   node scripts/nf/verify-nf-cash-via-day-only.js > "$SCRATCH/nf-cvd.log" 2>&1
 *
 * Disposable ZZTEST-NF-<run> company; Awami is read but never written;
 * cleanup verified by query, always, even on failure.
 *
 * Exit: 0 held · 1 something failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF, TOKEN } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));

const PORT = 4501;
const URL_BASE = `https://${REF}.supabase.co`;
const VIA_CODES = ['10100', '10200', '10300'];
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(62)} ${pass ? '' : String(detail).slice(0, 300)}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'nexufinance.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}
async function keys() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const list = await r.json();
  return { anon: list.find(k => k.name === 'anon').api_key, svc: list.find(k => k.name === 'service_role').api_key };
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
// Every RPC goes over real HTTP with a real JWT (SR-9), and every argument is
// asserted present first — an `undefined` is dropped by JSON.stringify and
// silently becomes a differently shaped request.
function rpc(anonKey, jwt, name, args) {
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) throw new Error(`rpc ${name}: argument ${k} is undefined`);
  }
  return http_('POST', `/rest/v1/rpc/${name}`, { key: anonKey, jwt, body: args });
}
const code = r => (r.json && typeof r.json === 'object' && r.json.message) || null;
const okStatus = r => r.status >= 200 && r.status < 300;

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-cash-via-day-only] project ${REF} · run ${run}`);
  let K;
  try { K = await keys(); }
  catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) {
    console.log('COULD NOT RUN — seed assertions failed:\n' + built.failures.join('\n'));
    process.exitCode = 2; return;
  }
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = {};
  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZCVD${run}', 'ZZTEST-NF-${run}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-cvd-${run}@zztest-nf.invalid`, password = crypto.randomBytes(18).toString('base64url');
    const cu = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (cu.status >= 300) throw new Error(`create user: HTTP ${cu.status}`);
    users.D = { id: cu.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}','${users.D.id}','director','CVD Director',true)`);
    const li = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (li.status !== 200) throw new Error(`sign-in: HTTP ${li.status}`);
    users.D.jwt = li.json.access_token;
    console.log('  fixture: company, real chart, a director\n');

    // ── 1. the head list no longer offers cash ───────────────────────────
    let r = await rpc(K.anon, users.D.jwt, 'nf_list_heads', { p_company_id: C });
    const heads = Array.isArray(r.json) ? r.json : [];
    const headCodes = heads.map(h => h.code);
    ok('CVD-01 nf_list_heads returns 79 heads, not 82', heads.length === 79, `got ${heads.length}`);
    ok('CVD-02 nf_list_heads offers none of 10100/10200/10300',
      VIA_CODES.every(c => !headCodes.includes(c)), JSON.stringify(headCodes.filter(c => VIA_CODES.includes(c))));

    // the same question asked of the REAL Awami chart, read-only, through the
    // real RPC (not a hand-written SELECT that might disagree with it)
    const [awamiDir] = await q(`select user_id from nf_members where company_id='${AWAMI_COMPANY_ID}' and role in ('director','accountant') and active limit 1`);
    if (awamiDir) {
      const [aw] = await q(`select set_config('request.jwt.claim.sub','${awamiDir.user_id}',true);
        select jsonb_array_length(public.nf_list_heads('${AWAMI_COMPANY_ID}')) n,
               (select count(*) from jsonb_array_elements(public.nf_list_heads('${AWAMI_COMPANY_ID}')) e
                 where e->>'code' in ('10100','10200','10300')) vias`);
      ok('CVD-03 Awami: nf_list_heads drops 82 → 79', Number(aw.n) === 79, `got ${aw.n}`);
      ok('CVD-04 Awami: no via account in the head list', Number(aw.vias) === 0, `got ${aw.vias}`);
    } else {
      ok('CVD-03/04 Awami head list', false, 'no active Awami director/accountant to call the RPC as');
    }

    // ── 2. a JV can never touch cash — at the database ───────────────────
    const jvCash = (no, legs) => rpc(K.anon, users.D.jwt, 'nf_jv_save', {
      p_company_id: C, p_voucher_no: no, p_voucher_date: '2026-03-01', p_narration: 'must be refused', p_legs: legs });

    // the exact shape CRITICAL-1 described: spend cash from a journal voucher
    r = await jvCash('JV-CASH-OUT', [
      { account_code: '70100', floor_code: 'P-W', debit: 250000 },
      { account_code: '10100', floor_code: 'P-W', credit: 250000 }]);
    ok('CVD-05 nf_jv_save refuses Dr expense / Cr 10100 (cash out of a JV)',
      code(r) === 'NF:CASH_VIA_DAY_ONLY', JSON.stringify(r.json));

    r = await jvCash('JV-CASH-IN', [
      { account_code: '10100', floor_code: 'P-W', debit: 5000 },
      { account_code: '40900', floor_code: 'P-W', credit: 5000 }]);
    ok('CVD-06 nf_jv_save refuses Dr 10100 / Cr income (cash INTO a JV too)',
      code(r) === 'NF:CASH_VIA_DAY_ONLY', JSON.stringify(r.json));

    r = await jvCash('JV-PETTY', [
      { account_code: '70500', floor_code: 'P-W', debit: 900 },
      { account_code: '10200', floor_code: 'P-W', credit: 900 }]);
    ok('CVD-07 nf_jv_save refuses petty cash (10200)', code(r) === 'NF:CASH_VIA_DAY_ONLY', JSON.stringify(r.json));

    r = await jvCash('JV-BANK', [
      { account_code: '85100', floor_code: 'P-W', debit: 400 },
      { account_code: '10300', floor_code: 'P-W', credit: 400 }]);
    ok('CVD-08 nf_jv_save refuses the bank (10300)', code(r) === 'NF:CASH_VIA_DAY_ONLY', JSON.stringify(r.json));

    // bypass nf_jv_save entirely — the rule must live at the DB layer, not in
    // one RPC that a second entry path could simply not call.
    // R-2 (re-audit): nf_post_voucher is an INTERNAL primitive and no longer
    // holds EXECUTE for `authenticated`, so this call must now be refused by
    // the grant BEFORE the rule is even consulted.
    const rawLegs = [{ account_code: '70100', floor_code: 'P-W', debit: 100 },
                     { account_code: '10100', floor_code: 'P-W', credit: 100 }];
    r = await rpc(K.anon, users.D.jwt, 'nf_post_voucher', {
      p_company_id: C, p_day_id: null, p_voucher_no: 'JV-RAW', p_voucher_date: '2026-03-01',
      p_narration: 'straight past nf_jv_save', p_sort: 0, p_legs: rawLegs });
    ok('CVD-09 R-2: nf_post_voucher is not callable by an authenticated user at all',
      r.status === 404 || r.status === 403 || /permission denied|Could not find the function/i.test(JSON.stringify(r.json)),
      `${r.status} ${JSON.stringify(r.json)}`);

    // …and the rule still holds underneath the grant. Executed with FULL
    // privilege over the Management API (the service_role/migration channel,
    // which the revoke does NOT cover) with a real member's claim set, so
    // this tests the TRIGGER and not the ACL. Without this the suite would
    // only prove the door is locked, never that the wall behind it stands.
    let rawErr = null;
    try {
      await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
        select public.nf_post_voucher('${C}', NULL, 'JV-RAW', '2026-03-01', 'straight past nf_jv_save', 0,
          '${JSON.stringify(rawLegs)}'::jsonb)`);
    } catch (e) { rawErr = e.message; }
    ok('CVD-09a …and with full privilege the DB layer still refuses it (NF:CASH_VIA_DAY_ONLY)',
      !!rawErr && /CASH_VIA_DAY_ONLY/.test(rawErr), rawErr || 'it was ACCEPTED');

    const [leaked] = await q(`select count(*) n from nf_vouchers where company_id='${C}'`);
    ok('CVD-09b not one of those refusals left a row behind', Number(leaked.n) === 0, `${leaked.n} vouchers exist`);

    // ── 3. R4 is a constraint that WORKS, not one that merely exists ─────
    let r4err = null;
    try { await q(`update public.nf_accounts set is_head = true where company_id='${C}' and via = 'Cash'`); }
    catch (e) { r4err = e.message; }
    ok('CVD-10 nf_accounts_head_not_via actually rejects is_head=true on a via account',
      !!r4err && /nf_accounts_head_not_via/.test(r4err), r4err || 'the UPDATE was ACCEPTED');
    const [stillNot] = await q(`select count(*) n from nf_accounts where company_id='${C}' and via is not null and is_head`);
    ok('CVD-10b no via account is flagged is_head', Number(stillNot.n) === 0, `${stillNot.n} are`);

    // ── 3b. the head-list FILTER itself, not the data (re-audit test gap a) ──
    // CVD-01..04 pass because gen-seed and 20260920a both set is_head=false on
    // the vias — they would pass even if nf_list_heads had no `via IS NULL`
    // clause, so they prove the outcome and not the filter. Plant the thing
    // the filter exists to catch: a via account flagged is_head=true. The
    // CHECK constraint forbids exactly that, so the constraint is dropped and
    // the whole probe runs inside ONE statement batch that ends in ROLLBACK —
    // nothing is committed and the constraint is never actually absent from a
    // committed state, even if this fails part-way.
    const [planted] = await q(`BEGIN;
      ALTER TABLE public.nf_accounts DROP CONSTRAINT nf_accounts_head_not_via;
      UPDATE public.nf_accounts SET is_head = true WHERE company_id = '${C}' AND via IS NOT NULL;
      SELECT set_config('request.jwt.claim.sub','${users.D.id}',true);
      SELECT json_build_object(
        'planted', (SELECT count(*) FROM public.nf_accounts WHERE company_id='${C}' AND via IS NOT NULL AND is_head),
        'heads',   jsonb_array_length(public.nf_list_heads('${C}')),
        'vias_offered', (SELECT count(*) FROM jsonb_array_elements(public.nf_list_heads('${C}')) e
                          WHERE e->>'code' IN ('10100','10200','10300'))) j;
      ROLLBACK;`);
    ok('CVD-11 the head list excludes a via account even when is_head is TRUE (filter, not data)',
      Number(planted.j.planted) === 3 && Number(planted.j.vias_offered) === 0 && Number(planted.j.heads) === 79,
      JSON.stringify(planted.j));
    const [rolledBack] = await q(`select
        (select count(*) from pg_constraint where conname='nf_accounts_head_not_via' and conrelid='public.nf_accounts'::regclass) constraint_back,
        (select count(*) from public.nf_accounts where via is not null and is_head) still_planted`);
    ok('CVD-11b the probe rolled back cleanly: constraint restored, nothing planted survives',
      Number(rolledBack.constraint_back) === 1 && Number(rolledBack.still_planted) === 0, JSON.stringify(rolledBack));

    // ── 3c. R-3: no existence oracle across companies ───────────────────────
    // This director is a member of the scratch company only. Asking about a
    // REAL Awami voucher id and about a random uuid must be indistinguishable.
    const [awamiV] = await q(`select id from public.nf_vouchers where company_id='${AWAMI_COMPANY_ID}' limit 1`);
    const realOther = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: awamiV.id, p_version: 0 });
    const nonExistent = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: crypto.randomUUID(), p_version: 0 });
    ok('CVD-14 R-3: a real voucher in another company answers exactly like one that does not exist',
      code(realOther) === 'NF:VOUCHER_NOT_FOUND' && code(nonExistent) === 'NF:VOUCHER_NOT_FOUND'
      && realOther.status === nonExistent.status,
      `other-company: ${realOther.status} ${JSON.stringify(realOther.json)} · random: ${nonExistent.status} ${JSON.stringify(nonExistent.json)}`);

    // ── 4. the day path still works end to end ──────────────────────────
    r = await rpc(K.anon, users.D.jwt, 'nf_start_first_day', {
      p_company_id: C, p_date: '2026-03-02', p_closing_no: 'DC-1',
      p_open_cash: 500000, p_open_petty: 10000, p_open_bank: 200000 });
    ok('CVD-20 a day starts', okStatus(r), JSON.stringify(r.json).slice(0, 200));
    const [dayRow] = await q(`select id, version from nf_days where company_id='${C}' and business_date='2026-03-02'`);

    // a receipt: head leg 21100 + a via leg on 10100 — the via leg is the
    // whole point, and is exactly what the new guard must keep allowing
    r = await rpc(K.anon, users.D.jwt, 'nf_save_line', {
      p_day_id: dayRow.id, p_line_id: null, p_side: 'IN', p_voucher_no: 'CRV-1',
      p_description: 'token received', p_head: '21100', p_floor: 'GF', p_via: 'Cash',
      p_amount: 75000, p_version: null, p_party_name: 'CVD Test Buyer' });
    ok('CVD-21 a cash RECEIPT still posts (its via leg on 10100 is allowed)', okStatus(r), JSON.stringify(r.json).slice(0, 250));

    r = await rpc(K.anon, users.D.jwt, 'nf_save_line', {
      p_day_id: dayRow.id, p_line_id: null, p_side: 'OUT', p_voucher_no: 'CPV-1',
      p_description: 'site labour', p_head: '52600', p_floor: 'GF', p_via: 'Cash',
      p_amount: 30000, p_version: null, p_party_name: null });
    ok('CVD-22 a cash PAYMENT still posts', okStatus(r), JSON.stringify(r.json).slice(0, 250));

    // the harder case: a transfer voucher whose BOTH legs are via accounts
    const [dv] = await q(`select version from nf_days where id='${dayRow.id}'`);
    r = await rpc(K.anon, users.D.jwt, 'nf_set_transfers', {
      p_day_id: dayRow.id, p_to_bank: 100000, p_to_petty: 5000, p_version: dv.version });
    ok('CVD-23 a TRANSFER still posts — both legs are via accounts', okStatus(r), JSON.stringify(r.json).slice(0, 250));

    const [legs] = await q(`select
        (select count(*) from nf_voucher_legs l join nf_accounts a on a.company_id=l.company_id and a.code=l.account_code
          where l.company_id='${C}' and a.via is not null) via_legs,
        (select count(*) from nf_vouchers v where v.company_id='${C}' and v.day_id is not null) day_vouchers,
        (select count(*) from nf_vouchers v where v.company_id='${C}' and v.day_id is null) dayless`);
    ok('CVD-23b the via legs really exist on day vouchers (4 vouchers, 6 via legs)',
      Number(legs.via_legs) === 6 && Number(legs.day_vouchers) === 4 && Number(legs.dayless) === 0, JSON.stringify(legs));

    // the position still computes, and still refuses to go negative
    // nf_get_day's position is { net, rows: [{ via, code, opening, received,
    // paid, transfers, closing }] } — one row per via account, NOT the flat
    // close_cash/close_petty/close_bank shape nf_position_row returns.
    r = await rpc(K.anon, users.D.jwt, 'nf_get_day', { p_company_id: C, p_date: '2026-03-02' });
    const rows = (r.json && r.json.position && r.json.position.rows) || [];
    const byVia = Object.fromEntries(rows.map(x => [x.via, x]));
    ok('CVD-24 the day position is right: cash 500000 + 75000 - 30000 - 105000 = 440000',
      rows.length === 3 && Number(byVia.Cash && byVia.Cash.closing) === 440000
      && Number(byVia.Petty && byVia.Petty.closing) === 15000
      && Number(byVia.Bank && byVia.Bank.closing) === 300000,
      JSON.stringify(rows));

    r = await rpc(K.anon, users.D.jwt, 'nf_save_line', {
      p_day_id: dayRow.id, p_line_id: null, p_side: 'OUT', p_voucher_no: 'CPV-2',
      p_description: 'more than there is', p_head: '52600', p_floor: 'GF', p_via: 'Cash',
      p_amount: 9000000, p_version: null, p_party_name: null });
    ok('CVD-25 the day path still refuses to overdraw the till', code(r) === 'NF:NEGATIVE_POSITION', JSON.stringify(r.json));

    // ── 5. the report that picked its accounts by is_head ───────────────
    r = await rpc(K.anon, users.D.jwt, 'nf_get_cash_bank_movement', { p_company_id: C, p_from: null, p_to: null });
    const cbm = (r.json && r.json.accounts) || [];
    ok('CVD-30 Cash & Bank Movement still covers all three accounts (did not go empty)',
      cbm.length === 3 && VIA_CODES.every(c => cbm.some(a => a.code === c)), JSON.stringify(cbm.map(a => a.code)));
    // What this migration is answerable for is the account SET (the `accts`
    // CTE it widened), and the MOVEMENTS those accounts report. Assert both
    // against the same day: 75000 in, 30000 paid + 105000 transferred out.
    const cash = cbm.find(a => a.code === '10100');
    ok('CVD-31 …and 10100\'s movements still tie to the day (in 75000, out 30000+105000)',
      !!cash && Number(cash.total_in) === 75000 && Number(cash.total_out) === 135000, JSON.stringify(cash));

    // MEDIUM-4, CLOSED by 20260920b. This assertion was written the other way
    // up one pass ago: it pinned the BUG (opening 0, closing −60000) so the
    // gap stayed visible and whoever fixed it would be told to close the
    // finding. That is exactly what happened, so it now pins the fix.
    // nf_get_cash_bank_movement asks nf_ledger_position — the same function
    // the sheet uses — instead of deriving the opening from legs alone, so
    // report and sheet cannot drift apart. 500000 opened + 75000 in
    // − 30000 paid − 105000 transferred = 440000, the sheet's own figure
    // (CVD-24).
    ok('CVD-32 MEDIUM-4 closed: the report opens at the typed opening, and closes where the sheet does',
      !!cash && Number(cash.opening) === 500000 && Number(cash.closing) === 440000, JSON.stringify(cash));

    // ── 4b. R-1: a day voucher cannot be re-parented to day-less ────────────
    // The via-leg rule lives in the LEG guard, so moving the HEADER off its
    // day slipped past it untouched — the legs never change, so nothing fired.
    // service_role only, which is exactly the channel this q() runs on.
    let reparent = null;
    try {
      await q(`update public.nf_vouchers set day_id = null
                where id = (select id from public.nf_vouchers where company_id='${C}' and day_id is not null limit 1)`);
    } catch (e) { reparent = e.message; }
    ok('CVD-26 R-1: UPDATE nf_vouchers SET day_id = NULL is refused (NF:VOUCHER_DAY_IMMUTABLE)',
      !!reparent && /VOUCHER_DAY_IMMUTABLE/.test(reparent), reparent || 'the UPDATE was ACCEPTED');
    const [stillDay] = await q(`select count(*) n from public.nf_vouchers where company_id='${C}' and day_id is null`);
    ok('CVD-26b …and no voucher of this company became day-less', Number(stillDay.n) === 0, `${stillDay.n} are`);

    // ── 4c. R-2 belt: a day voucher must carry its day's own date ───────────
    // Not reachable by an app user any more (CVD-09), so this is aimed at the
    // one channel the revoke does not cover: migrations and import scripts.
    let dateMismatch = null;
    try {
      await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
        select public.nf_post_voucher('${C}', '${dayRow.id}', 'CPV-OFFDATE', '2026-03-01', 'dated off its day', 99,
          '[{"account_code":"52600","floor_code":"GF","debit":10},{"account_code":"10100","floor_code":"GF","credit":10}]'::jsonb)`);
    } catch (e) { dateMismatch = e.message; }
    ok('CVD-27 R-2 belt: a day voucher dated off its day is refused (NF:DATE_DAY_MISMATCH)',
      !!dateMismatch && /DATE_DAY_MISMATCH/.test(dateMismatch), dateMismatch || 'it was ACCEPTED');
    // and the same call with the day's OWN date is accepted, so CVD-27 is
    // testing the date rule and not merely that the statement fails
    let sameDate = null;
    try {
      await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
        select public.nf_post_voucher('${C}', '${dayRow.id}', 'CPV-ONDATE', '2026-03-02', 'dated on its day', 98,
          '[{"account_code":"52600","floor_code":"GF","debit":10},{"account_code":"10100","floor_code":"GF","credit":10}]'::jsonb)`);
    } catch (e) { sameDate = e.message; }
    ok('CVD-27b …while the identical voucher dated ON its day is accepted', sameDate === null, sameDate || '');

    // ── 6. the screen, for completeness — the picker cannot offer cash ───
    if (!puppeteer || !CHROME) {
      console.log('  (browser layer skipped — no puppeteer-core/Chrome)');
    } else {
      srv = await serve();
      browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
      await page.evaluateOnNewDocument((ref, jwt, uid, mail) => {
        localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
          access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
          user: { id: uid, aud: 'authenticated', role: 'authenticated', email: mail, app_metadata: {}, user_metadata: {} } }));
      }, REF, users.D.jwt, users.D.id, users.D.email);
      await page.setViewport({ width: 1500, height: 1100 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#nf-rpm-toggle', { timeout: 15000 });
      await page.click('#nf-rpm-toggle');
      await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
      await page.click('[data-goto="jv"]');
      await page.waitForSelector('.jvsheet #nf-jv-post', { timeout: 15000 });

      // type "10" into the JV account picker: every 101xx code would match on
      // substring, so if cash were still in the list it would be right there
      const cashOffered = await page.evaluate(async () => {
        const inp = document.querySelector('[data-pick="jv-account"] .nfpick-in');
        if (!inp) return { error: 'no jv-account picker on the screen' };
        inp.focus();
        inp.value = '10';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 250));
        const dd = inp.closest('[data-pick]').querySelector('.nfpick-dd');
        const text = dd ? dd.innerText : '';
        return { text, hasCash: /10100|10200|10300/.test(text) };
      });
      ok('CVD-40 the JV account picker does not offer 10100/10200/10300',
        cashOffered.hasCash === false, JSON.stringify(cashOffered).slice(0, 300));

      // and the Daily Closing head picker must not offer them either
      await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.pos-grid', { timeout: 15000 });
      const sheetOffered = await page.evaluate(async () => {
        const inp = document.querySelector('[data-pick="head"] .nfpick-in');
        if (!inp) return { error: 'no head picker on the sheet' };
        inp.focus();
        inp.value = '10';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 250));
        const dd = inp.closest('[data-pick]').querySelector('.nfpick-dd');
        const text = dd ? dd.innerText : '';
        return { text, hasCash: /10100|10200|10300/.test(text) };
      });
      ok('CVD-41 the Daily Closing head picker does not offer them either',
        sheetOffered.hasCash === false, JSON.stringify(sheetOffered).slice(0, 300));
      ok('CVD-42 no console or page errors on either screen', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

      // ── R-4 · the save queue must drain even when the toast cannot show ──
      // The re-audit's finding against our own MEDIUM-3 fix: toast() does
      // `root.querySelector('#nf-toast-host').appendChild(...)` with no null
      // check, and that host is destroyed when the person opens the Director
      // Report or the JV screen. A debounced save failing after that reaches a
      // toast whose host is null, throws INSIDE the catch handler, and
      // serialDebounce's `.then()` — the only thing that resets `running` —
      // never runs. The queue is wedged for the rest of the session and every
      // later edit is silently dropped. The previous empty `.catch(){}` could
      // not throw, so this was a regression the fix introduced.
      //
      // Reproduced here exactly, with no stubbing: delete the toast host, make
      // one save fail for real (a stale version, by bumping it out of band),
      // then type again and require the second edit to reach the database.
      const [dv0] = await q(`select version from nf_days where id='${dayRow.id}'`);
      await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#nf-remarks', { timeout: 15000 });
      // out of band: the page's cached day version is now stale by one
      await rpc(K.anon, users.D.jwt, 'nf_set_remarks', { p_day_id: dayRow.id, p_remarks: 'bumped out of band', p_version: dv0.version });

      const typeRemark = async (text) => page.evaluate(t => {
        const el = document.querySelector('#nf-remarks');
        if (!el) return false;
        el.value = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, text);

      await page.evaluate(() => { const h = document.querySelector('#nf-toast-host'); if (h) h.remove(); });
      const hostGone = await page.evaluate(() => !document.querySelector('#nf-toast-host'));
      ok('CVD-50 setup: the toast host is really gone (as it is after opening a report)', hostGone, 'host still present');

      ok('CVD-51 setup: the remarks box accepted the first edit', await typeRemark('first attempt'), 'no #nf-remarks');
      await new Promise(res => setTimeout(res, 2500));   // 700ms debounce + the round trip
      const [afterFirst] = await q(`select remarks from nf_days where id='${dayRow.id}'`);
      // not vacuous: that save MUST have failed, or the test proves nothing
      ok('CVD-52 setup: the first save really was rejected (stale version)',
        afterFirst.remarks !== 'first attempt', JSON.stringify(afterFirst));

      await typeRemark('second attempt');
      await new Promise(res => setTimeout(res, 3000));
      const [afterSecond] = await q(`select remarks from nf_days where id='${dayRow.id}'`);
      ok('CVD-53 R-4: a later edit still saves — the queue drained despite the failed toast',
        afterSecond.remarks === 'second attempt', JSON.stringify(afterSecond));
    }
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    if (users.D && users.D.id) {
      const r = await http_('DELETE', `/auth/v1/admin/users/${users.D.id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user: HTTP ${r.status}`);
    }
    const [left] = await q(`select json_build_object(
      'company', (select count(*) from companies where id='${C}'),
      'nf_rows', (select count(*) from nf_vouchers where company_id='${C}') + (select count(*) from nf_days where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(left.j));
    ok('CLEANUP', left.j.company === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));
    const awamiAfter = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} → ${awamiAfter}`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
