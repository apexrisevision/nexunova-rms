const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4336;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
const srv = http.createServer((q,r)=>{ const p=decodeURIComponent(q.url.split('?')[0]); let f=path.join(ROOT,p==='/'?'login.html':p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
const has = (arr, re) => arr.some(u => re.test(u));
(async () => {
  await new Promise(res=>srv.listen(PORT,'127.0.0.1',res));
  // logged-in simulation so three.js is skipped too (cleanest "what's eager" view)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1366, height:900 });
  await page.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { var a=document.getElementById('s-app'); var l=document.getElementById('s-login'); if(a)a.classList.add('on'); if(l)l.classList.remove('on'); }); });
  const reqs=[]; const errs=[];
  page.on('request', q=>reqs.push(q.url()));
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e=>errs.push('PAGEERROR '+e.message));
  await page.goto(`http://127.0.0.1:${PORT}/login.html`, { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1500));

  const eager = {
    chart:   has(reqs,/chart(\.umd|\.min)?\.js/i),
    three:   has(reqs,/three(\.min)?\.js/),
    xlsx:    has(reqs,/xlsx/),
    intltel: has(reqs,/intlTelInput/i),
    supabase:has(reqs,/supabase/),
  };

  // lazy-load chart.js on demand + render a REAL chart to a canvas (proves the lib works)
  const chartTest = await page.evaluate(async () => {
    const before = typeof Chart;
    await window.ensureChart();
    const cv = document.createElement('canvas'); cv.id='__t'; cv.width=200; cv.height=100;
    document.body.appendChild(cv);
    const ch = new Chart(cv.getContext('2d'), { type:'line', data:{ labels:['Jan','Feb','Mar'], datasets:[{ label:'x', data:[3,5,4] }] }, options:{ responsive:false, animation:false } });
    const ok = !!(ch && ch.canvas && ch.data && ch.data.datasets[0].data.length===3);
    return { before, after: typeof Chart, version: (window.Chart && Chart.version) || null, rendered: ok };
  });
  const chartRequestedAfter = has(reqs,/chart(\.umd|\.min)?\.js/i);

  await browser.close(); srv.close();
  console.log('EAGER first paint (logged-in) — expect chart:false three:false xlsx:false intltel:false supabase:true');
  console.log('  ', JSON.stringify(eager));
  console.log('chart.js requested AFTER ensureChart():', chartRequestedAfter, '(expect true)');
  console.log('CHART lazy + real render:', JSON.stringify(chartTest));
  const real = errs.filter(e=>!/401|404|Failed to load resource|WebGL|swiftshader/i.test(e));
  console.log('real JS errors:', real.length, real.slice(0,6).join(' | '));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
