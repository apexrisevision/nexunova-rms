const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4731;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,p)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'login.html':u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,950']});
  const page=await b.newPage();await page.setViewport({width:1400,height:880});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate(()=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value='awami';q.value='Samsungnote123*';window._loginReadyAt=0;});
  await page.evaluate(()=>doLogin());await sleep(7000);
  await page.evaluate(()=>{var o=document.getElementById('s-onboarding');if(o)o.classList.remove('on');nav('newsale');});await sleep(3500);
  // read floor-group order + first few units in first group
  const info=await page.evaluate(()=>{
    const groups=Array.prototype.map.call(document.querySelectorAll('#ns-unit-list .nx-kpi-label'),e=>e.textContent.trim().replace(/\s+\d+$/,'')).filter(Boolean);
    const firstUnits=Array.prototype.slice.call(document.querySelectorAll('#ns-unit-list [onclick^="_nsPickUnitById"]'),0,8).map(e=>{const t=e.querySelector('div');return t?t.textContent.trim():'';});
    const stickyBtn=document.querySelector('#ns-body button')?.textContent.trim();
    return {floorGroupsTop6:groups.slice(0,6), firstUnits, stickyBtn};
  });
  console.log('FLOOR GROUP ORDER:',JSON.stringify(info.floorGroupsTop6));
  console.log('FIRST UNITS:',JSON.stringify(info.firstUnits));
  console.log('TOP STICKY BTN:',info.stickyBtn);
  await page.screenshot({path:path.join(__dirname,'newsale_step1.png')});
  // pick the first unit, confirm sticky Next enables + shows selection
  await page.evaluate(()=>{const el=document.querySelector('#ns-unit-list [onclick^="_nsPickUnitById"]');if(el)el.click();});await sleep(1200);
  const after=await page.evaluate(()=>{const btn=document.querySelector('#ns-body button');return {btnText:btn?btn.textContent.trim():'',disabled:btn?btn.disabled:null,sel:(document.querySelector('#ns-body strong')||{}).textContent||''};});
  console.log('AFTER PICK:',JSON.stringify(after));
  await page.screenshot({path:path.join(__dirname,'newsale_picked.png')});
  await b.close();srv.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
