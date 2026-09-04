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

  // ⚠️ TWO GUARDS, AND BOTH ARE LOAD-BEARING. Below this point sit assertions
  // of the form "X must not appear", which pass on an empty string and pass
  // just as happily on gibberish — an assertion that cannot fail is worse than
  // none, because it buys false confidence. Same family as the NULL trap in P4.
  //
  //   1 · QUANTITY. Nothing was extracted at all.
  //   2 · INTELLIGIBILITY. Something was extracted and it is not language.
  //
  // The second guard exists because the first was not enough. Switching the
  // renderer to embedded Inter made pdf-lib write glyph ids instead of WinAnsi
  // codes; the old extractor turned those into ~700 characters of confident
  // nonsense, which sailed through a length check while every §A10 check went
  // green on it. A positive control — text the document certainly contains —
  // is what tells the two apart.
  const dense = text.replace(/\s/g, '').length;
  if (dense < 200) {
    bad(`text extraction produced only ${dense} characters — every content ` +
        'assertion below would pass vacuously, so none of them is run');
    return report();
  }

  const CONTROL = ['Daily Closing', 'FOURTEEN GROUP', 'Closing (C/F)'];
  const missing = CONTROL.filter(c => !text.includes(c));
  if (missing.length) {
    bad(`the extractor produced ${dense} characters that are not the document: ` +
        `${missing.map(m => `“${m}”`).join(', ')} missing. Every "must not appear" ` +
        'assertion below would pass on this, so none of them is run.');
    console.log('     first 120 chars: ' + JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 120)));
    return report();
  }
  ok(`extracted ${dense} characters, and they are the document — ` +
     `${CONTROL.length} positive controls found`);

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
/* ══════════════════════════════════════════════════════════════════════════
   Reading the text back out of the PDF
   ──────────────────────────────────────────────────────────────────────────
   THE POINT OF THIS FILE IS THAT IT KEEPS WORKING WHEN THE TYPEFACE CHANGES.

   With one of the standard 14 fonts (Helvetica) pdf-lib writes WinAnsi codes:
   <44 61 69 6C 79> is literally "Daily". With an EMBEDDED SUBSET (Inter) it
   writes GLYPH IDS — <0001 0002 0003 0004 0005> — whose meaning lives only in
   that font's /ToUnicode CMap. Decoding those as WinAnsi produces several
   hundred characters of confident gibberish.

   That mattered more than it sounds. The first time Inter was switched on,
   eighteen content assertions failed — and the two §A10 checks, which look for
   something that must be ABSENT, went GREEN on the gibberish. Same disease as
   the NULL trap, third costume. So:

     · text is decoded per font, through that font's own CMap. The two subsets
       in one sheet share 33 codes and disagree about 29 of them, so a merged
       map is not an approximation, it is a lie;
     · and the caller must pass an INTELLIGIBILITY GATE before any "must not
       appear" assertion is allowed to run.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every object in the file, by object number.
 *
 * ⚠️ Most of them are NOT `N 0 obj … endobj` in the byte stream. pdf-lib packs
 * the small dictionaries — including every /Font and its /ToUnicode pointer —
 * into COMPRESSED OBJECT STREAMS (/Type /ObjStm), so a raw search for
 * "/ToUnicode" finds zero hits in a file that has two. An ObjStm inflates to a
 * header of `objnum offset` pairs followed by the object bodies at those
 * offsets from /First. They are expanded here, or none of the font plumbing
 * below can be resolved.
 */
function pdfObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  for (const m of s.matchAll(/(\d+)\s+\d+\s+obj\b/g)) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) continue;
    objs.set(Number(m[1]), { dict: s.slice(start, Math.min(end, start + 4000)), start, end });
  }

  for (const [, obj] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const bytes = streamOf(buf, s, obj);
    if (!bytes) continue;
    const body = bytes.toString('latin1');
    const first = Number((/\/First\s+(\d+)/.exec(obj.dict) || [])[1] || 0);
    const n = Number((/\/N\s+(\d+)/.exec(obj.dict) || [])[1] || 0);
    const nums = body.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = nums[i * 2], off = nums[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(off)) continue;
      const nextOff = i + 1 < n ? nums[(i + 1) * 2 + 1] : body.length - first;
      // Packed objects have no stream of their own, so start/end are absent —
      // only `dict` is ever read for them.
      objs.set(num, { dict: body.slice(first + off, first + nextOff), start: -1, end: -1 });
    }
  }
  return { s, objs };
}

