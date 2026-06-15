const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4913;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403/.test(m.text()))errs.push(m.text());});
p.on('dialog',async d=>{try{await d.accept()}catch(e){}});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await p.evaluate(()=>nav('salesaccess'));await sleep(2200);
const hasDelete=await p.evaluate(()=>/Delete/.test(document.querySelector('#pg-salesaccess')?.textContent||''));
await p.screenshot({path:path.join(__dirname,'sa_delete_dropdown_shots_A.png'),fullPage:true}).catch(()=>{});
// open approve modal for the pending row
await p.evaluate(()=>{const bs=[...document.querySelectorAll('#pg-salesaccess button')].find(x=>/Approve/.test(x.textContent)); if(bs) bs.click();});
await sleep(500);
const opts=await p.evaluate(()=>[...document.querySelectorAll('.nx-modal-overlay select option')].map(o=>o.textContent));
await p.screenshot({path:path.join(__dirname,'sa_delete_dropdown_shots_B.png')}).catch(()=>{});
await b.close();srv.close();
console.log('PEOPLE_HAS_DELETE_BTN:',hasDelete);
console.log('APPROVE_DROPDOWN_OPTIONS:',JSON.stringify(opts));
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
