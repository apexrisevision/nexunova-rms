// Verify the "Mera Hisaab — Portal Link" action on the client profile + its kit modal.
// Fully stubbed (S, caches, supabase.rpc incl. admin_invite_portal_client) → ZERO writes.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4287;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'portalbtn_shots'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){ return new Promise(res=>{ const s=http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); }).listen(PORT,'127.0.0.1',()=>res(s)); }); }

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1500,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errs = []; page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); page.on('pageerror', e=>errs.push('PAGEERROR '+e));
  await page.goto('http://127.0.0.1:'+PORT+'/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'R', coName:'Fourteen Group of companies', coCode:'14GROUPOFCOMPANIES' };
    window._projectsCache = [{ id:'p1', name:'Khushal Bagh Heights', projectName:'Khushal Bagh Heights' }];
    const c = { id:'am', fullName:'ABDUL MAJID', fatherName:'GHULAM', cnic:'17301-1234567-1', phonePrimary:'0300-1234567', clientCode:'KBH-C-0127', status:'active', projectId:'p1', email:'' };
    window._clientsCache = [c];
    window.gclients=()=>window._clientsCache; window.gclient=(id)=>window._clientsCache.find(x=>x.id===id);
    window.gproject=(id)=>window._projectsCache.find(p=>p.id===id); window.gprojects=()=>window._projectsCache;
    window.gunits=()=>[]; window.hasProjectAccess=()=>true; window.mountFormNav=()=>{}; window.loadClientsCache=async()=>true; window.logA=()=>{};
    window._rpcLog=[];
    supabase.rpc = async (name) => {
      window._rpcLog.push(name);
      if (name==='get_recovery_position') return { data:{ rows:[{ client_code:'KBH-C-0127', client_name:'ABDUL MAJID', sale_id:'s1', unit_no:'6-19', net_price:7974000, paid_to_date:2850000, closing:5124000, closing_old:0, closing_current:5124000, overdue_days:30 }], totals:{}, period:{} }, error:null };
      if (name==='list_sales_by_client_all') return { data:[{ id:'s1', sale_number:'BKG-235', status:'active', unit_id:'u1', net_amount:7974000, down_payment:0 }], error:null };
      if (name==='get_client_ledger') return { data:{ success:true, rows:[], opening_balance:0, closing_balance:0, client_info:{} }, error:null };
      if (name==='get_contact_logs_cache') return { data:[], error:null };
      if (name==='get_clients_plan_status') return { data:{ max_allowed:10000, current_count:1, can_add:true }, error:null };
      if (name==='get_clients_by_health_category') return { data:[], error:null };
      if (name==='list_agents') return { data:[], error:null };
      if (name==='get_portal_access_status') return { data:{ has_access:false }, error:null };
      if (name==='admin_invite_portal_client') return { data:{ success:true, temp_token:'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', temp_password:'AB12CD34', email:'am000000@portal.local' }, error:null };
      return { data:{ success:true }, error:null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });

  // render ABDUL MAJID profile
  await page.evaluate(() => { document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on')); document.getElementById('pg-clientdetail').classList.add('on'); });
  await page.evaluate(() => { _cid='am'; rClientDetail(); });
  await new Promise(r=>setTimeout(r,800));

  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#pg-clientdetail .nx-btn')].find(x=>/Mera Hisaab/.test(x.textContent));
    return { present: !!b, label: b?b.textContent.trim():null };
  });

  // click → open modal
  await page.evaluate(() => { const b=[...document.querySelectorAll('#pg-clientdetail .nx-btn')].find(x=>/Mera Hisaab/.test(x.textContent)); b && b.click(); });
  await new Promise(r=>setTimeout(r,500));

  const modal = await page.evaluate(() => {
    const m = document.getElementById('cd-portal-modal');
    if (!m) return { open:false };
    const link = (document.getElementById('cd-portal-link')||{}).value || '';
    return { open:true, title:(m.querySelector('.nx-modal-title')||{}).textContent, link,
      linkValid: /buyer-portal\.html\?t=[0-9a-f]{8,}/.test(link),
      hasPw: /AB12CD34/.test(m.textContent), hasNote:/WhatsApp or print/.test(m.textContent) };
  });

  // screenshots: 1366 + 1920, light + dark (modal stays open)
  for (const w of [1366, 1920]) {
    await page.setViewport({ width:w, height: w===1366?900:1080 });
    for (const t of ['light','dark']) {
      await page.evaluate(th=>document.documentElement.setAttribute('data-theme',th), t);
      await new Promise(r=>setTimeout(r,250));
      await page.screenshot({ path: path.join(OUT, `portal_modal_${w}_${t}.png`) });
    }
  }

  await browser.close(); srv.close();
  console.log('BUTTON:', JSON.stringify(btn));
  console.log('MODAL :', JSON.stringify(modal));
  const real = errs.filter(e=>!/401|404|Failed to load resource/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
