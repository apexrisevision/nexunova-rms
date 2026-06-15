/** Reskin Batch 6 — Inbox (contacts) + Approvals verification (live ZZTEST).
 *  Seeded 2 pending approval_requests (dnd + discount). Screenshot the warm
 *  Approvals inbox + decision modal, then drive a real APPROVE (dnd applies) +
 *  REJECT (discount, with reason); screenshot History + the Inbox (contacts)
 *  page. 1366+1920 light+dark. MCP cleans up after. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4751; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'inbox_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026', ZCID='a2915ce7-c01c-463b-ba50-b144b2240337';
const REQ_DND='52218726-ea86-4aeb-ae20-3442e436f4fa', REQ_DISC='c56a6338-d669-41c8-8513-4208bcc439ec';
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

  // ── Approvals inbox (2 pending) ──
  await page.evaluate(()=>nav('approvals')); await sleep(2600);
  const pre = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('get_pending_approvals',{p_filters:{}}); return (data?.rows||[]).length; }, ZCID);
  console.log('PENDING_BEFORE', pre, 'rows', await page.evaluate(()=>document.querySelectorAll('#ap-body .ap-row').length));
  await shoot('approvals_inbox');

  // ── decision modal (open the discount request) ──
  await page.evaluate((id)=>_apOpenDrawer(id), REQ_DISC); await sleep(1800);
  await shoot('approvals_modal');

  // ── drive REJECT (discount) ──
  await page.evaluate(()=>{ const ta=document.getElementById('ap-dec-comment'); ta.value='Discount not justified — account is not at retention risk.'; ta.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.evaluate(()=>_apDrawerSubmit('reject')); await sleep(2800);
  // ── drive APPROVE (dnd) ──
  await page.evaluate((id)=>_apOpenDrawer(id), REQ_DND); await sleep(1800);
  await page.evaluate(()=>{ const ta=document.getElementById('ap-dec-comment'); ta.value='Confirmed with client — honor the DND request.'; ta.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.evaluate(()=>_apDrawerSubmit('approve')); await sleep(2800);

  const post = await page.evaluate(async(cid)=>{
    const p=await supabase.rpc('get_pending_approvals',{p_filters:{}});
    const h=await supabase.rpc('get_approval_history',{p_filters:{limit:50}});
    return { pending:(p.data?.rows||[]).length, history:(h.data?.rows||[]).filter(r=>r.status!=='pending').length };
  }, ZCID);
  const dnd = await page.evaluate(async()=>{ const {data}=await supabase.rpc('get_client_by_id',{p_id:'9b921760-b385-4a56-883b-57db3f1646de',p_company_id:'a2915ce7-c01c-463b-ba50-b144b2240337'}).catch(()=>({})); return data?.dnd_status; });
  console.log('AFTER', JSON.stringify(post), 'dnd_applied', dnd);

  // ── History tab ──
  await page.evaluate(()=>_apSetTab('history')); await sleep(1800);
  await shoot('approvals_history');

  // ── Inbox (contacts) page ──
  await page.evaluate(()=>nav('contacts')); await sleep(3000);
  const inboxProbe = await page.evaluate(()=>({ tabs:document.querySelectorAll('#fc-tabs .nx-tab').length, kpis:document.querySelectorAll('#pg-contacts .nx-kpi').length }));
  console.log('INBOX', JSON.stringify(inboxProbe));
  await shoot('inbox');
  await shoot('inbox_log', async()=>{ await page.evaluate(()=>_fcSetTab('log')); await sleep(700); });

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
