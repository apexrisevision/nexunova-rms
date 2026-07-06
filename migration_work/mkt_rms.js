/**
 * MARKETING CAPTURE — RMS admin (login.html)  ·  reusable, committed
 * ------------------------------------------------------------------
 * Serves the REAL RMS admin app locally and injects genuinely-realistic demo
 * data at the supabase.rpc()/cache boundary (fake Pakistani names / plausible
 * PKR / recent dates). ZERO DB writes. Renders the real product UI at 1440@2x,
 * light + dark. Re-run after RMS UI changes to refresh the marketing shots.
 * Output: marketing_shots/rms-crm/  (files 13+ ; continues the CRM set)
 */
const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4291;const BASE='http://127.0.0.1:'+PORT+'/login.html';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT=path.join(ROOT,'marketing_shots','rms-crm');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{const p=decodeURIComponent(rq.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rs.writeHead(404);return rs.end();}rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(rs);}).listen(PORT,'127.0.0.1',()=>r(s));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── fictional recovery aging (name, code, unit, floor, closing, overdue_days) ──
const RROWS=[
 ['Ahmed Raza Qureshi','GH-C-0116','G-02','Ground',3550000,45],
 ['Imran Farooq','GH-C-0037','1-10','1st Floor',6100000,120],
 ['Sara Khan','GH-C-0045','4-09','4th Floor',5740000,210],
 ['Bilal Hussain','GH-C-0026','UG-13','Upper Ground',5330000,90],
 ['Fatima Noor','GH-C-0005','6-14','6th Floor',2480000,300],
 ['Usman Ghani','GH-C-0038','2-18','2nd Floor',4855000,60],
 ['Zainab Malik','GH-C-0007','3-17','3rd Floor',4640000,30],
 ['Hassan Ali Sheikh','GH-C-0044','3-18','3rd Floor',4420000,180],
 ['Ayesha Siddiqui','GH-C-0001','1-09','1st Floor',2900000,75],
 ['Kamran Shah','GH-C-0066','8-16','8th Floor',3720000,150],
].map((r,i)=>({client_name:r[0],client_code:r[1],unit_no:r[2],floor_name:r[3],closing:r[4],overdue_days:r[5],net_price:r[4],opening:r[4],due_period:0,received_total:0,received_applied:0,paid_pct:0,advance_bf:0,sale_id:'s'+i,last_payment_date:null,last_payment_amount:0}));
const RCLOSING=RROWS.reduce((s,r)=>s+r.closing,0);
const RTOTALS={due:9210458,closing:RCLOSING,opening:RCLOSING+4730802,net_price:892000000,advance_bf:1015756,recovery_pct:24.6,received_total:14275100,received_applied:13463900};
const ROFFICERS=[{officer_name:'Usman Ali',dead_recovery_total:1230000,current_recovery_total:6233900},{officer_name:'Fatima Naz',dead_recovery_total:640000,current_recovery_total:5041200},{officer_name:'All Officers',dead_recovery_total:1870000,current_recovery_total:14275100}];

