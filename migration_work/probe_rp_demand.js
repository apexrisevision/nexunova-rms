/** Probe get_recovery_position for the demand-sheet model. Two periods:
 *  A = epoch..last-month-end (cumulative scheduled due + received + arrears)
 *  B = this-month-start..this-month-end (current month installment).
 *  Dumps row keys + the fields we need so we can build the transform correctly. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4796; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage();
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);

  const out = await page.evaluate(async ()=>{
    const cid = S.cid;
    const A = await supabase.rpc('get_recovery_position', { p_company_id: cid, p_project_id: null, p_from_date: '2000-01-01', p_to_date: '2026-05-31' });
    const B = await supabase.rpc('get_recovery_position', { p_company_id: cid, p_project_id: null, p_from_date: '2026-06-01', p_to_date: '2026-06-30' });
    const ar = (A.data && A.data.rows) || []; const br = (B.data && B.data.rows) || [];
    const pick = r => ({ unit:r.unit_no, client:r.client_name, total_price:r.total_price, discount:r.discount, net_price:r.net_price,
      due_period:r.due_period, received_total:r.received_total, opening:r.opening, closing:r.closing, advance_bf:r.advance_bf });
    return { errA:A.error&&A.error.message, errB:B.error&&B.error.message,
      keys: ar[0]?Object.keys(ar[0]):[], A: ar.map(pick), B: br.map(pick) };
  });
  console.log(JSON.stringify(out,null,2));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
