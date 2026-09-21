#!/usr/bin/env node
/**
 * NexuFinance — exports a real PDF of the director daily closing report,
 * for owner review before any further report gets built on this design.
 * Same fixture as verify-nf-director-report.js (the golden day sample,
 * plus a real inter-company voucher with no via leg at all) — this
 * script's only job is to save the actual output somewhere the owner can
 * open it, not to assert pass/fail.
 *
 *   node scripts/nf/export-director-report-sample.js
 *
 * Writes to D:\Claude Cowork\Awami_Director_Daily_Closing_SAMPLE.pdf and
 * cleans up its own fixture company afterward, verified by query — Awami
 * itself is never touched.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require('./gen-seed');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 4493;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = `https://${REF}.supabase.co`;
const OUT_PATH = 'D:\\Claude Cowork\\Awami_Director_Daily_Closing_SAMPLE.pdf';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'nexufinance.html' : p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
function countPdfPages(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (m) return Number(m[1]);
  return (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[export-director-report-sample] project ${REF} · run ${run}`);

  const keysR = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  const K = { anon: keysR.find(k => k.name === 'anon').api_key, svc: keysR.find(k => k.name === 'service_role').api_key };

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const s = built.ref.sample;
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const companyName = `ZZTEST-NF-${run}`;
  const users = {};
  let srv, browser;

  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZNFEXP${run}', '${companyName}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-export-${run}@zztest-nf.invalid`;
    const password = crypto.randomBytes(18).toString('base64url');
    const u = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (u.status >= 300) throw new Error('create user: ' + JSON.stringify(u.json));
    users.D = { id: u.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}', '${users.D.id}', 'director', 'Syed Yousaf Shah', true)`);
    const login = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (login.status !== 200) throw new Error('sign-in: HTTP ' + login.status);
    users.D.jwt = login.json.access_token;

    const tokenLine = s.in.find(x => x.h === '21100');
    if (tokenLine) {
      await q(`insert into nf_parties (company_id, name, kind, created_by) values
        ('${C}', '${tokenLine.d.replace(/'/g, "''")}', 'customer', '${users.D.id}'::uuid)`);
    }

    const rpc = (name, args) => http_('POST', `/rest/v1/rpc/${name}`, { key: K.anon, jwt: users.D.jwt, body: args });
    let r = await rpc('nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno,
      p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
    if (r.status !== 200) throw new Error('nf_start_first_day: ' + JSON.stringify(r.json));
    const dayId = r.json.day.id;
    for (const [side, rows] of [['IN', s.in], ['OUT', s.out]]) {
      for (const x of rows.filter(x => Number(x.a))) {
        r = await rpc('nf_save_line', { p_day_id: dayId, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
          p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null });
        if (r.status !== 200) throw new Error(`nf_save_line ${x.v}: ` + JSON.stringify(r.json));
      }
    }
    r = await rpc('nf_set_transfers', { p_day_id: dayId, p_to_bank: Number(s.tBank), p_to_petty: null, p_version: r.json.day.version });
    if (r.status !== 200) throw new Error('nf_set_transfers: ' + JSON.stringify(r.json));
    // (the cash count was removed 2026-09-21, docs/PLAN.md §44 — nf_save_count now refuses)

    // the real inter-company voucher the owner asked to see reflected: no
    // via leg at all — FMH paying an Awami cost directly
    const floor = built.seed.floors[0].code;
    // Through nf_jv_save, which is the public path for a day-less voucher.
    // This used to call nf_post_voucher directly; 20260920c revoked EXECUTE on
    // that primitive from `authenticated` (AUDIT_REPORT.md R-2), so a direct
    // call from a signed-in session is refused now \u2014 as it should be. Same
    // voucher, same legs, same result; nf_jv_save posts with day_id NULL
    // always and derives source='JV' itself.
    r = await rpc('nf_jv_save', { p_company_id: C, p_voucher_no: 'JV-SAMPLE-1',
      p_voucher_date: s.date, p_narration: 'FMH paid a project cost directly, on Awami\u2019s behalf',
      p_legs: [
        { account_code: '53100', floor_code: floor, debit: 75000 },
        { account_code: '22100', floor_code: floor, credit: 75000 },
      ] });
    if (r.status !== 200) throw new Error('nf_jv_save (FMH): ' + JSON.stringify(r.json));
    console.log('  fixture ready: golden day entered, FMH inter-company voucher posted');

    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((ref, jwt, uid, email) => {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
      }));
      window.print = function () {};
    }, REF, users.D.jwt, users.D.id, users.D.email);
    await page.setViewport({ width: 1280, height: 1400, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.pos-grid', { timeout: 15000 });
    await page.click('#nf-toDir');
    await page.waitForSelector('.rsheet', { timeout: 10000 });
    await new Promise(res => setTimeout(res, 400));

    await page.emulateMediaType('print');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.emulateMediaType('screen');
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, pdf);
    const pages = countPdfPages(pdf);
    console.log(`  wrote ${OUT_PATH} — ${pages} page(s), ${(pdf.length / 1024).toFixed(0)} KB`);
  } finally {
    console.log('\n── cleanup');
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge FAILED:', e.message); }
    if (users.D) {
      try {
        const r = await http_('DELETE', `/auth/v1/admin/users/${users.D.id}`, { key: K.svc, jwt: K.svc });
        console.log('  delete user D: HTTP', r.status);
      } catch (e) { console.log('  delete user D FAILED:', e.message); }
    }
    const [chk] = await q(`select json_build_object('company', (select count(*) from companies where id='${C}'),
        'nf_rows', (select count(*) from nf_days where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(chk.j));
    if (browser) await browser.close();
    if (srv) srv.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
