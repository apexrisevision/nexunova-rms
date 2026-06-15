const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4728;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,p)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'login.html':u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,900']});
  const page=await b.newPage();await page.setViewport({width:1400,height:820});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate(()=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value='awami';q.value='Samsungnote123*';window._loginReadyAt=0;});
  await page.evaluate(()=>doLogin());await sleep(7000);
  // open the wizard (no saving — just inspect)
  await page.evaluate(()=>{ if(typeof OB!=='undefined'&&OB.show) OB.show(window.S&&S.cid); });await sleep(2000);
  const info=await page.evaluate(()=>{
    const scr=document.getElementById('s-onboarding');
    const links=Array.prototype.map.call(document.querySelectorAll('#s-onboarding a'),a=>({t:a.textContent.trim(),href:a.getAttribute('href')||a.getAttribute('onclick')||''}));
    return {
      onboardingOn: scr&&scr.classList.contains('on'),
      screenScrollH: scr?scr.scrollHeight:0, screenClientH: scr?scr.clientHeight:0,
      scrollable: scr?(scr.scrollHeight>scr.clientHeight+2):false,
      overflowY: scr?getComputedStyle(scr).overflowY:'',
      stepTitle:(document.querySelector('#s-onboarding .nx-page-title')||{}).textContent||'',
      links
    };
  });
  console.log(JSON.stringify(info,null,2));
  await page.screenshot({path:path.join(__dirname,'wizard.png'),fullPage:true});
  await b.close();srv.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
