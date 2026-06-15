/** Add-User form: render + empty-submit feedback check (live ZZTEST admin). */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4805; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'clientform_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1400,1100']});
  const page=await browser.newPage(); await page.setViewport({width:1366,height:950});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('pageerror',e=>errs.push('PAGEERR:'+e.message.slice(0,200)));
  page.on('dialog',async d=>{ console.log('DIALOG:', d.message().slice(0,80)); try{await d.dismiss();}catch(e){} });
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(7000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});
  await page.evaluate(()=>nav('clients')); await sleep(2500);
  const opened = await page.evaluate(()=>{ try{ ClientForm.open({}); return 'ok'; }catch(e){ return 'ERR:'+e.message; } });
  console.log('OPEN', opened); await sleep(1500);
  const m1 = await page.evaluate(()=>{ const ov=document.querySelector('.nx-modal-overlay'); const mo=document.querySelector('.nx-modal'); const bd=document.querySelector('.nx-modal-body'); const ti=document.querySelector('.nx-modal-title'); const tr=ti?ti.getBoundingClientRect():null; const mr=mo?mo.getBoundingClientRect():null; const cs=bd?getComputedStyle(bd):null;
    return { open:!!ov, fields:document.querySelectorAll('.nx-input,.nx-select').length, title:(ti?.textContent||''), titleTop: tr?Math.round(tr.top):null, modalTop: mr?Math.round(mr.top):null, modalBot: mr?Math.round(mr.bottom):null, modalH: mr?Math.round(mr.height):0, vh: window.innerHeight,
      bodyScrollTop: bd?bd.scrollTop:null, bodyScrollH: bd?bd.scrollHeight:null, bodyClientH: bd?bd.clientHeight:null, bodyMinH: cs?cs.minHeight:null, bodyFlex: cs?cs.flexGrow:null, overlayOverflow: ov?getComputedStyle(ov).overflowY:null }; });
  console.log('MODAL', JSON.stringify(m1));
  const chain = await page.evaluate(()=>{ let el=document.querySelector('.nx-modal-overlay'); const out=[]; while(el && el!==document.documentElement){ const cs=getComputedStyle(el); if(cs.transform!=='none'||cs.filter!=='none'||cs.willChange!=='auto'||cs.perspective!=='none'||(cs.contain&&cs.contain!=='none'&&cs.contain!=='normal')) out.push({tag:el.tagName.toLowerCase(),id:el.id||'',cls:(el.className||'').toString().slice(0,40),transform:cs.transform.slice(0,30),filter:cs.filter.slice(0,20),willChange:cs.willChange,contain:cs.contain}); el=el.parentElement; } return out; });
  console.log('ANCESTORS', JSON.stringify(chain));
  await page.screenshot({path:path.join(OUT,'userform_open.png')});  // viewport only

  // empty submit → feedback?
  await page.evaluate(()=>{ try{ ClientForm.save(); }catch(e){} }); await sleep(800);
  const fb = await page.evaluate(()=>{ const e=document.getElementById('cfm-error'); return { errShown: e && e.style.display!=='none' && e.offsetParent!==null, errText:(e?e.textContent:'').slice(0,80), errInView: e?(()=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight;})():false }; });
  console.log('EMPTY_SUBMIT', JSON.stringify(fb));
  await page.screenshot({path:path.join(OUT,'userform_emptysubmit.png'), fullPage:true});
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
