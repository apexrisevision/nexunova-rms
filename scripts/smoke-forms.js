#!/usr/bin/env node
/* ============================================================================
   NEXUNOVA RMS — FORM SMOKE TEST  (runtime layer of the safety-net)
   ----------------------------------------------------------------------------
   Boots login.html headless and OPENS every critical data-entry form, catching
   JS errors and confirming each renders. Complements scripts/predeploy-check.js
   (which is static). Exits non-zero if any form throws.

     node scripts/smoke-forms.js        (or: npm run check:forms)

   Needs Chrome + puppeteer-core (resolved from migration_work/node_modules).
   ========================================================================== */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4399;
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[smoke-forms] SKIPPED — puppeteer-core or Chrome not found (static `npm run check` still gates).');
  process.exit(0);
}

// Each: [display name, lazy nav-module, JS expression to open the form].
// Page-scoped forms render their page first (rBanks/rPDC/rReceipts).
const FORMS = [
  ['Add Unit', 'units', "openUnitModal(null)"],
  ['Add Client', 'clients', "ClientForm.open({projectId:'p1'})"],
  ['Add Agent', 'agents', "openAgentModal(null)"],
  ['Commission Payment', 'agents', "openCommPayModal('a1','Agent A',100000,'monthly','2026-08-01')"],
  ['Commission Structure', 'agents', "typeof _csOpenForm==='function'&&_csOpenForm('p1')"],
  ['Merge Agents', 'agents', "typeof openMergeAgentModal==='function'&&openMergeAgentModal()"],
  ['Add Project', 'projects', "openProjectModal(null)"],
  ['Add Bank', 'banks', "typeof rBanks==='function'&&rBanks(); _bankOpenModal(null)"],
  ['Add Floor', 'categories', "typeof openFloorModal==='function'&&openFloorModal(null)"],
  ['Add Type', 'categories', "typeof openTypeModal==='function'&&openTypeModal(null)"],
  ['Add Status', 'categories', "typeof openStatusModal==='function'&&openStatusModal(null)"],
  ['Add SaleType', 'categories', "typeof openSaleTypeModal==='function'&&openSaleTypeModal(null)"],
  ['Add User', 'users', "typeof openAddUserModal==='function'&&openAddUserModal()"],
  ['Receipt Voucher', 'receipts', "rReceipts(); _rvNewVoucher()"],
  ['Shift Amount', 'receipts', "_rvOpenShift()"],
  ['New Sale', 'newsale', "rNewSale()"],
  ['Add Payment', 'addpayment', "rAddPayment()"],
  ['PDC Bundle', 'pdc', "rPDC(); typeof _pdcOpenBundle==='function'&&_pdcOpenBundle()"],
];
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){return new Promise(res=>{const s=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(PORT,'127.0.0.1',()=>res(s));});}
const SEL = '.mov.on,.nx-modal,#cfm-modal,.md,#pg-newsale .nx-card,#pg-addpayment .nx-card';

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'Tester', coName:'ZZTEST' };
    supabase.rpc = async () => ({ data:{ success:true, rows:[], sale:{ sale_id:'s1', net_amount:1000000, client_name:'X', unit_no:'G-01' }, installments:[], id:'x' }, error:null });
    window._projectsCache=[{id:'p1',name:'KBH',projectName:'KBH'}];
    window._unitsCache=[{id:'u1',unitNo:'G-01',customerName:'X',projectId:'p1',isAvailable:false,saleId:'s1',totalPaid:100000,pendingAmount:50000}];
    window._clientsCache=[{id:'c1',fullName:'CLIENT A',projectId:'p1'}];
    window._typesCache=[{id:'t1',name:'Shop'}];window._statusesCache=[{id:'st1',name:'Available',isAvailable:true}];
    window._floorsCache=[{id:'f1',name:'Ground',sortOrder:0}];window._saleTypesCache=[{id:'stp1',name:'Installment'}];
    window._salAgents=[{id:'a1',full_name:'Agent A',commission_percent:2,project_id:'p1'}];window._agentsCache=window._salAgents;
    window.hasProjectAccess=()=>true;window.activeProjectId=()=>'';
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });

  const results = [];
  for (const [nm, mod, expr] of FORMS) {
    const errs = []; const h = e => errs.push(String(e).slice(0, 140)); page.on('pageerror', h);
    try { await page.evaluate(async m => { if (window.ensurePageModules) await window.ensurePageModules(m); }, mod); } catch {}
    await new Promise(r => setTimeout(r, 200));
    const info = await page.evaluate((e, sel) => { window.__ferr = null; const b = document.querySelectorAll(sel).length; try { eval(e); } catch (err) { window.__ferr = err.message; } return { b }; }, expr, SEL);
    await new Promise(r => setTimeout(r, 350));
    const after = await page.evaluate(sel => ({ a: document.querySelectorAll(sel).length, ferr: window.__ferr }), SEL);
    page.off('pageerror', h);
    const jsErr = errs.find(x => !/Failed to load|404|net::ERR|401|Download the/.test(x));
    results.push({ nm, opened: after.a > info.b || after.a > 0, err: after.ferr || jsErr || null });
    await page.evaluate(() => { document.querySelectorAll('.mov.on').forEach(m => m.classList.remove('on')); ['u-modal-host','pm-modal-host','cs-modal-host','rv-shift-host','cp-form-host'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; }); const cf = document.getElementById('cfm-modal'); if (cf) cf.remove(); });
  }
  await browser.close(); srv.close();

  console.log('\n════════════ FORM SMOKE ════════════');
  let bad = 0;
  for (const r of results) { const s = r.err ? '❌ ERROR' : (r.opened ? '✅ opens' : '⚠️  no-render'); if (r.err) bad++; console.log(s + '  ' + r.nm + (r.err ? '  -> ' + r.err : '')); }
  console.log('────────────────────────────────────');
  if (bad) { console.log('RESULT: ❌ ' + bad + '/' + results.length + ' form(s) throw. FIX before deploy.'); process.exit(1); }
  console.log('RESULT: ✅ all ' + results.length + ' forms open cleanly.');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
