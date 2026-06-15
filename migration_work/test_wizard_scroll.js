const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4729;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,p)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'login.html':u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1400,820']});
  const page=await b.newPage();await page.setViewport({width:1400,height:820});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate(()=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value='awami';q.value='Samsungnote123*';window._loginReadyAt=0;});
  await page.evaluate(()=>doLogin());await sleep(7000);
  await page.evaluate(()=>{ if(typeof OB!=='undefined'&&OB.show) OB.show(window.S&&S.cid); });await sleep(1500);
  // inject TALL content to simulate Floors/Types/Units steps
  const r=await page.evaluate(()=>{
    const step=document.getElementById('ob-step');
    step.innerHTML += '<div style="height:1600px;background:linear-gradient(#1e293b,#334155)">TALL TEST CONTENT (simulating a long step)</div><div id="ob-bottom-marker" style="padding:20px;color:#fff">BOTTOM REACHED</div>';
    const scr=document.getElementById('s-onboarding');
    const before={scrollH:scr.scrollHeight,clientH:scr.clientHeight,overflowY:getComputedStyle(scr).overflowY};
    scr.scrollTop = scr.scrollHeight;  // try to scroll to bottom
    return {before, scrolledTop:scr.scrollTop, canScroll:scr.scrollHeight>scr.clientHeight+2, reachedBottom: scr.scrollTop>0};
  });
  await sleep(500);
  console.log(JSON.stringify(r,null,2));
  await page.screenshot({path:path.join(__dirname,'wizard_scrolled.png')});
  await b.close();srv.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