// ── fictional units board ──
const UNITS=[
 ['u1','G-02','fG','Ground','t2','Shop',400,'Sold',false,7550000,'s1','Ahmed Raza Qureshi',7550000,4550000,3000000],
 ['u2','G-03','fG','Ground','t2','Shop',420,'Available',true,7800000,null,'',0,0,0],
 ['u3','1-03','f1','1st Floor','t1','Apartment',1200,'Sold',false,9500000,'s2','Sara Khan',9500000,9500000,0],
 ['u4','1-04','f1','1st Floor','t1','Apartment',1200,'Available',true,9500000,null,'',0,0,0],
 ['u5','1-05','f1','1st Floor','t1','Apartment',1250,'Sold',false,9800000,'s3','Bilal Hussain',9800000,1300000,8500000],
 ['u6','2-08','f2','2nd Floor','t1','Apartment',1300,'Available',true,10200000,null,'',0,0,0],
 ['u7','2-09','f2','2nd Floor','t1','Apartment',1300,'Sold',false,10200000,'s4','Fatima Noor',10200000,5200000,5000000],
 ['u8','2-10','f2','2nd Floor','t3','Office',900,'Available',true,8600000,null,'',0,0,0],
 ['u9','3-14','f3','3rd Floor','t1','Apartment',1350,'Sold',false,11000000,'s5','Usman Ghani',11000000,11000000,0],
 ['u10','3-15','f3','3rd Floor','t1','Apartment',1350,'Available',true,11000000,null,'',0,0,0],
 ['u11','4-18','f4','4th Floor','t1','Apartment',1400,'Sold',false,12500000,'s6','Kamran Shah',12500000,3500000,9000000],
 ['u12','4-19','f4','4th Floor','t1','Apartment',1400,'Available',true,12500000,null,'',0,0,0],
].map(r=>({id:r[0],unitNo:r[1],floorId:r[2],floorLabel:r[3],unitTypeId:r[4],type:r[5],area:r[6],areaUnit:'sqft',status:r[7],isAvailable:r[8],basePrice:r[9],saleId:r[10],customerName:r[11],totalPrice:r[12],totalPaid:r[13],pendingAmount:r[14]}));

