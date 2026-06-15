// Phase 3E verification: Clients list + Client profile (ZAHID 10-unit + YOUSAF historical) on nx-kit.
// All RPCs stubbed → ZERO writes. ZAHID financials mirror the real RP ground truth
// (net 65,569,410 / paid 25,698,000 / balance 22,010,540) so the screenshot ties to the RP report.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4263;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1500,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

  const asserts = await page.evaluate(() => {
    S = { cid: 'co1', userId: 'u1', role: 'admin', name: 'R', coName: 'Fourteen Group' };
    window._projectsCache = [{ id: 'p1', name: 'Sapphire Heights', projectName: 'Sapphire Heights' }];

    // ── roster (camelCase cache) ──
    const clients = [
      { id: 'zahid', fullName: 'ZAHID KHAN', fatherName: 'GHULAM KHAN', cnic: '17301-1162060-5', phonePrimary: '0301-1162060', clientCode: 'KBH-C-0041', status: 'active', projectId: 'p1', clientCategory: 'Investor', address: 'University Road', city: 'Peshawar', createdAt: '2025-09-01' },
      { id: 'c2', fullName: 'IMRAN ALI', fatherName: 'SHER ALI', cnic: '17301-2222222-2', phonePrimary: '0301-2222222', clientCode: 'KBH-C-0042', status: 'active', projectId: 'p1' },
      { id: 'c3', fullName: 'BILAL AHMED', fatherName: 'NISAR', cnic: '17301-3333333-3', phonePrimary: '0301-3333333', clientCode: 'KBH-C-0043', status: 'active', projectId: 'p1' },
      { id: 'hassan', fullName: 'HASSAN KHAN', fatherName: 'GUL KHAN', cnic: '17301-4444444-4', phonePrimary: '0301-4444444', clientCode: 'KBH-C-0086', status: 'active', projectId: 'p1' },
      { id: 'yousaf', fullName: 'SYED YOUSAF SHAH', fatherName: 'SYED AKBAR', cnic: null, phonePrimary: '0301-9999999', clientCode: 'KBH-C-0143', status: 'inactive', projectId: 'p1', createdAt: '2025-03-01' },
      { id: 'c5', fullName: 'SAMI ULLAH', fatherName: 'HABIB', cnic: null, phonePrimary: '0301-5555555', clientCode: 'KBH-C-0144', status: 'inactive', projectId: 'p1' }
    ];
    window._clientsCache = clients;
    window.gclients = () => window._clientsCache;
    window.gclient = (id) => window._clientsCache.find(c => c.id === id);

    // ZAHID 10 units in cache (for cancelled lookup / log-followup)
    const units = [];
    for (let i = 1; i <= 10; i++) units.push({ id: 'uz' + i, unitNo: 'Z-' + String(i).padStart(2, '0'), clientId: 'zahid', customerName: 'ZAHID KHAN', projectId: 'p1', area: 1000, totalPrice: 6556941, totalPaid: 2569800 });
    units.push({ id: 'uy1', unitNo: 'Y-01', clientId: 'yousaf', customerName: 'SYED YOUSAF SHAH', projectId: 'p1' });
    window._unitsCache = units;
    window.gunits = () => window._unitsCache;
    window.gproject = (id) => window._projectsCache.find(p => p.id === id);
    window.gprojects = () => window._projectsCache;
    window.hasProjectAccess = () => true;
    window.mountFormNav = () => {};
    window.loadClientsCache = async () => true;
    window.logA = () => {};

    // ── RP rows: ZAHID 10 — REAL per-row ground truth (overdue_days>0 with non-zero closing) ──
    const zUnits = [
      ['1-04',8208270,3000000,3062481,294],['1-06',4373100,1400000,1311930,654],
      ['4-21',4923975,2000000,1917190,286],['UG-01',9107595,4000000,3332000,294],
      ['UG-02',4627530,2698000,1388259,1037],['UG-05',4087260,1400000,1226178,654],
      ['UG-06',4423950,1400000,1327185,654],['UG-07',7555950,2900000,2266785,654],
      ['UG-16',9446505,3900000,2833950,654],['UG-20',8815275,3000000,3344582,294]
    ];
    const rpRows = zUnits.map((u, i) => ({
      client_code: 'KBH-C-0041', client_name: 'ZAHID KHAN', sale_id: 'z' + (i + 1), unit_no: u[0],
      net_price: u[1], paid_to_date: u[2], closing: u[3], closing_old: 0, closing_current: 0, overdue_days: u[4]
    }));
    // Spot-check: HASSAN paid up to date (closing 0) but overdue_days stale (488) → Overdue MUST be 0
    rpRows.push({ client_code: 'KBH-C-0086', client_name: 'HASSAN KHAN', sale_id: 'h1', unit_no: 'A-12', net_price: 5000000, paid_to_date: 5000000, closing: 0, closing_old: 0, closing_current: 0, overdue_days: 488 });

    const zahidSales = zUnits.map((u, i) => ({ id: 'z' + (i + 1), sale_number: 'KBH-S-' + String(i + 1).padStart(3, '0'), status: 'active', unit_id: 'uz' + (i + 1), net_amount: u[1], down_payment: 0 }));
    const yousafSales = [];
    for (let i = 1; i <= 5; i++) yousafSales.push({ id: 'y' + i, sale_number: 'KBH-S-9' + String(i).padStart(2, '0'), status: 'cancelled', unit_id: 'uy1', net_amount: 4200000, down_payment: 0 });

    const ledgerRows = [
      { row_type: 'CR', entry_date: '2026-05-12', credit: 1500000, voucher_no: 'RCV-2026-0210', chq_no: null, description: 'Payment Received — Bank Transfer' },
      { row_type: 'CR', entry_date: '2026-04-08', credit: 1000000, voucher_no: 'RCV-2026-0188', chq_no: '0044219', description: 'Payment Received — Cheque' },
      { row_type: 'DR', entry_date: '2026-04-01', debit: 200000, description: 'Installment Due — 12th Installment' },
      { row_type: 'CR', entry_date: '2026-03-15', credit: 2000000, voucher_no: 'RCV-2026-0150', chq_no: null, description: 'Payment Received — Cash' }
    ];
    const contactLogs = [
      { client_id: 'zahid', contact_date: '2026-05-20', contact_type: 'Call', agent_name: 'Bilal', notes: 'Promised to clear 2 installments by month-end.', next_follow_up_date: '2026-06-30' },
      { client_id: 'zahid', contact_date: '2026-04-18', contact_type: 'Field Visit', agent_name: 'Asif', notes: 'Met at site; reviewing two more units.' }
    ];

    window._rpcLog = [];
    supabase.rpc = async (name, args) => {
      window._rpcLog.push({ name });
      if (name === 'get_recovery_position') return { data: { rows: rpRows, totals: {}, period: {} }, error: null };
      if (name === 'list_sales_by_client_all') return { data: (args.p_client_id === 'zahid' ? zahidSales : args.p_client_id === 'yousaf' ? yousafSales : []), error: null };
      if (name === 'get_client_ledger') return { data: { success: true, rows: ledgerRows, opening_balance: 0, closing_balance: 0, client_info: {} }, error: null };
      if (name === 'get_contact_logs_cache') return { data: contactLogs, error: null };
      if (name === 'get_clients_plan_status') return { data: { max_allowed: 10000, current_count: 5, can_add: true }, error: null };
      if (name === 'get_clients_by_health_category') return { data: [], error: null };
      if (name === 'list_agents') return { data: [], error: null };
      return { data: { success: true }, error: null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    return { ok: true };
  });

  const show = (id) => page.evaluate((i) => { document.querySelectorAll('.pg').forEach(p => p.classList.remove('on')); document.getElementById(i).classList.add('on'); }, id);
  async function shoot(name, theme) { await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await new Promise(r => setTimeout(r, 500)); await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await new Promise(r => setTimeout(r, 150)); await page.screenshot({ path: path.join(OUT, `clients_${name}_${theme}.png`) }); }

  // ── LIST ──
  await show('pg-clients');
  await page.evaluate(() => rClients());
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => _clSetStatus('')); // show All so HASSAN (active, paid-up) is visible alongside ZAHID
  await new Promise(r => setTimeout(r, 200));
  const listInfo = await page.evaluate(() => {
    const count = document.getElementById('cl-count')?.textContent || '';
    const rows = [...document.querySelectorAll('#cl-ct tbody tr')];
    const cell = (name) => {
      const tr = rows.find(r => r.textContent.includes(name));
      if (!tr) return null;
      const td = tr.querySelectorAll('td');
      return { units: td[4].textContent.trim(), balance: td[5].textContent.trim(), overdue: td[6].textContent.trim() };
    };
    return { count, rows: rows.length, zahid: cell('ZAHID KHAN'), hassan: cell('HASSAN KHAN') };
  });
  await shoot('list', 'light'); await shoot('list', 'dark');

  // ── ZAHID profile ──
  await show('pg-clientdetail');
  await page.evaluate(() => { _cid = 'zahid'; rClientDetail(); });
  await new Promise(r => setTimeout(r, 700));
  const zahid = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('#cd-fin .nx-kpi-label')].map(e => e.textContent.trim());
    const fin = [...document.querySelectorAll('#cd-fin .nx-kpi-value')].map(e => e.textContent.trim());
    const portRows = [...document.querySelectorAll('#cd-portfolio tbody tr')];
    const perRowOverdueDays = portRows.map(tr => tr.querySelectorAll('td')[5].textContent.trim());
    const pays = document.querySelectorAll('#cd-payments > div').length;
    return { kpis: labels.map((l, i) => l + '=' + fin[i]), portRows: portRows.length, perRowOverdueDays, pays };
  });
  await shoot('profile_zahid', 'light'); await shoot('profile_zahid', 'dark');

  // ── YOUSAF historical ──
  await page.evaluate(() => { _cid = 'yousaf'; rClientDetail(); });
  await new Promise(r => setTimeout(r, 600));
  const yousaf = await page.evaluate(() => {
    const banner = !!document.querySelector('#pg-clientdetail .nx-banner--warn');
    const portRows = document.querySelectorAll('#cd-portfolio tbody tr').length;
    const txt = document.querySelector('#pg-clientdetail').textContent;
    return { banner, portRows, hasCancelled: txt.includes('Cancelled') };
  });
  await shoot('profile_historical', 'light'); await shoot('profile_historical', 'dark');

  await browser.close(); srv.close();
  console.log('LIST count:', listInfo.count, '| rows:', listInfo.rows);
  console.log('  ZAHID row  →', JSON.stringify(listInfo.zahid), '(expect overdue 22,010,540)');
  console.log('  HASSAN row →', JSON.stringify(listInfo.hassan), '(paid-up, overdue_days 488 → expect overdue —/0)');
  console.log('ZAHID profile 5 KPIs:', JSON.stringify(zahid.kpis));
  console.log('  expected: Contracted 65,569,410 · Paid 25,698,000 · Remaining 39,871,410 · Due 22,010,540 · Overdue 22,010,540');
  console.log('  per-row overdue_days:', JSON.stringify(zahid.perRowOverdueDays), '| portfolio rows', zahid.portRows, '| payments', zahid.pays);
  console.log('YOUSAF historical: banner=' + yousaf.banner + ' cancelledRows=' + yousaf.portRows + ' hasCancelledChip=' + yousaf.hasCancelled);
  console.log('real JS errors:', errs.filter(e => !/401|Failed to load resource|404/.test(e)).length, errs.filter(e => !/401|Failed to load resource|404/.test(e)).slice(0, 6).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
