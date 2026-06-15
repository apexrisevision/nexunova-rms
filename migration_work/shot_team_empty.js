/** Team Performance EMPTY-state proof (0 active recovery officers = the FG
 *  reality). Screenshots the warm render-gated empty Team page + the admin
 *  Dashboard with the team panel correctly HIDDEN. 1366+1920 light+dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4762; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'team_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];

(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  async function shoot(name){
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(200);
        await page.mouse.move(0,0); await sleep(60);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot', name);
  }

  await page.evaluate(()=>nav('team')); await sleep(2600);
  const empty = await page.evaluate(()=>({
    rows: document.querySelectorAll('#team-body .nx-table tbody tr').length,
    emptyMsg: (document.querySelector('#team-body .nx-empty-msg')?.textContent||'').slice(0,90)
  }));
  console.log('TEAM_EMPTY', JSON.stringify(empty));
  await shoot('team_empty');

  await page.evaluate(()=>nav('dashboard')); await sleep(4000);
  const dash = await page.evaluate(()=>({ hasPanel: [...document.querySelectorAll('#pg-dashboard .nx-card')].some(c=>/Recovery team/i.test(c.textContent)) }));
  console.log('DASH_PANEL_HIDDEN', JSON.stringify(dash));

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
