/** Batch-1 reskin verification: render Banks/Receipts/Payments-queue/Reminders on a
 *  real session (ZZTEST), light+dark screenshots, console-error capture, + a Banks
 *  write round-trip. Read-only against data; only writes a throwaway bank in ZZTEST. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4400; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'b1_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE='zztestinternalsafeto', PW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[];
async function shotPage(page,id,name){
  await page.evaluate((id)=>{ try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){} if(typeof nav==='function') nav(id); }, id);
  await sleep(1800);
  for(const theme of ['dark','light']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    await sleep(250);
    await page.screenshot({path:path.join(OUT,name+'_'+theme+'.png')});
  }
  console.log('  shot',name);
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1440,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1320,height:900});
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,180));});
  page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,180)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
  await page.evaluate(()=>doLogin()); await sleep(6000);
  await page.evaluate(()=>{try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){}});
  console.log('logged_in', await page.evaluate(()=>!!(document.getElementById('s-app')&&document.getElementById('s-app').classList.contains('on'))));

  await shotPage(page,'recovery','01_payments_queue');
  await shotPage(page,'receipts','02_receipts');
  await shotPage(page,'reminders','03_reminders');
  await shotPage(page,'banks','04_banks_before');

  // ── Banks write round-trip ──
  await page.evaluate(()=>{ if(typeof _bankOpenModal==='function') _bankOpenModal(); });
  await sleep(700);
  await page.evaluate(()=>{
    var set=(id,v)=>{var e=document.getElementById(id);if(e)e.value=v;};
    set('bk-bank_name','ZZ Verify Bank'); set('bk-account_title','ZZTEST Verify A/C');
    set('bk-account_number','0001-2233-4455'); set('bk-branch','Main');
  });
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),'dark');
  await sleep(200); await page.screenshot({path:path.join(OUT,'05_banks_modal_dark.png')});
  const before = await page.evaluate(()=> (window._banksData||[]).length);
  await page.evaluate(()=>{ if(typeof _bankSave==='function') _bankSave(); });
  await sleep(2500);
  const after = await page.evaluate(()=> (window._banksData||[]).length);
  console.log('banks_roundtrip before/after =', before, after);
  await page.screenshot({path:path.join(OUT,'06_banks_after_dark.png')});

  console.log('CONSOLE_ERRS', errs.length);
  errs.slice(0,12).forEach(e=>console.log('  ERR',e));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
