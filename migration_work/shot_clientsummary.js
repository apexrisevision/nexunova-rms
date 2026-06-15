/** Client Recovery Summary report verify (live ZZTEST). Opens the new portfolio
 *  grand-summary report: one row per sale + an ALL-CLIENTS grand-total row.
 *  Probes the columns + totals, screenshots 1366 light + dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4799; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'clientsummary_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1440,1100']});
  const page=await browser.newPage(); await page.setViewport({width:1366,height:900});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  await page.evaluate(()=>{ nav('reports'); }); await sleep(1200);
  await page.evaluate(()=>openRptViewer('client_summary')); await sleep(1600);
  try { await page.waitForFunction(()=>/ALL UNITS/.test(document.querySelector('#nxr-body')?.textContent||''), { timeout:12000 }); } catch(e){ console.log('wait timeout'); }
  await sleep(700);

  const probe = await page.evaluate(()=>{
    const body = document.querySelector('#nxr-body');
    const t = body?.textContent||'';
    const tbodyRows = body?.querySelectorAll('table tbody tr')?.length||0;
    const footCells = [...(body?.querySelectorAll('table tfoot tr td')||[])].map(td=>td.textContent.trim());
    const heads = [...(body?.querySelectorAll('table thead th')||[])].map(th=>th.textContent.trim());
    const dataCells = [...(body?.querySelectorAll('table tbody tr')||[])].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent.trim()));
    return { hasTotal:/ALL UNITS/.test(t), arrears:/Arrears/.test(t), netDue:/Net Due Now/.test(t), adv:/Less Advance/.test(t),
             heads, dataRows:tbodyRows, dataCells, footCells };
  });
  console.log('PROBE', JSON.stringify(probe));

  for (const theme of ['dark','light']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(400);
    await page.mouse.move(0,0); await sleep(60);
    await page.screenshot({path:path.join(OUT,`clientsummary_${theme}.png`), fullPage:true});
    console.log('  shot', theme);
  }
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
