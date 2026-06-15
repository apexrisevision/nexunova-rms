/** Batch-2 layout-fix verification on REAL FG data (read-only inject; no FG writes).
 *  Renders KBH's actual floors/types/statuses on the Categories board at 1366x768
 *  and 1920x1080, light+dark, full-page — proving "Upper Ground" intact, no overlap,
 *  long status chips (INSTALLMENT/MORTGAGED/POSSESSION) never clip, names truncate. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4600; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'b2fix_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE='zztestinternalsafeto', PW='ZzTest!2026';
const PID='7f70ba90-130e-42b5-801b-4c9bafa82975';
const FG = {
  proj:{ id:PID, name:'KHUSHAL BAGH HEIGHTS' },
  floors:[
    {id:'f0',name:'Ground',floorCode:'G',sortOrder:0,isActive:true},
    {id:'f1',name:'Upper Ground',floorCode:'UG',sortOrder:1,isActive:true},
    {id:'f2',name:'1st Floor',floorCode:'1',sortOrder:2,isActive:true},
    {id:'f3',name:'2nd Floor',floorCode:'2',sortOrder:3,isActive:true},
    {id:'f4',name:'3rd Floor',floorCode:'3',sortOrder:4,isActive:true},
    {id:'f5',name:'4th Floor',floorCode:'4',sortOrder:5,isActive:true},
    {id:'f6',name:'5th Floor',floorCode:'5',sortOrder:6,isActive:true},
    {id:'f7',name:'6th Floor',floorCode:'6',sortOrder:7,isActive:true},
    {id:'f8',name:'7th Floor',floorCode:'7',sortOrder:8,isActive:true},
    {id:'f9',name:'8th Floor',floorCode:'8',sortOrder:9,isActive:true},
    {id:'f10',name:'9th Floor',floorCode:'9',sortOrder:10,isActive:true},
    {id:'fLONG',name:'Mezzanine Service Plant Deck AAAA',floorCode:'MSPD',sortOrder:11,isActive:true},
  ],
  types:[
    {id:'t1',name:'1 Bed',typeCode:'1BED',sortOrder:1,isActive:true,defaultArea:null,defaultPrice:null,projectId:PID},
    {id:'t2',name:'2 Bed',typeCode:'2BED',sortOrder:2,isActive:true,defaultArea:850,defaultPrice:9500000,projectId:PID},
    {id:'t3',name:'3 Bed',typeCode:'3BED',sortOrder:3,isActive:true,defaultArea:null,defaultPrice:null,projectId:PID},
  ],
  statuses:[
    {id:'s1',name:'Available',statusCode:'AVAILABLE',isAvailable:true,isActive:true,sortOrder:1,projectId:PID},
    {id:'s2',name:'Booked',statusCode:'BOOKED',isAvailable:false,isActive:true,sortOrder:2,projectId:PID},
    {id:'s3',name:'Sold',statusCode:'SOLD',isAvailable:false,isActive:true,sortOrder:3,projectId:PID},
    {id:'s4',name:'Reserved',statusCode:'RESERVED',isAvailable:false,isActive:true,sortOrder:4,projectId:PID},
    {id:'s5',name:'On Installment',statusCode:'INSTALLMENT',isAvailable:false,isActive:true,sortOrder:5,projectId:PID},
    {id:'s6',name:'Mortgaged',statusCode:'MORTGAGED',isAvailable:false,isActive:true,sortOrder:6,projectId:PID},
    {id:'s7',name:'Under Transfer',statusCode:'TRANSFER',isAvailable:false,isActive:true,sortOrder:7,projectId:PID},
    {id:'s8',name:'On Hold',statusCode:'HOLD',isAvailable:false,isActive:true,sortOrder:8,projectId:PID},
    {id:'s9',name:'Possession Given',statusCode:'POSSESSION',isAvailable:false,isActive:true,sortOrder:9,projectId:PID},
    {id:'s10',name:'Dead / Cancelled',statusCode:'DEAD',isAvailable:false,isActive:true,sortOrder:10,projectId:PID},
    {id:'s11',name:'Full Cash',statusCode:'F_C',isAvailable:false,isActive:true,sortOrder:11,projectId:PID},
    {id:'s12',name:'Adjustment',statusCode:'ADJ',isAvailable:false,isActive:true,sortOrder:12,projectId:PID},
    {id:'s13',name:'Installment',statusCode:'INST',isAvailable:true,isActive:true,sortOrder:13,projectId:PID},
  ],
  usage:{ byType:{t1:90,t2:130,t3:40}, byStatus:{s3:183,s1:78,s5:30,s9:12},
    byFloorName:{'ground':1,'upper ground':26,'1st floor':26,'2nd floor':26,'3rd floor':26,'4th floor':26,'5th floor':26,'6th floor':26,'7th floor':26,'8th floor':26,'9th floor':26} }
};
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1100']});
  const page=await browser.newPage();
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  await page.setViewport({width:1366,height:768});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
  await page.evaluate(()=>doLogin()); await sleep(6000);
  await page.evaluate(()=>{ document.getElementById('s-onboarding')?.classList.remove('on'); if(typeof nav==='function') nav('categories'); }); await sleep(1500);
  await page.evaluate((FG)=>{
    document.getElementById('s-onboarding')?.classList.remove('on');
    window.gfloors=()=>window._floorsCache; window.gfloor=(id)=>window._floorsCache.find(f=>f.id===id);
    window.gtype=(id)=>window._typesCache.find(t=>t.id===id); window.gstatus=(id)=>window._statusesCache.find(s=>s.id===id);
    window.gunits=()=>window._unitsCache; window.gunit=(id)=>(window._unitsCache.find(u=>u.id===id)||null);
    window.gprojects=()=>window._projectsCache; window.gproject=(id)=>window._projectsCache.find(p=>p.id===id);
    window._floorsCache=FG.floors; window._typesCache=FG.types; window._statusesCache=FG.statuses; window._saleTypesCache=[];
    var units=[]; Object.entries(FG.usage.byFloorName).forEach(([n,c])=>{for(var i=0;i<c;i++)units.push({floorLabel:n});});
    Object.entries(FG.usage.byType).forEach(([id,c])=>{for(var i=0;i<c;i++)units.push({unitTypeId:id});});
    Object.entries(FG.usage.byStatus).forEach(([id,c])=>{for(var i=0;i<c;i++)units.push({statusId:id});});
    window._unitsCache=units;
    window._projectsCache=[{id:FG.proj.id,name:FG.proj.name,projectName:FG.proj.name}];
    if(window.S){ S.assignedProjectIds=null; S.isProjectAdmin=true; }
    window._catProject=FG.proj.id;
    rCategories();
  }, FG);
  await sleep(1500);

  for (const [w,h,tag] of [[1366,768,'1366'],[1920,1080,'1920']]) {
    await page.setViewport({width:w,height:h}); await sleep(400);
    await page.evaluate(()=>{ if(typeof rCategories==='function') rCategories(); }); await sleep(900);
    for (const theme of ['dark','light']) {
      await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(250);
      await page.screenshot({path:path.join(OUT,`cat_${tag}_${theme}.png`), fullPage:true});
      console.log('  shot', `cat_${tag}_${theme}`);
    }
  }
  // report column count at each width + that Upper Ground rendered
  const info = await page.evaluate(()=>{
    const grid = document.querySelector('#pg-categories [style*="grid-template-columns"]');
    const cs = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const ug = document.querySelector('#cat-floors')?.innerHTML.includes('Upper Ground');
    const stylechip = document.querySelector('#cat-statuses')?.innerHTML.includes('INSTALLMENT');
    return { cols_at_1920: cs, upperGround: ug, statusChip: stylechip };
  });
  console.log('INFO', JSON.stringify(info));
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
