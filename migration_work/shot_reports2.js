// Phase 3B report screenshots: hub + Aging + Client Ledger + Collections (light+dark).
// Headless has no prod auth, so RPCs are stubbed with REAL/representative KBH data.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4240;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const RP_TOTALS = { due: 9210458, closing: 211414190, opening: 206683388, net_price: 1180442089, advance_bf: 1015756, recovery_pct: 1.8, received_total: 3781500 };
const RP_ROWS = [['MUHAMMAD AMIR KHAN', 'KBH-C-0116', 'G-02', 'Ground', 7550000, 232], ['SHUKAR ULLAH', 'KBH-C-0037', '1-10', '1st Floor', 6109716, 955], ['SAJJAD ALI', 'KBH-C-0045', '4-09', '4th Floor', 5739286, 767], ['ABDUS SAMI', 'KBH-C-0026', 'UG-13', 'Upper Ground', 5330060, 572], ['IJAZ NAZIR', 'KBH-C-0050', '8-04', '8th Floor', 1221500, 45]]
  .map(r => ({ client_name: r[0], client_code: r[1], unit_no: r[2], floor_name: r[3], closing: r[4], overdue_days: r[5], sale_id: 's-' + r[1] }));

function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate((RP_TOTALS, RP_ROWS) => {
    S = { cid: 'test', userId: 'u1', role: 'admin', name: 'Rashid', coName: 'Fourteen Group of Companies' };
    window._clientsCache = [{ id: 'ij', fullName: 'IJAZ NAZIR', client_name: 'IJAZ NAZIR', client_code: 'KBH-C-0050' }, { id: 'c2', fullName: 'SHUKAR ULLAH', client_code: 'KBH-C-0037' }];
    window._unitsCache = [{ id: 'u804', unitNo: '8-04', floorLabel: '8th Floor', type: 'Apartment', area: 1250, price: 13500000, isAvailable: false, status: 'Sold' }, { id: 'uG02', unitNo: 'G-02', floorLabel: 'Ground', isAvailable: true, status: 'Available', area: 900, price: 13500000 }];
    window.XLSX = window.XLSX || { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} };
    supabase.rpc = async (name, args) => {
      if (name === 'get_recovery_position') return { data: { totals: RP_TOTALS, rows: RP_ROWS, officer_summary: [{ officer_name: 'All Officers', current_recovery_total: 2233900, dead_recovery_total: 1230000 }] }, error: null };
      if (name === 'get_client_ledger') return { data: { opening_balance: 0, closing_balance: 1221500, client_info: { client_name: 'IJAZ NAZIR' }, rows: [
        { entry_date: '2024-03-01', row_order: 1, voucher_no: 'DP-0', description: 'Installment Due — Down Payment', debit: 1500000, credit: null },
        { entry_date: '2024-03-05', row_order: 2, voucher_no: 'RV-0012', description: 'Payment Received — Cash', debit: null, credit: 1500000 },
        { entry_date: '2024-06-01', row_order: 1, voucher_no: 'INS-01', description: 'Installment Due — 1st', debit: 2000000, credit: null },
        { entry_date: '2024-06-10', row_order: 2, voucher_no: 'RV-0048', description: 'Payment Received — Online', debit: null, credit: 1449923 },
        { entry_date: '2024-09-01', row_order: 1, voucher_no: 'INS-02', description: 'Installment Due — 2nd', debit: 1671423, credit: null },
        { entry_date: '2024-09-15', row_order: 2, voucher_no: 'RV-0061', description: 'Payment Received — Cheque', debit: null, credit: 1000000 }
      ] }, error: null };
      if (name === 'list_payments_filtered') return { data: [
        { id: 'p1', payment_date: '2026-06-03', voucher_code: 'RV-2201', client_id: 'ij', payment_method: 'Cash', amount: 1500000, created_by: 'u1', sale_id: 's-KBH-C-0050' },
        { id: 'p2', payment_date: '2026-06-03', voucher_code: 'RV-2202', client_id: 'c2', payment_method: 'Online Transfer', amount: 800000, created_by: 'u1', sale_id: 's-KBH-C-0037' },
        { id: 'p3', payment_date: '2026-06-08', voucher_code: 'RV-2203', client_id: 'ij', payment_method: 'Cheque', amount: 981500, created_by: null, sale_id: 's-KBH-C-0050' },
        { id: 'p4', payment_date: '2026-06-11', voucher_code: 'RV-2204', client_id: 'c2', payment_method: 'Cash', amount: 500000, created_by: 'u1', sale_id: 's-KBH-C-0037' }
      ], error: null };
      if (name === 'get_sales_unit_map') return { data: [{ id: 's-KBH-C-0050', unit_id: 'u804' }, { id: 's-KBH-C-0037', unit_id: 'uG02' }], error: null };
      if (name === 'get_unit_ledger') {
        const asof = args.p_to_date;                  // as-of call → recoverable closing
        if (asof) return { data: { opening_balance: 0, closing_balance: 1221500, rows: [] }, error: null };
        return { data: { opening_balance: 0, closing_balance: 3949923, unit_info: { unit_no: '8-04' }, rows: [
          { entry_date: '2024-03-01', voucher_no: 'DP-0', description: 'Down Payment / Booking', debit: 1500000, credit: null },
          { entry_date: '2024-03-05', voucher_no: 'RV-0012', description: 'Payment Received — Cash', debit: null, credit: 1500000 },
          { entry_date: '2024-06-01', voucher_no: 'INS-01', description: 'Installment 1', debit: 2000000, credit: null },
          { entry_date: '2024-06-10', voucher_no: 'RV-0048', description: 'Payment Received — Online', debit: null, credit: 1449923 },
          { entry_date: '2024-09-01', voucher_no: 'INS-02', description: 'Installment 2', debit: 1671423, credit: null },
          { entry_date: '2024-09-15', voucher_no: 'RV-0061', description: 'Payment Received — Cheque', debit: null, credit: 1000000 },
          { entry_date: '2027-03-01', voucher_no: 'INS-03', description: 'Installment 3 (future)', debit: 1364211, credit: null },
          { entry_date: '2027-06-01', voucher_no: 'INS-04', description: 'Installment 4 (future)', debit: 1364212, credit: null }
        ] }, error: null };
      }
      return { data: null, error: null };
    };
    window.gunm = function (id) { return id === 'u1' ? 'Aslam Khan' : id; };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof buildSB === 'function') buildSB();
  }, RP_TOTALS, RP_ROWS);

  async function shot(name, openFn) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.evaluate(() => {                       // make #pg-reports the active page
        document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
        const pr = document.getElementById('pg-reports'); if (pr) pr.classList.add('on');
      });
      await page.evaluate(openFn);
      await new Promise(r => setTimeout(r, 800));
      await page.screenshot({ path: path.join(OUT, `rpt_${name}_${theme}.png`) });
    }
  }
  await shot('hub', () => rReports());
  await shot('aging', () => openRptViewer('aging'));
  await shot('collections', () => openRptViewer('collections'));
  await shot('ledger', () => { openRptViewer('client_ledger'); setTimeout(() => NXReport._set('clientId', 'ij'), 200); });
  await shot('unitstmt', () => { openRptViewer('unit_statement'); setTimeout(() => NXReport._set('unitId', 'u804'), 200); });

  // Unit Statement closing-position readback (cross-tie)
  await page.evaluate(() => { document.querySelectorAll('.pg').forEach(p => p.classList.remove('on')); document.getElementById('pg-reports').classList.add('on'); openRptViewer('unit_statement'); setTimeout(() => NXReport._set('unitId', 'u804'), 150); });
  await new Promise(r => setTimeout(r, 900));
  const unitClosing = await page.evaluate(() => { const last = [...document.querySelectorAll('#nxr-body .nx-card')].pop(); return last ? last.textContent.replace(/\s+/g, ' ').trim() : ''; });
  console.log('Unit Statement closing position:', unitClosing);

  // read back rendered totals for the cross-tie proof (screen == data)
  await page.evaluate(() => openRptViewer('aging'));
  await new Promise(r => setTimeout(r, 700));
  const agingTotalText = await page.evaluate(() => { const t = document.querySelector('#nxr-body tfoot'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; });

  await browser.close(); srv.close();
  console.log('SHOTS: rpt_{hub,aging,collections,ledger}_{light,dark}');
  console.log('Aging rendered totals row:', agingTotalText);
  console.log('real JS errors:', errs.filter(e => !/401|Failed to load resource/.test(e)).length, errs.filter(e => !/401|Failed to load resource/.test(e)).slice(0, 6).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
