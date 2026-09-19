#!/usr/bin/env node
/**
 * One-time export of real report PDFs (General Journal, General Ledger,
 * Trial Balance, Profit & Loss, Balance Sheet) against Awami's REAL
 * imported history — for the owner's first look at his own numbers in
 * the system, not a fixture.
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
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
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
    // own Reports menu toggle renders unconditionally alongside it. Wait
    // for the actual button, not a generic gate/grid guess.
    await page.waitForSelector('#nf-rpm-toggle', { timeout: 15000 });

    // A real Chromium engine limitation, not a content bug (see
    // docs/PLAN.md §16, found and A/B-tested 2026-09-19): a <table> that
    // must span more than one printed page gets pushed ENTIRELY to page
    // 2 in headless PDF generation. On the Journal (nothing before the
    // table but the header) that leaves page 1 truly empty. On the
    // Ledger, page 1 still holds the real opening/closing balance tiles
    // — legitimate content, not waste — and only the table continues on
    // page 2, which is normal pagination, not this bug. So the test is
    // "does page 1 have ANY real figure on it at all" (any digit),
    // not specifically the table's own header word — checking for
    // "Debit" specifically first got this wrong for the Ledger, silently
    // dropping its real balance tiles along with the (non-existent, for
    // that page) blank space. Confirmed by bisection on the Journal — a
    // table short enough to fit one page prints fine; the moment it
    // needs a second, page 1 goes blank. The permanent fix (table → CSS
    // grid markup for reports that can span multiple pages) is tracked
    // separately, not done here.
    function pdfPageCount(pdfBuf) {
      // page.pdf() returns a plain Uint8Array in this Puppeteer version,
      // not a Buffer — Uint8Array's own .toString() ignores an encoding
      // argument and returns a decimal-byte-list instead, so this must
      // go through Buffer.from() first or the regex never matches.
      return (Buffer.from(pdfBuf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    }
    function page1HasRealContent(pdfBuf) {
      const tmp = path.join(os.tmpdir(), `nf-pdf-check-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
      fs.writeFileSync(tmp, Buffer.from(pdfBuf));
      try {
        const text = execFileSync('pdftotext', ['-f', '1', '-l', '1', tmp, '-'], { encoding: 'utf8' });
        return /\d/.test(text);
      } finally {
        fs.unlinkSync(tmp);
      }
    }

    async function savePdf(name) {
      await page.emulateMediaType('print');
      let pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      // Only ever drop page 1 when there's a page 2 to fall back to — a
      // genuinely empty single-page report (no rows at all) must never
      // be reduced to a zero-page file.
      if (pdfPageCount(pdf) > 1 && !page1HasRealContent(pdf)) {
        console.log('  page 1 is blank (Chromium table-pagination gap) — dropping it');
        pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, pageRanges: '2-' });
      }
      await page.emulateMediaType('screen');
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const out = path.join(OUT_DIR, name);
      fs.writeFileSync(out, pdf);
      console.log(`  wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
    }

    // Navigation now goes through the shared Reports dropdown
    // (js/nf/nf-reports-menu.js, docs/PLAN.md §23) instead of the old
    // one-button-per-report header — cross-navigates directly between
    // any two reports, no detour back through the closing sheet needed
    // between each export.
    async function gotoReport(key) {
      await page.click('#nf-rpm-toggle');
      await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
      await page.click(`[data-goto="${key}"]`);
    }

    // ── General Journal ──────────────────────────────────────────────────
    await gotoReport('journal');
    await page.waitForSelector('.jsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-jrn-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const jrnRows = await page.$$eval('#nf-jrn-body tr.jvfirst', els => els.length);
    console.log(`General Journal: ${jrnRows} vouchers`);
    await savePdf('Awami_General_Journal_2026-09-18.pdf');

    // ── General Ledger — 22100 FMH (46 real entries, the richer account) ──
    await gotoReport('ledger');
    await page.waitForSelector('.lsheet', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('#nf-lgr-acct option').length > 1, { timeout: 10000 });
    await page.select('#nf-lgr-acct', '22100');
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-lgr-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const lgrRows = await page.$$eval('.ltab tbody tr', els => els.length);
    console.log(`General Ledger (22100 FMH): ${lgrRows} entries`);
    await savePdf('Awami_General_Ledger_22100_FMH_2026-09-18.pdf');

    // ── Trial Balance ─────────────────────────────────────────────────────
    await gotoReport('tb');
    await page.waitForSelector('.tsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-tb-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const tbRows = await page.$$eval('.ttab tbody tr', els => els.length);
    const tbFoot = await page.$eval('.ttab tfoot', el => el.innerText.replace(/\s+/g, ' '));
    console.log(`Trial Balance: ${tbRows} accounts | ${tbFoot}`);
    await savePdf('Awami_Trial_Balance_2026-09-18.pdf');

    // ── Profit & Loss ────────────────────────────────────────────────────
    await gotoReport('pl');
    await page.waitForSelector('.plsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-pl-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const plNet = await page.$eval('.plnet .orow.net b', el => el.textContent.trim());
    console.log(`Profit & Loss: net income ${plNet}`);
    await savePdf('Awami_Profit_and_Loss_2026-09-19.pdf');

    // ── Balance Sheet ────────────────────────────────────────────────────
    await gotoReport('bs');
    await page.waitForSelector('.bssheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-bs-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const bsCheck = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.rtile b')).map(el => el.textContent.trim());
      const bannerBad = !!document.querySelector('.rbanner.bad');
      return { tiles, bannerBad };
    });
    console.log(`Balance Sheet: Assets ${bsCheck.tiles[0]} | Liabilities ${bsCheck.tiles[1]} | Equity ${bsCheck.tiles[2]} | balanced: ${!bsCheck.bannerBad}`);
    await savePdf('Awami_Balance_Sheet_2026-09-19.pdf');

    // ── Party Statement — FMH (richest party, matches 22100's own figures) ─
    await gotoReport('party');
    await page.waitForSelector('.pgsheet', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('#nf-pty-sel option').length > 1, { timeout: 10000 });
    await page.select('#nf-pty-sel', await page.$$eval('#nf-pty-sel option', (opts) => {
      const fmh = opts.find(o => /^FMH/.test(o.textContent.trim()));
      return fmh ? fmh.value : opts[1].value;
    }));
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-pty-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const ptyRows = await page.$$eval('.pgtab .pgrow:not(.pghead)', els => els.length);
    const ptyTiles = await page.$$eval('.rtile b', els => els.map(el => el.textContent.trim()));
    console.log(`Party Statement (FMH): ${ptyRows} entries | Opening ${ptyTiles[0]} | Closing ${ptyTiles[1]}`);
    await savePdf('Awami_Party_Statement_FMH_2026-09-19.pdf');

    // ── Token Money Register ────────────────────────────────────────────
    await gotoReport('token');
    await page.waitForSelector('.tkrsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-tkr-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const tkrTiles = await page.$$eval('.rtile b', els => els.map(el => el.textContent.trim()));
    console.log(`Token Register: ${tkrTiles[0]} units | Received ${tkrTiles[1]} | Returned ${tkrTiles[2]} | Net ${tkrTiles[3]}`);
    await savePdf('Awami_Token_Register_2026-09-19.pdf');

    // ── Cash & Bank Movement ────────────────────────────────────────────
    await gotoReport('cashbank');
    await page.waitForSelector('.cbsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-cb-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const cbTiles = await page.$$eval('.rtile b', els => els.map(el => el.textContent.trim()));
    console.log(`Cash & Bank Movement: Opening ${cbTiles[0]} | In ${cbTiles[1]} | Out ${cbTiles[2]} | Closing ${cbTiles[3]}`);
    await savePdf('Awami_Cash_and_Bank_Movement_2026-09-19.pdf');

    // ── Floor/Class Cost & Collection ───────────────────────────────────
    await gotoReport('floor');
    await page.waitForSelector('.flrsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-flr-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const flrTiles = await page.$$eval('.rtile b', els => els.map(el => el.textContent.trim()));
    console.log(`Floor Summary: Cost ${flrTiles[0]} | Income ${flrTiles[1]} | Token Collected ${flrTiles[2]}`);
    await savePdf('Awami_Floor_Summary_2026-09-19.pdf');

    // ── Project Cost Summary ────────────────────────────────────────────
    await gotoReport('projectcost');
    await page.waitForSelector('.pcsheet', { timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('#nf-pc-body'); return b && !/Loading…/.test(b.textContent);
    }, { timeout: 10000 });
    const pcTiles = await page.$$eval('.rtile b', els => els.map(el => el.textContent.trim()));
    console.log(`Project Cost Summary: Total ${pcTiles[0]}`);
    await savePdf('Awami_Project_Cost_Summary_2026-09-19.pdf');

    console.log('\nAll ten PDFs saved to', OUT_DIR);
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
