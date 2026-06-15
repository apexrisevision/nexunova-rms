const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4321;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json','.ico':'image/x-icon' };
const srv = http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise(res=>srv.listen(PORT,'127.0.0.1',res));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage();
  const reqs = {}; const errs=[];
  page.on('response', res => { const u=res.url(); if(/favicon|nexunova-icon/.test(u)) reqs[u]=res.status(); });
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e=>errs.push('PAGEERROR '+e.message));
  await page.goto(`http://127.0.0.1:${PORT}/login.html`, { waitUntil:'networkidle2' });
  // confirm the icon link resolves + the login screen rendered
  const info = await page.evaluate(()=>({
    iconHref: (document.querySelector('link[rel="icon"]')||{}).href || null,
    appleHref: (document.querySelector('link[rel="apple-touch-icon"]')||{}).href || null,
    loginVisible: !!document.querySelector('#s-login') && getComputedStyle(document.querySelector('#s-login')).display!=='none',
    bigIconStillRef: document.documentElement.innerHTML.includes('assets/nexunova-icon.png')
  }));
  await browser.close(); srv.close();
  console.log('icon link:', info.iconHref);
  console.log('apple link:', info.appleHref);
  console.log('login screen present:', info.loginVisible);
  console.log('4.8MB icon still referenced anywhere in DOM:', info.bigIconStillRef);
  console.log('favicon-ish network responses:', JSON.stringify(reqs));
  const real = errs.filter(e=>!/401|404|Failed to load resource/.test(e));
  console.log('real JS errors:', real.length, real.slice(0,4).join(' | '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
