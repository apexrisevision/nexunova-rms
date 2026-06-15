/** Batch 6 verify (cont.): approve the dnd request (race-safe), then screenshot
 *  Approvals History + the Inbox (contacts) page. 1366+1920 light+dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4752; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'inbox_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026', ZCID='a2915ce7-c01c-463b-ba50-b144b2240337';
const REQ_DND='52218726-ea86-4aeb-ae20-3442e436f4fa';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
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

  // ── approve dnd (race-safe: wait for composer after async load) ──
  await page.evaluate(()=>nav('approvals')); await sleep(2400);
  await page.evaluate((id)=>_apOpenDrawer(id), REQ_DND);
  try { await page.waitForFunction(()=>{ const t=document.getElementById('ap-dec-comment'); const title=document.querySelector('#ap-modal .nx-modal-title'); return t && title && title.textContent.indexOf('Loading')<0; }, { timeout:8000 }); } catch(e){ console.log('wait timeout'); }
  await sleep(300);
  await page.evaluate(()=>{ const ta=document.getElementById('ap-dec-comment'); ta.value='Confirmed with client — honor the DND request.'; ta.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.evaluate(()=>_apDrawerSubmit('approve')); await sleep(3200);

  const state = await page.evaluate(async(cid)=>{
    const p=await supabase.rpc('get_pending_approvals',{p_filters:{}});
    const h=await supabase.rpc('get_approval_history',{p_filters:{limit:50}});
    return { pending:(p.data?.rows||[]).length, decided:(h.data?.rows||[]).filter(r=>r.status!=='pending').length };
  }, ZCID);
  console.log('STATE', JSON.stringify(state));

  // ── History tab ──
  await page.evaluate(()=>_apSetTab('history')); await sleep(2000);
  await shoot('approvals_history');

  // ── Inbox (contacts) ──
  await page.evaluate(()=>nav('contacts')); await sleep(3200);
  const inbox = await page.evaluate(()=>({ tabs:document.querySelectorAll('#fc-tabs .nx-tab').length, kpis:document.querySelectorAll('#pg-contacts .nx-kpi').length }));
  console.log('INBOX', JSON.stringify(inbox));
  await shoot('inbox');
  await shoot('inbox_log', async()=>{ await page.evaluate(()=>_fcSetTab('log')); await sleep(700); });

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
