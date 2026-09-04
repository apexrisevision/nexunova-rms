#!/usr/bin/env node
/**
 * Daily Closing — P7 verification: the Director PDF, rendered for real.
 *
 *   node scripts/verify-daily-closing-pdf.js
 *
 * This one cannot run inside BEGIN … ROLLBACK like the others: the renderer is
 * an edge function reached over HTTP, so it needs a fixture day that is really
 * committed and a real signed-in user to call it as.
 *
 * Both live on ZZTEST — the tenant whose name says it is safe to wipe. The
 * fixture is IDEMPOTENT: it reuses the same day and the same auth user every
 * run rather than piling up. That also makes it a proper golden fixture, since
 * the figures are fixed and the extracted text can be compared exactly.
 *
 * ⚠️ cash_entries can never be deleted (invariant 1), so this script's fixture
 * entries are permanent on ZZTEST by design. That is the correct trade: the
 * alternative is a golden test with nothing to render.
 *
 * It then downloads the PDF, INFLATES its content streams with zlib and reads
 * the text back out — a real extraction, not a check that some bytes exist.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { q, REF, TOKEN } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'daily-closing', 'design');
const URL_BASE = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';   // ZZTEST Tower
const FIXTURE_DATE = '2999-07-07';                   // far future: never a real business day
const EMAIL = 'dc-pdf-fixture@zztest.invalid';
const PASSWORD = 'dc-fixture-' + REF.slice(0, 8) + '-Aa1!';

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const head = t => console.log('\n── ' + t);

const one = r => (Array.isArray(r) ? r[0] : r) || {};

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  const keys = await r.json();
  const k = (keys || []).find(x => x.name === 'service_role' || x.type === 'secret');
  if (!k || !k.api_key) throw new Error('could not read the service key');
  return k.api_key;
}

(async () => {
  const SERVICE = await serviceKey();

  // ── 1 · an auth user to call as ─────────────────────────────────────────
  head('a signed-in caller on the ZZTEST tenant');
  let authId = one(await q(
    `select auth_user_id::text id from public.app_users
      where company_id='${CO}' and email='${EMAIL}' limit 1`)).id;

  if (!authId) {
    const mk = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    });
    const u = await mk.json();
    authId = u.id;
    if (!authId) throw new Error('could not create the fixture auth user: ' + JSON.stringify(u).slice(0, 200));
    await q(`insert into public.app_users
      (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
      values ('${CO}','DC PDF Fixture','dcpdffixture','${EMAIL}','cfo','password','active','${authId}')
      on conflict do nothing`);
    await q(`insert into public.user_project_assignments
      (company_id, user_id, project_id, access_level, is_active)
      select '${CO}', id, '${PJ}', 'edit', true from public.app_users
       where email='${EMAIL}' on conflict do nothing`);
  }
  ok(`fixture user ready (${EMAIL})`);

  const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!tok.access_token) { bad('could not sign in as the fixture user: ' + JSON.stringify(tok).slice(0, 200)); }
  else ok('signed in and holding a real JWT');
  const JWT = tok.access_token;

  // ── 2 · the fixture day ─────────────────────────────────────────────────
  head('a committed, closed fixture day');
  let dayId = one(await q(
    `select id::text id from public.cash_days
      where project_id='${PJ}' and business_date='${FIXTURE_DATE}'`)).id;

  if (!dayId) {
    // Built directly, not through the RPCs: setup_cash_opening is once-per-
    // project and this project may already have a real opening from another
    // suite. The figures are what matter to a golden render.
    await q(`select public.seed_daily_closing_chart('${CO}','${PJ}')`);
    const uid = one(await q(`select id::text id from public.app_users where email='${EMAIL}'`)).id;
    const unit = one(await q(`select id::text id from public.units where project_id='${PJ}' limit 1`)).id;
    const a2020 = one(await q(`select id::text id from public.qb_accounts where company_id='${CO}' and number='2020'`)).id;
    const a6050 = one(await q(`select id::text id from public.qb_accounts where company_id='${CO}' and number='6050'`)).id;
    const p1 = one(await q(`insert into public.payees (company_id,project_id,name,kind)
      values ('${CO}','${PJ}','Yousaf Khan','CUSTOMER')
      on conflict do nothing returning id::text id`)).id
      || one(await q(`select id::text id from public.payees where company_id='${CO}' and name='Yousaf Khan'`)).id;
    const p2 = one(await q(`insert into public.payees (company_id,project_id,name,kind)
      values ('${CO}','${PJ}','PESCO','VENDOR')
      on conflict do nothing returning id::text id`)).id
      || one(await q(`select id::text id from public.payees where company_id='${CO}' and name='PESCO'`)).id;

    dayId = one(await q(`insert into public.cash_days
      (company_id, project_id, business_date, status, opening_cash, opening_bank, created_by)
      values ('${CO}','${PJ}','${FIXTURE_DATE}','OPEN',17723.00,1000.00,'${uid}')
      returning id::text id`)).id;

    const ins = (seq, type, mode, dir, vt, no, amt, payee, extra) => q(
      `insert into public.cash_entries (company_id,project_id,cash_day_id,seq_no,idempotency_key,
        entry_type,mode,direction,voucher_type,voucher_no,amount,narration,payee_id,${extra ? 'unit_id,' : ''}
        rms_status,qb_account_id,created_by)
       values ('${CO}','${PJ}','${dayId}',${seq},gen_random_uuid(),'${type}','${mode}','${dir}','${vt}','${no}',
        ${amt},'${extra ? 'Installment #4' : 'Electricity bill'}','${payee}',${extra ? `'${extra}',` : ''}
        '${type === 'CLIENT_RECEIPT' ? 'PENDING' : 'NA'}','${type === 'CLIENT_RECEIPT' ? a2020 : a6050}','${uid}')`);
    await ins(1, 'CLIENT_RECEIPT', 'CASH', 'IN', 'CRV', '0041', 150000, p1, unit);
    await ins(2, 'EXPENSE', 'CASH', 'OUT', 'CPV', '0112', 77000, p2, null);
    await q(`insert into public.cash_entries (company_id,project_id,cash_day_id,seq_no,idempotency_key,
      entry_type,mode,direction,voucher_type,voucher_no,amount,narration,payee_id,rms_status,qb_account_id,created_by)
      values ('${CO}','${PJ}','${dayId}',3,gen_random_uuid(),'OTHER','BANK','IN','BRV','0007',50000,
      'Cheque deposited','${p2}','NA','${a2020}','${uid}')`);

    await q(`update public.cash_days set status='CLOSED',
      closing_cash=90723.00, closing_bank=51000.00, counted_cash=90720.00,
      variance=-3.00, variance_note='short 3, cashier',
      closed_by='${uid}', closed_at=now(), version=1
      where id='${dayId}'`);
  }
  ok(`fixture day ${FIXTURE_DATE} is CLOSED (${dayId})`);

  // ── 3 · render ──────────────────────────────────────────────────────────
  head('the renderer');
  const res = await fetch(`${URL_BASE}/functions/v1/daily-closing-pdf`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: CO, cash_day_id: dayId }),
  });
  const out = await res.json();
  if (!out.success) { bad('render failed: ' + JSON.stringify(out).slice(0, 400)); return report(); }
  ok(`rendered v${out.version}, ${out.bytes} bytes, typeface ${out.typeface}`);

  const expectedName = `ZZTESTTower_Daily_Closing_${FIXTURE_DATE}.pdf`;
  out.filename === expectedName
    ? ok(`filename is {ProjectSlug}_Daily_Closing_{YYYY-MM-DD}.pdf — ${out.filename}`)
    : bad(`filename is ${out.filename}, want ${expectedName}`);
  /^.+\/documents\/.+\/v\d+_/.test(out.storage_key)
    ? ok('stored under the project, by date, with the version in the name')
    : bad('storage key looks wrong: ' + out.storage_key);

  // ── 4 · versions accumulate, prior files kept ───────────────────────────
  const again = await fetch(`${URL_BASE}/functions/v1/daily-closing-pdf`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: CO, cash_day_id: dayId }),
  }).then(r => r.json());
  again.success && again.version === out.version + 1
    ? ok(`a second render takes v${again.version}, it does not overwrite v${out.version}`)
    : bad('re-render did not increment the version: ' + JSON.stringify(again).slice(0, 200));
  const kept = one(await q(`select count(*)::int n from public.day_documents where cash_day_id='${dayId}'`)).n;
  kept >= 2 ? ok(`${kept} versions on record — prior files are kept`) : bad(`only ${kept} version rows`);

  // ── 5 · the golden render ───────────────────────────────────────────────
  head('what the PDF actually says');
  const pdfRes = await fetch(out.url);
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'director_pdf_sample.pdf'), buf);
  ok(`sample saved to docs/daily-closing/design/director_pdf_sample.pdf (${Math.round(buf.length / 1024)} KB)`);

  const text = extractText(buf);

  // ⚠️ Guard first. Without it, "no phone number appears" and "no lakh/crore
  // grouping" both PASS on an empty string — an assertion that cannot fail is
  // worse than none, because it buys false confidence. Same family of bug as
  // the NULL-comparison trap in P4.
  if (text.replace(/\s/g, '').length < 200) {
    bad(`text extraction produced only ${text.replace(/\s/g, '').length} characters — ` +
        'every content assertion below would pass vacuously, so they are not run');
    return report();
  }
  ok(`extracted ${text.replace(/\s/g, '').length} characters of real text from the PDF`);

  const want = [
    ['FOURTEEN GROUP', 'the brand constant, not companies.display_name'],
    ['ZZTEST TOWER', 'the project name from projects, uppercased'],
    ['Daily Closing', 'the document title'],
    // §A13 sets labels in uppercase with tracking; the renderer draws them
    // character by character to get the tracking, so the extracted text is the
    // uppercase form. The first version of this test looked for title case and
    // was wrong about the document, not the other way round.
    ['CLOSING CASH', 'the hero label, uppercase per §A13'],
    ['90,723', 'closing cash'],
    ['51,000', 'closing bank'],
    ['17,723', 'opening cash'],
    ['150,000', 'received'],
    ['77,000', 'paid'],
    ['Opening (B/F)', 'summary row'],
    ['Closing (C/F)', 'summary row'],
    ['RECEIPTS', 'ledger block label'],
    ['PAYMENTS', 'ledger block label'],
    ['Yousaf Khan', 'a payee'],
    ['CRV-0041', 'a voucher'],
    ['(3)', 'the variance, in parentheses'],
    ['short 3, cashier', 'the variance note'],
    ['Confidential', 'the footer'],
  ];
  for (const [needle, what] of want) {
    text.includes(needle) ? ok(`${what.padEnd(46)} “${needle}”`)
                          : bad(`${what} — “${needle}” is NOT in the rendered text`);
  }

  // ── the two §A10 detectors, and proof that they work ────────────────────
  //
  // A detector that has never fired is not a detector. Both of these look for
  // something that SHOULD be absent, so on a clean PDF they are green whether
  // they work or not — the same false-confidence shape as the NULL trap. The
  // first version of the lakh check only matched CRORE grouping, so a document
  // reading "1,50,000" passed it; that was found by deliberately breaking the
  // renderer, and this self-test is what stops it recurring silently.
  const PHONE = /(?:\+92|0)3\d{2}[\s-]?\d{7}|\b\d{11}\b/;
  const LAKH  = /\d,\d\d,\d\d\d/;

  const probes = [
    [PHONE, '03001234567',  true,  'phone detector fires on a bare 11-digit mobile'],
    [PHONE, '0300 1234567', true,  'phone detector fires on a spaced mobile'],
    [PHONE, '+923001234567', true, 'phone detector fires on +92 form'],
    [PHONE, 'CRV-0041 90,723', false, 'phone detector ignores vouchers and money'],
    [LAKH,  '1,50,000',     true,  'lakh detector fires on lakh grouping'],
    [LAKH,  '1,23,45,678',  true,  'lakh detector fires on crore grouping'],
    [LAKH,  '1,234,567',    false, 'lakh detector ignores Western grouping'],
    [LAKH,  '90,723',       false, 'lakh detector ignores a five-figure amount'],
  ];
  for (const [re, sample, should, what] of probes) {
    re.test(sample) === should ? ok(what)
      : bad(`${what} — it did not, so the check below proves nothing`);
  }

  // §A10 — no client phone numbers, ever.
  const phones = text.match(new RegExp(PHONE.source, 'g'));
  phones ? bad(`§A10 VIOLATED — a phone-shaped string is in the PDF: ${phones[0]}`)
         : ok('§A10 — no phone-shaped string anywhere in the rendered text');

  // and no lakh/crore grouping
  LAKH.test(text)
    ? bad('lakh/crore grouping leaked into the PDF')
    : ok('Western grouping throughout — no lakh/crore')

  report();

  function report() {
    console.log('\n──────────────────────────────────────────────');
    console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                           : `❌ FAIL  (${pass} passed, ${fail} failed)`);
    if (fail) process.exitCode = 1;
  }
})().catch(e => { console.error('❌ ' + e.message); process.exitCode = 1; });

/**
 * Pull the visible text out of a PDF: find every stream, inflate the Flate ones,
 * and collect the string operands of Tj / TJ. pdf-lib writes ASCII/WinAnsi
 * literals, so unescaping the four sequences that matter is enough.
 */
