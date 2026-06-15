const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4733;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,p)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'login.html':u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const page=await b.newPage();await page.setViewport({width:1400,height:880});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate(()=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value='awami';q.value='Samsungnote123*';window._loginReadyAt=0;});
  await page.evaluate(()=>doLogin());await sleep(8000);
  const diag=await page.evaluate(()=>{
    const cache=window._unitsCache||[];
    const g=(typeof gunits==='function')?gunits():[];
    const avail=g.filter(u=>u.isAvailable!==false&&!u.saleId);
    const byAvail=cache.filter(u=>u.isAvailable!==false).length;
    const bySale=cache.filter(u=>!u.saleId).length;
    const statusNull=cache.filter(u=>!u.status).length;
    // distinct status values in cache
    const st={};cache.forEach(u=>{const k=(u.status||'(none)');st[k]=(st[k]||0)+1;});
    return {
      rawCache:cache.length,
      gunits:g.length,
      newsaleAvail:avail.length,
      cache_isAvailable_true:byAvail,
      cache_no_saleId:bySale,
      cache_status_missing:statusNull,
      statusCounts:st,
      activeProject:(typeof activeProjectId==='function')?activeProjectId():'n/a',
      statusesCacheLen:(window._statusesCache||[]).length
    };
  });
  console.log(JSON.stringify(diag,null,2));
  await b.close();srv.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
