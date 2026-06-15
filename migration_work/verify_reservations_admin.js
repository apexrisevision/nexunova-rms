const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4823;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'resv_admin_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
  const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,200)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin());await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // Reservations page
  await page.evaluate(()=>nav('reservations'));await sleep(2500);
  const rTxt=await page.evaluate(()=>document.querySelector('#pg-reservations')?.textContent||'');
  await page.screenshot({path:path.join(OUT,'A_reservations_light.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','dark');});await sleep(600);
  await page.screenshot({path:path.join(OUT,'B_reservations_dark.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','light');});

  // Sales Access page
  await page.evaluate(()=>nav('salesaccess'));await sleep(2200);
  const sTxt=await page.evaluate(()=>document.querySelector('#pg-salesaccess')?.textContent||'');
  await page.screenshot({path:path.join(OUT,'C_salesaccess_light.png'),fullPage:true});

  // Units page — confirm 1-01 renders RESERVED
  await page.evaluate(()=>nav('units'));await sleep(2600);
  const unitsReserved=await page.evaluate(()=>{
    const t=document.querySelector('#pg-units')?.textContent||'';
    return /Reserved/i.test(t);
  });
  await page.screenshot({path:path.join(OUT,'D_units_reserved.png'),fullPage:true});

  await browser.close();srv.close();
  console.log('RESV_PAGE_HAS_AHMAD:', /Ahmad/.test(rTxt), '| has Mr. X:', /Mr\. X/.test(rTxt), '| has 1-01:', /1-01/.test(rTxt));
  console.log('SALESACCESS_HAS_AHMAD:', /Ahmad/.test(sTxt));
  console.log('UNITS_SHOWS_RESERVED:', unitsReserved);
  console.log('CONSOLE_ERRORS:', errs.length); errs.slice(0,15).forEach(e=>console.log('  '+e));
  console.log('SHOTS:', fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
