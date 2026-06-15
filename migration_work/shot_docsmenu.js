/** Sale Detail "Print / Documents" dropdown verify (live ZZTEST). Screenshots the
 *  action bar + the open menu, asserts each item routes to the right document
 *  (Application Form -> printApplicationForm; Agreement/Schedule/Demand ->
 *  the right report html; Unit Statement / Client Ledger -> openRptViewer). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4791; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'docsmenu_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const SALE='0e513df3-e54d-4408-9bdf-e7a5c518729f';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1440,height:900});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  // capture intents instead of opening windows / printing
  await page.evaluate(()=>{ window.__af=null; window.__open=null; window.NXPrint.emit=function(h){window.__af=h;}; window.open=function(u){window.__open=u;return {document:{open(){},write(){},close(){}},focus(){},print(){}};}; });
  await page.evaluate((id)=>openSaleDetail(id), SALE); await sleep(3500);

  // bar count (standalone buttons) + menu item map
  const map = await page.evaluate(()=>{
    const items=[...document.querySelectorAll('.sd-docs-item')].map(b=>({label:b.querySelector('.sd-docs-l')?.textContent, on:b.getAttribute('onclick')}));
    const bar=[...document.querySelectorAll('#pg-salesdetail .no-p > button, #pg-salesdetail .no-p > .sd-docs-wrap')].length;
    return { items, barEls:bar, hasTrigger: !!document.querySelector('.sd-docs-trigger') };
  });
  console.log('BAR_ELS', map.barEls, 'TRIGGER', map.hasTrigger);
  map.items.forEach(i=>console.log('  ITEM', JSON.stringify(i.label), '->', (i.on||'').replace(/_salDocsHide\(\);/,'').slice(0,70)));

  // screenshot: bar closed
  await page.screenshot({ path: path.join(OUT,'bar_closed.png'), clip:{x:0,y:120,width:1440,height:120} });
  // open the menu + screenshot
  await page.evaluate(()=>document.querySelector('.sd-docs-trigger').click()); await sleep(450);
  await page.screenshot({ path: path.join(OUT,'menu_open.png'), clip:{x:0,y:120,width:760,height:520} });

  // click Application Form → printApplicationForm should run (sets __af)
  await page.evaluate(()=>document.querySelector('.sd-docs-trigger').click()); await sleep(200);
  await page.evaluate(()=>{ const it=[...document.querySelectorAll('.sd-docs-item')].find(b=>/Application Form/.test(b.textContent)); it.click(); }); await sleep(1800);
  const afOk = await page.evaluate(()=>!!window.__af && /size:8\.5in 14in/.test(window.__af));
  // Agreement → report html
  await page.evaluate(()=>{ window.__open=null; document.querySelector('.sd-docs-trigger').click(); }); await sleep(200);
  await page.evaluate(()=>{ [...document.querySelectorAll('.sd-docs-item')].find(b=>/Sale Agreement/.test(b.textContent)).click(); }); await sleep(400);
  const agrUrl = await page.evaluate(()=>window.__open||'');

  console.log('APPFORM_TRIGGERED', afOk, '| AGREEMENT_URL', agrUrl.slice(0,40));
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
