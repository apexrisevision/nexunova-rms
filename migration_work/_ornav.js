const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4924;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'or_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
// role check
const role=await p.evaluate(()=>S&&S.role);
// 1) SIDEBAR: is there a My Recovery nav item?
const sbItem=await p.evaluate(()=>{ var el=[...document.querySelectorAll('.ni')].find(n=>/My Recovery/.test(n.textContent)); return !!el; });
await p.evaluate(()=>{ var el=[...document.querySelectorAll('.ni')].find(n=>/My Recovery/.test(n.textContent)); if(el) el.click(); });
await sleep(3500);
const afterSidebar=await p.evaluate(()=>document.querySelector('.pg.on')?.id||'');
// 2) REPORTS card
await p.evaluate(()=>{ if(typeof nav==='function') nav('reports'); });
await sleep(2500);
const cardPresent=await p.evaluate(()=>/My Recovery — Work Sheet/.test(document.getElementById('pg-reports')?.textContent||''));
await p.evaluate(()=>{ var c=[...document.querySelectorAll('#pg-reports .nx-card')].find(x=>/My Recovery — Work Sheet/.test(x.textContent)); if(c) c.click(); });
await sleep(3500);
const afterCard=await p.evaluate(()=>document.querySelector('.pg.on')?.id||'');
await b.close();srv.close();
console.log('role:',role);
console.log('SIDEBAR  "My Recovery" item present:',sbItem,'| after click active page:',afterSidebar,'(want pg-myrecovery)');
console.log('REPORTS  card present:',cardPresent,'| after click active page:',afterCard,'(want pg-myrecovery)');
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
