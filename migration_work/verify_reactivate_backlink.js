const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4881;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'reactivate_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',ZTOKEN='ab9f673bd43ca2efca5d455a23c96dd5';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const errs=[];
  function watch(p,tag){p.on('console',m=>{if(m.type()==='error')errs.push('['+tag+'] '+m.text().slice(0,140));});p.on('pageerror',e=>errs.push('[PAGEERR '+tag+'] '+e.message.slice(0,140)));}

  // 1) sales-portal: register -> "Already approved? Sign in" -> login shows back link -> back to register
  const sp=await browser.newPage();await sp.setViewport({width:1366,height:900});watch(sp,'portal');
  await sp.goto(BASE+'/sales-portal.html?signup='+ZTOKEN,{waitUntil:'networkidle0'});await sleep(1800);
  await sp.evaluate(()=>showScreen('screen-login'));await sleep(300);
  const backVisible=await sp.evaluate(()=>{const e=document.getElementById('login-to-register');return e&&getComputedStyle(e).display!=='none';});
  await sp.screenshot({path:path.join(OUT,'A_login_with_back_link.png')});
  const wentBack=await sp.evaluate(()=>{const a=document.querySelector('#login-to-register a'); if(a){a.click();return document.getElementById('screen-register').classList.contains('active');}return false;});
  await sp.close();

  // 2) admin Sales Access: inactive row shows Reactivate
  const p=await browser.newPage();await p.setViewport({width:1440,height:1000});watch(p,'admin');
  p.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
  await p.evaluate(()=>doLogin());await sleep(6500);
  await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await p.evaluate(()=>nav('salesaccess'));await sleep(2200);
  const hasReactivate=await p.evaluate(()=>/Reactivate/.test(document.querySelector('#pg-salesaccess')?.textContent||''));
  const hasInactive=await p.evaluate(()=>/Reactivate Me/.test(document.querySelector('#pg-salesaccess')?.textContent||''));
  await p.screenshot({path:path.join(OUT,'B_admin_reactivate_button.png'),fullPage:true});
  await p.close();

  await browser.close();srv.close();
  console.log('LOGIN_BACK_LINK_VISIBLE:',backVisible,'| clicking it returns to register:',wentBack);
  console.log('ADMIN_HAS_REACTIVATE_BTN:',hasReactivate,'| inactive row shown:',hasInactive);
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,10).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
