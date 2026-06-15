const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4915;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'board3_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
async function inject(p,tok,activeAgoMs){await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});await p.evaluate((t,a)=>{localStorage.setItem('rms.sales.token',t);localStorage.setItem('rms.sales.active',String(Date.now()-a));},tok,activeAgoMs||0);await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});await sleep(2200);}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
const errs=[];const pm=await b.newPage();await pm.setViewport({width:390,height:844});pm.on('pageerror',e=>errs.push(e.message));pm.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await inject(pm,'KBH_AREA',1000); // active 1s ago -> session valid -> restores app (refresh does NOT log out)
const onApp=await pm.evaluate(()=>document.getElementById('screen-app').classList.contains('active'));
const defaultMode=await pm.evaluate(()=>{const on=document.querySelector('.modeseg .m.on'); return on?on.textContent:''; });
const hasFloorSections=await pm.evaluate(()=>document.querySelectorAll('#bv-body .floor').length); // detailed = expanded floors
const areaOnCard=await pm.evaluate(()=>{const u=[...document.querySelectorAll('.unit .uar')]; return u.length? u[0].textContent : '';});
await pm.screenshot({path:path.join(OUT,'A_detailed_default_area.png'),fullPage:true});
// open reserve on first available unit -> area in form
await pm.evaluate(()=>{const u=document.querySelector('.unit.avail'); if(u) u.click();});await sleep(400);
const reserveArea=await pm.evaluate(()=>{const m=document.querySelector('#modal-host'); return m? (/(\d[\d,]*)\s*sqft/.test(m.textContent)? m.textContent.match(/(\d[\d,]*)\s*sqft/)[0] : '') : '';});
await pm.screenshot({path:path.join(OUT,'B_reserve_area.png')});
await pm.evaluate(()=>closeModal());
// switch to Floor wise
await pm.evaluate(()=>_bvMode('floors'));await sleep(400);
const floorCards=await pm.evaluate(()=>document.querySelectorAll('.floorcard').length);
const modeNow=await pm.evaluate(()=>{const on=document.querySelector('.modeseg .m.on');return on?on.textContent:'';});
await pm.screenshot({path:path.join(OUT,'C_floorwise.png'),fullPage:true});
await pm.close();
// session: stale (>30min idle) -> should NOT restore -> login screen
const ps=await b.newPage();await ps.setViewport({width:390,height:844});ps.on('pageerror',e=>errs.push(e.message));
await inject(ps,'KBH_AREA',31*60*1000); // active 31 min ago
const staleShowsLogin=await ps.evaluate(()=>document.getElementById('screen-login').classList.contains('active'));
await ps.close();
await b.close();srv.close();
console.log('REFRESH_KEEPS_SESSION(onApp):',onApp,'| default mode:',JSON.stringify(defaultMode),'| expanded floor sections:',hasFloorSections);
console.log('AREA on card:',JSON.stringify(areaOnCard),'| area in reserve form:',JSON.stringify(reserveArea));
console.log('FLOORWISE cards:',floorCards,'| mode after toggle:',JSON.stringify(modeNow));
console.log('STALE_30MIN_SHOWS_LOGIN:',staleShowsLogin);
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
