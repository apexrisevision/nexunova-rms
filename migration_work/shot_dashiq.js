/** Dashboard Recovery Intelligence band verify (live ZZTEST, admin). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4802; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'dashiq_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1300']});
  const page=await browser.newPage(); await page.setViewport({width:1440,height:1050});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await page.evaluate(()=>nav('dashboard')); await sleep(4500);
  const probe = await page.evaluate(()=>{
    const t=document.querySelector('#pg-dashboard')?.textContent||'';
    return { hasBand:/Recovery Intelligence/.test(t), hasOpen:/Open full intelligence/.test(t), hasChase:/Chase first/.test(t), heroOk:/Total receivable/.test(t) };
  });
  console.log('PROBE', JSON.stringify(probe));
  for (const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(400);
    await page.mouse.move(0,0); await sleep(60);
    await page.screenshot({path:path.join(OUT,`dashiq_${theme}.png`), fullPage:true});
    console.log('  shot', theme);
  }
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
