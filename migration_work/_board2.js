const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4914;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'board2_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
async function openBoard(p,t){await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});await p.evaluate(x=>sessionStorage.setItem('rms.sales.token',x),t);await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});await sleep(2200);}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
const errs=[];
// mobile
const pm=await b.newPage();await pm.setViewport({width:390,height:844});pm.on('pageerror',e=>errs.push(e.message));pm.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await openBoard(pm,'KBH_BOARD2');
const dir=await pm.evaluate(()=>({floorCards:document.querySelectorAll('.floorcard').length, hasBars:document.querySelectorAll('.fc-bar').length, firstFloor:(document.querySelector('.floorcard .fc-name')||{}).textContent}));
await pm.screenshot({path:path.join(OUT,'A_directory_mobile.png'),fullPage:true});
// tap first floor
await pm.evaluate(()=>{const c=document.querySelector('.floorcard'); if(c) c.click();});await sleep(400);
const det=await pm.evaluate(()=>({backBtn:!!document.querySelector('.backbtn'), title:(document.querySelector('.fd-title')||{}).textContent, units:document.querySelectorAll('#bv-body .unit').length}));
await pm.screenshot({path:path.join(OUT,'B_floor_detail_mobile.png'),fullPage:true});
// back, then filter Available, then search
await pm.evaluate(()=>_bvBack());await sleep(200);
await pm.evaluate(()=>_bvFilter('available'));await sleep(200);
const availDir=await pm.evaluate(()=>(document.querySelector('.floorcard .fc-stat span')||{}).textContent);
await pm.evaluate(()=>{const i=document.getElementById('bv-q'); i.value='1-04'; i.dispatchEvent(new Event('input'));});await sleep(300);
const search=await pm.evaluate(()=>({results:document.querySelectorAll('#bv-body .unit').length, title:(document.querySelector('#bv-body .fd-title')||{}).textContent}));
await pm.screenshot({path:path.join(OUT,'C_search_mobile.png'),fullPage:true});
await pm.close();
// desktop directory
const pd=await b.newPage();await pd.setViewport({width:1366,height:950});pd.on('pageerror',e=>errs.push(e.message));
await openBoard(pd,'KBH_BOARD2');await pd.screenshot({path:path.join(OUT,'D_directory_desktop.png'),fullPage:true});await pd.close();
await b.close();srv.close();
console.log('DIRECTORY:',JSON.stringify(dir));
console.log('DETAIL:',JSON.stringify(det));
console.log('AVAIL_FILTER_LABEL:',JSON.stringify(availDir),'| SEARCH 1-04:',JSON.stringify(search));
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
console.log('shots:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error(e);process.exit(1)});
