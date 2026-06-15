/** KIT WARMTH v2 verification. Login ZZTEST (real session) → shoot dashboard &
 *  reports hub on live data; then FG real-data inject → categories (all 4 tabs)
 *  + units inventory. All at 1366 & 1920, light + dark, full-page. The shots
 *  answer the owner's test: "not confusing, not boring — interesting." */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const REF = 'itqxljtfbrppntgyfush';
const TOKEN = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const PORT = 4711; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'warmth_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const PID='7f70ba90-130e-42b5-801b-4c9bafa82975';
const OCC={'ground':{total:1,avail:0},'upper ground':{total:26,avail:3},'1st floor':{total:26,avail:4},'2nd floor':{total:26,avail:3},'3rd floor':{total:26,avail:6},'4th floor':{total:26,avail:7},'5th floor':{total:26,avail:8},'6th floor':{total:26,avail:5},'7th floor':{total:26,avail:10},'8th floor':{total:26,avail:15},'9th floor':{total:26,avail:17}};
const FG = {
  proj:{ id:PID, name:'KHUSHAL BAGH HEIGHTS' },
  floors:[['f0','Ground','G',0],['f1','Upper Ground','UG',1],['f2','1st Floor','1',2],['f3','2nd Floor','2',3],['f4','3rd Floor','3',4],['f5','4th Floor','4',5],['f6','5th Floor','5',6],['f7','6th Floor','6',7],['f8','7th Floor','7',8],['f9','8th Floor','8',9],['f10','9th Floor','9',10]].map(([id,name,floorCode,sortOrder])=>({id,name,floorCode,sortOrder,isActive:true})),
  types:[{id:'t1',name:'1 Bed',typeCode:'1BED',sortOrder:1,isActive:true,defaultArea:null,defaultPrice:null,projectId:PID},{id:'t2',name:'2 Bed',typeCode:'2BED',sortOrder:2,isActive:true,defaultArea:850,defaultPrice:9500000,projectId:PID},{id:'t3',name:'3 Bed',typeCode:'3BED',sortOrder:3,isActive:true,defaultArea:null,defaultPrice:null,projectId:PID}],
  statuses:[['s1','Available','AVAILABLE',true,1],['s2','Booked','BOOKED',false,2],['s3','Sold','SOLD',false,3],['s4','Reserved','RESERVED',false,4],['s5','On Installment','INSTALLMENT',false,5],['s6','Mortgaged','MORTGAGED',false,6],['s7','Under Transfer','TRANSFER',false,7],['s8','On Hold','HOLD',false,8],['s9','Possession Given','POSSESSION',false,9],['s10','Dead / Cancelled','DEAD',false,10],['s11','Full Cash','F_C',false,11],['s12','Adjustment','ADJ',false,12],['s13','Installment','INST',true,13]].map(([id,name,statusCode,isAvailable,sortOrder])=>({id,name,statusCode,isAvailable,isActive:true,sortOrder,projectId:PID})),
  saletypes:[{id:'sty1',name:'Installment Plan',typeCode:'INST',sortOrder:1,isActive:true,projectId:PID},{id:'sty2',name:'Full Cash',typeCode:'CASH',sortOrder:2,isActive:true,projectId:PID}],
};
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  async function shoot(name){
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(250);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot', name);
  }

  // ── live ZZTEST data: dashboard + reports hub (warmth chrome) ──
  await page.evaluate(()=>nav('dashboard')); await sleep(3500); await shoot('dashboard');
  await page.evaluate(()=>nav('reports')); await sleep(1500); await shoot('reports');

  // ── FG real-data inject (read-only) — categories + units ──
  await page.evaluate((FG,OCC)=>{
    window.gfloors=()=>window._floorsCache; window.gfloor=(id)=>window._floorsCache.find(f=>f.id===id);
    window.gtype=(id)=>window._typesCache.find(t=>t.id===id); window.gstatus=(id)=>window._statusesCache.find(s=>s.id===id);
    window.gunits=()=>window._unitsCache; window.gunit=(id)=>(window._unitsCache.find(u=>u.id===id)||null);
    window.gprojects=()=>window._projectsCache; window.gproject=(id)=>window._projectsCache.find(p=>p.id===id);
    window._floorsCache=FG.floors; window._typesCache=FG.types; window._statusesCache=FG.statuses; window._saleTypesCache=FG.saletypes;
    var units=[], n=0;
    Object.entries(OCC).forEach(([fl,o])=>{ var f=FG.floors.find(x=>x.name.toLowerCase()===fl);
      for(var i=0;i<o.total;i++){ var avail=i<o.avail; n++;
        units.push({ id:'u'+n, unitNo:(f?f.floorCode:'?')+'-'+String(i+1).padStart(2,'0'), floorLabel:f?f.name:fl, floorId:f?f.id:null,
          unitTypeId:FG.types[i%3].id, type:FG.types[i%3].name, statusId:avail?'s1':'s3', status:avail?'Available':'Sold',
          isAvailable:avail, area:850+(i%3)*200, price:9500000+(i%3)*2000000 }); } });
    window._unitsCache=units;
    window._projectsCache=[{id:FG.proj.id,name:FG.proj.name,projectName:FG.proj.name}];
    if(window.S){ S.assignedProjectIds=null; S.isProjectAdmin=true; }
    window._catProject=FG.proj.id; window._unitsProject=FG.proj.id;
  }, FG, OCC); await sleep(400);

  // units inventory
  await page.evaluate(()=>nav('units')); await sleep(1600); await shoot('units');

  // categories — all 4 tabs
  await page.evaluate(()=>nav('categories')); await sleep(1500);
  for (const tab of ['floors','types','statuses','saletypes']){
    await page.evaluate(t=>_catShowTab(t),tab); await sleep(300);
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(220);
        await page.screenshot({path:path.join(OUT,`cat-${tab}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot cat', tab);
  }

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
