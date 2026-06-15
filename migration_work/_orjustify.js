const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4928;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',KBH='3249e3b5-c411-4f5f-ae48-0246304c9c87';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'or_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1560,height:1040});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await p.evaluate((kbh)=>{ S.cid=kbh; }, KBH);
await p.evaluate(()=>{ if(typeof rMyRecovery==='function') rMyRecovery(); });
await sleep(5000);
await p.evaluate(()=>{ document.querySelectorAll('.pg').forEach(x=>x.classList.remove('on')); document.getElementById('pg-myrecovery')?.classList.add('on'); });
// switch to ALL accounts so table totals = headline figures
await p.evaluate(()=>{ if(typeof _orSetFilter==='function') _orSetFilter('all'); });
await sleep(1500);
const T=await p.evaluate(()=>window._orStore.T);
// read the TOTAL row from the table
const tot=await p.evaluate(()=>{ var tr=[...document.querySelectorAll('#or-table tbody tr')].find(x=>/TOTAL/.test(x.textContent)); if(!tr)return null; return [...tr.querySelectorAll('td')].map(td=>td.textContent.replace(/[^0-9]/g,'')); });
const oneCard=await p.evaluate(()=>document.querySelectorAll('#or-body > .nx-card, #or-body .nx-card').length);
const hasGrid=await p.evaluate(()=>/min-width:150px/.test(document.getElementById('or-body').innerHTML));
await p.evaluate(()=>{ var t=document.getElementById('or-table'); if(t)t.scrollIntoView(); });
await p.screenshot({path:path.join(OUT,'justify.png')});
await b.close();srv.close();
const f=n=>Number(n).toLocaleString('en-US');
console.log('Headline figures: oldArrears',f(T.oldArrears),'| dueToDate',f(T.dueToDate),'| recovered(cash)',f(T.recovered),'| advBf',f(T.advBf),'| advFut',f(T.advFut),'| remaining',f(T.remaining));
if(tot){ console.log('Table TOTAL row:   oldArrears',f(tot[2]),'| dueToDate',f(tot[3]),'| recovered',f(tot[4]),'| advance',f(tot[5]),'| remaining',f(tot[6])); 
  console.log('Match old:',tot[2]==String(Math.round(T.oldArrears)),'| due:',tot[3]==String(Math.round(T.dueToDate)),'| rec:',tot[4]==String(Math.round(T.recovered)),'| remaining:',tot[6]==String(Math.round(T.remaining)));
  console.log('Rollforward check old+due-rec-adv+advFut =',f(T.oldArrears+T.dueToDate-T.recovered-T.advBf+T.advFut),'== remaining?',Math.abs(T.oldArrears+T.dueToDate-T.recovered-T.advBf+T.advFut-T.remaining)<1);
}
console.log('figure-grid (min-width:150px boxes) present:',hasGrid,'(want false) | errors:',errs.length);
errs.slice(0,5).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
