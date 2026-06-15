/** Batch 5 verify (final): approve the pending transfer + cancellation (completing
 *  the round-trip → registers populate + chains enrich), then screenshot
 *  transferred / cancelled / ownership-chain / transfer-form / cancel-form at
 *  1366+1920 light+dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4744; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'ops_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026', ZCID='a2915ce7-c01c-463b-ba50-b144b2240337';
const U_XFER='5e5a16c1-b595-41d2-8807-cade9938f5e4', U_CANC='18dc0060-cb64-414d-bc95-0ed4d312b858';
const REQ_XFER='56253fa9-60d4-44da-b689-af67769df03e', REQ_CANC='09172a63-6361-4caa-919e-1e625b08b8c6', REQ_DUP='604ce5be-8c1d-4da5-ba54-8b3292d3c946';
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
  await page.evaluate(()=>nav('units')); await sleep(2200);

  // approve transfer + cancellation (executes them); reject the duplicate cancel
  const appr = await page.evaluate(async(rx,rc,rd)=>{
    const out={};
    try{ const {data}=await supabase.rpc('approve_request',{p_request_id:rx,p_comment:'verify'}); out.xfer=data?.success??data; }catch(e){ out.xfer='err:'+e.message; }
    try{ const {data}=await supabase.rpc('approve_request',{p_request_id:rc,p_comment:'verify'}); out.canc=data?.success??data; }catch(e){ out.canc='err:'+e.message; }
    try{ await supabase.rpc('reject_request',{p_request_id:rd,p_comment:'duplicate'}); out.dup='rejected'; }catch(e){ out.dup='err:'+e.message; }
    return out;
  }, REQ_XFER, REQ_CANC, REQ_DUP);
  const counts = await page.evaluate(async(cid)=>{
    const t=await supabase.rpc('get_transferred_units_ledger',{p_company_id:cid,p_project_id:null,p_date_from:null,p_date_to:null,p_settlement_status:'All'});
    const c=await supabase.rpc('get_cancelled_units_ledger',{p_company_id:cid,p_project_id:null,p_date_from:null,p_date_to:null,p_refund_status:'All'});
    return { transferred:(t.data?.rows||[]).length, cancelled:(c.data?.rows||[]).length };
  }, ZCID);
  console.log('APPROVE', JSON.stringify(appr), 'COUNTS', JSON.stringify(counts));

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

  await page.evaluate(()=>nav('transferunits')); await sleep(2200); await shoot('transferred');
  await page.evaluate(()=>nav('cancelledunits')); await sleep(2200); await shoot('cancelled');
  await page.evaluate((uid)=>rUnitChain(uid), U_XFER); await sleep(2800);
  const chainEv = await page.evaluate(()=>document.querySelectorAll('#pg-unitchain .uc-ev').length);
  console.log('CHAIN_EVENTS', chainEv);
  await shoot('chain');
  await page.evaluate(()=>nav('unittransfer')); await sleep(2600); await shoot('transfer_form');
  await page.evaluate(()=>nav('unitcancel')); await sleep(2600); await shoot('cancel_form');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
