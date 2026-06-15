const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4851;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'signup_redesign_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const ZCODE='zztestinternalsafeto',ZPW='ZzTest!2026';
const ZTOKEN='f4910951c2445d908bd00f559e970cb0';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1500,1200']});
  const errs=[];
  async function np(w,h){const p=await browser.newPage();await p.setViewport({width:w,height:h});
    p.on('console',m=>{if(m.type()==='error')errs.push('['+w+'] '+m.text().slice(0,150));});
    p.on('pageerror',e=>errs.push('[PAGEERR '+w+'] '+e.message.slice(0,150)));
    p.on('dialog',async d=>{try{await d.accept();}catch(e){}});return p;}

  // ===== A) sales-portal register view + pending screen =====
  let sp=await np(1366,900);
  await sp.goto(BASE+'/sales-portal.html?signup='+ZTOKEN,{waitUntil:'networkidle0'});await sleep(2000);
  const regShown=await sp.$eval('#screen-register',el=>el.classList.contains('active')).catch(()=>false);
  const regCo=await sp.$eval('#reg-co-name',el=>el.textContent).catch(()=>'');
  await sp.screenshot({path:path.join(OUT,'A1_register_view.png')});
  await sp.evaluate(()=>showScreen('screen-pending'));await sleep(300);
  await sp.screenshot({path:path.join(OUT,'A2_pending_screen.png')});
  await sp.close();
  // mobile register
  let spm=await np(390,844);
  await spm.goto(BASE+'/sales-portal.html?signup='+ZTOKEN,{waitUntil:'networkidle0'});await sleep(2000);
  await spm.screenshot({path:path.join(OUT,'A3_register_mobile.png')});
  await spm.close();
  // invalid token -> falls back to login with error
  let spb=await np(1366,900);
  await spb.goto(BASE+'/sales-portal.html?signup=bad-token-xyz',{waitUntil:'networkidle0'});await sleep(1800);
  const badShownLogin=await spb.$eval('#screen-login',el=>el.classList.contains('active')).catch(()=>false);
  await spb.close();

  // ===== B) admin Sales Access (login as ZZTEST owner) =====
  let p=await np(1366,900);
  await p.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await p.evaluate((c,q)=>{const u=document.getElementById('li-u'),w=document.getElementById('li-p');u.removeAttribute('readonly');w.removeAttribute('readonly');u.value=c;w.value=q;window._loginReadyAt=0;},ZCODE,ZPW);
  await p.evaluate(()=>doLogin());await sleep(6500);
  await p.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await p.evaluate(()=>nav('salesaccess'));await sleep(2400);
  const txt=await p.evaluate(()=>document.querySelector('#pg-salesaccess')?.textContent||'');
  const hasSignupLink=/Sales signup link/.test(txt);
  const hasPending=/Pending registrations/.test(txt)&&/Awaiting Approval/.test(txt);
  const hasActive=/Approved Rep/.test(txt);
  const hasAddBtn=/Add sales person/.test(txt);   // should be GONE
  await p.screenshot({path:path.join(OUT,'B1_admin_salesaccess_light.png'),fullPage:true});
  // approve modal (open, don't submit)
  const approveOpened=await p.evaluate(()=>{const b=[...document.querySelectorAll('#pg-salesaccess button')].find(x=>/Approve/.test(x.textContent));if(b){b.click();return true;}return false;});
  await sleep(500);
  const modalHasScope=await p.evaluate(()=>/Project scope/.test(document.querySelector('.nx-modal-overlay')?.textContent||''));
  await p.screenshot({path:path.join(OUT,'B2_approve_modal.png')});
  await p.evaluate(()=>_saCloseModal&&_saCloseModal());
  // dark + 1920
  await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await sleep(400);
  await p.screenshot({path:path.join(OUT,'B3_admin_dark.png'),fullPage:true});
  await p.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await p.setViewport({width:1920,height:1080});await sleep(500);
  await p.screenshot({path:path.join(OUT,'B4_admin_1920.png'),fullPage:true});
  await p.close();

  await browser.close();srv.close();
  console.log('REGISTER_VIEW_SHOWN:',regShown,'| company shown:',JSON.stringify(regCo));
  console.log('INVALID_TOKEN_FALLS_TO_LOGIN:',badShownLogin);
  console.log('ADMIN signuplink:',hasSignupLink,'| pending list:',hasPending,'| active list:',hasActive,'| OLD Add button gone:',!hasAddBtn);
  console.log('APPROVE_MODAL_OPENED:',approveOpened,'| has scope picker:',modalHasScope);
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,15).forEach(e=>console.log('  '+e));
  console.log('SHOTS:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
