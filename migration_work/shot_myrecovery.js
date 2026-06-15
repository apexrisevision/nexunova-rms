/** My Recovery (officer report) verify — live ZZTEST as owner (is_full → all rows).
 *  Navigates, probes sections, tests KPI drill + filter + print, shots light/dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4806; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'myrecovery_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  await page.evaluate(()=>nav('myrecovery')); await sleep(900);
  try { await page.waitForFunction(()=>/Your brief|No accounts|Could not load/.test(document.querySelector('#or-body')?.textContent||''), { timeout:15000 }); } catch(e){ console.log('wait timeout'); }
  await sleep(800);

  const probe = await page.evaluate(()=>{
    const t=document.querySelector('#or-body')?.textContent||'';
    return { brief:/Your brief/.test(t), thisMonth:/To recover this month/.test(t), recovered:/Recovered so far/.test(t),
             still:/Still to recover/.test(t), old:/Old baqaya/.test(t), progress:/Progress this month/.test(t),
             whoToCall:/Who to call/.test(t), empty:/No accounts/.test(t), err:/Could not load/.test(t),
             kpis:document.querySelectorAll('#or-body [onclick^="_orDrill"]').length,
             tableRows:document.querySelectorAll('#or-table tbody tr').length,
             filters:document.querySelectorAll('#or-filterbar button').length,
             actions:document.querySelectorAll('#or-table a[href^="tel:"], #or-table a[href^="https://wa.me"], #or-table button[onclick*="openConModal"]').length };
  });
  console.log('PROBE', JSON.stringify(probe));
  const store = await page.evaluate(()=>{ const s=window._orStore; if(!s) return null; return { rows:s.rows.length, target:Math.round(s.T.target), recovered:Math.round(s.T.recovered), remaining:Math.round(s.T.remaining), old:Math.round(s.T.oldArrears), scoped:s.scoped }; });
  console.log('STORE', JSON.stringify(store));

  for (const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(400);
    await page.mouse.move(0,0); await sleep(60);
    await page.screenshot({path:path.join(OUT,`mr_${theme}.png`), fullPage:true});
    console.log('  shot', theme);
  }
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light')); await sleep(200);

  // KPI drill
  const drill = await page.evaluate(()=>{ const el=document.querySelector('#or-body [onclick*="_orDrill(\'remaining\')"]')||document.querySelector('#or-body [onclick^="_orDrill"]'); if(el) el.click(); else if(window._orStore) _orDrill('remaining'); const m=document.querySelector('.nx-modal-overlay'); return m?{open:true,title:(m.querySelector('.nx-modal-title')?.textContent||'').slice(0,50),rows:m.querySelectorAll('tbody tr').length,footer:(m.querySelector('.nx-modal-footer')?.textContent||'').replace(/\s+/g,' ').slice(0,80)}:{open:false}; });
  console.log('DRILL', JSON.stringify(drill));
  if(drill.open){ await page.screenshot({path:path.join(OUT,'mr_drill.png')}); await page.evaluate(()=>_orDrillClose()); await sleep(300); }

  // filter toggle
  const filt = await page.evaluate(()=>{ _orSetFilter('overdue'); const a=document.querySelectorAll('#or-table tbody tr').length; _orSetFilter('likely'); const b=document.querySelectorAll('#or-table tbody tr').length; _orSetFilter('owe'); const c=document.querySelectorAll('#or-table tbody tr').length; return {overdue:a,likely:b,owe:c}; });
  console.log('FILTER', JSON.stringify(filt));

  // print capture
  const printHtml = await page.evaluate(()=>{ let cap=null; const orig=window.NXPrint&&window.NXPrint.emit; if(window.NXPrint) window.NXPrint.emit=(h)=>{cap=h;}; try{ _orPrint(); }catch(e){ return 'ERR:'+e.message; } if(window.NXPrint&&orig) window.NXPrint.emit=orig; return cap; });
  if(printHtml && printHtml.indexOf('ERR:')!==0){
    console.log('PRINT ok · bytes', printHtml.length);
    const rp=await browser.newPage(); await rp.setViewport({width:820,height:1160,deviceScaleFactor:1.4});
    await rp.setContent(printHtml,{waitUntil:'domcontentloaded'}); await sleep(400);
    await rp.screenshot({path:path.join(OUT,'mr_print.png'), fullPage:true}); console.log('  print shot');
  } else { console.log('PRINT FAIL', printHtml); }

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
