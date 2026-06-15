const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';const ROOT=path.resolve(__dirname,'..');const PORT=4916;const BASE=`http://127.0.0.1:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=path.join(__dirname,'sticky_shots');
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(s));});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
const errs=[];const p=await b.newPage();await p.setViewport({width:390,height:780});p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});
await p.evaluate(t=>{localStorage.setItem('rms.sales.token',t);localStorage.setItem('rms.sales.active',String(Date.now()));},'KBH_STICKY');
await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});await sleep(2200);
// measure: body should NOT scroll (page fixed); #bv-body should scroll
const m1=await p.evaluate(()=>{
  const body=document.scrollingElement; const bv=document.getElementById('bv-body');
  const headBottomBefore=document.querySelector('.modeseg').getBoundingClientRect().bottom;
  bv.scrollTop=600; // scroll the unit list
  return {bodyScroll:body.scrollTop, bvScrollable:bv.scrollHeight>bv.clientHeight+5, bvScrolled:bv.scrollTop, headBottomBefore};
});
await sleep(200);
const m2=await p.evaluate(()=>{
  // after scrolling units, is the header (modeseg) still at the same place + top bar visible?
  const headBottomAfter=document.querySelector('.modeseg').getBoundingClientRect().bottom;
  const topVisible=document.querySelector('.top').getBoundingClientRect().top>=-1;
  const tabsVisible=document.getElementById('tab-board').getBoundingClientRect().top>=0;
  const kpisVisible=document.querySelector('.kpis').getBoundingClientRect().top>=0;
  return {headBottomAfter, topVisible, tabsVisible, kpisVisible};
});
await p.screenshot({path:path.join(OUT,'A_scrolled_header_pinned.png')});
await b.close();srv.close();
console.log('M1:',JSON.stringify(m1));
console.log('M2:',JSON.stringify(m2));
console.log('HEADER_FIXED(before==after):', Math.abs(m1.headBottomBefore-m2.headBottomAfter)<2, '| BODY did NOT scroll:', m1.bodyScroll===0, '| units scrolled:', m1.bvScrolled>0);
console.log('errors:',errs.length);errs.slice(0,5).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error(e);process.exit(1)});
