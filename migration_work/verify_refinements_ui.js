const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4861;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'refinements_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const errs=[];
  async function np(w,h){const p=await browser.newPage();await p.setViewport({width:w,height:h});
    p.on('console',m=>{if(m.type()==='error')errs.push('['+w+'] '+m.text().slice(0,150));});
    p.on('pageerror',e=>errs.push('[PAGEERR] '+e.message.slice(0,150)));return p;}
  // inject a session token then load the board
  async function openBoard(p, token){
    await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});
    await p.evaluate(t=>sessionStorage.setItem('rms.sales.token',t), token);
    await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});
    await sleep(2200);
  }

  // KBH board — real floor order (Ground..9th)
  let p=await np(1366,950);
  await openBoard(p,'KBH_READER_SESSION');
  const floorOrder=await p.evaluate(()=>[...document.querySelectorAll('#app-body .floor-lbl')].map(e=>e.textContent));
  await p.screenshot({path:path.join(OUT,'A_kbh_board_floor_order.png'),fullPage:true});
  await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await sleep(400);
  await p.screenshot({path:path.join(OUT,'B_kbh_board_dark.png'),fullPage:true});
  await p.close();
  // mobile
  let pm=await np(390,844);
  await openBoard(pm,'KBH_READER_SESSION');
  await pm.screenshot({path:path.join(OUT,'C_kbh_board_mobile.png'),fullPage:true});
  await pm.close();

  // ZZTEST board — tap reserved 1-01 -> privacy popup (no client)
  let pz=await np(1366,950);
  await openBoard(pz,'BOARD_TESTER_SESSION');
  const clicked=await pz.evaluate(()=>{const c=[...document.querySelectorAll('.unit.reserved')][0]; if(c){c.click();return true;}return false;});
  await sleep(500);
  const popupText=await pz.evaluate(()=>document.querySelector('#modal-host')?.textContent||'');
  await pz.screenshot({path:path.join(OUT,'D_reserved_privacy_popup.png')});
  await pz.close();

  await browser.close();srv.close();
  console.log('KBH_FLOOR_ORDER:',JSON.stringify(floorOrder));
  console.log('RESERVED_POPUP_CLICKED:',clicked);
  console.log('POPUP_HAS_RESERVED_BY:',/Reserved by/.test(popupText),'| popup leaks client name "Secret":',/Secret/.test(popupText));
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,12).forEach(e=>console.log('  '+e));
  console.log('SHOTS:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
