const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
const srv = http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise(res=>srv.listen(PORT,'127.0.0.1',res));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--use-gl=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1366, height:900 });
  // Simulate a logged-in load: as soon as the DOM parses, make the APP screen active
  // (this is what init.js does after validating a session) — BEFORE login-bg's gate runs.
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
      var app = document.getElementById('s-app'); var login = document.getElementById('s-login');
      if (app) app.classList.add('on');
      if (login) login.classList.remove('on');
    });
  });
  const reqs = [];
  page.on('request', q => reqs.push(q.url()));
  await page.goto(`http://127.0.0.1:${PORT}/login.html`, { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,3000)); // give the gate ample time to (not) fire
  const threeRequested = reqs.some(u => /three(\.min)?\.js/.test(u));
  const state = await page.evaluate(()=>({ appOn: document.getElementById('s-app').classList.contains('on'), threeDefined: typeof THREE!=='undefined' }));
  await browser.close(); srv.close();
  console.log('LOGGED-IN simulation → three.js requested:', threeRequested, '(expect false)');
  console.log('  app screen active:', state.appOn, '| THREE defined:', state.threeDefined, '(expect false)');
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
