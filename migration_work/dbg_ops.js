const puppeteer=require('puppeteer-core');const http=require('http'),path=require('path'),fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4742;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
const U_CANC='18dc0060-cb64-414d-bc95-0ed4d312b858';
function serve(){return new Promise(res=>{const srv=http.createServer((rq,rp)=>{const p=decodeURIComponent(rq.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rp.writeHead(404);return rp.end();}rp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(rp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});const page=await b.newPage();await page.setViewport({width:1366,height:900});
page.on('dialog',async d=>{try{await d.accept()}catch(e){}});
await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
await page.evaluate(()=>doLogin());await sleep(6500);
await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await page.evaluate(()=>nav('units'));await sleep(2500);
// capture toasts
await page.evaluate(()=>{window.__toasts=[];const o=window.toast;window.toast=function(m,t){window.__toasts.push((t||'')+': '+m);if(o)return o.apply(this,arguments);};});
await page.evaluate((uid)=>rUnitCancel(uid),U_CANC);await sleep(3000);
const loaded=await page.evaluate(()=>{
  return { has_unit_sel: !!document.getElementById('cx-unit'), unit_sel_val:(document.getElementById('cx-unit')||{}).value,
    has_reason: !!document.getElementById('cx-reason-cat'), has_confirm: !!document.getElementById('cx-confirm'),
    has_submit: !!document.getElementById('cx-submit-btn'),
    fin_text: (document.getElementById('cx-sec-financial')||{}).innerText?.slice(0,120) };
});
console.log('LOADED', JSON.stringify(loaded));
await page.evaluate(()=>{
  const setI=(id,v,ev)=>{const e=document.getElementById(id);if(!e)return;e.value=v;e.dispatchEvent(new Event(ev||'input',{bubbles:true}));};
  setI('cx-reason-cat','Financial constraints','change');
  setI('cx-detail-reason','Buyer requested cancellation due to financial constraints and relocation abroad.');
  const c=document.getElementById('cx-confirm');if(c)c.checked=true;
});await sleep(300);
await page.evaluate(()=>_cxSubmit());await sleep(3500);
const after=await page.evaluate(()=>({toasts:window.__toasts, success:!!document.querySelector('#pg-unitcancel .rops-success-screen, #pg-unitcancel .rops-success-title')}));
console.log('AFTER', JSON.stringify(after));
await b.close();srv.close();})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
