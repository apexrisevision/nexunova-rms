const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4831;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'convert_ui_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const page=await browser.newPage();await page.setViewport({width:1366,height:900});
  const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,160)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin());await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  // Reservations page (light 1366)
  await page.evaluate(()=>nav('reservations'));await sleep(2500);
  await page.screenshot({path:path.join(OUT,'A_reservations_1366_light.png'),fullPage:true});
  const hasConvert=await page.evaluate(()=>/Convert to Sale/.test(document.querySelector('#pg-reservations')?.textContent||''));

  // dark
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await sleep(500);
  await page.screenshot({path:path.join(OUT,'B_reservations_dark.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));await sleep(300);

  // 1920 width
  await page.setViewport({width:1920,height:1080});await sleep(400);
  await page.screenshot({path:path.join(OUT,'C_reservations_1920.png'),fullPage:true});
  await page.setViewport({width:1366,height:900});await sleep(300);

  // Click "Convert to Sale" on the active row -> New Sale prefilled with banner
  const clicked=await page.evaluate(()=>{
    const btn=[...document.querySelectorAll('#pg-reservations button')].find(b=>/Convert to Sale/.test(b.textContent));
    if(btn){btn.click();return true;}return false;
  });
  await sleep(2800);
  const onNewSale=await page.evaluate(()=>document.querySelector('#pg-newsale')?.classList.contains('on'));
  const convertBanner=await page.evaluate(()=>/Converting the reservation/.test(document.querySelector('#pg-newsale')?.textContent||''));
  const titleConvert=await page.evaluate(()=>/Convert Reservation/.test(document.querySelector('#pg-newsale')?.textContent||''));
  await page.screenshot({path:path.join(OUT,'D_convert_newsale_prefilled.png'),fullPage:true});

  await browser.close();srv.close();
  console.log('RESV_HAS_CONVERT_BTN:',hasConvert);
  console.log('CONVERT_CLICK_OPENED_NEWSALE:',onNewSale,'| convert banner:',convertBanner,'| convert title:',titleConvert);
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,12).forEach(e=>console.log('  '+e));
  console.log('SHOTS:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
