/** KBH Application Form verify (live ZZTEST). Captures the body-only legal print
 *  doc via an NXPrint.emit override, lays it on a simulated legal sheet with the
 *  pre-printed header/footer bands marked, and screenshots WITH nominee and
 *  WITHOUT nominee (blank boxes). Sale 0e513df3 → client 9b921760 (photo + nominee
 *  FATIMA RAZA + occupation/income/NTN set in the round-trip). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4781; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'appform_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const SALE='0e513df3-e54d-4408-9bdf-e7a5c518729f';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// lay the captured body-only doc onto a simulated legal sheet with band markers
function onSheet(html){
  const bands =
    '<div style="position:absolute;top:0;left:0;right:0;height:3.0in;background:#eef7ee;border-bottom:1.5px dashed #2a9d2a;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;font:12px sans-serif;color:#2a9d2a">▲ PRE-PRINTED GREEN HEADER / LOGO + "APPLICATION FORM" BAND (3.0in) — body prints below</div>'+
    '<div style="position:absolute;bottom:0;left:0;right:0;height:0.5in;border-top:1.5px dashed #888;display:flex;align-items:center;justify-content:center;font:11px sans-serif;color:#888">▼ PRE-PRINTED FOOTER BAND (0.5in) — sayadeveloper.com</div>';
  return html.replace('<body>',
    '<body style="margin:0;padding:3.0in 0.22in 0.5in 0.22in;position:relative;background:#fff;width:8.5in;min-height:14in;box-sizing:border-box">'+bands);
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1100,1500']});
  const page=await browser.newPage(); await page.setViewport({width:1280,height:1000});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await page.evaluate(()=>{ window.NXPrint.emit = function(html){ window.__af = html; }; });
  await page.evaluate((id)=>openSaleDetail(id), SALE); await sleep(3500);

  // action-bar check: standalone Application Form button restored (no dropdown)
  const bar = await page.evaluate(()=>{
    const btns=[...document.querySelectorAll('#pg-salesdetail .no-p button')].map(b=>b.textContent.trim()).filter(Boolean);
    return { buttons:btns, hasAppForm:btns.some(t=>/Application Form/.test(t)), hasDropdown:!!document.querySelector('.sd-docs-trigger') };
  });
  console.log('ACTION_BAR', JSON.stringify(bar));
  await page.screenshot({ path: path.join(OUT,'action_bar.png'), clip:{x:240,y:208,width:1180,height:60} });

  const render = await browser.newPage();
  await render.setViewport({ width: 840, height: 1380, deviceScaleFactor: 1.4 });

  async function shoot(name){
    const html = await page.evaluate(()=>window.__af||'');
    if (!html) { console.log('NO HTML for', name); return; }
    await render.setContent(onSheet(html), { waitUntil:'domcontentloaded', timeout:15000 });
    await sleep(1800);
    await render.screenshot({ path: path.join(OUT, name+'.png'), fullPage:true });
    console.log('  shot', name, '· bytes', html.length);
  }

  // WITH nominee
  await page.evaluate(async()=>{ window.__af=null; await printApplicationForm(); }); await sleep(2200);
  await shoot('appform_with_nominee');

  // WITHOUT nominee — strip the client's next_of_kin via an rpc override (no DB write)
  await page.evaluate(()=>{
    const orig = supabase.rpc.bind(supabase);
    supabase.rpc = function(fn,args){ const pr = orig(fn,args);
      if(fn==='get_client_by_id'){ return pr.then(r=>{ if(r&&r.data){ r.data=Object.assign({},r.data,{next_of_kin_name:null,next_of_kin_cnic:null,next_of_kin_relation:null,next_of_kin_photo_url:null}); } return r; }); }
      return pr; };
  });
  await page.evaluate(async()=>{ window.__af=null; await printApplicationForm(); }); await sleep(2200);
  await shoot('appform_without_nominee');

  // probe the captured field population
  const probe = await page.evaluate(()=>{
    const h = window.__af||''; return {
      hasOccupation: /Occupation/.test(h), hasMonthly: /Monthly Income/.test(h), hasNTN: /NTN/.test(h),
      hasLegalPage: /size:8\.5in 14in/.test(h), hasSigs: /Signature of Applicant/.test(h)
    };
  });
  console.log('PROBE', JSON.stringify(probe));
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
