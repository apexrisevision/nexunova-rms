const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4503;const BASE=`http://127.0.0.1:${PORT}`;
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
await page.evaluate(()=>{try{document.getElementById('s-onboarding')?.classList.remove('on');}catch(e){}if(typeof nav==='function')nav('categories');});await sleep(2000);
const diag=await page.evaluate(async()=>{
  const fl=(window._floorsCache||[]).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
  const gid=fl[0]?.id;
  const cur=(typeof getCurrentCompanyId==='function')?getCurrentCompanyId():'NO_FN';
  const scid=window.S?S.cid:'NO_S';
  const r1=await saveFloor({id:gid, sort_order:9});
  const r2=await saveFloor({id:gid, company_id:scid, sort_order:8});
  return {gid, cur, scid, match:cur===scid, r1:JSON.stringify(r1), r2:JSON.stringify(r2)};
});
console.log(JSON.stringify(diag,null,1));
const db=await sql(`SELECT name,sort_order FROM floors WHERE id='${diag.gid}';`);
console.log('DB_now', JSON.stringify(db));
await browser.close();srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
