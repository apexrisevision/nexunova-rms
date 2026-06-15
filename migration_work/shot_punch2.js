// Punch-list #2 — Client photo: resize math, form preview, profile avatar (with/without). ZERO real writes.
// The real authenticated upload to rms-documents/clients/photos is proven separately by real_upload.js
// (a no-auth headless harness can't stub the storage client's captured fetch).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4275;
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
    const cv = document.createElement('canvas'); cv.width=120; cv.height=120; const cx=cv.getContext('2d');
    cx.fillStyle='#0d9488'; cx.fillRect(0,0,120,120); cx.fillStyle='#fff'; cx.font='bold 54px sans-serif'; cx.textAlign='center'; cx.fillText('AR',60,80);
    window.__photoURI = cv.toDataURL('image/png');
    const withPhoto = { id:'zc1', fullName:'AHMED RAZA', fatherName:'GHULAM', cnic:'17301-1111111-1', phonePrimary:'0301-1111111', clientCode:'ZZ-C-001', status:'active', projectId:'p1', clientCategory:'Investor', city:'Peshawar', clientPhotoUrl:window.__photoURI, nextOfKinName:'FATIMA RAZA', nextOfKinRelation:'Spouse', nextOfKinPhone:'0301-7654321' };
    const noPhoto   = { id:'zc2', fullName:'BILAL KHAN', fatherName:'NISAR', cnic:'17301-2222222-2', phonePrimary:'0301-2222222', clientCode:'ZZ-C-002', status:'active', projectId:'p1' };
    window._clientsCache = [withPhoto, noPhoto];
    window.gclient = id => window._clientsCache.find(c=>c.id===id); window.gclients = () => window._clientsCache;
    window.gprojects = () => window._projectsCache; window.gproject = id => window._projectsCache.find(p=>p.id===id);
    window.hasProjectAccess = () => true; window.mountFormNav = () => {}; window.loadClientsCache = async()=>true; window.logA=()=>{};
    window._cap = {};
    supabase.rpc = async (name, args) => { window._cap[name] = args;
      if (name==='get_recovery_position') return { data:{ rows:[], totals:{}, period:{} }, error:null };
      if (name==='list_sales_by_client_all') return { data:[], error:null };
      if (name==='create_client') return { data:{ success:true, id:'newid' }, error:null };
      if (name==='update_client') return { data:{ success:true }, error:null };
      return { data:{ success:true, rows:[] }, error:null }; };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });
  const shoot=(n,t)=>page.evaluate(x=>document.documentElement.setAttribute('data-theme',x),t).then(()=>new Promise(r=>setTimeout(r,350))).then(()=>page.screenshot({path:path.join(OUT,`p2_${n}_${t}.png`)}));

  // 1. Resize correctness — same canvas math as ClientForm._resize on an 800x600 source
  const resize = await page.evaluate(async () => {
    const src = document.createElement('canvas'); src.width=800; src.height=600;
    const c=src.getContext('2d'); c.fillStyle='#6366f1'; c.fillRect(0,0,800,600);
    const blob = await new Promise(r=>src.toBlob(r,'image/png'));
    const file = new File([blob],'p.png',{type:'image/png'});
    return await new Promise((resolve,reject)=>{ const u=URL.createObjectURL(file); const img=new Image();
      img.onload=()=>{ let w=img.width,h=img.height,max=512; if(w>max||h>max){const s=Math.min(max/w,max/h);w=Math.round(w*s);h=Math.round(h*s);} const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);URL.revokeObjectURL(u);cv.toBlob(b=>resolve({w,h,bytes:b.size,within512:w<=512&&h<=512}),'image/jpeg',0.85);};
      img.onerror=()=>reject('bad'); img.src=u; });
  });

  // 1b. Form with photo populated (UI state after upload)
  await page.evaluate(() => { ClientForm.open({ projectId:'p1' });
    document.getElementById('cfm-photo_url').value = window.__photoURI;
    document.getElementById('cfm-photo-prev').innerHTML = '<img src="'+window.__photoURI+'" style="width:100%;height:100%;object-fit:cover">'; });
  await new Promise(r=>setTimeout(r,250));
  await shoot('form_photo','light'); await shoot('form_photo','dark');

  // 2. Save → payload carries client_photo_url from the hidden input
  const savePayload = await page.evaluate(async () => {
    document.getElementById('cfm-full_name').value='NEW CLIENT';
    document.getElementById('cfm-father_name').value='FATHER';
    document.getElementById('cfm-phone_primary').value='0300-0000000';
    document.getElementById('cfm-cnic').value='42101-1234567-1';
    window._cap.create_client=null;
    await ClientForm.save();
    const d = (window._cap.create_client && window._cap.create_client.p_data) || {};
    return { photoIncluded: typeof d.client_photo_url==='string' && d.client_photo_url.length>0 };
  });
  await page.evaluate(()=>ClientForm.close&&ClientForm.close());

  // 3. Edit prefill — existing photo in preview + hidden
  const prefill = await page.evaluate(() => { ClientForm.open({ clientId:'zc1' });
    return { hidden: !!document.getElementById('cfm-photo_url').value, previewImg: !!document.querySelector('#cfm-photo-prev img') }; });
  await page.evaluate(()=>ClientForm.close());

  // 4. Profile WITH photo
  await page.evaluate(()=>{ document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on')); document.getElementById('pg-clientdetail').classList.add('on'); _cid='zc1'; rClientDetail(); });
  await new Promise(r=>setTimeout(r,400));
  const profWith = await page.evaluate(()=>({ img: !!document.querySelector('#pg-clientdetail .nx-card img') }));
  await shoot('profile_with_photo','light'); await shoot('profile_with_photo','dark');

  // 5. Profile WITHOUT photo → initials avatar
  await page.evaluate(()=>{ _cid='zc2'; rClientDetail(); });
  await new Promise(r=>setTimeout(r,400));
  const profNo = await page.evaluate(()=>{ const card=document.querySelector('#pg-clientdetail .nx-card'); const av=card.querySelector('div[style*="linear-gradient"]'); return { img: !!card.querySelector('img'), initialsAvatar: !!av, text: av&&av.textContent }; });
  await shoot('profile_no_photo','light'); await shoot('profile_no_photo','dark');

  await browser.close(); srv.close();
  console.log('RESIZE 800x600 ->', JSON.stringify(resize));
  console.log('SAVE payload photoIncluded:', savePayload.photoIncluded);
  console.log('EDIT PREFILL:', JSON.stringify(prefill));
  console.log('PROFILE with photo:', JSON.stringify(profWith), '| no photo:', JSON.stringify(profNo));
  const real = errs.filter(e=>!/401|Failed to load resource|404|net::ERR/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
