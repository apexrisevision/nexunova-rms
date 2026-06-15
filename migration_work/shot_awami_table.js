const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4726;const BASE=`http://127.0.0.1:${PORT}`;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){return new Promise(res=>{const srv=http.createServer((q,p)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'login.html':u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);return p.end();}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const srv=await serve();
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1600,1050']});
  const page=await b.newPage();await page.setViewport({width:1500,height:1000});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'});await sleep(900);
  await page.evaluate(()=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value='awami';q.value='Samsungnote123*';window._loginReadyAt=0;});
  await page.evaluate(()=>doLogin());await sleep(7000);
  await page.evaluate(()=>{var o=document.getElementById('s-onboarding');if(o)o.classList.remove('on');nav('units');});await sleep(3500);
  await page.evaluate(()=>_uSetView('table'));await sleep(2500);
  // read the distinct floor-label column order (col 2) as they appear top-to-bottom
  const order=await page.evaluate(()=>{
    const seen=[];document.querySelectorAll('#pg-units table.nx-table tbody tr').forEach(tr=>{const c=tr.children[1];if(c){const v=c.textContent.trim();if(v&&seen[seen.length-1]!==v&&!seen.includes(v))seen.push(v);}});return seen;
  });
  console.log('FLOOR ORDER (table, top→bottom):',JSON.stringify(order));
  await page.screenshot({path:path.join(__dirname,'awami_table.png')});
  await b.close();srv.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
