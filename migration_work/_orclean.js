const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4927;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',KBH='3249e3b5-c411-4f5f-ae48-0246304c9c87';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1500,height:1000});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await p.evaluate((kbh)=>{ S.cid=kbh; }, KBH);
await p.evaluate(()=>{ if(typeof rMyRecovery==='function') rMyRecovery(); });
await sleep(5000);
const r=await p.evaluate(()=>{ var b=document.getElementById('or-body'); var t=b?b.textContent:''; return {
  hasYourBrief:/Your brief/.test(t), hasAIbadge:/\bAI\b/.test((b&&b.querySelector('.nx-badge')?b.querySelector('.nx-badge').textContent:'')),
  hasThisMonth:/This month —/.test(t), hasRollforward:/current remaining\s*is built/i.test(t.replace(/\s+/g,' ')),
  hasWhoToCall:/Who to call/.test(t), tableRows:(document.querySelectorAll('#or-table tbody tr')||[]).length
};});
await b.close();srv.close();
console.log('Your brief present:',r.hasYourBrief,'(want false)');
console.log('This month figures:',r.hasThisMonth,'| rollforward:',r.hasRollforward,'| Who to call table:',r.hasWhoToCall,'| rows:',r.tableRows);
console.log('errors:',errs.length);errs.slice(0,5).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
