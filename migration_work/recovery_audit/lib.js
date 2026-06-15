// Shared harness for the Recovery Module workday audit.
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve(port){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(port,'127.0.0.1',()=>res(srv));});}

async function start(port){
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve(port);
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1100']});
  const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
  const errs=[]; const rpcs=[];
  page.on('console',m=>{const t=m.text(); if(m.type()==='error')errs.push(t.slice(0,260));});
  page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,260)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  // Capture RPC responses for attribution proof
  page.on('response',async r=>{ try{ const u=r.url(); if(u.includes('/rest/v1/rpc/')){ const fn=u.split('/rpc/')[1].split('?')[0]; let body=null; try{body=await r.text();}catch(_){ } rpcs.push({fn,status:r.status(),body:(body||'').slice(0,400)});} }catch(_){}} );
  const base='http://127.0.0.1:'+port;
  return { browser, page, srv, errs, rpcs, base, shot:(n)=>page.screenshot({path:path.join(OUT,n+'.png'),fullPage:false}) };
}

async function login(page, base, ident, pass){
  await page.goto(base+'/login.html',{waitUntil:'networkidle2'}); await sleep(1000);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ident,pass);
  await page.evaluate(()=>doLogin()); await sleep(9000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  return page.evaluate(()=>{
    const appOn = document.getElementById('s-app')?.classList.contains('on');
    let s=null; try{ s=(typeof S!=='undefined')?S:null; }catch(_){}
    return { loggedIn: !!appOn && !!(s&&s.userId), appOn, role: s?s.role:null, userId: s?s.userId:null, name: s?s.name:null, username: s?s.username:null };
  });
}

module.exports = { start, login, sleep, OUT };
