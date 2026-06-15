const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4920;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'recdash_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403/.test(m.text()))errs.push(m.text());});
p.on('dialog',async d=>{try{await d.accept()}catch(e){}});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
// force recovery role + rebuild sidebar + render dashboard
await p.evaluate(()=>{ try{effectiveRole=()=>'recovery';}catch(e){} if(window.S)window.S.role='recovery'; if(typeof buildSB==='function')buildSB(); nav('dashboard'); });
await sleep(2500);
const sidebarHasMyRec=await p.evaluate(()=>/My Recovery/.test(document.querySelector('.sb,.sidebar,#s-app')?.textContent||document.body.textContent));
const coachShown=await p.evaluate(()=>/How recovery works/.test(document.getElementById('pg-dashboard')?.textContent||''));
await p.screenshot({path:path.join(OUT,'A_recovery_dashboard.png'),fullPage:true});
// unit-test the pure panel functions with synthetic data (real loaded code)
const alertsHtml=await p.evaluate(()=>_dashOffAlerts({items:[{title:'Promise overdue',name:'Ali',unit:'A-1',amount:50000,date:'2026-06-10',sev:'danger'}]},[{last_contact_date:null},{last_contact_date:'2026-05-01'}]));
const noPhoneHtml=await p.evaluate(()=>_dashOffNext([{client_name:'NoPhone Cust',phone:'03',overdue_amt:1000,oldest_overdue_days:120,unit_id:'u1',sale_id:'s1',reasons:[]}]));
const okPhoneHtml=await p.evaluate(()=>_dashOffNext([{client_name:'Good Cust',phone:'03219694246',overdue_amt:1000,unit_id:'u1',sale_id:'s1',reasons:[]}]));
await b.close();srv.close();
console.log('SIDEBAR has My Recovery:',sidebarHasMyRec,'| COACH shown:',coachShown);
console.log('ALERTS panel ok:', /Needs attention/.test(alertsHtml)&&/Promise overdue/.test(alertsHtml)&&/not contacted in 14/.test(alertsHtml));
console.log('NO-PHONE handled:', /No phone on file/.test(noPhoneHtml)&&!/tel:03"/.test(noPhoneHtml)&&/Plan a field visit/.test(noPhoneHtml));
console.log('OK-PHONE shows Call now:', /tel:03219694246/.test(okPhoneHtml));
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
