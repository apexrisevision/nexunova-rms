const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4901;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'login_default_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZTOKEN='ab9f673bd43ca2efca5d455a23c96dd5';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1400,1000']});
  const errs=[];
  const p=await browser.newPage();await p.setViewport({width:1366,height:950});
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
  p.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,140)));
  await p.goto(BASE+'/sales-portal.html?signup='+ZTOKEN,{waitUntil:'networkidle0'});await sleep(2000);
  const onLoad=await p.evaluate(()=>({
    loginActive: document.getElementById('screen-login').classList.contains('active'),
    registerActive: document.getElementById('screen-register').classList.contains('active'),
    loginCoName: (document.getElementById('login-co')||{}).textContent||'',
    loginCoVisible: (function(){const e=document.getElementById('login-co');return e&&getComputedStyle(e).display!=='none';})(),
    coFieldHidden: (function(){const e=document.getElementById('co-field');return e&&getComputedStyle(e).display==='none';})(),
    requestLinkVisible: (function(){const e=document.getElementById('login-to-register');return e&&getComputedStyle(e).display!=='none';})(),
    phonePlaceholder: (document.getElementById('i-phone')||{}).placeholder||''
  }));
  await p.screenshot({path:path.join(OUT,'A_link_defaults_to_login.png')});
  // go to register via the link
  await p.evaluate(()=>{const a=document.querySelector('#login-to-register a'); if(a) a.click();});await sleep(400);
  const reg=await p.evaluate(()=>({
    registerActive: document.getElementById('screen-register').classList.contains('active'),
    regCoName: (document.getElementById('reg-co')||{}).textContent||'',
    regCoVisible: (function(){const e=document.getElementById('reg-co');return e&&getComputedStyle(e).display!=='none';})(),
    phonePlaceholder: (document.getElementById('reg-phone')||{}).placeholder||'',
    cnicPlaceholder: (document.getElementById('reg-cnic')||{}).placeholder||''
  }));
  await p.screenshot({path:path.join(OUT,'B_register_company_name.png')});
  await p.close();await browser.close();srv.close();
  console.log('ON_LOAD:',JSON.stringify(onLoad,null,0));
  console.log('REGISTER:',JSON.stringify(reg,null,0));
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,8).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
