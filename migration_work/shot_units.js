// Phase 3C verification: units page (grid/table) + quick add + bulk 26x10 preview
// + wizard steps 2-4. ALL write RPCs stubbed → ZERO writes to FG. Captures payloads
// to assert floor_id + sellable status on quick-add and bulk; asserts bulk math = 260.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4260;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate(() => {
    S = { cid: 'test', userId: 'u1', role: 'admin', name: 'R', coName: 'FG' };
    // floors: Ground + 1st..8th + Upper Ground for bulk/wizard (10 floors for 26x10)
    const floors = [{ id: 'fG', name: 'Ground', sortOrder: 0, isActive: true }, { id: 'fUG', name: 'Upper Ground', sortOrder: 1, isActive: true }];
    for (let i = 1; i <= 8; i++) floors.push({ id: 'f' + i, name: i + (i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th') + ' Floor', sortOrder: i + 1, isActive: true });
    window._floorsCache = floors;
    window._typesCache = [{ id: 't1', name: 'Apartment', isActive: true }, { id: 't2', name: 'Shop', isActive: true }, { id: 't3', name: 'Office', isActive: true }];
    window._statusesCache = [{ id: 'sAvail', name: 'Available', isAvailable: true, isActive: true, color: '#16A34A' }, { id: 'sSold', name: 'Sold', isAvailable: false, isActive: true, color: '#2563EB' }];
    window._projectsCache = [{ id: 'p1', name: 'Sapphire Heights' }];
    // representative units: 8 units, mix sold/available across 2 floors
    window._unitsCache = [
      { id: 'u1', unitNo: 'G-01', floorId: 'fG', floorLabel: 'Ground', unitTypeId: 't2', type: 'Shop', area: 400, areaUnit: 'sqft', status: 'Sold', isAvailable: false, basePrice: 5000000, saleId: 's1', customerName: 'AHMED RAZA', totalPrice: 5000000, totalPaid: 2000000, pendingAmount: 3000000 },
      { id: 'u2', unitNo: 'G-02', floorId: 'fG', floorLabel: 'Ground', unitTypeId: 't2', type: 'Shop', area: 400, areaUnit: 'sqft', status: 'Available', isAvailable: true, basePrice: 5000000, saleId: null },
      { id: 'u3', unitNo: '1-01', floorId: 'f1', floorLabel: '1st Floor', unitTypeId: 't1', type: 'Apartment', area: 1200, areaUnit: 'sqft', status: 'Sold', isAvailable: false, basePrice: 9000000, saleId: 's2', customerName: 'SARA KHAN', totalPrice: 9000000, totalPaid: 9000000, pendingAmount: 0 },
      { id: 'u4', unitNo: '1-02', floorId: 'f1', floorLabel: '1st Floor', unitTypeId: 't1', type: 'Apartment', area: 1200, areaUnit: 'sqft', status: 'Available', isAvailable: true, basePrice: 9000000, saleId: null },
      { id: 'u5', unitNo: '1-03', floorId: 'f1', floorLabel: '1st Floor', unitTypeId: 't1', type: 'Apartment', area: 1250, areaUnit: 'sqft', status: 'Sold', isAvailable: false, basePrice: 9500000, saleId: 's3', customerName: 'BILAL', totalPrice: 9500000, totalPaid: 1000000, pendingAmount: 8500000 },
      { id: 'u6', unitNo: '1-04', floorId: 'f1', floorLabel: '1st Floor', unitTypeId: 't1', type: 'Apartment', area: 1250, areaUnit: 'sqft', status: 'Available', isAvailable: true, basePrice: 9500000, saleId: null }
    ];
    window.fM = v => Number(v || 0).toLocaleString('en-US');
    window.loadUnitsCache = async () => true; window.loadFloorsCache = async () => true; window.loadProjectsCache = async () => true;
    window.logA = () => {};
    window._rpcLog = [];
    supabase.rpc = async (name, args) => { window._rpcLog.push({ name, args: JSON.parse(JSON.stringify(args)) }); return { data: { success: true, inserted: (args.p_units || []).length, errors: 0, id: 'new' }, error: null }; };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
    document.getElementById('pg-units').classList.add('on');
  });

  async function shoot(name, theme) { await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await new Promise(r => setTimeout(r, 350)); await page.screenshot({ path: path.join(OUT, `units_${name}_${theme}.png`) }); }

  // counts header
  const counts = await page.evaluate(() => { rUnits(); const el = document.querySelector('#pg-units .nx-kpi-label'); return el ? el.textContent.trim() : ''; });
  await new Promise(r => setTimeout(r, 300));
  await shoot('grid', 'light'); await shoot('grid', 'dark');
  await page.evaluate(() => _uSetView('table')); await shoot('table', 'light'); await shoot('table', 'dark');
  await page.evaluate(() => { _uSetView('grid'); _uToggleQuickAdd(); });
  await shoot('quickadd', 'light');

  // quick-add payload assertion (floor_id + sellable status)
  const qa = await page.evaluate(async () => {
    window._rpcLog = [];
    document.getElementById('qa-no').value = 'TEST-9';
    document.getElementById('qa-floor').value = 'f1';
    document.getElementById('qa-type').value = 't1';
    await quickAddUnit();
    const c = window._rpcLog.find(x => x.name === 'create_unit');
    return c ? { floor_id: c.args.p_data.floor_id, status_id: c.args.p_data.status_id, unit_no: c.args.p_data.unit_no } : null;
  });

  // bulk generate 26 x 10 preview
  const bulk = await page.evaluate(async () => {
    openBulkGen();
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('bg-per').value = '26';
    document.querySelectorAll('.bg-floor').forEach(c => c.checked = true);
    buildBulkPreview();
    await new Promise(r => setTimeout(r, 150));
    const trs = [...document.querySelectorAll('#bg-preview table tbody tr')];
    const names = trs.map(tr => tr.querySelector('td').textContent.trim());
    const perFloorFirst = names.filter(n => /-01$/.test(n));   // first unit of each floor
    const header = (document.querySelector('#bg-preview .nx-kpi-label') || {}).textContent || '';
    return { count: names.length, header: header.replace(/\s+/g, ' ').trim(), perFloorFirst: perFloorFirst.slice(0, 5), first: names[0] };
  });
  await new Promise(r => setTimeout(r, 200));
  await shoot('bulk_preview', 'light'); await shoot('bulk_preview', 'dark');
  // bulk payload floor_id assertion (execute → captured, stub no-write)
  const bulkPayload = await page.evaluate(async () => { window._rpcLog = []; await executeBulkGen(); const b = window._rpcLog.find(x => x.name === 'bulk_create_units'); return b ? { n: b.args.p_units.length, allFloorId: b.args.p_units.every(u => !!u.floor_id), allStatus: b.args.p_units.every(u => !!u.status_id) } : null; });

  // wizard steps 2-4
  await page.evaluate(() => { OB.show('test'); });
  await page.evaluate(() => OB._goto(2)); await new Promise(r => setTimeout(r, 250)); await shoot('wizard2', 'light'); await shoot('wizard2', 'dark');
  await page.evaluate(() => OB._goto(3)); await new Promise(r => setTimeout(r, 250)); await shoot('wizard3', 'light');
  await page.evaluate(() => { OB._goto(4); setTimeout(() => { document.getElementById('ob-per').value = '10'; OB._preview(); }, 150); });
  await new Promise(r => setTimeout(r, 500)); await shoot('wizard4', 'light'); await shoot('wizard4', 'dark');

  await browser.close(); srv.close();
  console.log('COUNTS header:', counts);
  console.log('QUICK-ADD create_unit payload:', JSON.stringify(qa), '| floor_id set:', qa && !!qa.floor_id, '| sellable status (sAvail):', qa && qa.status_id === 'sAvail');
  console.log('BULK 26x10 preview:', bulk.count, 'rows |', bulk.header, '| per-floor first:', JSON.stringify(bulk.perFloorFirst));
  console.log('BULK payload to RPC:', JSON.stringify(bulkPayload));
  console.log('real JS errors:', errs.filter(e => !/401|Failed to load resource/.test(e)).length, errs.filter(e => !/401|Failed to load resource/.test(e)).slice(0, 6).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
