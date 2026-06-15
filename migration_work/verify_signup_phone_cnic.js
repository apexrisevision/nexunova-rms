const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4891;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'signup_phone_cnic_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026',ZTOKEN='ab9f673bd43ca2efca5d455a23c96dd5';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const errs=[];
  function watch(p,t){p.on('console',m=>{if(m.type()==='error')errs.push('['+t+'] '+m.text().slice(0,140));});p.on('pageerror',e=>errs.push('[PAGEERR '+t+'] '+e.message.slice(0,140)));}

  // Register view: CNIC field + phone hint; submit with +92 format -> pending
  const sp=await browser.newPage();await sp.setViewport({width:1366,height:950});watch(sp,'portal');
  await sp.goto(BASE+'/sales-portal.html?signup='+ZTOKEN,{waitUntil:'networkidle0'});await sleep(1800);
  const regHas=await sp.evaluate(()=>({cnic:!!document.getElementById('reg-cnic'),phoneHint:/03219694246/.test(document.querySelector('#screen-register')?.textContent||''),cnicHint:/35201-1234567-1/.test(document.querySelector('#screen-register')?.textContent||'')}));
  await sp.screenshot({path:path.join(OUT,'A_register_with_cnic.png')});
  await sp.evaluate(()=>{document.getElementById('reg-name').value='UI Reg Tester';document.getElementById('reg-phone').value='+923009998877';document.getElementById('reg-cnic').value='35201-7654321-9';document.getElementById('reg-pin').value='4321';});
  await sp.evaluate(()=>doRegister());await sleep(1800);
  const pendingShown=await sp.evaluate(()=>document.getElementById('screen-pending').classList.contains('active'));
  // now go to login -> company code field hidden (company known via link)
  await sp.evaluate(()=>goLogin());await sleep(400);
  const coHidden=await sp.evaluate(()=>{const f=document.getElementById('co-field');return f?getComputedStyle(f).display==='none':null;});
  await sp.screenshot({path:path.join(OUT,'B_login_no_company_code.png')});
  await sp.close();

  // admin: pending list shows the UI-registered person + CNIC
  const p=await browser.newPage();await p.setViewport({width:1440,height:1000});watch(p,'admin');
  p.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
  await p.evaluate(()=>doLogin());await sleep(6500);
  await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await p.evaluate(()=>nav('salesaccess'));await sleep(2200);
  const adminTxt=await p.evaluate(()=>document.querySelector('#pg-salesaccess')?.textContent||'');
  await p.screenshot({path:path.join(OUT,'C_admin_pending_cnic.png'),fullPage:true});
  await p.close();

  await browser.close();srv.close();
  console.log('REGISTER_HAS:',JSON.stringify(regHas));
  console.log('UI_REGISTER_PENDING_SHOWN:',pendingShown);
  console.log('LOGIN_COMPANY_CODE_HIDDEN:',coHidden);
  console.log('ADMIN_PENDING_HAS_CNIC:',/35201-7654321-9/.test(adminTxt),'| has UI Reg Tester:',/UI Reg Tester/.test(adminTxt));
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,10).forEach(e=>console.log('  '+e));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
