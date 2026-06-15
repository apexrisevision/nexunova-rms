// Punch-list #3 — New Sale "More booking details" disclosure. ZERO real writes (RPCs captured).
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4277;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve(){return new Promise(res=>{const s=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(PORT,'127.0.0.1',()=>res(s));});}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1500,1100'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1100 });
  const errs = []; page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); page.on('pageerror', e=>errs.push('PAGEERROR '+e));
  await page.goto('http://127.0.0.1:'+PORT+'/login.html', { waitUntil:'networkidle2' });

  await page.evaluate(() => {
    S = { cid:'co1', userId:'u1', role:'admin', name:'Rashid', coName:'ZZTEST' };
    window._projectsCache = [{ id:'p1', name:'Sapphire Heights', projectName:'Sapphire Heights' }];
    window._saleTypesCache = [{ id:'st1', name:'Fresh booking', projectId:'p1', isActive:true, sortOrder:1 }, { id:'st2', name:'Transfer', projectId:'p1', isActive:true, sortOrder:2 }];
    window._salAgents = [];
    window._unitsCache = [{ id:'unit1', unitNo:'G-01', projectId:'p1', isAvailable:true, area:1000 }];
    window._clientsCache = [{ id:'cl1', fullName:'AHMED RAZA', projectId:'p1' }];
    window.gclient = id => window._clientsCache.find(c=>c.id===id);
    window.openSaleDetail = () => {}; window.loadUnitsCache = async()=>true; window.hasProjectAccess = () => true;
    window._cap = [];
    supabase.rpc = async (name, args) => { window._cap.push({ name, args });
      if (name==='create_sale_with_schedule') return { data:{ success:true, sale_id:'newsale1', sale_number:'SAL-2026-0099' }, error:null };
      if (name==='edit_sale') return { data:{ success:true }, error:null };
      return { data:[], error:null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });
  const shoot=(n,t)=>page.evaluate(x=>document.documentElement.setAttribute('data-theme',x),t).then(()=>new Promise(r=>setTimeout(r,350))).then(()=>page.screenshot({path:path.join(OUT,`p3_${n}_${t}.png`)}));

  // Build a valid _ns (unit/client/deal/plan) and capture the create payload.
  const setup = (extras) => `(() => {
    const today='2026-06-12';
    const plan=[{type:'down_payment',due:today,amount:300000,label:'Booking'}];
    for(let i=1;i<=7;i++) plan.push({type:'installment',due:'2026-'+String(6+i).padStart(2,'0')+'-12',amount:100000});
    _ns={ step:5, unit:{id:'unit1',projectId:'p1',unitNo:'G-01'}, client:{id:'cl1',full_name:'AHMED RAZA'},
      agentId:null, commPct:null, saleDate:today, bookingDate:today,
      rate:1000, area:1000, list:1000000, deal:1000000, discount:0, pricePerSqft:1000, net:1000000,
      tpl:'equal', plan,
      coBuyerName:'', coBuyerCnic:'', coBuyerShare:'', nomineeName:'', nomineeCnic:'', nomineeRelation:'', wht:'', cvt:'', saleTypeId:'' };
    Object.assign(_ns, ${JSON.stringify(extras)});
  })()`;

  // 1. WITHOUT extras → only create_sale_with_schedule, exact 3D keys, no edit_sale
  const without = await page.evaluate(async (s) => {
    eval(s); window._cap=[];
    await _nsCreate();
    const calls = window._cap.map(c=>c.name);
    const create = window._cap.find(c=>c.name==='create_sale_with_schedule');
    return { calls, editSaleCalled: calls.includes('edit_sale'),
             pSaleKeys: create ? Object.keys(create.args.p_sale).sort() : null };
  }, setup({}));

  // 2. WITH co-buyer + WHT → create + edit_sale(patch)
  const withExtras = await page.evaluate(async (s) => {
    eval(s); window._cap=[];
    await _nsCreate();
    const calls = window._cap.map(c=>c.name);
    const create = window._cap.find(c=>c.name==='create_sale_with_schedule');
    const edit = window._cap.find(c=>c.name==='edit_sale');
    return { calls, createKeys: create ? Object.keys(create.args.p_sale).sort() : null,
             editPatch: edit ? edit.args.p_data : null };
  }, setup({ coBuyerName:'JOINT BUYER', coBuyerCnic:'42101-1234567-1', coBuyerShare:'50', wht:'25000', saleTypeId:'st1' }));

  // 3. Disclosure screenshot — render DEAL step with extras filled (open)
  await page.evaluate(() => {
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
    const pg=document.getElementById('pg-newsale'); if(pg) pg.classList.add('on');
    _ns={ step:3, unit:{id:'unit1',projectId:'p1',unitNo:'G-01'}, client:{id:'cl1'}, agentId:null, commPct:null,
      saleDate:'2026-06-12', bookingDate:'2026-06-12', rate:1000, area:1000, list:1000000, deal:1000000, discount:0, pricePerSqft:1000, net:1000000, tpl:'equal', plan:[],
      coBuyerName:'JOINT BUYER', coBuyerCnic:'42101-1234567-1', coBuyerShare:'50', nomineeName:'FATIMA', nomineeCnic:'', nomineeRelation:'Spouse', wht:'25000', cvt:'12000', saleTypeId:'st1' };
    _nsRender(); _nsDealRecalc();
    const d=document.querySelector('#pg-newsale details'); if(d) d.open=true;
  });
  await new Promise(r=>setTimeout(r,300));
  await shoot('deal_more_open','light'); await shoot('deal_more_open','dark');

  await browser.close(); srv.close();
  const EXPECT3D = ['agent_id','area_sqft','commission_rate','company_id','created_by','discount','down_payment','installment_count','price_per_sqft','sale_date','unit_id','client_id'].sort();
  console.log('WITHOUT:', JSON.stringify(without));
  console.log('  byte-identical 3D p_sale keys:', JSON.stringify(without.pSaleKeys)===JSON.stringify(EXPECT3D), '| no edit_sale:', !without.editSaleCalled);
  console.log('WITH:', JSON.stringify(withExtras));
  console.log('  create p_sale keys unchanged:', JSON.stringify(withExtras.createKeys)===JSON.stringify(EXPECT3D));
  const real = errs.filter(e=>!/401|Failed to load resource|404|net::ERR/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
