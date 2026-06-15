const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4922;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',KBH='3249e3b5-c411-4f5f-ae48-0246304c9c87';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'or_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
// point the report at KBH data (owner = is_full, RPC returns KBH rows), then render My Recovery
await p.evaluate((kbh)=>{ S.cid=kbh; }, KBH);
await p.evaluate(()=>{ if(typeof rMyRecovery==='function') rMyRecovery(); });
await new Promise(r=>setTimeout(r,4500));
await p.evaluate(()=>{ document.querySelectorAll('.pg').forEach(x=>x.classList.remove('on')); document.getElementById('pg-myrecovery')?.classList.add('on'); });
await sleep(5000);
const T=await p.evaluate(()=>{ var s=window._orStore; return s?s.T:null; });
const hasAdvCol=await p.evaluate(()=>/Advance pre-paid/.test(document.getElementById('pg-myrecovery')?.textContent||document.body.textContent));
const hasRollforward=await p.evaluate(()=>/How\s+current remaining\s+is built/i.test(document.body.textContent.replace(/\s+/g,' ')));
await p.screenshot({path:path.join(OUT,'A_myrecovery.png'),fullPage:true});
await b.close();srv.close();
const f=n=>Number(n).toLocaleString('en-US');
if(T){
  console.log('oldArrears :',f(T.oldArrears));
  console.log('dueToDate  :',f(T.dueToDate));
  console.log('recvApplied:',f(T.recvApplied));
  console.log('advBf      :',f(T.advBf));
  console.log('remaining  :',f(T.remaining));
  console.log('check (open+dueTD-recvApplied-advBf):',f(T.oldArrears+T.dueToDate-T.recvApplied-T.advBf),'== remaining?',Math.abs((T.oldArrears+T.dueToDate-T.recvApplied-T.advBf)-T.remaining)<1);
  console.log('dueMonth(full):',f(T.dueMonth),'| recovered(cash):',f(T.recovered));
} else console.log('No _orStore (report did not load)');
console.log('Advance column present:',hasAdvCol,'| Rollforward strip present:',hasRollforward,'| errors:',errs.length);
errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
