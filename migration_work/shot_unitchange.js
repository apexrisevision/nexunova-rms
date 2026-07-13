/** CHANGE UNIT — end-to-end verification on the live ZZTEST tenant.
 *  Logs in for real, drives the new page with REAL RPCs (no stubs), performs an
 *  actual unit change through the UI, and screenshots light + dark.
 *  Also asserts the page's own guard rails: the button must stay disabled until
 *  the form is genuinely complete.
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4771; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'uc_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1600,height:1100});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,220));});
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message.slice(0,220)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});

  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // capture every toast — a silent failure must not look like a pass
  await page.evaluate(()=>{
    window.__toasts=[];
    const orig=window.toast;
    window.toast=(msg,kind)=>{ window.__toasts.push({msg:String(msg),kind:kind||''}); try{orig&&orig(msg,kind);}catch(e){} };
  });

  // warm the units/projects caches the page reads from
  await page.evaluate(()=>nav('units')); await sleep(2500);

  const R = {};

  // ── nav item present in the sidebar? ──
  R.nav_item = await page.evaluate(()=>{
    const el=[...document.querySelectorAll('#s-app .ni')].find(n=>n.dataset.pg==='unitchange');
    return el ? el.textContent.trim() : null;
  });

  await page.evaluate(()=>nav('unitchange')); await sleep(2500);
  R.page_rendered = await page.evaluate(()=>!!document.getElementById('uc-root'));
  R.btn_disabled_at_start = await page.evaluate(()=>document.getElementById('uc-submit')?.disabled);
  R.hint_at_start = await page.evaluate(()=>document.querySelector('#uc-summary .rops-fh')?.textContent.trim());
  await page.screenshot({path:path.join(OUT,'01_empty_light.png'),fullPage:true});

  // ── pick project → current (sold) unit ──
  const proj = await page.evaluate(()=>{
    const s=document.getElementById('uc-project');
    const opt=[...s.options].find(o=>o.value);
    if(!opt) return null;
    s.value=opt.value; _ucOnProject(opt.value);
    return opt.textContent;
  });
  R.project = proj;
  await sleep(2500);

  R.sold_units = await page.evaluate(()=>[...document.getElementById('uc-old-unit').options].map(o=>o.textContent).filter((_,i)=>i>0));
  R.available_units = await page.evaluate(()=>[...document.getElementById('uc-new-unit').options].map(o=>o.textContent).filter((_,i)=>i>0));

  const oldPick = await page.evaluate(()=>{
    const s=document.getElementById('uc-old-unit');
    const opt=[...s.options].find(o=>o.value);
    if(!opt) return null;
    s.value=opt.value; _ucOnOldUnit(opt.value);
    return opt.textContent;
  });
  R.old_unit_picked = oldPick;
  await sleep(2800);

  // did it load the real sale + the real money already received?
  R.loaded_client = await page.evaluate(()=>_ucData?.clientName || null);
  R.loaded_sale   = await page.evaluate(()=>_ucData?.oldSale?.sale_number || null);
  R.received      = await page.evaluate(()=>_ucData?.received);

  // ── pick the new unit — rate/area must prefill from it ──
  const newPick = await page.evaluate(()=>{
    const s=document.getElementById('uc-new-unit');
    const opt=[...s.options].find(o=>o.value);
    if(!opt) return null;
    s.value=opt.value; _ucOnNewUnit(opt.value);
    return opt.textContent;
  });
  R.new_unit_picked = newPick;
  await sleep(700);
  R.prefilled = await page.evaluate(()=>({
    rate: document.getElementById('uc-rate')?.value,
    area: document.getElementById('uc-area')?.value
  }));

  // still blocked — no reason chosen yet
  R.btn_disabled_before_reason = await page.evaluate(()=>document.getElementById('uc-submit')?.disabled);
  R.hint_before_reason = await page.evaluate(()=>document.querySelector('#uc-summary .rops-fh')?.textContent.trim());

  // ── schedule + reason ──
  await page.evaluate(()=>{
    const c=document.getElementById('uc-count'); c.value='4'; _ucData.installmentCount='4'; _ucBuildSchedule();
    const r=document.getElementById('uc-reason'); r.value='Client wants a bigger unit'; _ucData.reason=r.value; _ucUpdateSummary();
  });
  await sleep(600);

  R.schedule = await page.evaluate(()=>_ucSchedule.map(s=>({no:s.installment_number,due:s.due_date,amt:s.amount_due})));
  R.money = await page.evaluate(()=>_ucMoney());
  R.btn_enabled_now = await page.evaluate(()=>!document.getElementById('uc-submit')?.disabled);
  await page.screenshot({path:path.join(OUT,'02_filled_light.png'),fullPage:true});

  // dark theme
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','dark');}); await sleep(700);
  await page.screenshot({path:path.join(OUT,'03_filled_dark.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','light');}); await sleep(500);

  // ── REAL submit ──
  await page.evaluate(()=>_ucSubmit()); await sleep(6000);
  R.success_screen = await page.evaluate(()=>document.querySelector('.rops-success-title')?.textContent.trim() || null);
  R.voucher = await page.evaluate(()=>document.querySelector('.rops-success-vch')?.textContent.trim() || null);
  R.result = await page.evaluate(()=>_ucResult || null);
  await page.screenshot({path:path.join(OUT,'04_success_light.png'),fullPage:true});

  R.toasts = await page.evaluate(()=>window.__toasts||[]);
  R.console_errors = errs.slice(0,8);
  console.log(JSON.stringify(R,null,2));

  await browser.close(); srv.close();
})();
