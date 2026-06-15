/** Subah ki List (Smart Recovery Queue) verification — live ZZTEST.
 *  Screenshots the warm queue (Tier A/B call list + collapsed Escalate),
 *  the expanded Escalate section, 1366+1920 light+dark, console errors captured.
 *  Also a functional role-gate re-probe: Legal hidden from recovery only;
 *  admin+manager keep it; all three reach the queue. Seed is in the DB (MCP). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4769; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'queue_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,200)));
  page.on('dialog',async d=>{try{await d.dismiss();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  async function shoot(name, prep){
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(200);
        if (prep) await prep();
        await page.mouse.move(0,0); await sleep(60);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot', name);
  }

  // ── The queue (collapsed escalate) ──
  await page.evaluate(()=>nav('queue')); await sleep(3500);
  const probe = await page.evaluate(()=>({
    counts: (window._sklData&&_sklData.counts)||null,
    rows: document.querySelectorAll('#skl-body .nx-card').length,
    kpis: document.querySelectorAll('#skl-body .nx-kpi').length,
    chips: document.querySelectorAll('#skl-body .nx-badge').length,
    tierA: [...document.querySelectorAll('#skl-body .skl-row-a')].length,
    firstRow: document.querySelector('#skl-body .nx-card--hover')?.innerText.replace(/\s+/g,' ').slice(0,120),
    tierABadge: window._tierACount
  }));
  console.log('QUEUE_PROBE', JSON.stringify(probe));
  await shoot('queue');

  // ── Escalate expanded ──
  await page.evaluate(()=>{ if(typeof _sklToggleEsc==='function') _sklToggleEsc(); }); await sleep(500);
  await shoot('queue_escalate');
  console.log('QUEUE_PHASE_ERRS', errs.length, errs.slice(0,10).join(' | '));

  // ── Functional role-gate re-probe (client-side nav gate) ──
  const roleProbe = await page.evaluate(()=>{
    const orig = S.role;
    const test = (role)=>{ S.role=role;
      nav('legalcases'); const legal=document.querySelector('.pg.on')?.id;
      nav('queue');      const q=document.querySelector('.pg.on')?.id;
      return { role, legalcases_lands_on: legal, queue_lands_on: q,
               hasPerm_legal: (typeof hasPermission==='function')?hasPermission('legalcases'):null,
               hasPerm_queue: (typeof hasPermission==='function')?hasPermission('queue'):null }; };
    const out = ['admin','manager','recovery'].map(test);
    S.role=orig; nav('queue');
    return out;
  });
  console.log('ROLE_GATE', JSON.stringify(roleProbe,null,0));

  console.log('CONSOLE_ERRS_TOTAL', errs.length);
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
