const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4929;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',KBH='3249e3b5-c411-4f5f-ae48-0246304c9c87';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'or_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
// force recovery role + KBH data, render dashboard
await p.evaluate((kbh)=>{ try{effectiveRole=()=>'recovery';}catch(e){} S.cid=kbh; if(typeof rDash==='function') rDash(); }, KBH);
await sleep(6000);
const dash=await p.evaluate(()=>{
  var pg=document.getElementById('pg-dashboard'); var t=pg?pg.textContent:'';
  return {
    hasOrBody: !!(pg && pg.querySelector('#or-body')),
    hasReportTable: !!(pg && pg.querySelector('#or-table table')),
    hasRollforward: /current remaining\s*\(to date/i.test(t.replace(/\s+/g,' ')),
    thCount: pg? (pg.querySelectorAll('#or-table thead th').length):0,
    toolsFirstRow: pg? (function(){var tr=pg.querySelector('#or-table tbody tr'); return tr?tr.querySelector('td:last-child').querySelectorAll('a,button').length:0;})():0,
    hasCoach: /Your recovery day|START HERE|YOUR DAY/i.test(t),
    hasYourBrief: /Your brief/.test(t),
    greeting: /Good (morning|afternoon|evening)/.test(t),
    minWidthScroll: /min-width:1180px/.test(pg?pg.innerHTML:'')
  };
});
await p.screenshot({path:path.join(OUT,'dash_report.png'),fullPage:false});
await b.close();srv.close();
console.log('DASHBOARD shows report:');
console.log('  #or-body present:',dash.hasOrBody,'| report table:',dash.hasReportTable,'| rollforward:',dash.hasRollforward);
console.log('  table columns (th):',dash.thCount,'(want 8) | tools/row:',dash.toolsFirstRow,'(want 5)');
console.log('  greeting header:',dash.greeting,'| min-width scroll grid:',dash.minWidthScroll,'(want false)');
console.log('  FAZOOL removed -> coach/steps:',dash.hasCoach,'(want false) | Your brief:',dash.hasYourBrief,'(want false)');
console.log('errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
