const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, 'win3_shots'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
const srv = http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
const has = (arr, re) => arr.some(u => re.test(u));
(async () => {
  await new Promise(res=>srv.listen(PORT,'127.0.0.1',res));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--use-gl=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1366, height:900 });
  const reqs = []; const errs = [];
  page.on('request', q => reqs.push(q.url()));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR '+e.message));

  await page.goto(`http://127.0.0.1:${PORT}/login.html`, { waitUntil:'networkidle2' });

  // snapshot of what loaded right after first paint (before any lazy trigger)
  const eagerSnap = reqs.slice();
  const eager = {
    three:   has(eagerSnap, /three(\.min)?\.js/),
    xlsx:    has(eagerSnap, /xlsx/),
    intltel: has(eagerSnap, /intlTelInput/i),
    supabase:has(eagerSnap, /supabase/),
    chart:   has(eagerSnap, /chart/),
  };

  // give the login-screen three.js gate time to fire (login is the active screen)
  await new Promise(r=>setTimeout(r,2500));
  const afterLogin = {
    threeRequested: has(reqs, /three(\.min)?\.js/),
    threeDefined: await page.evaluate(()=>typeof THREE!=='undefined'),
    canvas: await page.evaluate(()=>!!document.getElementById('lx-canvas')),
    loginOn: await page.evaluate(()=>document.getElementById('s-login').classList.contains('on')),
  };

  // XLSX: lazy-load on demand + real workbook round-trip (proves export works post-load)
  const xlsxTest = await page.evaluate(async () => {
    const before = typeof XLSX;
    await window.ensureXLSX();
    const aoa = [['Unit','Paid'],['6-19',2850000]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Test');
    const buf = XLSX.write(wb, { type:'array', bookType:'xlsx' });   // real serialize (no download)
    return { before, after: typeof XLSX, bytes: buf.byteLength, ok: buf.byteLength > 0 };
  });

  // intl-tel: lazy-load on demand
  const itelTest = await page.evaluate(async () => {
    const before = typeof window.intlTelInput;
    await window.ensureIntlTel();
    return { before, after: typeof window.intlTelInput };
  });

  // screenshots of the login screen (with 3D bg) light+dark, 1366+1920
  for (const w of [1366,1920]) { await page.setViewport({width:w,height:w===1366?900:1080});
    for (const t of ['dark','light']) { await page.evaluate(th=>document.documentElement.setAttribute('data-theme',th),t); await new Promise(r=>setTimeout(r,400)); await page.screenshot({path:path.join(OUT,`login_${w}_${t}.png`)}); } }

  await browser.close(); srv.close();
  console.log('EAGER (first paint) — should be three:false xlsx:false intltel:false, supabase:true chart:true');
  console.log('  ', JSON.stringify(eager));
  console.log('THREE on login screen:', JSON.stringify(afterLogin));
  console.log('XLSX lazy + real export:', JSON.stringify(xlsxTest));
  console.log('intl-tel lazy:', JSON.stringify(itelTest));
  const real = errs.filter(e=>!/401|404|Failed to load resource|swiftshader|GL |WebGL|GroupMarker/i.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
