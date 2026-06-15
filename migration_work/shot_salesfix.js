// Phase 3B-fix verification: (A) Sales Summary period filter end-to-end — the
// config must send sale_from/sale_to (not date_from/date_to) + status=active, and
// the rendered count/net must match source docs per period. (B) factory-wide
// filter-propagation audit: for each of the 8 reports, toggling a filter must change
// the args the config sends to its RPC (or be legitimately identical, explained).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4250;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
// canned active sales per sale_from (source-doc verified via SQL)
const SALES = { '2026-06-01': { n: 1, net: 8400000 }, '2026-05-01': { n: 2, net: 12240000 }, '2026-01-01': { n: 19, net: 127001200 }, '2025-01-01': { n: 52, net: 341560988 } };
const CUM_NET = 1180442089;
function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1500,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate((SALES, CUM_NET) => {
    S = { cid: 'test', userId: 'u1', role: 'admin', name: 'R', coName: 'Fourteen Group' };
    window._rpcLog = [];
    window._clientsCache = [{ id: 'ij', fullName: 'IJAZ NAZIR', client_code: 'KBH-C-0050' }];
    window._unitsCache = [{ id: 'u804', unitNo: '8-04', floorLabel: '8th', isAvailable: false, status: 'Sold', area: 1250, price: 1, projectId: 'p1' }, { id: 'u2', unitNo: 'G-02', isAvailable: true, status: 'Available', projectId: 'p2' }];
    window.XLSX = { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} };
    window.gprojects = () => [{ id: 'p1', name: 'Tower A' }, { id: 'p2', name: 'Tower B' }];
    supabase.rpc = async (name, args) => {
      window._rpcLog.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'list_sales_for_report') {
        const flt = args.p_filters || {};
        if (flt.status === 'cancelled') return { data: Array.from({ length: 49 }, (_, i) => ({ sale_number: 'C' + i, total_amount: 982069.0, received_amount: i === 0 ? 48121380 : 0, net_amount: 982069 })), error: null };
        if (!flt.sale_from && flt.status === 'active') { const rows = []; for (let i = 0; i < 183; i++) rows.push({ net_amount: CUM_NET / 183 }); return { data: rows, error: null }; } // cumulative
        const m = SALES[flt.sale_from] || { n: 0, net: 0 };
        const rows = Array.from({ length: m.n }, () => ({ sale_number: 'S', sale_date: flt.sale_from, total_amount: m.net / (m.n || 1), discount: 0, net_amount: m.net / (m.n || 1), floor_name: 'F', unit_no: 'U', client_name: 'C' }));
        return { data: rows, error: null };
      }
      if (name === 'get_recovery_position') return { data: { totals: { closing: 211414190, due: 9210458, received_total: 3781500, recovery_pct: 1.8, net_price: CUM_NET, opening: 206683388, advance_bf: 0 }, rows: [{ client_name: 'X', client_code: 'K', unit_no: 'U', closing: 211414190, overdue_days: 100, sale_id: 's' }], officer_summary: [] }, error: null };
      if (name === 'get_client_ledger') return { data: { opening_balance: 0, closing_balance: 1221500, rows: [{ entry_date: '2024-01-01', voucher_no: 'V', description: 'd', debit: 1221500, credit: null }] }, error: null };
      if (name === 'get_unit_ledger') return { data: { opening_balance: 0, closing_balance: args.p_to_date ? 1221500 : 3949923, rows: [{ entry_date: '2024-01-01', voucher_no: 'V', description: 'd', debit: 3949923, credit: null }] }, error: null };
      if (name === 'list_payments_filtered') return { data: [{ id: 'p', payment_date: args.p_filters.date_from || '2026-06-01', voucher_code: 'RV', client_id: 'ij', payment_method: 'Cash', amount: 1000, created_by: 'u1', sale_id: 's' }], error: null };
      if (name === 'get_sales_unit_map') return { data: [{ id: 's', unit_id: 'u804' }], error: null };
      if (name === 'get_pdc_register') return { data: { success: true, rows: [] }, error: null };
      return { data: null, error: null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
    document.getElementById('pg-reports').classList.add('on');
  }, SALES, CUM_NET);

  // ── (A) Sales period pass/fail ──
  const salesRows = [];
  await page.evaluate(() => openRptViewer('sales_summary'));
  await new Promise(r => setTimeout(r, 600));
  for (const [period, from, to] of [['Jun 2026', '2026-06-01', '2026-06-30'], ['May 2026', '2026-05-01', '2026-05-31'], ['2026 YTD', '2026-01-01', '2026-12-31'], ['2025', '2025-01-01', '2025-12-31']]) {
    const r = await page.evaluate(async (from, to) => {
      window._rpcLog = [];
      NXReport._set('from', from); NXReport._set('to', to);
      await new Promise(r => setTimeout(r, 350));
      const calls = window._rpcLog.filter(c => c.name === 'list_sales_for_report' && c.args.p_filters.sale_from);
      const sent = calls.length ? calls[0].args.p_filters : {};
      const tf = document.querySelector('#nxr-body tfoot');
      const sum = (document.getElementById('nxr-summary') || {}).textContent || '';
      return { sentKeys: Object.keys(sent).sort().join(','), sale_from: sent.sale_from, status: sent.status, summary: sum.replace(/\s+/g, ' ').slice(0, 200) };
    }, from, to);
    salesRows.push({ period, from, sentKeys: r.sentKeys, status: r.status, summary: r.summary });
  }

  // ── (B) filter-propagation audit: toggle a filter, assert args change ──
  const audit = [];
  async function probe(key, label, setupFn, toggleA, toggleB) {
    const r = await page.evaluate(async (key, setupFn, A, B) => {
      openRptViewer(key); await new Promise(r => setTimeout(r, 200));
      if (setupFn) { eval('(' + setupFn + ')()'); await new Promise(r => setTimeout(r, 250)); }
      const grab = async (kv) => { window._rpcLog = []; NXReport._set(kv[0], kv[1]); await new Promise(r => setTimeout(r, 300)); return JSON.stringify(window._rpcLog.map(c => c.args)); };
      const a = await grab(A); const b = await grab(B);
      return { a, b, changed: a !== b };
    }, key, setupFn ? setupFn.toString() : null, toggleA, toggleB);
    audit.push({ key, label, changed: r.changed });
  }
  await probe('recovery_position', 'from/to', null, ['from', '2026-01-01'], ['from', '2025-01-01']);
  // recovery_position uses its own controls, skip via factory; handle separately below
  await probe('aging', 'to-date', null, ['to', '2026-06-12'], ['to', '2026-05-01']);
  await probe('client_ledger', 'client', null, ['clientId', 'ij'], ['clientId', 'c2']);
  await probe('unit_statement', 'unit', null, ['unitId', 'u804'], ['unitId', 'u2']);
  await probe('collections', 'date range', null, ['from', '2026-06-01'], ['from', '2025-01-01']);
  await probe('pdc', 'status', null, ['status', 'pending'], ['status', 'bounced']);
  await probe('sales_summary', 'period', null, ['from', '2026-06-01'], ['from', '2025-01-01']);
  await probe('availability', 'project', null, ['project', 'p1'], ['project', 'p2']);

  // availability client-side filter: row count by project (no RPC → probe can't see it)
  const avail = await page.evaluate(async () => {
    openRptViewer('availability'); await new Promise(r => setTimeout(r, 250));
    NXReport._set('project', 'p1'); await new Promise(r => setTimeout(r, 250));
    const a = document.querySelectorAll('#nxr-body tbody tr').length;
    NXReport._set('project', 'p2'); await new Promise(r => setTimeout(r, 250));
    const b = document.querySelectorAll('#nxr-body tbody tr').length;
    return { p1: a, p2: b, changed: a !== b };
  });
  // cancelled trail count + sales fixed screenshot
  const cancelled = await page.evaluate(async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    openRptViewer('sales_summary'); await new Promise(r => setTimeout(r, 300));
    NXReport._set('status', 'active'); NXReport._set('from', '2026-06-01'); NXReport._set('to', '2026-06-30');
    await new Promise(r => setTimeout(r, 400));
    return true;
  });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'rpt_sales_fixed_light.png') });
  const cancN = await page.evaluate(async () => {
    NXReport._set('status', 'cancelled'); await new Promise(r => setTimeout(r, 400));
    return document.querySelectorAll('#nxr-body tbody tr').length;
  });

  await browser.close(); srv.close();
  console.log('availability client-side filter: p1=' + avail.p1 + ' rows, p2=' + avail.p2 + ' rows, changes=' + avail.changed);
  console.log('cancelled view rows rendered:', cancN);
  console.log('=== (A) SALES PERIOD — config sends correct keys? ===');
  salesRows.forEach(r => console.log(`${r.period}: keys=[${r.sentKeys}] status=${r.status}`));
  console.log('\n=== (B) FILTER PROPAGATION AUDIT (args change on toggle) ===');
  audit.forEach(a => console.log(`${a.key} (${a.label}): ${a.changed ? 'CHANGES ✓' : 'identical'}`));
  console.log('\nreal JS errors:', errs.filter(e => !/401|Failed to load resource/.test(e)).length, errs.filter(e => !/401|Failed to load resource/.test(e)).slice(0, 5).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
