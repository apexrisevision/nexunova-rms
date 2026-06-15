const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4841;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'salesaccess_badge_shots');
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

  // Sales Access — real state (ZZTEST = Ultimate 50, 0 sales users -> "0 / 50", Add enabled)
  await page.evaluate(()=>nav('salesaccess'));await sleep(2200);
  const normalBadge=await page.evaluate(()=>document.querySelector('#pg-salesaccess')?.textContent||'');
  const normBadgeText=(normalBadge.match(/Sales access:\s*\d+\s*\/\s*\d+/)||[''])[0];
  const addEnabled=await page.evaluate(()=>{const b=[...document.querySelectorAll('#pg-salesaccess button')].find(x=>/Add sales person/.test(x.textContent));return b?!b.disabled:null;});
  await page.screenshot({path:path.join(OUT,'A_badge_normal_1366.png'),fullPage:true});

  // Simulate AT-CAP state (15/15) to prove the badge + disabled Add + warn banner render
  await page.evaluate(()=>{ _saLimit={current_count:15,max_allowed:15,can_add:false,plan_name:'Basic'}; _saRender(); });
  await sleep(500);
  const capBadge=await page.evaluate(()=>document.querySelector('#pg-salesaccess')?.textContent||'');
  const capBadgeText=(capBadge.match(/Sales access:\s*\d+\s*\/\s*\d+/)||[''])[0];
  const addDisabledAtCap=await page.evaluate(()=>{const b=[...document.querySelectorAll('#pg-salesaccess button')].find(x=>/Add sales person/.test(x.textContent));return b?b.disabled:null;});
  const capWarn=/used all 15 sales-access slots/.test(capBadge);
  await page.screenshot({path:path.join(OUT,'B_badge_atcap_15of15.png'),fullPage:true});

  // dark + 1920 at cap
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await sleep(400);
  await page.screenshot({path:path.join(OUT,'C_badge_atcap_dark.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.setViewport({width:1920,height:1080});await sleep(400);
  await page.evaluate(()=>{ _saLimit=null; rSalesAccess(); });await sleep(1800);
  await page.screenshot({path:path.join(OUT,'D_badge_1920.png'),fullPage:true});

  await browser.close();srv.close();
  console.log('NORMAL_BADGE:',JSON.stringify(normBadgeText),'| add enabled:',addEnabled);
  console.log('ATCAP_BADGE:',JSON.stringify(capBadgeText),'| add disabled:',addDisabledAtCap,'| warn banner:',capWarn);
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,12).forEach(e=>console.log('  '+e));
  console.log('SHOTS:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
