const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4709;const BASE=`http://127.0.0.1:${PORT}`;
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
const out=await page.evaluate(async()=>{
  const scid = window.S ? S.cid : 'NO_S(window)';
  const desc=gfloors().slice().sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0));
  const fromId=desc[0].id, toId=desc[1].id;
  const moved=desc.filter(f=>f.id!==fromId); moved.splice(1,0,desc[0]);
  const asc=moved.slice().reverse();
  const results=[];
  for(let i=0;i<asc.length;i++){ const f=asc[i]; let r; try{ r=await saveFloor({company_id:S.cid,id:f.id,sort_order:i+1}); }catch(e){ r={_error:{message:e.message}}; }
    results.push(f.name+' -> '+(r&&r._error?('ERR '+(r._error.message||r._error.code)):('ok '+JSON.stringify(r)))); }
  return { scid, plan: asc.map((f,i)=>f.name+'='+(i+1)), results };
});
console.log(JSON.stringify(out,null,1));
await sleep(800);
const db=await sql(`SELECT name,sort_order FROM floors WHERE company_id=(SELECT id FROM companies WHERE company_code='${CODE}') ORDER BY sort_order;`);
console.log('DB_now', JSON.stringify(db.map(f=>f.name+':'+f.sort_order)));
await browser.close();srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
