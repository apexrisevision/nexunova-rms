// Headless E2E render check for the Agent Recovery Book (admin report).
// Logs in as the ZZTEST owner (real prod session), navigates to agentrecovery,
// asserts the store loads + roster renders + an agent drill renders, no JS errors.
const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4931;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'ar_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon|404/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
const fnExists=await p.evaluate(()=>typeof rAgentRecovery==='function');
await p.evaluate(()=>nav('agentrecovery'));await sleep(5000);
const active=await p.evaluate(()=>document.querySelector('.pg.on')?.id||'(none)');
const store=await p.evaluate(()=>{const s=window._arStore;return s?{agents:s.agents.length,rows:s.rows.length,totals:s.totals}:null;});
const rosterHasTable=await p.evaluate(()=>/Agents · worst overdue first/.test(document.getElementById('pg-agentrecovery')?.textContent||''));
await p.screenshot({path:path.join(OUT,'A_roster.png'),fullPage:true});
// drill into the first agent bucket
let drillOk=false,drillRows=0;
if(store&&store.agents>0){
  const firstId=await p.evaluate(()=>{const a=window._arStore.agents[0];return a.agent_id||'__none__';});
  await p.evaluate(id=>_arOpenAgent(id),firstId);await sleep(1200);
  drillOk=await p.evaluate(()=>/work each client right here/.test(document.getElementById('pg-agentrecovery')?.textContent||''));
  drillRows=await p.evaluate(id=>_arAgentRows(id==='__none__'?null:id).length, firstId);
  await p.screenshot({path:path.join(OUT,'B_agentdrill.png'),fullPage:true});
}
// assign modal opens
await p.evaluate(()=>{window._arView={mode:'roster',agentId:null};_arRender();});await sleep(400);
await p.evaluate(()=>_arAssignOpen());await sleep(1500);
const assignOpen=await p.evaluate(()=>!!document.querySelector('#ar-assign-host .nx-modal-overlay'));
await p.screenshot({path:path.join(OUT,'C_assign.png'),fullPage:true});
await b.close();srv.close();
console.log('rAgentRecovery exists :',fnExists);
console.log('active page           :',active,'(want pg-agentrecovery)');
console.log('store loaded          :',!!store, store?('agents='+store.agents+' rows='+store.rows):'');
if(store) console.log('totals.overdue / remaining / received :',store.totals.overdue, store.totals.total_remaining, store.totals.received);
console.log('roster table rendered :',rosterHasTable);
console.log('agent drill rendered  :',drillOk,'rows='+drillRows);
console.log('assign modal opens    :',assignOpen);
console.log('JS errors             :',errs.length);
errs.slice(0,8).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
