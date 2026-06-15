// RP regression after the reports.js splice: render Recovery Position, confirm
// the grand total reads the live RPC value (closing 211,414,190 as-of 2026-06-12),
// and exercise its existing print path → valid PDF. Stub = real totals + sample rows.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4222;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const TOTALS = { due: 9210458, closing: 211414190, opening: 206683388, net_price: 1180442089, advance_bf: 1015756, recovery_pct: 1.8, received_total: 3781500, received_applied: 3463900 };
const OFFICERS = [{ officer_name: 'All Officers', dead_recovery_total: 1230000, current_recovery_total: 2233900 }];
const SAMPLE = [['MUHAMMAD AMIR KHAN', 'KBH-C-0116', 'G-02', 'Ground', 7550000, 232], ['SHUKAR ULLAH', 'KBH-C-0037', '1-10', '1st Floor', 6109716, 955], ['SAJJAD ALI', 'KBH-C-0045', '4-09', '4th Floor', 5739286, 767], ['ABDUS SAMI', 'KBH-C-0026', 'UG-13', 'Upper Ground', 5330060, 572], ['SAYYED AHSAN ALI', 'KBH-C-0005', '6-14', '6th Floor', 4977818, 1066]]
  .map(r => ({ client_name: r[0], client_code: r[1], unit_no: r[2], floor_name: r[3], closing: r[4], overdue_days: r[5], net_price: r[4], opening: r[4], due_period: 0, received_total: 0, received_applied: 0, paid_pct: 0, advance_bf: 0, sale_id: 'x', last_payment_date: null, last_payment_amount: 0 }));

function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

  const result = await page.evaluate(async (TOTALS, OFFICERS, SAMPLE) => {
    S = { cid: 'test', userId: 'u', role: 'admin', name: 'Rashid', coName: 'Fourteen Group of Companies' };
    window._capturedPrintHTML = null;
    const realOpen = window.open;
    window.open = function () { // capture _rpEmitPrint's document.write payload
      const doc = { _html: '', open() {}, write(s) { this._html += s; }, close() {} };
      const w = { document: doc, focus() {}, print() { window._capturedPrintHTML = doc._html; }, onload: null };
      setTimeout(() => { if (w.onload) try { w.onload(); } catch (e) {} }, 0);
      return w;
    };
    supabase.rpc = async (name, args) => {
      if (name === 'get_recovery_position') return { data: { totals: TOTALS, rows: SAMPLE, officer_summary: OFFICERS, period: { from: args.p_from_date, to: args.p_to_date } }, error: null };
      return { data: null, error: null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof buildSB === 'function') buildSB();
    document.documentElement.setAttribute('data-theme', 'light');
    openRptViewer('recovery_position');
    await new Promise(r => setTimeout(r, 1200));
    const bodyText = (document.getElementById('r-ct') || {}).textContent || '';
    // print
    printRpt();
    await new Promise(r => setTimeout(r, 400));
    return { rendered: bodyText.length > 200, showsClosing: bodyText.includes('211,414,190') || bodyText.replace(/[, ]/g, '').includes('211414190'), printCaptured: !!window._capturedPrintHTML, printHasTitle: (window._capturedPrintHTML || '').includes('Recovery Position') };
  }, TOTALS, OFFICERS, SAMPLE);

  await page.screenshot({ path: path.join(OUT, 'rp_regression_light.png') });

  // render captured print HTML → PDF, assert valid
  let pdfOK = false;
  const cap = await page.evaluate(() => window._capturedPrintHTML || '');
  if (cap) {
    const p2 = await browser.newPage();
    await p2.setContent(cap, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(OUT, 'rp_regression_print.pdf');
    await p2.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true });
    const buf = fs.readFileSync(pdfPath);
    pdfOK = buf.slice(0, 5).toString('latin1') === '%PDF-' && buf.slice(-1024).toString('latin1').includes('%%EOF');
  }
  await browser.close(); srv.close();
  console.log('RP rendered:', result.rendered);
  console.log('RP shows closing 211,414,190:', result.showsClosing);
  console.log('RP print path captured HTML:', result.printCaptured, '| has title:', result.printHasTitle);
  console.log('RP print → valid PDF (%PDF + %%EOF):', pdfOK);
  console.log('real JS errors:', errs.filter(e => !/401|Failed to load resource/.test(e)).length, errs.filter(e => !/401|Failed to load resource/.test(e)).slice(0, 5).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
