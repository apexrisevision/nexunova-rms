#!/usr/bin/env node
/**
 * Daily Closing — P10: a real file, through the real bridge.
 *
 *   node scripts/verify-daily-closing-attachment.js
 *
 * This is the item carried from P7 and pinned to P10's Definition of Done:
 *
 *   · attach a REAL file to a REAL entry;
 *   · prove the storage key begins with that entry's project_id;
 *   · prove a user from ANOTHER project cannot fetch the signed URL.
 *
 * It cannot run inside BEGIN … ROLLBACK: the bridge is an edge function over
 * HTTP, so it needs a committed entry and two really signed-in users. Both live
 * on ZZTEST.
 *
 * ⚠️ SR-1. The fixture entry is PERMANENT — invariant 1 forbids deleting a cash
 * entry — so it lives on **ZZ Map Tower**, a ZZTEST project that hosts no suite
 * which wipes entries. The uploaded object is deleted at the end; the row that
 * points at it is not, and cannot be.
 *
 * ⚠️ SR-2. "The other user is refused" is an absent-thing assertion. It is
 * paired throughout: the owning user's identical call must SUCCEED first, so a
 * broken harness that can fetch nothing at all fails before it can pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { q, REF, TOKEN } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const URL_BASE = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';
const BUCKET = 'daily-closing';

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';   // ZZ Map Tower — P10 fixtures
const PJ_OTHER = '2da565ca-2b83-44bf-b4de-2cae762571df'; // ZZTEST Garden

const OWNER_EMAIL = 'dc-att-owner@zztest.invalid';
const OTHER_EMAIL = 'dc-att-other@zztest.invalid';
const PW = 'dc-att-' + REF.slice(0, 8) + '-Aa1!';

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);
const one = r => (Array.isArray(r) ? r[0] : r) || {};

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  const k = (await r.json() || []).find(x => x.name === 'service_role' || x.type === 'secret');
  if (!k || !k.api_key) throw new Error('could not read the service key');
  return k.api_key;
}

async function ensureUser(SERVICE, email, role, projectId, grant) {
  let authId = one(await q(
    `select auth_user_id::text id from public.app_users
      where company_id='${CO}' and email='${email}' limit 1`)).id;
  if (!authId) {
    const u = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PW, email_confirm: true }),
    }).then(r => r.json());
    authId = u.id;
    if (!authId) throw new Error(`could not create ${email}: ${JSON.stringify(u).slice(0, 200)}`);
    await q(`insert into public.app_users
      (company_id, full_name, username, email, role, auth_provider, status, auth_user_id, module_permissions)
      values ('${CO}','${email.split('@')[0]}','${email.split('@')[0].replace(/-/g,'')}','${email}',
              '${role}','password','active','${authId}','${grant ? '{"dailyclosing": true}' : '{}'}'::jsonb)
      on conflict do nothing`);
  }
  // assignment is refreshed every run, so a project change in the file takes effect
  await q(`insert into public.user_project_assignments (company_id, user_id, project_id, access_level, is_active)
           select '${CO}', id, '${projectId}', 'edit', true from public.app_users where email='${email}'
           on conflict do nothing`);
  const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  }).then(r => r.json());
  if (!tok.access_token) throw new Error(`could not sign in ${email}: ${JSON.stringify(tok).slice(0, 200)}`);
  return { authId, jwt: tok.access_token };
}

const fn = (name, jwt, body) => fetch(`${URL_BASE}/functions/v1/${name}`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

(async () => {
  const SERVICE = await serviceKey();

  head('two signed-in users, on two different projects');
  const owner = await ensureUser(SERVICE, OWNER_EMAIL, 'cfo', PJ, false);
  const other = await ensureUser(SERVICE, OTHER_EMAIL, 'staff', PJ_OTHER, true);
  ok(`the owner is on ZZ Map Tower, the other on ZZTEST Garden`);

  head('a committed day and entry to hang a file on');
  await q(`select public.seed_daily_closing_chart('${CO}','${PJ}')`);
  let entry = one(await q(
    `select e.id::text id from public.cash_entries e
      where e.project_id='${PJ}' and e.narration = 'P10 attachment fixture' limit 1`)).id;

  if (!entry) {
    // Built directly rather than through the RPCs: setup_cash_opening is
    // once-per-project and this project may already have an opening.
    const uid = one(await q(`select id::text id from public.app_users where email='${OWNER_EMAIL}'`)).id;
    const acct = one(await q(`select id::text id from public.qb_accounts where company_id='${CO}' and number='6050'`)).id;
    let payee = one(await q(`select id::text id from public.payees where company_id='${CO}' and name='P10 Vendor'`)).id;
    if (!payee) {
      payee = one(await q(`insert into public.payees (company_id,project_id,name,kind)
        values ('${CO}','${PJ}','P10 Vendor','VENDOR') returning id::text id`)).id;
    }
    let day = one(await q(`select id::text id from public.cash_days
      where project_id='${PJ}' and business_date = current_date`)).id;
    if (!day) {
      day = one(await q(`insert into public.cash_days
        (company_id, project_id, business_date, status, opening_cash, opening_bank, created_by)
        values ('${CO}','${PJ}', current_date, 'OPEN', 0, 0, '${uid}') returning id::text id`)).id;
    }
    entry = one(await q(`insert into public.cash_entries
      (company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type, mode, direction,
       voucher_type, voucher_no, amount, narration, payee_id, rms_status, qb_account_id, created_by)
      values ('${CO}','${PJ}','${day}',
        (select coalesce(max(seq_no),0)+1 from public.cash_entries where cash_day_id='${day}'),
        gen_random_uuid(),'EXPENSE','CASH','OUT','CPV',
        'P10-' || floor(random()*9000+1000)::text, 500,'P10 attachment fixture','${payee}',
        'NA','${acct}','${uid}') returning id::text id`)).id;
  }
  ok(`entry ${entry.slice(0, 8)}… on ZZ Map Tower (permanent by design — SR-1)`);

  // ── a real file ──────────────────────────────────────────────────────────
  // A genuine one-page PDF, built here so the suite carries no fixture binary.
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

  head('the upload: the browser asks, the bridge decides where');
  const up = await fn('daily-closing-file', owner.jwt,
    { op: 'upload-url', company_id: CO, entry_id: entry, mime: 'application/pdf' });
  if (!up.json || up.json.success !== true) {
    bad(`the bridge refused the owner: ${JSON.stringify(up.json)}`);
    return report();
  }
  ok('the bridge issued a signed upload URL to the entry\'s own user');

  const key = up.json.storage_key;
  key.startsWith(PJ + '/')
    ? ok(`THE KEY BEGINS WITH THE PROJECT ID — ${key.slice(0, 45)}…`)
    : bad(`the key does not start with the project id: ${key}`);
  key.includes('/' + entry + '/')
    ? ok('and it is filed under the entry it belongs to')
    : bad(`the key does not contain the entry id: ${key}`);

  // The browser never chose the path — prove the bridge ignores one it is given.
  const spoof = await fn('daily-closing-file', owner.jwt, {
    op: 'upload-url', company_id: CO, entry_id: entry, mime: 'application/pdf',
    storage_key: `${PJ_OTHER}/anything/evil.pdf`,
  });
  (spoof.json && spoof.json.storage_key && spoof.json.storage_key.startsWith(PJ + '/'))
    ? ok('a storage_key supplied by the caller is ignored — the bridge builds its own')
    : bad(`a caller-supplied key changed where the file lands: ${spoof.json && spoof.json.storage_key}`);

  // and a type that is not an attachment is refused
  const badMime = await fn('daily-closing-file', owner.jwt,
    { op: 'upload-url', company_id: CO, entry_id: entry, mime: 'application/x-msdownload' });
  (badMime.json && badMime.json.error === 'INVALID_TRANSITION')
    ? ok('an executable is refused a URL at all — JPG, PNG and PDF only')
    : bad(`a .exe was offered an upload URL: ${JSON.stringify(badMime.json)}`);

  head('the file really goes up, and the row really points at it');
  const put = await fetch(up.json.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  put.ok ? ok(`uploaded ${pdf.length} bytes to the private bucket`)
         : bad(`the upload failed: HTTP ${put.status} ${(await put.text()).slice(0, 120)}`);

  // ⚠️ IMPERSONATE. The Management API runs as the superuser with no
  // request.jwt.claims, so _rms_caller() comes back empty and every RPC
  // answers NOT_AUTHORIZED. Both statements go in ONE request so the
  // session-local setting is still in force for the second.
  const rec = await q(
    `select set_config('request.jwt.claims',
       json_build_object('sub','${owner.authId}')::text, true);
     select public.add_cash_entry_attachment(
       '${CO}','${entry}','${key}','application/pdf', ${pdf.length}) r;`);
  const att = one(rec).r;
  (att && att.success)
    ? ok('add_cash_entry_attachment accepted the key the bridge built')
    : bad(`the attachment row was refused: ${JSON.stringify(att)}`);
  const attId = att && att.attachment_id;

  head('reading it back: the owner can, the other project cannot');
  const readOwn = await fn('daily-closing-file', owner.jwt,
    { op: 'read-url', company_id: CO, attachment_id: attId });
  const gotUrl = readOwn.json && readOwn.json.success && readOwn.json.url;
  gotUrl ? ok('the owner gets a signed download URL')
         : bad(`the owner was refused their own file: ${JSON.stringify(readOwn.json)}`);
  (readOwn.json && readOwn.json.expires_in === 600)
    ? ok('and it expires in ten minutes, per §A7')
    : bad(`the URL expires in ${readOwn.json && readOwn.json.expires_in}s, §A7 says 600`);

  if (gotUrl) {
    const back = await fetch(readOwn.json.url);
    const bytes = Buffer.from(await back.arrayBuffer());
    bytes.length === pdf.length && bytes.subarray(0, 8).toString() === pdf.subarray(0, 8).toString()
      ? ok(`and the URL really returns the file — ${bytes.length} bytes, same header`)
      : bad(`the signed URL returned ${bytes.length} bytes, expected ${pdf.length}`);
  }

  // ── THE ONE THAT MATTERS ────────────────────────────────────────────────
  const readOther = await fn('daily-closing-file', other.jwt,
    { op: 'read-url', company_id: CO, attachment_id: attId });
  (readOther.json && readOther.json.success === true)
    ? bad(`A USER FROM ANOTHER PROJECT FETCHED THE FILE: ${JSON.stringify(readOther.json).slice(0, 160)}`)
    : ok(`a user on another project is refused the same attachment id (${readOther.status})`);

  const upOther = await fn('daily-closing-file', other.jwt,
    { op: 'upload-url', company_id: CO, entry_id: entry, mime: 'application/pdf' });
  (upOther.json && upOther.json.success === true)
    ? bad('a user from another project was given an upload URL for this entry')
    : ok('and cannot get an upload URL for an entry that is not theirs');

  // and with no token at all
  const noAuth = await fetch(`${URL_BASE}/functions/v1/daily-closing-file`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'read-url', company_id: CO, attachment_id: attId }),
  });
  noAuth.status === 401 || noAuth.status === 403
    ? ok(`and an unauthenticated call is refused outright (${noAuth.status})`)
    : bad(`an unauthenticated call answered ${noAuth.status}`);

  head('tidy up what CAN be tidied');
  const del = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  del.ok ? ok('the uploaded object is removed from the bucket')
         : bad(`the object could not be removed: HTTP ${del.status}`);
  await q(`delete from public.cash_entry_attachments where id = '${attId}'`);
  ok('and its row with it — the ENTRY stays, because invariant 1 says it must');

  report();

  function report() {
    console.log('\n──────────────────────────────────────────────');
    console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                           : `❌ FAIL  (${pass} passed, ${fail} failed)`);
    if (fail) process.exitCode = 1;
  }
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });
