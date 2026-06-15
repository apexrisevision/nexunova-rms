const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4804;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});const page=await b.newPage();await page.setViewport({width:1366,height:950});
page.on('dialog',async d=>{try{await d.dismiss();}catch(e){}});
await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
await page.evaluate(()=>doLogin());await sleep(7000);
await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await page.evaluate(()=>nav('users'));await sleep(2500);
await page.evaluate(()=>openAddUserModal());await sleep(1200);
const chain=await page.evaluate(()=>{let el=document.querySelector('#um-modal-host .nx-modal-overlay');const out=[];while(el&&el!==document.documentElement){const cs=getComputedStyle(el);out.push({tag:el.tagName.toLowerCase(),id:el.id||'',cls:(el.className||'').toString().slice(0,40),transform:cs.transform,filter:cs.filter,willChange:cs.willChange,contain:cs.contain,perspective:cs.perspective});el=el.parentElement;}return out;});
console.log(JSON.stringify(chain.filter(x=>x.transform!=='none'||x.filter!=='none'||x.willChange!=='auto'||x.perspective!=='none'||(x.contain&&x.contain!=='none')),null,1));
await b.close();srv.close();})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