/** The inflated bytes of object N's stream, or null if it has none. */
function streamOf(buf, s, obj) {
  if (obj.start < 0) return null;          // an object packed inside an ObjStm
  const p = s.indexOf('stream', obj.start);
  if (p < 0 || p > obj.end) return null;
  let a = p + 6;
  if (buf[a] === 0x0d) a++;
  if (buf[a] === 0x0a) a++;
  const e = s.indexOf('endstream', a);
  if (e < 0) return null;
  const raw = buf.subarray(a, e);
  try { return zlib.inflateSync(raw); } catch { return raw; }
}

/** /ToUnicode CMap → { '0001': 'D', … }. Handles bfchar and bfrange. */
function parseCMap(text) {
  const map = {};
  const uni = h => String.fromCodePoint(...(h.match(/.{4}/g) || []).map(x => parseInt(x, 16)));
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map[m[1].toUpperCase()] = uni(m[2]);
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 512; c++) {
        map[c.toString(16).toUpperCase().padStart(m[1].length, '0')] =
          String.fromCodePoint(dst + (c - lo));
      }
    }
  }
  return map;
}

/** WinAnsi, one byte per code — the standard-14 path. Kept, and still used. */
function winAnsi(hexDigits) {
  let out = '';
  for (let i = 0; i + 1 < hexDigits.length; i += 2) {
    const c = parseInt(hexDigits.substr(i, 2), 16);
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
    else if (c === 0xB7) out += '·';
    else if (c === 0x97 || c === 0x96) out += '—';
    else if (c === 0x93 || c === 0x94) out += '"';
    else out += ' ';
  }
  return out;
}

function unesc(s) {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t').replace(/\\([()\\])/g, '$1');
}

function extractText(buf) {
  const { s, objs } = pdfObjects(buf);

  // font object number → its CMap (absent for the standard 14)
  const cmapFor = new Map();
  for (const [num, obj] of objs) {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
    if (!tu) continue;
    const cm = objs.get(Number(tu[1]));
    if (!cm) continue;
    const bytes = streamOf(buf, s, cm);
    if (bytes) cmapFor.set(num, parseCMap(bytes.toString('latin1')));
  }

  // resource name → CMap, gathered from every /Font dictionary.
  //
  // ⚠️ The names are NOT /F1 /F2. pdf-lib mints one per drawText call, like
  // `/Inter-Regular-6837590713`, and a `\w+` name pattern matches "Inter" and
  // then fails on the hyphen — so every lookup missed, every string fell back
  // to WinAnsi, and the extractor produced fluent nonsense. A PDF name may hold
  // anything but whitespace and delimiters.
  const NAME = '[^\\s/<>\\[\\]()]+';
  const byName = new Map();
  for (const [, obj] of objs) {
    const fd = /\/Font\s*<<([^>]*)>>/.exec(obj.dict);
    if (!fd) continue;
    for (const m of fd[1].matchAll(new RegExp('/(' + NAME + ')\\s+(\\d+)\\s+\\d+\\s+R', 'g'))) {
      if (cmapFor.has(Number(m[2]))) byName.set(m[1], cmapFor.get(Number(m[2])));
    }
  }

  let out = '';
  for (const [, obj] of objs) {
    const bytes = streamOf(buf, s, obj);
    if (!bytes) continue;
    const t = bytes.toString('latin1');
    if (!/\bTf\b/.test(t) && !/\bTj\b/.test(t) && !/\bTJ\b/.test(t)) continue;

    // Walk the operators in order so the font in scope is the right one.
    let cmap = null;
    const ops = new RegExp(
      '/(' + NAME + ')\\s+[\\d.]+\\s+Tf' +
      '|<([0-9A-Fa-f\\s]+)>\\s*Tj' +
      '|\\[([^\\]]*)\\]\\s*TJ' +
      '|\\(((?:\\\\.|[^\\\\()])*)\\)\\s*Tj', 'g');
    for (const m of t.matchAll(ops)) {
      if (m[1] !== undefined) { cmap = byName.get(m[1]) || null; continue; }
      const decode = h => {
        const d = h.replace(/\s/g, '').toUpperCase();
        if (!cmap) return winAnsi(d);
        let r = '';
        for (let i = 0; i + 3 < d.length; i += 4) r += cmap[d.substr(i, 4)] ?? '';
        return r;
      };
      if (m[2] !== undefined) out += decode(m[2]);
      else if (m[3] !== undefined) {
        for (const p of m[3].matchAll(/<([0-9A-Fa-f\s]+)>/g)) out += decode(p[1]);
        for (const p of m[3].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) out += unesc(p[1]);
      } else if (m[4] !== undefined) out += unesc(m[4]);
    }
    out += '\n';
  }
  return out;
}

