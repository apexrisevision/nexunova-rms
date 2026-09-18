#!/usr/bin/env node
/**
 * One-time export of real report PDFs (General Journal, General Ledger,
 * Trial Balance) against Awami's REAL imported history — for the owner's
 * first look at his own numbers in the system, not a fixture.
 *
 *   node scripts/nf/export-real-reports.js
 *
 * Uses a temporary viewer-role session (created separately, session in
 * scripts/nf/_pdf_review_session.json) — read-only, no writes possible
 * at viewer role. Cleans up that account at the end regardless of
 * outcome.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');
const { q, REF } = require('../_sbq');

const AWAMI = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 4498;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'D:\\Claude Cowork';
const session = JSON.parse(fs.readFileSync(__dirname + '/_pdf_review_session.json', 'utf8'));

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

(async () => {
  let srv, browser;
  try {
    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((ref, jwt, uid, email) => {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
      }));
      window.print = function () {};
    }, REF, session.jwt, session.id, session.email);
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${AWAMI}`, { waitUntil: 'networkidle2' });
    // Awami has zero nf_days (only imported vouchers) — the closing
    // sheet itself shows "No day has been opened yet", but the header's
    // own report nav buttons render unconditionally alongside it. Wait
    // for the actual button, not a generic gate/grid guess.
    await page.waitForSelector('#nf-toJrn', { timeout: 15000 });

    async function savePdf(name) {
      await page.emulateMediaType('print');
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.emulateMediaType('screen');
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const out = path.join(OUT_DIR, name);
      fs.writeFileSync(out, pdf);
      console.log(`  wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
    }

    // ── General Journal ──────────────────────────────────────────────────
    await page.click('#nf-toJrn');
    await page.waitForSelector('.jsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-jrn-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const jrnRows = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    console.log(`General Journal: ${jrnRows} vouchers`);
    await savePdf('Awami_General_Journal_2026-09-18.pdf');
    await page.click('#nf-jrn-back');
    await page.waitForSelector('#nf-toLgr', { timeout: 10000 });

    // ── General Ledger — 22100 FMH (46 real entries, the richer account) ──
    await page.click('#nf-toLgr');
    await page.waitForSelector('.lsheet', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('#nf-lgr-acct option').length > 1, { timeout: 10000 });
    await page.select('#nf-lgr-acct', '22100');
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-lgr-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const lgrRows = await page.$$eval('.ltab tbody tr', els => els.length);
    console.log(`General Ledger (22100 FMH): ${lgrRows} entries`);
    await savePdf('Awami_General_Ledger_22100_FMH_2026-09-18.pdf');
    await page.click('#nf-lgr-back');
    await page.waitForSelector('#nf-toTB', { timeout: 10000 });

    // ── Trial Balance ─────────────────────────────────────────────────────
    await page.click('#nf-toTB');
    await page.waitForSelector('.tsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-tb-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const tbRows = await page.$$eval('.ttab tbody tr', els => els.length);
    const tbFoot = await page.$eval('.ttab tfoot', el => el.innerText.replace(/\s+/g, ' '));
    console.log(`Trial Balance: ${tbRows} accounts | ${tbFoot}`);
    await savePdf('Awami_Trial_Balance_2026-09-18.pdf');

    console.log('\nAll three PDFs saved to', OUT_DIR);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    console.log('\n── cleanup (temporary viewer session) ──');
    try {
      await q(`delete from nf_members where company_id='${AWAMI}' and user_id='${session.id}'::uuid`);
      const { TOKEN } = require('../_sbq');
      const keysR = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
      const svc = keysR.find(k => k.name === 'service_role').api_key;
      const del = await fetch(`https://${REF}.supabase.co/auth/v1/admin/users/${session.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${svc}`, apikey: svc },
      });
      console.log('  deleted temporary auth user: HTTP', del.status);
      const [chk] = await q(`select count(*) n from nf_members where user_id='${session.id}'::uuid`);
      console.log('  verified by query: nf_members rows left =', chk.n);
    } catch (e) { console.log('  cleanup FAILED:', e.message); }
    fs.unlinkSync(__dirname + '/_pdf_review_session.json');
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
