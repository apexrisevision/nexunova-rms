const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4338;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, 'pw_shots'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
const HARNESS = `<!DOCTYPE html><html data-theme="dark"><head><meta charset="utf-8"><style>body{background:#0b0e14;margin:0;font-family:Inter,sans-serif}</style></head><body>
<script>window.sessionStorage.setItem('nxn_sess', JSON.stringify({userId:'sa1'}));
window.supabase={ rpc: async (n,a)=>{ window.__lastRpc={n,a}; if(n==='admin_extend_subscription') return {data:{success:true,new_period_end:'2026-07-25T12:00:00+00:00',new_period_start:'2026-06-25T12:00:00+00:00',status:'active'},error:null}; return {data:[],error:null}; } };
</script>
<script src="/js/pages/super-admin.js"></script>
</body></html>`;
const srv = http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]);
  if(p==='/'){ r.writeHead(200,{'Content-Type':'text/html'}); return r.end(HARNESS); }
  let f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise(res=>srv.listen(PORT,'127.0.0.1',res));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({width:1366,height:900});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, {waitUntil:'networkidle2'});
  const hasSA = await page.evaluate(()=>typeof SA==='object' && typeof SA._recordPayment==='function');
  // open the modal (FG-like prefill)
  await page.evaluate(()=>SA._recordPayment('co-fg','Fourteen Group of companies',10000,'monthly','2026-06-25T12:00:00+00:00'));
  await new Promise(r=>setTimeout(r,300));
  const modal = await page.evaluate(()=>{
    const ov=document.getElementById('sa-pay-overlay'); if(!ov) return {open:false};
    return { open:true, amount:document.getElementById('sa-pay-amount').value,
      cycle:document.getElementById('sa-pay-cycle').value,
      methods:[...document.getElementById('sa-pay-method').options].map(o=>o.value),
      title:/Record Payment/.test(ov.textContent) };
  });
  for (const t of ['dark','light']) { await page.evaluate(th=>document.documentElement.setAttribute('data-theme',th),t); await new Promise(r=>setTimeout(r,200)); await page.screenshot({path:path.join(OUT,`pw_modal_${t}.png`)}); }
  // fill + submit (stubbed rpc → success)
  await page.evaluate(()=>{ document.getElementById('sa-pay-amount').value='10000'; document.getElementById('sa-pay-ref').value='HBL-TXN-55012'; });
  await page.evaluate(()=>SA._submitExtend());
  await new Promise(r=>setTimeout(r,400));
  const submit = await page.evaluate(()=>({ rpc:window.__lastRpc, msg:(document.getElementById('sa-pay-msg')||{}).textContent }));
  await browser.close(); srv.close();
  console.log('SA loaded + _recordPayment present:', hasSA);
  console.log('MODAL:', JSON.stringify(modal));
  console.log('SUBMIT rpc args:', JSON.stringify(submit.rpc), '| msg:', submit.msg);
  const real=errs.filter(e=>!/401|404|Failed to load resource/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,5).join(' | '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
