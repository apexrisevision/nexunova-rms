const puppeteer = require('puppeteer-core');
const http=require('http'),path=require('path'),fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4721;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
const KBH={id:'7f70ba90-130e-42b5-801b-4c9bafa82975',code:'PRJ-2026-0001',name:'KHUSHAL BAGH HEIGHTS',city:'Peshawar',location:'Babu Gahri Stop'};
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:1366,height:768});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin());await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await page.evaluate((KBH)=>{
    const proj={id:KBH.id,projectCode:KBH.code,projectName:KBH.name,name:KBH.name,status:'active',city:KBH.city,location:KBH.location,constructionProgress:45};
    const units=[]; for(let i=0;i<10;i++)units.push({id:'u'+i,projectId:KBH.id,status:i<3?'Available':'Sold',isAvailable:i<3,totalPrice:1e6,basePrice:1e6,totalPaid:5e5});
    window._projectsCache=[proj];window.gprojects=()=>[proj];window.gproject=(id)=>[proj].find(p=>p.id===id);
    window._unitsCache=units;window.gunits=()=>units;
    if(window.S){S.assignedProjectIds=null;S.isProjectAdmin=true;}
    nav('projects');
  },KBH);await sleep(1500);
  const probe=await page.evaluate(()=>{
    const out={};
    const sel={ name:'.prjc-name', loc:'.prjc-loc span', view:'.prjc-view', card:'.prjcard' };
    for(const k in sel){ const el=document.querySelector(sel[k]); if(!el){out[k]='MISSING';continue;}
      const cs=getComputedStyle(el);
      out[k]={ outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor, border:cs.borderBottomStyle+' '+cs.borderBottomWidth+' '+cs.borderBottomColor, boxShadow:cs.boxShadow.slice(0,60), bg:cs.backgroundColor, textDecoration:cs.textDecorationLine };
    }
    return out;
  });
  console.log(JSON.stringify(probe,null,2));
  await browser.close();srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
