// Verify "Send via WhatsApp" on the Mera Hisaab portal-link modal: wa.me URL + prefilled
// message, no-phone fallback, screenshots. Fully stubbed (zero writes).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4291;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'portalwa_shots'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){ return new Promise(res=>{ const s=http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); }).listen(PORT,'127.0.0.1',()=>res(s)); }); }

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--window-size=1500,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1366, height:900 });
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); page.on('pageerror',e=>errs.push('PAGEERROR '+e));
  await page.goto('http://127.0.0.1:'+PORT+'/login.html',{waitUntil:'networkidle2'});

  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'R', coName:'Fourteen Group', coCode:'14GROUPOFCOMPANIES' };
    window._projectsCache=[{id:'p1',name:'Khushal Bagh Heights',projectName:'Khushal Bagh Heights'}];
    const withPhone = { id:'wp', fullName:'AKHTAR MUNIR', fatherName:'X', cnic:'17301-1-1', phonePrimary:'0301-1162060', clientCode:'KBH-C-0124', status:'active', projectId:'p1', email:'' };
    const noPhone   = { id:'np', fullName:'NO PHONE CLIENT', fatherName:'X', cnic:'17301-2-2', phonePrimary:'', whatsapp:'', clientCode:'KBH-C-9999', status:'active', projectId:'p1', email:'' };
    window._clientsCache=[withPhone,noPhone];
    window.gclients=()=>window._clientsCache; window.gclient=(id)=>window._clientsCache.find(x=>x.id===id);
    window.gproject=(id)=>window._projectsCache.find(p=>p.id===id); window.gprojects=()=>window._projectsCache;
    window.gunits=()=>[]; window.hasProjectAccess=()=>true; window.mountFormNav=()=>{}; window.loadClientsCache=async()=>true; window.logA=()=>{};
    supabase.rpc = async (name) => {
      if (name==='get_recovery_position') return { data:{ rows:[], totals:{}, period:{} }, error:null };
      if (name==='list_sales_by_client_all') return { data:[], error:null };
      if (name==='get_client_ledger') return { data:{ success:true, rows:[], opening_balance:0, closing_balance:0, client_info:{} }, error:null };
      if (name==='get_contact_logs_cache') return { data:[], error:null };
      if (name==='get_clients_plan_status') return { data:{ max_allowed:10000, current_count:2, can_add:true }, error:null };
      if (name==='get_clients_by_health_category') return { data:[], error:null };
      if (name==='list_agents') return { data:[], error:null };
      if (name==='get_portal_access_status') return { data:{ has_access:false }, error:null };
      if (name==='admin_invite_portal_client') return { data:{ success:true, temp_token:'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb', temp_password:'AB12CD34', email:'wp000000@portal.local' }, error:null };
      return { data:{ success:true }, error:null };
    };
    document.getElementById('s-login').classList.remove('on'); document.getElementById('s-app').classList.add('on');
  });

  async function openFor(cid){
    await page.evaluate(()=>{ document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on')); document.getElementById('pg-clientdetail').classList.add('on'); });
    await page.evaluate((c)=>{ _cid=c; rClientDetail(); }, cid);
    await new Promise(r=>setTimeout(r,700));
    await page.evaluate(()=>{ const b=[...document.querySelectorAll('#pg-clientdetail .nx-btn')].find(x=>/Mera Hisaab/.test(x.textContent)); b&&b.click(); });
    await new Promise(r=>setTimeout(r,400));
    return page.evaluate(()=>{
      const m=document.getElementById('cd-portal-modal'); if(!m) return {open:false};
      const wa=[...m.querySelectorAll('a.nx-btn')].find(a=>/WhatsApp/.test(a.textContent));
      const copy=[...m.querySelectorAll('.nx-btn')].find(b=>/Copy/.test(b.textContent));
      let href=wa?wa.getAttribute('href'):null, text=null;
      if(href){ const q=href.split('?text='); text=q[1]?decodeURIComponent(q[1]):''; }
      return { open:true, waPresent:!!wa, href, text, copyPresent:!!copy,
        note:/Auto-send via WhatsApp will be available/.test(m.textContent),
        noPhoneNote:/No phone number on file/.test(m.textContent) };
    });
  }

  const withP = await openFor('wp');
  // screenshots (modal open, with-phone)
  for (const w of [1366,1920]) { await page.setViewport({width:w,height:w===1366?900:1080});
    for (const t of ['light','dark']) { await page.evaluate(th=>document.documentElement.setAttribute('data-theme',th),t); await new Promise(r=>setTimeout(r,250)); await page.screenshot({path:path.join(OUT,`wa_modal_${w}_${t}.png`)}); } }
  await page.evaluate(()=>_cdClosePortalModal());
  const noP = await openFor('np');

  await browser.close(); srv.close();
  console.log('WITH PHONE :', JSON.stringify(withP, null, 2));
  console.log('NO PHONE   :', JSON.stringify(noP));
  const real = errs.filter(e=>!/401|404|Failed to load resource/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,5).join(' | '));
})().catch(e=>{ console.error('FATAL',e); process.exit(1); });
