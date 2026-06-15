const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4921;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',UNIT='5e5a16c1-b595-41d2-8807-cade9938f5e4';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'ustmt_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403/.test(m.text()))errs.push(m.text());});
p.on('dialog',async d=>{try{await d.accept()}catch(e){}});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
// force recovery role (the role where it bounced) + rebuild nav
await p.evaluate(()=>{ try{effectiveRole=()=>'recovery';}catch(e){} if(window.S)window.S.role='recovery'; if(typeof buildSB==='function')buildSB(); });
// open the SOLD unit's detail, then click View Unit Statement
await p.evaluate((id)=>{ if(typeof rUD==='function'){ rUD(id); } }, UNIT);
await sleep(1500);
const hasBtn=await p.evaluate(()=>/View Unit Statement/.test(document.getElementById('pg-unitdetail')?.textContent||''));
await p.evaluate(()=>{const a=[...document.querySelectorAll('#pg-unitdetail a,#pg-unitdetail button')].find(x=>/View Unit Statement/.test(x.textContent)); if(a)a.click();});
await sleep(1800);
const activePg=await p.evaluate(()=>document.querySelector('.pg.on')?.id||'');
const reportsHasStatement=await p.evaluate(()=>/Unit Statement/.test(document.getElementById('pg-reports')?.textContent||''));
const wentToDashboard=await p.evaluate(()=>document.querySelector('.pg.on')?.id==='pg-dashboard');
await p.screenshot({path:path.join(OUT,'A_unit_statement.png'),fullPage:true});
await b.close();srv.close();
console.log('SOLD unit had View-Statement button:',hasBtn);
console.log('After click -> active page:',JSON.stringify(activePg),'| went to DASHBOARD (the bug):',wentToDashboard);
console.log('Reports container shows "Unit Statement":',reportsHasStatement);
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
