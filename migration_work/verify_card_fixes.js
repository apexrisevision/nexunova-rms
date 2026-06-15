const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT=path.resolve(__dirname,'..');const PORT=4871;const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(__dirname,'card_fixes_shots');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const FG_TOKEN='3e1a0f7987fa16fb1517c26f5a60b573';
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
  async function openBoard(p,token){
    await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'});
    await p.evaluate(t=>sessionStorage.setItem('rms.sales.token',t),token);
    await p.goto(BASE+'/sales-portal.html',{waitUntil:'networkidle0'}); await sleep(2200);
  }
  // Board with a SOLD (by agent) + RESERVED (by sales person) card
  let p=await np(1366,1000);
  await openBoard(p,'SOLD_READER_SESSION');
  const bylines=await p.evaluate(()=>[...document.querySelectorAll('.unit .uby')].map(e=>e.textContent));
  await p.screenshot({path:path.join(OUT,'A_board_bylines.png'),fullPage:true});
  await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await sleep(400);
  await p.screenshot({path:path.join(OUT,'B_board_bylines_dark.png'),fullPage:true});
  await p.close();
  // mobile
  let pm=await np(390,844);
  await openBoard(pm,'SOLD_READER_SESSION');
  await pm.screenshot({path:path.join(OUT,'C_board_bylines_mobile.png'),fullPage:true});
  await pm.close();
  // register view — confirm NO project picker, fields present
  let pr=await np(1366,950);
  await pr.goto(BASE+'/sales-portal.html?signup='+FG_TOKEN,{waitUntil:'networkidle0'});await sleep(1800);
  const regFields=await pr.evaluate(()=>({
    name: !!document.getElementById('reg-name'), phone: !!document.getElementById('reg-phone'), pin: !!document.getElementById('reg-pin'),
    hasSelect: !!document.querySelector('#screen-register select'),
    selectText: (document.querySelector('#screen-register select')||{}).textContent||''
  }));
  await pr.screenshot({path:path.join(OUT,'D_register_no_picker.png')});
  await pr.close();

  await browser.close();srv.close();
  console.log('CARD_BYLINES:',JSON.stringify(bylines));
  console.log('REGISTER_FIELDS:',JSON.stringify(regFields));
  console.log('CONSOLE_ERRORS:',errs.length);errs.slice(0,12).forEach(e=>console.log('  '+e));
  console.log('SHOTS:',fs.readdirSync(OUT).join(', '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
