/** Reskin Batch 5 — Transferred / Cancelled / Ownership-chain / Transfer + Cancel.
 *  Company-scoped RPCs (S lexical) + FG ledger source tables empty → verify on
 *  ZZTEST with REAL round-trips driving the actual forms (logic byte-identical):
 *    transfer unit 1-02 → new owner · cancel unit G-01.
 *  Then screenshot transfer/cancel forms + both registers (now populated) +
 *  ownership chain at 1366+1920 light+dark. MCP cleans up the ZZTEST rows after.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4741; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'ops_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026', ZCID='a2915ce7-c01c-463b-ba50-b144b2240337';
const U_XFER = '5e5a16c1-b595-41d2-8807-cade9938f5e4';  // unit 1-02 (sold) → transfer
const U_CANC = '18dc0060-cb64-414d-bc95-0ed4d312b858';  // unit G-01 (sold) → cancel
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
  // warm caches (forms read window._unitsCache/_projectsCache)
  await page.evaluate(()=>nav('units')); await sleep(2500);

  const rt = {};

  // ── TRANSFER round-trip (unit 1-02 → new owner) ──
  await page.evaluate((uid)=>rUnitTransfer(uid), U_XFER); await sleep(2600);
  rt.xfer = await page.evaluate(()=>{
    const setI=(id,v,ev)=>{const e=document.getElementById(id);if(!e)return false;e.value=v;e.dispatchEvent(new Event(ev||'input',{bubbles:true}));return true;};
    const setS=(id,v)=>{const e=document.getElementById(id);if(!e)return false;e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));return true;};
    if (typeof _txSetNewClientMode==='function') _txSetNewClientMode(true);
    const ok={};
    ok.name=setI('tx-nc-name','ZZ New Owner'); ok.cnic=setI('tx-nc-cnic','42101-9999999-1'); ok.phone=setI('tx-nc-phone','03001112222');
    ok.date=setI('tx-date','2026-06-13'); ok.reason=setS('tx-reason','Investor exit');
    ok.close=setI('tx-close-note','Buyer settled directly; original payments retained as deemed received from continuing owner.');
    ok.area=setI('tx-area','1000'); ok.rate=setI('tx-rate','5000');
    return ok;
  });
  // net = 1000*5000 = 5,000,000 → set full down so no schedule needed
  await page.evaluate(()=>{const e=document.getElementById('tx-down');e.value='5000000';e.dispatchEvent(new Event('input',{bubbles:true}));}); await sleep(400);
  await page.evaluate(()=>{const c=document.getElementById('tx-confirm');if(c)c.checked=true;});
  await page.evaluate(()=>_txSubmit()); await sleep(4000);
  rt.xfer_count = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('get_transferred_units_ledger',{p_company_id:cid,p_project_id:null,p_date_from:null,p_date_to:null,p_settlement_status:'All'}); return (data?.rows||[]).length; }, ZCID);

  // ── CANCEL round-trip (unit G-01) ──
  await page.evaluate((uid)=>rUnitCancel(uid), U_CANC); await sleep(2600);
  rt.canc = await page.evaluate(()=>{
    const setI=(id,v,ev)=>{const e=document.getElementById(id);if(!e)return false;e.value=v;e.dispatchEvent(new Event(ev||'input',{bubbles:true}));return true;};
    const setS=(id,v)=>{const e=document.getElementById(id);if(!e)return false;e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));return true;};
    const ok={};
    ok.reason=setS('cx-reason-cat','Financial constraints');
    ok.detail=setI('cx-detail-reason','Buyer requested cancellation due to financial constraints and relocation abroad.');
    const c=document.getElementById('cx-confirm'); if(c){c.checked=true;ok.confirm=true;}
    return ok;
  }); await sleep(300);
  await page.evaluate(()=>_cxSubmit()); await sleep(4000);
  rt.canc_count = await page.evaluate(async(cid)=>{ const {data}=await supabase.rpc('get_cancelled_units_ledger',{p_company_id:cid,p_project_id:null,p_date_from:null,p_date_to:null,p_refund_status:'All'}); return (data?.rows||[]).length; }, ZCID);

  console.log('ROUNDTRIP', JSON.stringify(rt));

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

  // registers (now populated)
  await page.evaluate(()=>nav('transferunits')); await sleep(2200); await shoot('transferred');
  await page.evaluate(()=>nav('cancelledunits')); await sleep(2200); await shoot('cancelled');
  // ownership chain (G-01 now has sale + cancellation)
  await page.evaluate((uid)=>rUnitChain(uid), U_CANC); await sleep(2600); await shoot('chain');
  const chainProbe = await page.evaluate(()=>document.querySelectorAll('#pg-unitchain .uc-ev').length);
  console.log('CHAIN_EVENTS', chainProbe);
  // forms (warm bridge) — fresh
  await page.evaluate(()=>rUnitTransfer()); await sleep(2200); await shoot('transfer_form');
  await page.evaluate(()=>rUnitCancel()); await sleep(2200); await shoot('cancel_form');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
