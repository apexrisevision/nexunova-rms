const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4809;const BASE='http://127.0.0.1:'+PORT;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});const pg=await b.newPage();await pg.setViewport({width:1440,height:1000});
pg.on('dialog',async d=>{try{await d.accept();}catch(e){}});
await pg.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await pg.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},'zztestinternalsafeto','ZzTest!2026');
await pg.evaluate(()=>doLogin());await sleep(6500);await pg.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await pg.evaluate(()=>nav('myrecovery'));await sleep(1600);
const ai=await pg.evaluate(()=>{const c=[...document.querySelectorAll('#or-body .nx-card')].find(x=>/Your brief/.test(x.textContent));if(!c)return{n:0};const lines=[...c.querySelectorAll('div[onclick]')];return {clickableLines:lines.length, proofArrows:lines.filter(d=>/→/.test(d.textContent)).length, sample:lines.map(d=>d.getAttribute('onclick')).slice(0,6)};});
console.log('AI', JSON.stringify(ai));
const opened=await pg.evaluate(()=>{const c=[...document.querySelectorAll('#or-body .nx-card')].find(x=>/Your brief/.test(x.textContent));const line=c&&c.querySelector('div[onclick]');if(line)line.click();const m=document.querySelector('.nx-modal-overlay');return m?{open:true,title:(m.querySelector('.nx-modal-title')?.textContent||'').slice(0,60),rows:m.querySelectorAll('tbody tr').length}:{open:false};});
console.log('CLICK_AI', JSON.stringify(opened));
await b.close();srv.close();})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
