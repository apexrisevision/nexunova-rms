const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4708;const BASE=`http://127.0.0.1:${PORT}`;
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync(path.join(ROOT,'.mcp.json'),'utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const CODE='zztestinternalsafeto',PW='ZzTest!2026';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})});return JSON.parse(await r.text());}
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});const page=await browser.newPage();
await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},CODE,PW);
await page.evaluate(()=>doLogin());await sleep(6000);
await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');if(typeof nav==='function')nav('categories');});await sleep(1800);
const before=await sql(`SELECT name,sort_order FROM floors WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') ORDER BY sort_order DESC;`);
const ids=await page.evaluate(()=>{const fl=(window._floorsCache||[]).slice().sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0));return {top:fl[0]?.id,second:fl[1]?.id};});
// proper drag: _bldDS sets the lexical _bldDrag, then _bldDP drops onto 'second'
await page.evaluate(async(top,second)=>{ _bldDS(top,{dataTransfer:{}}); await _bldDP(second,{preventDefault(){}}); },ids.top,ids.second);
await sleep(2000);
const after=await sql(`SELECT name,sort_order FROM floors WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') ORDER BY sort_order DESC;`);
console.log('before(top→):',before.map(f=>f.name).join(' > '));
console.log('after (top→):',after.map(f=>f.name).join(' > '));
console.log('REORDER_persisted_and_changed =', JSON.stringify(before.map(f=>f.name))!==JSON.stringify(after.map(f=>f.name)));
await browser.close();srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
