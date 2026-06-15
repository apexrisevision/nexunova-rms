/** Verify the freshly-provisioned Awami tenant can actually LOG IN.
 *  Logs in with company_code 'awami' + the chosen password, then asserts it
 *  lands inside the app (onboarding or dashboard) and NOT on the paywall/login. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4721; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE='awami', PW='Samsungnote123*';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1500,height:950});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
  await page.evaluate(()=>doLogin()); await sleep(7000);

  const state = await page.evaluate(()=>{
    const on = id => { const e=document.getElementById(id); return !!e && (e.classList.contains('on') || getComputedStyle(e).display!=='none'); };
    return {
      loginVisible: on('s-login'),
      appVisible:   on('s-app'),
      onboarding:   on('s-onboarding'),
      paywall:      !!document.querySelector('.pw-overlay, #s-paywall, .paywall, [data-paywall]') && (function(){const e=document.querySelector('.pw-overlay, #s-paywall, .paywall');return e && getComputedStyle(e).display!=='none';})(),
      sess:         (function(){try{const s=JSON.parse(sessionStorage.getItem('nxn_sess')||'{}');return {cid:s.cid,coName:s.coName,role:s.role,subStatus:s.subStatus};}catch(e){return null;}})(),
    };
  });
  console.log(JSON.stringify({
    LOGIN_OK: (!state.loginVisible && (state.appVisible || state.onboarding) && !state.paywall),
    state, errors: errs.slice(0,6)
  }, null, 2));
  await page.screenshot({path:path.join(__dirname,'awami_login.png')});
  await browser.close(); srv.close();
})().catch(e=>{console.error('HARNESS ERROR', e); process.exit(1);});
