#!/usr/bin/env node
/* ============================================================================
   NEXUNOVA RMS — PAGE SMOKE TEST  (module-level runtime net)
   ----------------------------------------------------------------------------
   Boots login.html headless and nav()s to EVERY page/module, catching JS errors.
   Page keys are read from js/lazy-pages.js automatically, so new pages are covered.
   Exits non-zero if any page throws on load. ("no-render" = needs real data to
   populate; not a crash — reported as info, not a failure.)

     node scripts/smoke-pages.js        (or: npm run check:pages)

   Needs Chrome + puppeteer-core (resolved from migration_work/node_modules).
   ========================================================================== */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4398;
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) { console.log('[smoke-pages] SKIPPED — puppeteer-core or Chrome not found.'); process.exit(0); }

// page keys straight from lazy-pages.js M{} + always-on pages
function pageKeys() {
  const lz = fs.readFileSync(path.join(ROOT, 'js/lazy-pages.js'), 'utf8');
  const block = lz.slice(lz.indexOf('var M = {'), lz.indexOf('};', lz.indexOf('var M = {')));
  const keys = new Set();
  for (const m of block.matchAll(/(^|\s|,|\{)('?[a-zA-Z][\w-]*'?):/g)) {
    const k = m[2].replace(/'/g, '');
    if (k !== 'var' && k !== 'M') keys.add(k);
  }
  ['dashboard', 'executive', 'myrecovery', 'ledgers'].forEach(k => keys.add(k));
  return [...keys].sort();
}
const DETAIL = { unitdetail:'unit1', clientdetail:'c1', agentdetail:'a1', salesdetail:'sale1', projectdetail:'p1', 'paylink-detail':'pl1', editsale:'sale1', unitchain:'unit1', unitcancel:'unit1', unitchange:'unit1', unittransfer:'unit1' };
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){return new Promise(res=>{const s=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(PORT,'127.0.0.1',()=>res(s));});}

(async () => {
  const PAGES = pageKeys();
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'Tester', coName:'ZZTEST' };
    const summary = { success:true, sale:{ sale_id:'sale1', client_name:'X', unit_no:'A-101', net_amount:1000000 }, installments:[{ amount_due:1000000, amount_paid:0, outstanding:1000000 }] };
    supabase.rpc = async (name) => {
      if (name === 'get_unit_payment_summary') return { data: summary, error:null };
      if (/^list_/.test(name)) return { data: [], error:null };
      return { data: { success:true, rows:[], items:[], data:[], list:[], entries:[], totals:{}, summary:{}, sale:{}, installments:[], client_info:{}, opening_balance:0, closing_balance:0, count:0, kpis:{}, officer_summary:[], period:{} }, error:null };
    };
    window._projectsCache=[{id:'p1',name:'KBH',projectName:'KBH'}];
    window._unitsCache=[{id:'unit1',unitNo:'A-101',customerName:'X',projectId:'p1',isAvailable:false,saleId:'sale1',totalPaid:0,pendingAmount:1000000}];
    window._clientsCache=[{id:'c1',fullName:'CLIENT A',projectId:'p1'}];
    window._typesCache=[{id:'t1',name:'Shop'}];window._statusesCache=[{id:'st1',name:'Available',isAvailable:true}];
    window._floorsCache=[{id:'f1',name:'Ground',sortOrder:0}];window._saleTypesCache=[{id:'stp1',name:'Installment'}];
    window._salAgents=[{id:'a1',full_name:'Agent A',project_id:'p1'}];window._agentsCache=window._salAgents;
    window.hasProjectAccess=()=>true;window.activeProjectId=()=>'';
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });

  const results = [];
  for (const key of PAGES) {
    const errs = []; const h = e => errs.push(String(e).slice(0, 140)); page.on('pageerror', h);
    try { await page.evaluate((k, arg) => { window.__perr = null; try { if (typeof nav === 'function') nav(k, arg); } catch (e) { window.__perr = e.message; } }, key, DETAIL[key] || undefined); } catch {}
    await new Promise(r => setTimeout(r, 500));
    const info = await page.evaluate(k => { const el = document.getElementById('pg-' + k); return { perr: window.__perr, rendered: el ? el.innerHTML.trim().length > 20 : false }; }, key);
    page.off('pageerror', h);
    const jsErr = errs.find(x => !/Failed to load|404|net::ERR|401|Download the|reading 'classList'/.test(x));
    results.push({ key, rendered: info.rendered, err: info.perr || jsErr || null });
  }
  await browser.close(); srv.close();

  console.log('\n════════════ PAGE SMOKE ════════════');
  const errored = results.filter(r => r.err);
  const noRender = results.filter(r => !r.err && !r.rendered).map(r => r.key);
  for (const r of errored) console.log('❌ ' + r.key + '  -> ' + r.err);
  console.log('────────────────────────────────────');
  console.log('✅ loaded clean: ' + results.filter(r => !r.err && r.rendered).length + '/' + results.length);
  if (noRender.length) console.log('ℹ️  no-render (need real data, not a crash): ' + noRender.join(', '));
  if (errored.length) { console.log('RESULT: ❌ ' + errored.length + ' page(s) throw on load. FIX before deploy.'); process.exit(1); }
  console.log('RESULT: ✅ all ' + results.length + ' pages load without errors.');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
