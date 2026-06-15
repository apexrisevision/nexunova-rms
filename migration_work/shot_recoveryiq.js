/** Recovery Intelligence page verify (live ZZTEST). Navigates to the new page,
 *  probes the sections, screenshots full page 1440 light + dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4801; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'recoveryiq_shots');
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

  await page.evaluate(()=>nav('recoveryiq')); await sleep(900);
  try { await page.waitForFunction(()=>/Recovery health|Could not load/.test(document.querySelector('#riq-body')?.textContent||''), { timeout:15000 }); } catch(e){ console.log('wait timeout'); }
  await sleep(900);

  const probe = await page.evaluate(()=>{
    const t = document.querySelector('#riq-body')?.textContent||'';
    return { funnel:/recovery funnel/.test(t), floor:/Risk by floor/.test(t), dso:/Avg overdue age/.test(t),
             flow:/Book (rotting|healing)/.test(t), actionMap:/THE ACTION MAP/.test(t),
             momentum:/Momentum/.test(t), topDef:/Chase these first/.test(t), exposure:/% of price/.test(t),
             watch:/SMART WATCHLISTS/.test(t), err:/Could not load/.test(t),
             cards: document.querySelectorAll('#riq-body .nx-card').length };
  });
  console.log('PROBE', JSON.stringify(probe));
  const links = await page.evaluate(()=>{
    const q=s=>document.querySelectorAll(s).length;
    return { dead:q('[onclick*="_riqDrill(\'dead\')"]'), seg:q('[onclick*="_riqDrill(\'seg:"]'), age:q('[onclick*="_riqDrill(\'age:"]'),
             floor:q('[onclick*="_riqDrill(\'floor:"]'), funnel:q('[onclick*="_riqDrill(\'collected\')"],[onclick*="_riqDrill(\'future\')"]'),
             momentum:q('[onclick*="_riqDrill(\'mbilled\')"],[onclick*="_riqDrill(\'mcollected\')"]'),
             concentration:q('[onclick*="_riqDrill(\'concentration\')"]'), client:q('[onclick*="_riqDrill(\'client:"]'),
             chaseRows:q('#riq-body tbody tr[onclick*="_riqOpenUnit"]') };
  });
  console.log('LINKS', JSON.stringify(links));

  for (const theme of ['dark','light']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(400);
    await page.mouse.move(0,0); await sleep(60);
    await page.screenshot({path:path.join(OUT,`riq_${theme}.png`), fullPage:true});
    console.log('  shot', theme);
  }

  // ── DRILL test: click a figure → modal trail, verify it ties ──
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light')); await sleep(200);
  const drill = await page.evaluate(()=>{
    // pick any drill-enabled figure (prefer a segment with units)
    const el = document.querySelector('#riq-body [onclick*="_riqDrill(\'overdue\')"]') || document.querySelector('#riq-body [onclick^="_riqDrill"]');
    if(!el){ // fall back: call directly
      if(window._riqStore) _riqDrill('overdue');
    } else el.click();
    return !!document.querySelector('.nx-modal-overlay');
  });
  await sleep(500);
  const modal = await page.evaluate(()=>{
    const m=document.querySelector('.nx-modal-overlay'); if(!m) return {open:false};
    const t=m.textContent||'';
    return { open:true, title:(m.querySelector('.nx-modal-title')?.textContent||'').slice(0,60),
             rows:m.querySelectorAll('tbody tr').length, hasTotal:/Σ /.test(t),
             footer:(m.querySelector('.nx-modal-footer')?.textContent||'').replace(/\s+/g,' ').slice(0,90) };
  });
  console.log('DRILL', JSON.stringify(modal));
  if(modal.open){ await page.screenshot({path:path.join(OUT,'riq_drill.png')}); console.log('  drill shot'); await page.evaluate(()=>_riqDrillClose()); await sleep(300); }

  // ── TREND drill test: click momentum run-rate → month-by-month modal ──
  const trendDrill = await page.evaluate(()=>{ const el=document.querySelector('#riq-body [onclick*="_riqDrill(\'trend\')"]'); if(el) el.click(); return !!document.querySelector('.nx-modal-overlay'); });
  await sleep(400);
  const tmodal = await page.evaluate(()=>{ const m=document.querySelector('.nx-modal-overlay'); if(!m) return {open:false}; return { open:true, title:(m.querySelector('.nx-modal-title')?.textContent||'').slice(0,50), rows:m.querySelectorAll('tbody tr').length, footer:(m.querySelector('.nx-modal-footer')?.textContent||'').replace(/\s+/g,' ').slice(0,80) }; });
  console.log('TREND_DRILL', JSON.stringify(tmodal));
  if(tmodal.open){ await page.screenshot({path:path.join(OUT,'riq_trend.png')}); console.log('  trend shot'); await page.evaluate(()=>_riqDrillClose()); await sleep(200); }

  // ── PRINT test: capture the emitted document, render & screenshot it ──
  const printHtml = await page.evaluate(()=>{ let cap=null; const orig=window.NXPrint&&window.NXPrint.emit; if(window.NXPrint) window.NXPrint.emit=(h)=>{cap=h;}; try{ _riqPrint(); }catch(e){ return 'ERR:'+e.message; } if(window.NXPrint&&orig) window.NXPrint.emit=orig; return cap; });
  if(printHtml && printHtml.indexOf('ERR:')!==0){
    console.log('PRINT ok · bytes', printHtml.length, '· sections', ['recovery funnel','aging','action map','Momentum','Risk by floor','Chase these first','watchlists'].filter(s=>printHtml.toLowerCase().includes(s.toLowerCase())).length);
    const rp=await browser.newPage(); await rp.setViewport({width:820,height:1160,deviceScaleFactor:1.4});
    await rp.setContent(printHtml,{waitUntil:'domcontentloaded'}); await sleep(500);
    await rp.screenshot({path:path.join(OUT,'riq_print.png'), fullPage:true}); console.log('  print shot');
  } else { console.log('PRINT FAIL', printHtml); }
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