// combined rpc stub (covers dashboard + recovery report + receipt)
function rpcStub(){
  return `(async function(){
    window.__cap=null; window.NXPrint={emit:function(html){window.__cap=html;}};
    supabase.rpc=async function(name,args){
      if(name==='get_recovery_position') return {data:{totals:${JSON.stringify(RTOTALS)},rows:${JSON.stringify(RROWS)},officer_summary:${JSON.stringify(ROFFICERS)},period:{from:(args&&args.p_from_date)||'2026-07-01',to:(args&&args.p_to_date)||'2026-07-06'}},error:null};
      if(name==='get_dashboard_receivable') return {data:{net_active:892000000,paid_active:471000000,receivable:421000000},error:null};
      if(name==='get_pdc_register') return {data:{success:true,rows:[{amount:1250000,status:'pending',cheque_date:'2026-07-15'},{amount:800000,status:'deposited',cheque_date:'2026-07-08'},{amount:1500000,status:'pending',cheque_date:'2026-07-22'}]},error:null};
      if(name==='get_pending_approvals') return {data:[],error:null};
      if(name==='get_payment_full') return {data:{id:'demo',amount:850000,payment_code:'PRV-2026-00042',payment_date:'2026-07-02',payment_method:'Bank Transfer',reference_no:'HBL-88123',notes:'2nd installment — Unit G-02',sale_id:'s1'},error:null};
      if(name==='get_sale_for_lookup') return {data:{unit_id:'u1'},error:null};
      return {data:null,error:null};
    };
  })();`;
}
function unlock(role){
  return `(function(){
    S={cid:'demo-cid',userId:'u1',role:'${role}',name:'Rashid Manzoor',username:'rashid',coName:'Fourteen Group of Companies',coCode:'14',permissions:{},assignedProjectIds:null,isProjectAdmin:true,hasFinanceUser:true,subStatus:'active',sessionVersion:1};
    window.hasProjectAccess=function(){return true;};window.hasFin=function(){return true;};
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    try{if(typeof stopLoginAnimations==='function')stopLoginAnimations();}catch(e){}
    try{if(typeof buildSB==='function')buildSB();}catch(e){}
    // units caches
    window._floorsCache=[{id:'fG',name:'Ground',sortOrder:0,isActive:true},{id:'fUG',name:'Upper Ground',sortOrder:1,isActive:true},{id:'f1',name:'1st Floor',sortOrder:2,isActive:true},{id:'f2',name:'2nd Floor',sortOrder:3,isActive:true},{id:'f3',name:'3rd Floor',sortOrder:4,isActive:true},{id:'f4',name:'4th Floor',sortOrder:5,isActive:true}];
    window._typesCache=[{id:'t1',name:'Apartment',isActive:true},{id:'t2',name:'Shop',isActive:true},{id:'t3',name:'Office',isActive:true}];
    window._statusesCache=[{id:'sAvail',name:'Available',isAvailable:true,isActive:true,color:'#16A34A'},{id:'sSold',name:'Sold',isAvailable:false,isActive:true,color:'#2563EB'}];
    window._projectsCache=[{id:'p1',name:'Sapphire Heights'}];
    window._unitsCache=${JSON.stringify(UNITS)};
    window.loadUnitsCache=async()=>true;window.loadFloorsCache=async()=>true;window.loadProjectsCache=async()=>true;window.logA=()=>{};
  })();`;
}
async function theme(page,t){await page.evaluate(x=>document.documentElement.setAttribute('data-theme',x),t);await sleep(300);}
async function shot(page,name,opt={}){await page.screenshot(Object.assign({path:path.join(OUT,name+'.png')},opt));console.log('  ✎',name+'.png');}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1000']});
  const page=await browser.newPage();
  const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,160)));
  await page.setViewport({width:1440,height:960,deviceScaleFactor:2});
  await page.goto(BASE,{waitUntil:'networkidle2'});await sleep(600);
  await page.evaluate(rpcStub());
  await page.evaluate(unlock('admin'));
  await sleep(300);

  // 6) Dashboard L+D
  for(const th of ['light','dark']){
    await theme(page,th);
    await page.evaluate(()=>{try{document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));const d=document.getElementById('pg-dashboard');if(d)d.classList.add('on');rDash();}catch(e){console.error('rDash',e.message)}});
    await sleep(1100);
    await shot(page,'13_admin_dashboard_'+th,{fullPage:true});
  }

  // 7) Recovery position — aging report (light)
  await theme(page,'light');
  await page.evaluate(async()=>{try{document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));const rp=document.getElementById('pg-reports');if(rp)rp.classList.add('on');openRptViewer('recovery_position');}catch(e){console.error('rpt',e.message)}});
  await sleep(2200);
  await shot(page,'14_recovery_aging_light',{fullPage:true});

  // 8) Units board L+D
  for(const th of ['light','dark']){
    await theme(page,th);
    await page.evaluate(()=>{try{document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));const u=document.getElementById('pg-units');if(u)u.classList.add('on');rUnits();}catch(e){console.error('rUnits',e.message)}});
    await sleep(1000);
    await shot(page,'15_units_board_'+th,{fullPage:true});
  }

  // 9) Branded payment receipt (client-facing PRV) — capture print HTML, render A5
  const cap=await page.evaluate(async()=>{try{await _printReceiptSupa('demo');}catch(e){console.error('rcpt',e.message);}return window.__cap;});
  if(cap){
    const rp=await browser.newPage();
    await rp.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
    await rp.setViewport({width:640,height:900,deviceScaleFactor:2});
    await rp.setContent(cap,{waitUntil:'networkidle0'});
    await rp.addStyleTag({content:'html,body{background:#ffffff!important;}'});
    await rp.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
    await sleep(400);
    await rp.screenshot({path:path.join(OUT,'16_payment_receipt_light.png'),fullPage:true});
    console.log('  ✎ 16_payment_receipt_light.png (branded — refresh after Phase 1b)');
    await rp.close();
  } else { console.log('  ⚠ receipt capture returned empty — FLAG for Rashid'); }

  fs.writeFileSync(path.join(OUT,'_rms_report.json'),JSON.stringify({errors:errs.slice(0,12),receiptCaptured:!!cap},null,1));
  console.log('\nERRORS:',JSON.stringify(errs.filter(e=>!/401|Failed to load resource/.test(e)).slice(0,8)));
  await browser.close();srv.close();
  console.log('\nRMS admin marketing shots →',OUT);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
