/** Focused re-verify: awaited floor reorder persistence + column-header icon fix. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const REF = 'itqxljtfbrppntgyfush';
const TOKEN = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const PORT = 4501; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'b2_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const CODE='zztestinternalsafeto', PW='ZzTest!2026';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})});return JSON.parse(await r.text());}
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const before=await sql(`SELECT name,sort_order FROM floors WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') ORDER BY sort_order;`);
  console.log('DB_before', JSON.stringify(before.map(f=>f.name+':'+f.sort_order)));
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1000']});
  const page=await browser.newPage(); await page.setViewport({width:1500,height:920});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
  await page.evaluate(()=>doLogin()); await sleep(6000);
  await page.evaluate(()=>{try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){}if(typeof nav==='function')nav('categories');}); await sleep(2000);
  // icon-fix check: column header should contain an <svg>, not escaped text
  const hdr = await page.evaluate(()=>{ var c=document.getElementById('cat-floors'); return c?c.innerHTML.includes('&lt;svg')||c.innerHTML.includes('&amp;lt;'):null; });
  console.log('header_has_escaped_svg_text(want false) =', hdr);
  // awaited reorder of the FIRST floor to bottom
  const firstId = await page.evaluate(()=>{ var fl=(window._floorsCache||[]).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)); return fl[0]?.id||null; });
  const firstName = before[0]?.name;
  await page.evaluate(async (id)=>{ if(typeof _catMoveBot==='function') await _catMoveBot('floors', id); }, firstId);
  await sleep(1500);
  const after=await sql(`SELECT name,sort_order FROM floors WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') ORDER BY sort_order;`);
  console.log('DB_after ', JSON.stringify(after.map(f=>f.name+':'+f.sort_order)));
  console.log('REORDER_persisted(first->last) =', after[after.length-1]?.name===firstName);
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,6).join(' | '));
  await page.screenshot({path:path.join(OUT,'07_categories_iconfix_dark.png')});
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
