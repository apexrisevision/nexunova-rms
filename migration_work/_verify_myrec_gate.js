/** Verify the myrecovery nav-gate passes for a RECOVERY role (the bounce bug). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4807; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // BEFORE state + simulate a recovery officer (client-side role flip + explicit recovery perm)
  const sim = await page.evaluate(()=>{
    S.role='recovery'; S.permissions={recovery:true, contacts:true, units:true, clients:true};
    const hp = (typeof hasPermission==='function');
    return { hasFn:hp, permMyrec: hp?hasPermission('myrecovery'):null, permQueue: hp?hasPermission('queue'):null, effRole:(typeof effectiveRole==='function'?effectiveRole():'?') };
  });
  console.log('PERM', JSON.stringify(sim));
  await page.evaluate(()=>nav('myrecovery')); await sleep(1400);
  const after = await page.evaluate(()=>{ return { active: document.querySelector('.pg.on')?.id||'(none)', bodyHas:/Your brief|No accounts|My Recovery/.test(document.getElementById('pg-myrecovery')?.textContent||'') }; });
  console.log('AFTER_NAV', JSON.stringify(after));
  console.log('RESULT', after.active==='pg-myrecovery' ? 'PASS — no bounce' : 'FAIL — bounced to '+after.active);
  console.log('ERRS', errs.length, errs.slice(0,4).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
