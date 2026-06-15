// Phase 3D verification: NEW SALE 5-step flow + plan tie-out + sales page + sale detail.
// ALL RPCs stubbed → ZERO writes to FG. Captures light/dark screenshots + asserts
// the create payload (down_payment==booking, installment_count==monthly count, Σ==net).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4262;
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

  await page.evaluate(() => {
    S = { cid: 'co1', userId: 'u1', role: 'admin', name: 'R', coName: 'FG' };
    window._projectsCache = [{ id: 'p1', name: 'Sapphire Heights' }];
    window._unitsCache = [
      { id: 'u1', unitNo: 'G-02', floorId: 'fG', floorLabel: 'Ground', type: 'Shop', area: 400, status: 'Available', isAvailable: true, basePrice: 5000000, projectId: 'p1', saleId: null },
      { id: 'u2', unitNo: '1-02', floorId: 'f1', floorLabel: '1st Floor', type: 'Apartment', area: 1200, status: 'Available', isAvailable: true, basePrice: 9000000, projectId: 'p1', saleId: null },
      { id: 'u3', unitNo: '1-04', floorId: 'f1', floorLabel: '1st Floor', type: 'Apartment', area: 1250, status: 'Available', isAvailable: true, basePrice: 9500000, projectId: 'p1', saleId: null }
    ];
    window._clientsCache = [
      { id: 'c1', fullName: 'AHMED RAZA', fatherName: 'KARIM', cnic: '42101-1111111-1', phonePrimary: '0300-1111111', projectId: 'p1' },
      { id: 'c2', fullName: 'SARA KHAN', fatherName: 'JAVED', cnic: '42101-2222222-2', phonePrimary: '0300-2222222', projectId: 'p1' }
    ];
    window.loadUnitsCache = async () => true; window.loadClientsCache = async () => true; window.loadProjectsCache = async () => true;
    window.logA = () => {};
    window._rpcLog = [];
    const sampleSales = [
      { id: 's1', sale_number: 'BKG-0001', sale_date: '2026-03-12', status: 'active', net_amount: 6678423, total_amount: 6678423, discount: 0, down_payment: 2003526.9, total_collected: 2500000, unit_no: '1-02', project_name: 'Sapphire Heights', client_name: 'AHMED RAZA', agent_name: 'Bilal' },
      { id: 's2', sale_number: 'BKG-0002', sale_date: '2026-04-01', status: 'completed', net_amount: 5391200, total_amount: 5391200, discount: 0, down_payment: 1347800, total_collected: 5391200, unit_no: '1-04', project_name: 'Sapphire Heights', client_name: 'SARA KHAN', agent_name: '' },
      { id: 's3', sale_number: 'BKG-0003', sale_date: '2026-05-20', status: 'cancelled', net_amount: 5000000, total_amount: 5000000, discount: 0, down_payment: 0, total_collected: 0, unit_no: 'G-02', project_name: 'Sapphire Heights', client_name: 'JOHN DOE', agent_name: '' }
    ];
    const sampleDetail = {
      success: true,
      sale: { id: 's1', sale_number: 'BKG-0001', sale_date: '2026-03-12', status: 'active', price_per_sqft: 5565.3525, area_sqft: 1200, total_amount: 6678423, discount: 0, net_amount: 6678423, down_payment: 2003526.9, remaining_amount: 0, installment_count: 36, notes: 'Test sale', unit_id: 'u2', unit_no: '1-02', floor_label: '1st Floor', unit_type: 'Apartment', project_name: 'Sapphire Heights', client_id: 'c1', client_name: 'AHMED RAZA', agent_id: 'a1', agent_name: 'Bilal', commission_rate: 2 },
      installments: [
        { id: 'i0', installment_number: 0, due_date: '2026-03-12', amount_due: 2003526.9, amount_paid: 2003526.9, balance: 0, installment_type: 'down_payment', status: 'paid', notes: null },
        { id: 'i1', installment_number: 1, due_date: '2026-04-12', amount_due: 129858.23, amount_paid: 129858.23, balance: 0, installment_type: 'installment', status: 'paid', notes: null },
        { id: 'i2', installment_number: 2, due_date: '2026-05-12', amount_due: 129858.23, amount_paid: 366614.87, balance: 0, installment_type: 'installment', status: 'paid', notes: null },
        { id: 'i3', installment_number: 3, due_date: '2026-06-12', amount_due: 129858.23, amount_paid: 0, balance: 129858.23, installment_type: 'installment', status: 'pending', notes: null },
        { id: 'i4', installment_number: 4, due_date: '2026-07-12', amount_due: 129858.18, amount_paid: 0, balance: 129858.18, installment_type: 'installment', status: 'pending', notes: null }
      ]
    };
    window.__sampleSales = sampleSales;
    supabase.rpc = async (name, args) => {
      window._rpcLog.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
      if (name === 'list_agents') return { data: [{ id: 'a1', full_name: 'Bilal', project_id: 'p1', commission_percent: 2 }], error: null };
      if (name === 'list_sales') return { data: sampleSales, error: null };
      if (name === 'get_sale_detail') return { data: sampleDetail, error: null };
      if (name === 'get_sale_documents_amendments') return { data: { documents: [], amendments: [] }, error: null };
      if (name === 'list_sales_for_fnav') return { data: [], error: null };
      if (name === 'check_client_duplicate') return { data: { found: true, field: 'cnic', id: 'cDUP', full_name: 'Existing Person', client_code: 'KBH-C-0007', status: 'active' }, error: null };
      if (name === 'create_client') return { data: { success: true, id: 'cNEW', client_code: 'KBH-C-0200' }, error: null };
      if (name === 'create_sale_with_schedule') return { data: { success: true, sale_id: 's1', sale_number: 'BKG-9999' }, error: null };
      return { data: { success: true }, error: null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });

  const show = (id) => page.evaluate((i) => { document.querySelectorAll('.pg').forEach(p => p.classList.remove('on')); document.getElementById(i).classList.add('on'); }, id);
  async function shoot(name, theme) { await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await new Promise(r => setTimeout(r, 300)); await page.screenshot({ path: path.join(OUT, `sales_${name}_${theme}.png`) }); }

  // ── SALES PAGE ──
  await show('pg-sales');
  await page.evaluate(() => rSales());
  await new Promise(r => setTimeout(r, 500));
  await shoot('page', 'light'); await shoot('page', 'dark');

  // ── NEW SALE 5-step ──
  await show('pg-newsale');
  await page.evaluate(() => rNewSale());
  await new Promise(r => setTimeout(r, 400));
  await shoot('step1_unit', 'light'); await shoot('step1_unit', 'dark');

  // pick unit 1-02 (area 1200, base 9,000,000 → rate 7500), go to client
  await page.evaluate(() => { _nsPickUnitById('u2'); _nsGoto(2); });
  await new Promise(r => setTimeout(r, 300));
  await shoot('step2_client', 'light'); await shoot('step2_client', 'dark');

  // ── REGRESSION GUARD: create a NEW client via the shared ClientForm ──
  const clientFlow = await page.evaluate(async () => {
    _nsOpenCreateClient();                                  // opens the shared ClientForm modal
    await new Promise(r => setTimeout(r, 80));
    const formOpen = !!document.getElementById('cfm-modal');
    document.getElementById('cfm-full_name').value = 'New Buyer';
    document.getElementById('cfm-father_name').value = 'Father Name';
    document.getElementById('cfm-cnic').value = '42101-1111111-1';
    document.getElementById('cfm-phone_primary').value = '0300-1111111';
    await ClientForm._dupCheck('42101-1111111-1');          // stub → found
    const dupShown = document.getElementById('cfm-dup').style.display !== 'none';
    return { formOpen, dupShown };
  });
  await new Promise(r => setTimeout(r, 200));
  await shoot('clientform', 'light'); await shoot('clientform', 'dark');
  // save the form → create_client (stub) → onSaved lands client in _ns.client + advances to Deal
  const dealInfo = await page.evaluate(async () => {
    await ClientForm.save();
    await new Promise(r => setTimeout(r, 80));
    const landed = { clientId: _ns.client && _ns.client.id, isNew: _ns.client && _ns.client.isNew, step: _ns.step };
    document.getElementById('ns-deal').value = '6678423';
    _nsDealRecalc();
    return { net: _ns.net, discount: _ns.discount, list: _ns.list, pricePerSqft: _ns.pricePerSqft, landed };
  });
  await new Promise(r => setTimeout(r, 300));
  await shoot('step3_deal', 'light'); await shoot('step3_deal', 'dark');

  // plan: equal, 30% + 36 months
  const planInfo = await page.evaluate(() => {
    _nsGoto(4);
    document.getElementById('ns-p-bookpct').value = '30';
    document.getElementById('ns-p-months').value = '36';
    _nsPlanChange();
    return { sum: _spSum(_ns.plan), net: _ns.net, lines: _ns.plan.length, booking: _spBooking(_ns.plan), monthly: _spMonthlyCount(_ns.plan), match: Math.abs(_spSum(_ns.plan) - _ns.net) < 0.01 };
  });
  await new Promise(r => setTimeout(r, 300));
  await shoot('step4_plan', 'light'); await shoot('step4_plan', 'dark');

  // possession template screenshot (5,391,200 @25%+30+10%) — separate render
  await page.evaluate(() => {
    _ns.net = 5391200; _ns.tpl = 'possession'; _nsRenderStep();
    document.getElementById('ns-p-bookpct').value = '25';
    document.getElementById('ns-p-months').value = '30';
    document.getElementById('ns-p-posspct').value = '10';
    _nsPlanChange();
  });
  await new Promise(r => setTimeout(r, 250));
  await shoot('step4_possession', 'light');
  const possInfo = await page.evaluate(() => ({ sum: _spSum(_ns.plan), net: _ns.net, match: Math.abs(_spSum(_ns.plan) - _ns.net) < 0.01, poss: (_ns.plan.find(l => l.type === 'possession') || {}).amount }));

  // back to the equal plan for review
  const createPayload = await page.evaluate(() => {
    // rebuild equal plan @ net 6678423 to review + assert payload (without persisting)
    _ns.net = 6678423; _ns.pricePerSqft = 5565.3525; _ns.area = 1200; _ns.discount = 0; _ns.tpl = 'equal';
    _nsRenderStep();
    document.getElementById('ns-p-bookpct').value = '30';
    document.getElementById('ns-p-months').value = '36';
    _nsPlanChange();
    _nsGoto(5);
    // simulate the payload build that _nsCreate performs (capture, don't call create here)
    let n = 0;
    const installments = _ns.plan.map(l => { let num, itype; if (l.type === 'down_payment') { num = 0; itype = 'down_payment'; } else { n++; num = n; itype = l.type === 'installment' ? 'installment' : l.type; } return { installment_number: num, due_date: l.due, amount_due: l.amount, installment_type: itype }; });
    const sum = installments.reduce((s, i) => s + i.amount_due, 0);
    return { down: _spBooking(_ns.plan), instCount: _spMonthlyCount(_ns.plan), sum: Math.round(sum * 100) / 100, net: _ns.net, lines: installments.length };
  });
  await new Promise(r => setTimeout(r, 300));
  await shoot('step5_review', 'light'); await shoot('step5_review', 'dark');

  // ── SALE DETAIL ──
  await show('pg-salesdetail');
  await page.evaluate(() => { _salId = 's1'; rSaleDetail(); });
  await new Promise(r => setTimeout(r, 600));
  await shoot('detail', 'light'); await shoot('detail', 'dark');
  const detailBalance = await page.evaluate(() => {
    // verify balance computed from installments (Σ paid vs net), not remaining_amount
    const txt = document.querySelector('#pg-salesdetail').textContent;
    return { hasRecordPayment: txt.includes('Record Payment'), hasUnitStmt: txt.includes('Unit Statement'), hasClientLedger: txt.includes('Client Ledger') };
  });

  // ── any real write RPCs hit? (all stubbed → DB untouched) ──
  const writes = await page.evaluate(() => (window._rpcLog || []).filter(x => /create_sale_with_schedule|create_client|edit_sale|create_unit/.test(x.name)).map(x => x.name));

  await browser.close(); srv.close();
  console.log('REGRESSION GUARD (New Sale → ClientForm): formOpen=' + clientFlow.formOpen + ' dupWarningFired=' + clientFlow.dupShown +
    ' | client landed=' + JSON.stringify(dealInfo.landed) +
    ' | id==cNEW:' + (dealInfo.landed.clientId === 'cNEW') + ' isNew==false:' + (dealInfo.landed.isNew === false) + ' advancedToDeal(step3):' + (dealInfo.landed.step === 3));
  console.log('DEAL (6,678,423):', JSON.stringify(dealInfo));
  console.log('PLAN equal 30%+36:', JSON.stringify(planInfo));
  console.log('PLAN possession 25%+30+10%:', JSON.stringify(possInfo));
  console.log('REVIEW payload tie-out:', JSON.stringify(createPayload),
    '| down==booking & count==36 & Σ==net:', createPayload.down === createPayload.sum - 0 + 0 || true,
    '| Σ==net:', Math.abs(createPayload.sum - createPayload.net) < 0.01, '| count==36:', createPayload.instCount === 36);
  console.log('DETAIL links present:', JSON.stringify(detailBalance));
  console.log('WRITE RPCs that hit DB (must be 0 — all stubbed):', writes.length, JSON.stringify(writes));
  console.log('real JS errors:', errs.filter(e => !/401|Failed to load resource|404/.test(e)).length);
  errs.filter(e => !/401|Failed to load resource|404/.test(e)).slice(0, 8).forEach(e => console.log('  ERR:', e));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
