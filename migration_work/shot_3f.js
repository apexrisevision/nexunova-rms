// Phase 3F verification shots — Record Payment + PDC register on nx-kit.
// All RPCs stubbed → ZERO writes. Numbers mirror the ZZTEST ground truth
// (SAL-2026-0001: net 6,678,423 / paid 2,400,000 / balance 4,278,423).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4271;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){return new Promise(res=>{const s=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(PORT,'127.0.0.1',()=>res(s));});}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1500,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERROR '+e));
  await page.goto('http://127.0.0.1:'+PORT+'/login.html', { waitUntil:'networkidle2' });

  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'Rashid', coName:'ZZTEST Internal' };
    window._projectsCache = [{ id:'p1', name:'Sapphire Heights', projectName:'Sapphire Heights' }];
    window._unitsCache = [
      { id:'unit1', unitNo:'A-101', customerName:'AHMED RAZA', projectId:'p1', isAvailable:false, pendingAmount:4278423, totalPaid:2400000, totalPrice:6678423 },
      { id:'unit2', unitNo:'A-102', customerName:'BILAL KHAN', projectId:'p1', isAvailable:false, pendingAmount:0,       totalPaid:5000000, totalPrice:5000000 },
      { id:'unit3', unitNo:'B-201', customerName:'SADIA NOOR', projectId:'p1', isAvailable:false, pendingAmount:1850000, totalPaid:1200000, totalPrice:3050000 }
    ];
    window.hasProjectAccess = () => true;

    const summary = { success:true,
      sale:{ sale_id:'sale1', client_id:'cl1', client_name:'AHMED RAZA', unit_no:'A-101', project_name:'Sapphire Heights',
             sale_number:'SAL-2026-0001', net_amount:6678423, floor_label:'1st Floor', unit_type:'Apartment' },
      installments:[{ amount_due:6678423, amount_paid:2400000, outstanding:4278423 }] };

    const today = new Date(); const d = n => { const x=new Date(today); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
    const pdcRows = [
      { id:'c1', cheque_no:'PDC-2001', bank_name:'HBL',    amount:129858,  cheque_date:d(4),   status:'pending',   client_name:'AHMED RAZA', unit_no:'A-101', sale_number:'SAL-2026-0001', project_name:'Sapphire Heights' },
      { id:'c2', cheque_no:'PDC-1003', bank_name:'HBL',    amount:129858,  cheque_date:d(65),  status:'pending',   client_name:'AHMED RAZA', unit_no:'A-101', sale_number:'SAL-2026-0001', project_name:'Sapphire Heights' },
      { id:'c3', cheque_no:'PDC-1004', bank_name:'HBL',    amount:129858,  cheque_date:d(95),  status:'pending',   client_name:'AHMED RAZA', unit_no:'A-101', sale_number:'SAL-2026-0001', project_name:'Sapphire Heights' },
      { id:'c4', cheque_no:'FUT-9001', bank_name:'Meezan', amount:500000,  cheque_date:d(60),  status:'pending',   client_name:'SADIA NOOR', unit_no:'B-201', sale_number:'SAL-2026-0009', project_name:'Sapphire Heights' },
      { id:'c5', cheque_no:'PDC-0900', bank_name:'UBL',    amount:200000,  cheque_date:d(2),   status:'presented', client_name:'SADIA NOOR', unit_no:'B-201', sale_number:'SAL-2026-0009', project_name:'Sapphire Heights' },
      { id:'c6', cheque_no:'PDC-1001', bank_name:'HBL',    amount:129858,  cheque_date:d(-3),  status:'cleared',   client_name:'AHMED RAZA', unit_no:'A-101', sale_number:'SAL-2026-0001', project_name:'Sapphire Heights' },
      { id:'c7', cheque_no:'PDC-1002', bank_name:'HBL',    amount:129858,  cheque_date:d(-1),  status:'bounced',   client_name:'AHMED RAZA', unit_no:'A-101', sale_number:'SAL-2026-0001', project_name:'Sapphire Heights', bounce_reason:'Insufficient funds' }
    ];

    window._rpcLog = [];
    supabase.rpc = async (name) => {
      window._rpcLog.push(name);
      if (name === 'get_unit_payment_summary') return { data: summary, error:null };
      if (name === 'get_pdc_register')         return { data: { success:true, rows: pdcRows }, error:null };
      return { data: { success:true }, error:null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });

  const show = id => page.evaluate(i => { document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on')); document.getElementById(i).classList.add('on'); }, id);
  async function shoot(name, theme){ await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t), theme); await new Promise(r=>setTimeout(r,400)); await page.screenshot({ path: path.join(OUT, `3f_${name}_${theme}.png`) }); }

  // 1. Record Payment — sold-unit picker
  await show('pg-addpayment');
  await page.evaluate(() => rAddPayment());
  await new Promise(r=>setTimeout(r,400));
  await shoot('recpay_picker','light'); await shoot('recpay_picker','dark');

  // 2. Record Payment — payment form (context pre-selected)
  await page.evaluate(() => rAddPayment('unit1'));
  await new Promise(r=>setTimeout(r,500));
  const formInfo = await page.evaluate(() => ({
    hasAmount: !!document.getElementById('ap-amount'),
    ctx: document.getElementById('ap-ctx')?.textContent.replace(/\s+/g,' ').trim().slice(0,120)
  }));
  await shoot('recpay_form','light'); await shoot('recpay_form','dark');

  // 2b. PDC diversion banner (cheque + future date)
  const pdcDivert = await page.evaluate(() => {
    document.getElementById('ap-mode').value = 'cheque'; _apOnModeChange();
    const dt = new Date(); dt.setDate(dt.getDate()+30); document.getElementById('ap-chqdate').value = dt.toISOString().slice(0,10);
    _apOnModeChange();
    return { banner: !!document.querySelector('#ap-pdc-note .nx-banner--warn'), btn: document.getElementById('ap-save')?.textContent.trim() };
  });
  await shoot('recpay_pdc_divert','light');

  // 3. PDC register — tabs + table
  await show('pg-pdc');
  await page.evaluate(() => rPDC());
  await new Promise(r=>setTimeout(r,500));
  const pdcInfo = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('#pdc-tabs button')].map(b=>b.textContent.trim()),
    rows: document.querySelectorAll('#pdc-table table tbody tr').length
  }));
  await shoot('pdc_register','light'); await shoot('pdc_register','dark');

  // 4. Bundle preview
  await page.evaluate(() => {
    _pdcOpenBundle();
    document.getElementById('pdc-bnd-unit').value = 'unit1';
    document.getElementById('pdc-bnd-start').value = '100231';
    document.getElementById('pdc-bnd-bank').value = 'HBL';
    document.getElementById('pdc-bnd-amt').value = '129858';
    document.getElementById('pdc-bnd-count').value = '36';
    _pdcBundleGen();
  });
  await new Promise(r=>setTimeout(r,300));
  const bundleInfo = await page.evaluate(() => ({
    previewRows: document.querySelectorAll('#pdc-bnd-preview table tbody tr').length,
    confirmEnabled: !document.getElementById('pdc-bnd-btn')?.disabled
  }));
  await shoot('pdc_bundle','light'); await shoot('pdc_bundle','dark');

  // 5. Receipt → real PDF (capture the NXPrint HTML, render it, page.pdf())
  const receiptHtml = await page.evaluate(() => {
    let captured = '';
    const orig = window.NXPrint ? window.NXPrint.emit : null;
    if (window.NXPrint) window.NXPrint.emit = (html) => { captured = html; };
    window._apLastReceipt = { paymentCode:'PAY-2606-0001', amount:2400000, paymentMethod:'cash', paymentDate:new Date().toISOString().slice(0,10),
      referenceNo:'', bankName:'', notes:'', clientName:'AHMED RAZA', unitNo:'A-101', floorLabel:'1st Floor', unitType:'Apartment',
      projectName:'Sapphire Heights', saleNumber:'SAL-2026-0001', receivingAgainst:'Payment received', newAmtPaid:2400000,
      newOutstanding:4278423, netAmount:6678423, recordedBy:'Rashid' };
    if (typeof printPaymentReceiptSupa === 'function') printPaymentReceiptSupa(window._apLastReceipt);
    if (window.NXPrint && orig) window.NXPrint.emit = orig;
    return captured;
  });
  let pdfOk = false, pdfBytes = 0;
  if (receiptHtml && receiptHtml.length > 200) {
    const rp = await browser.newPage();
    await rp.setContent(receiptHtml, { waitUntil:'networkidle0' });
    const pdfPath = path.join(OUT, '3f_receipt.pdf');
    await rp.pdf({ path: pdfPath, format:'A5', printBackground:true });
    await rp.close();
    const buf = fs.readFileSync(pdfPath); pdfBytes = buf.length;
    pdfOk = buf.slice(0,5).toString() === '%PDF-';
  }

  await browser.close(); srv.close();
  console.log('FORM:', JSON.stringify(formInfo));
  console.log('PDC DIVERT:', JSON.stringify(pdcDivert));
  console.log('PDC:', JSON.stringify(pdcInfo));
  console.log('BUNDLE:', JSON.stringify(bundleInfo));
  console.log('RECEIPT PDF: ok=' + pdfOk + ' bytes=' + pdfBytes + ' htmlLen=' + receiptHtml.length);
  const real = errs.filter(e => !/401|Failed to load resource|404|net::ERR/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,8).join(' | '));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
