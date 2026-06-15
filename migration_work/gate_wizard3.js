/** MAIN GATE AUDIT — robust wizard driver (polls for each step before acting). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4324; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'gate_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE = 'zztest2gateaudit', PASS = 'ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(page,n){await page.screenshot({path:path.join(OUT,n)});console.log('  shot',n);}
async function waitFor(page, sel, t=12000){ const end=Date.now()+t; while(Date.now()<end){ if(await page.evaluate(s=>!!document.querySelector(s)&&document.querySelector(s).offsetParent!==null, sel)) return true; await sleep(250);} return false; }
async function clickOnclick(page,sub){return page.evaluate((sub)=>{const el=[...document.querySelectorAll('[onclick]')].find(e=>(e.getAttribute('onclick')||'').includes(sub)&&e.offsetParent!==null);if(el){el.click();return true;}return false;},sub);}
async function step(page){ return page.evaluate(()=>{ if(document.getElementById('ob-pname'))return 1; if(document.getElementById('ob-fl-n'))return 2; if(document.querySelector('.ob-ty'))return 3; if(document.getElementById('ob-per'))return 4; if([...document.querySelectorAll('[onclick]')].some(e=>(e.getAttribute('onclick')||'').includes('_finish')))return 5; return 0; }); }

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1440,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1320,height:920});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(1000);
  await page.evaluate((code,pass)=>{const u=document.getElementById('li-u'),p=document.getElementById('li-p');u.removeAttribute('readonly');p.removeAttribute('readonly');u.value=code;p.value=pass;window._loginReadyAt=0;},CODE,PASS);
  await page.evaluate(()=>doLogin()); await sleep(5500);
  // ensure wizard visible (reset any stale localStorage step so it starts at project)
  await page.evaluate(()=>{ try{ Object.keys(localStorage).filter(k=>k.startsWith('rms.wizard.')).forEach(k=>localStorage.removeItem(k)); }catch(e){} if(window.OB) OB.show(window.S&&S.cid); });
  await sleep(1500);

  let guard=0;
  while(guard++ < 12){
    const s=await step(page);
    console.log('AT_STEP',s);
    if(s===1){ await clickOnclick(page,'_saveProject'); await waitFor(page,'#ob-fl-n'); await sleep(500); }
    else if(s===2){ await shot(page,'W_floors.png'); await clickOnclick(page,'_genFloors'); await waitFor(page,'.ob-ty'); await sleep(800); }
    else if(s===3){ await shot(page,'W_types.png'); await clickOnclick(page,'_saveTypes'); await waitFor(page,'#ob-per'); await sleep(800); }
    else if(s===4){ await page.evaluate(()=>{const e=document.getElementById('ob-per');if(e){e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));}}); await clickOnclick(page,'_preview'); await sleep(1200); await shot(page,'W_units.png'); await clickOnclick(page,'_genUnits'); await sleep(1000); const ok=await waitFor(page,"[onclick*='_finish']",15000); await sleep(800); console.log('UNITS_GEN_REACHED_DONE',ok); }
    else if(s===5){ await shot(page,'W_done.png'); console.log('DONE_ERR',JSON.stringify(await page.evaluate(()=>(document.getElementById('ob-err')||{}).textContent||''))); break; }
    else { console.log('UNKNOWN_STEP — err:',await page.evaluate(()=>(document.getElementById('ob-err')||{}).textContent||'')); break; }
  }
  console.log('CONSOLE_ERRS',errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
