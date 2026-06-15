const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4923;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',KBH='3249e3b5-c411-4f5f-ae48-0246304c9c87';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'or_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0])==='/'?'login.html':decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1300,1000']});
const errs=[];const p=await b.newPage();await p.setViewport({width:1280,height:950});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/403|favicon/.test(m.text()))errs.push(m.text());});
await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
await p.evaluate(()=>doLogin());await sleep(6500);
await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
await p.evaluate((kbh)=>{ S.cid=kbh; }, KBH);
await p.evaluate(()=>{ if(typeof rMyRecovery==='function') rMyRecovery(); });
await sleep(5000);
const html=await p.evaluate(()=>{ window.__cap=null; if(window.NXPrint) NXPrint.emit=function(h){window.__cap=h;}; if(typeof _orPrint==='function')_orPrint(); return window.__cap; });
console.log('captured html length:',html?html.length:0,'| errors:',errs.length);
errs.slice(0,5).forEach(e=>console.log('  '+e));
if(html){
  fs.writeFileSync(path.join(OUT,'worksheet.html'),html);
  const pg=await b.newPage(); await pg.setViewport({width:1123,height:794,deviceScaleFactor:2}); // A4 landscape @96dpi
  await pg.setContent(html,{waitUntil:'networkidle0'});
  await pg.screenshot({path:path.join(OUT,'worksheet_top.png')});
  await pg.screenshot({path:path.join(OUT,'worksheet_full.png'),fullPage:true});
}
await b.close();srv.close();
})().catch(e=>{console.error(e);process.exit(1)});
