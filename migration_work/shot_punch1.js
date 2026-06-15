// Punch-list #1 verification — Client Nominee restored. ZERO writes (RPCs stubbed/captured).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4273;
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
  const errs = []; page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); page.on('pageerror', e=>errs.push('PAGEERROR '+e));
  await page.goto('http://127.0.0.1:'+PORT+'/login.html', { waitUntil:'networkidle2' });

  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'Rashid', coName:'ZZTEST' };
    window._projectsCache = [{ id:'p1', name:'Sapphire Heights', projectName:'Sapphire Heights' }];
    const withNom = { id:'zc1', fullName:'AHMED RAZA', fatherName:'GHULAM', cnic:'17301-1111111-1', phonePrimary:'0301-1111111',
      clientCode:'ZZ-C-001', status:'active', projectId:'p1', clientCategory:'Investor', address:'University Rd', city:'Peshawar',
      nextOfKinName:'FATIMA RAZA', nextOfKinRelation:'Spouse', nextOfKinPhone:'0301-7654321' };
    const noNom = { id:'zc2', fullName:'BILAL KHAN', fatherName:'NISAR', cnic:'17301-2222222-2', phonePrimary:'0301-2222222',
      clientCode:'ZZ-C-002', status:'active', projectId:'p1' };
    window._clientsCache = [withNom, noNom];
    window.gclient = id => window._clientsCache.find(c=>c.id===id);
    window.gclients = () => window._clientsCache;
    window.gprojects = () => window._projectsCache; window.gproject = id => window._projectsCache.find(p=>p.id===id);
    window.hasProjectAccess = () => true; window.mountFormNav = () => {}; window.loadClientsCache = async()=>true; window.logA=()=>{};
    window._capture = [];
    supabase.rpc = async (name, args) => {
      window._capture.push({ name, args });
      if (name==='get_recovery_position') return { data:{ rows:[], totals:{}, period:{} }, error:null };
      if (name==='list_sales_by_client_all') return { data:[], error:null };
      if (name==='get_client_ledger') return { data:{ success:true, rows:[] }, error:null };
      if (name==='get_contact_logs_cache') return { data:[], error:null };
      if (name==='create_client') return { data:{ success:true, id:'newid', client_code:'ZZ-C-099' }, error:null };
      if (name==='update_client') return { data:{ success:true }, error:null };
      return { data:{ success:true }, error:null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });
  const shoot=(n,t)=>page.evaluate(x=>document.documentElement.setAttribute('data-theme',x),t).then(()=>new Promise(r=>setTimeout(r,350))).then(()=>page.screenshot({path:path.join(OUT,`p1_${n}_${t}.png`)}));

  // 1. Profile identity card shows the nominee
  await page.evaluate(()=>{ document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on')); document.getElementById('pg-clientdetail').classList.add('on'); _cid='zc1'; rClientDetail(); });
  await new Promise(r=>setTimeout(r,500));
  const profile = await page.evaluate(()=>{ const t=document.querySelector('#pg-clientdetail .nx-card').textContent; return { hasNominee: t.includes('Nominee: FATIMA RAZA'), snippet: (t.match(/Nominee:[^]*?(Spouse|7654321|\n)/)||[''])[0].slice(0,60) }; });
  await shoot('profile_identity','light'); await shoot('profile_identity','dark');

  // 2. ClientForm edit → nominee prefilled
  const editPrefill = await page.evaluate(()=>{ ClientForm.open({ clientId:'zc1' });
    return { name:document.getElementById('cfm-kin_name')?.value, rel:document.getElementById('cfm-kin_relation')?.value, phone:document.getElementById('cfm-kin_phone')?.value,
             detailsOpen: !!document.querySelector('#cfm-modal details[open]') }; });
  await shoot('form_edit_prefill','light'); await shoot('form_edit_prefill','dark');
  await page.evaluate(()=>ClientForm.close());

  // 3. ClientForm create → fill nominee → save → payload carries next_of_kin_*
  const createPayload = await page.evaluate(async ()=>{
    ClientForm.open({ projectId:'p1' });
    document.getElementById('cfm-full_name').value='NEW CLIENT';
    document.getElementById('cfm-father_name').value='FATHER';
    document.getElementById('cfm-phone_primary').value='0300-0000000';
    document.getElementById('cfm-cnic').value='42101-1234567-1';
    document.getElementById('cfm-kin_name').value='ZAINAB';
    document.getElementById('cfm-kin_relation').value='Daughter';
    document.getElementById('cfm-kin_phone').value='0300-9999999';
    window._capture=[];
    await ClientForm.save();
    const call = window._capture.find(c=>c.name==='create_client');
    const d = call && call.args && call.args.p_data || {};
    return { name:d.next_of_kin_name, rel:d.next_of_kin_relation, phone:d.next_of_kin_phone };
  });

  // 4. New Sale Review chip — missing (zc2) then present (zc1)
  const chip = await page.evaluate(()=>{
    const mk = cli => { window._ns = { step:5, client:cli, unit:{unitNo:'A-101'}, plan:[], saleDate:'2026-06-12', agentId:null, list:1000000, discount:0, net:1000000 };
      const div=document.createElement('div'); div.innerHTML=_nsStep5(); return div.textContent.includes('Nominee missing'); };
    window._salAgents = window._salAgents || [];
    return { missing: mk({ id:'zc2' }), present_when_has: mk({ id:'zc1' }), newClient: mk({ isNew:true, full_name:'X' }) };
  });

  await browser.close(); srv.close();
  console.log('PROFILE:', JSON.stringify(profile));
  console.log('EDIT PREFILL:', JSON.stringify(editPrefill));
  console.log('CREATE PAYLOAD:', JSON.stringify(createPayload));
  console.log('CHIP: noNominee->'+chip.missing+' (want true) | hasNominee->'+chip.present_when_has+' (want false) | newClient->'+chip.newClient+' (want true)');
  const real = errs.filter(e=>!/401|Failed to load resource|404|net::ERR/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