function extractText(buf) {
  let out = '';
  let i = 0;
  while (true) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    let a = s + 6;
    if (buf[a] === 0x0d) a++;
    if (buf[a] === 0x0a) a++;
    const e = buf.indexOf('endstream', a);
    if (e < 0) break;
    const chunk = buf.subarray(a, e);
    let body;
    try { body = zlib.inflateSync(chunk); } catch { body = chunk; }
    const t = body.toString('latin1');
    // pdf-lib emits HEX strings (<...>) rather than literals, for standard and
    // embedded fonts alike — the first version of this extractor only looked
    // for (...) and silently found nothing.
    for (const m of t.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) out += hex(m[1]);
    for (const m of t.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const p of m[1].matchAll(/<([0-9A-Fa-f\s]+)>/g)) out += hex(p[1]);
    }
    for (const m of t.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) out += unesc(m[1]);
    for (const m of t.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ/g)) {
      for (const p of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) out += unesc(p[1]);
    }
    out += '\n';
    i = e + 9;
  }
  return out;
}
function unesc(s) {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t').replace(/\\([()\\])/g, '$1');
}
/** WinAnsi hex string → text. One byte per character code for the standard 14. */
function hex(h) {
  const s = h.replace(/\s/g, '');
  let out = '';
  for (let i = 0; i + 1 < s.length; i += 2) {
    const c = parseInt(s.substr(i, 2), 16);
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
    else if (c === 0xB7) out += '·';
    else if (c === 0x97 || c === 0x96) out += '—';
    else if (c === 0x93 || c === 0x94) out += '"';
    else out += ' ';
  }
  return out;
}
