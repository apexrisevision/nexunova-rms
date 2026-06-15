/** PROJECT-SCOPE verification on ZZTEST (2 projects: Tower=21, Garden=5).
 *  Logs in as ZZTEST, asserts the topbar selector renders, and that the global
 *  project lens (gunits / setActiveProject) filters counts correctly:
 *    All Projects = 26 · Tower = 21 · Garden = 5
 *  Then screenshots the Inventory page under each lens. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4719; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'projscope_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,180));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // discover project ids from the real cache
  const projs = await page.evaluate(()=> (window._projectsCache||[]).map(p=>({id:p.id,name:p.projectName||p.name})));
  const tower = projs.find(p=>/Tower/i.test(p.name));
  const garden= projs.find(p=>/Garden/i.test(p.name));

  // selector presence
  const selVisible = await page.evaluate(()=>{const h=document.getElementById('nx-tb-proj');return !!h && h.style.display!=='none' && h.innerHTML.indexOf('nx-proj-btn')>=0;});
  const menuItems  = await page.evaluate(()=>Array.prototype.map.call(document.querySelectorAll('#nx-proj-menu .nx-menu-item'),e=>e.textContent.trim()));

  // count gunits() under each lens
  async function countUnder(id){ return await page.evaluate((pid)=>{ setActiveProject(pid); return (typeof gunits==='function'?gunits():[]).length; }, id); }
  const cAll    = await countUnder(null);
  const cTower  = await countUnder(tower ? tower.id : null);
  const cGarden = await countUnder(garden ? garden.id : null);

  // screenshots: Inventory under each lens
  async function shoot(id,label){ await page.evaluate((pid)=>{setActiveProject(pid); if(typeof nav==='function') nav('units');},id); await sleep(2500); await page.screenshot({path:path.join(OUT,label+'.png')});
    return await page.evaluate(()=>{ // chip label + the Inventory header "N UNITS · ..." line
      const lbl=(document.querySelector('.nx-proj-lbl')||{}).textContent||'';
      const sub=Array.prototype.map.call(document.querySelectorAll('#pg-units *'),e=>e.childNodes.length===1?e.textContent.trim():'').find(t=>/\bUNITS\b/i.test(t)&&t.length<60)||'';
      return {lbl, header:sub};
    });
  }
  const sAll   = await shoot(null,'inventory_all');
  const sTower = await shoot(tower?tower.id:null,'inventory_tower');
  const sGarden= await shoot(garden?garden.id:null,'inventory_garden');

  console.log(JSON.stringify({
    projects: projs.map(p=>p.name),
    selVisible, menuItems,
    counts: { all:cAll, tower:cTower, garden:cGarden },
    rendered: { all:sAll, tower:sTower, garden:sGarden },
    PASS: (cAll===26 && cTower===21 && cGarden===5 && selVisible),
    errors: errs.slice(0,8)
  }, null, 2));

  await browser.close(); srv.close();
})().catch(e=>{console.error('HARNESS ERROR', e); process.exit(1);});
