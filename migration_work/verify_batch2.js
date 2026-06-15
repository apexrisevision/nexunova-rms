/** Batch-2 reskin verification: render Types&Floors / Payment Methods / Backup on a
 *  real session (ZZTEST), light+dark, console-error capture, + the 3 sacred round-trips:
 *  (A) create a type with default area/price -> persisted; (B) reorder floors -> order
 *  survives reload; (C) smart-delete guard fires on an in-use status. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const REF = 'itqxljtfbrppntgyfush';
const TOKEN = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const PORT = 4500; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'b2_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE = 'zztestinternalsafeto', PW = 'ZzTest!2026';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})});const t=await r.text();if(!r.ok)throw new Error(r.status+' '+t);return JSON.parse(t);}
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[];
async function shot(page,name){for(const t of ['dark','light']){await page.evaluate(x=>document.documentElement.setAttribute('data-theme',x),t);await sleep(200);await page.screenshot({path:path.join(OUT,name+'_'+t+'.png')});}await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));console.log('  shot',name);}
async function navTo(page,id){await page.evaluate((id)=>{try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){}if(typeof nav==='function')nav(id);},id);await sleep(1600);}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  await sql(`DELETE FROM category_unit_types WHERE type_name='ZZ Verify Type' AND company_id=(SELECT id FROM companies WHERE company_code='${CODE}');`).catch(()=>{});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1500,height:920});
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,180));});
  page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,180)));
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
  await page.evaluate(()=>doLogin()); await sleep(6000);
  await page.evaluate(()=>{try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){}});
  console.log('logged_in', await page.evaluate(()=>!!document.getElementById('s-app')?.classList.contains('on')));

  // ── RENDER ──
  await navTo(page,'categories'); await shot(page,'01_categories');
  await navTo(page,'payment-methods'); await shot(page,'02_payment_methods');
  await navTo(page,'backup'); await shot(page,'03_backup');

  // back to categories for round-trips
  await navTo(page,'categories');
  const proj = await page.evaluate(()=>({ project:(window._catProject||null), floors:(window._floorsCache||[]).length, types:(window._typesCache||[]).length, statuses:(window._statusesCache||[]).length }));
  console.log('cat_context', JSON.stringify(proj));

  // Modal screenshots (type w/ area+price, status w/ tone picker)
  await page.evaluate(()=>{ if(typeof openTypeModal==='function') openTypeModal(); });
  await sleep(700); await page.screenshot({path:path.join(OUT,'04_type_modal_dark.png')});
  await page.evaluate(()=>{ var n=document.getElementById('tp-name'); if(n)n.value='ZZ Verify Type'; var a=document.getElementById('tp-area'); if(a)a.value='999'; var p=document.getElementById('tp-price'); if(p)p.value='12345'; });
  await page.evaluate(()=>{ if(typeof saveTypeForm==='function') saveTypeForm(); });
  await sleep(2600);
  const typeChk = await sql(`SELECT type_name, default_area, default_price FROM category_unit_types WHERE type_name='ZZ Verify Type' AND company_id=(SELECT id FROM companies WHERE company_code='${CODE}');`);
  console.log('ROUNDTRIP_A_type_defaults =', JSON.stringify(typeChk));

  await page.evaluate(()=>{ if(typeof openStatusModal==='function') openStatusModal(); });
  await sleep(700); await page.screenshot({path:path.join(OUT,'05_status_modal_dark.png')});
  await page.evaluate(()=>{ if(typeof _catCloseModal==='function') _catCloseModal(); });

  // ── ROUND-TRIP B: floor reorder survives reload ──
  const flBefore = await page.evaluate(()=> (window._floorsCache||[]).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map(f=>f.name));
  const firstFloorId = await page.evaluate(()=>{ var fl=(window._floorsCache||[]).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)); return fl[0]?.id||null; });
  if (firstFloorId) {
    await page.evaluate((id)=>{ if(typeof _catMoveBot==='function') _catMoveBot('floors', id); }, firstFloorId);
    await sleep(2600);
  }
  await navTo(page,'dashboard'); await navTo(page,'categories'); // force a reload of the list
  const flAfter = await page.evaluate(()=> (window._floorsCache||[]).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map(f=>f.name));
  console.log('ROUNDTRIP_B_floor_order before[0]=', flBefore[0], ' after[last]=', flAfter[flAfter.length-1], ' moved=', (flBefore.length>1 && flAfter[flAfter.length-1]===flBefore[0]));

  // ── ROUND-TRIP C: smart-delete guard fires on an in-use status ──
  const inUseStatus = await page.evaluate(()=>{ var u=(window._unitsCache||[]).find(x=>x.statusId); return u?u.statusId:null; });
  console.log('in_use_status_id', inUseStatus);
  if (inUseStatus) {
    await page.evaluate((id)=>{ if(typeof deleteStatusConfirm==='function') deleteStatusConfirm(id); }, inUseStatus);
    await sleep(900);
    const guard = await page.evaluate(()=>{ var t=document.querySelector('#cat-modal-host .nx-modal-title'); var hasReassign=!!document.getElementById('catdel-reassign'); return { title:t?t.textContent:'', hasReassign }; });
    console.log('ROUNDTRIP_C_guard =', JSON.stringify(guard));
    await page.screenshot({path:path.join(OUT,'06_smartdelete_guard_dark.png')});
    await page.evaluate(()=>{ if(typeof _catCloseModal==='function') _catCloseModal(); });
  }

  console.log('CONSOLE_ERRS', errs.length);
  errs.slice(0,12).forEach(e=>console.log('  ERR',e));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
