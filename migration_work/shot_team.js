/** Team Performance verification (live ZZTEST). Screenshots the warm Team
 *  leaderboard (populated), the per-officer drawer, the admin Dashboard team
 *  panel, and Report #9 (Officer Performance). 1366+1920 light+dark, console
 *  errors captured. Seed (officer + June activity) is in the DB; MCP cleans up. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4761; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'team_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6500);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  async function shoot(name, prep){
    for (const [w,h,tag] of SIZES){
      await page.setViewport({width:w,height:h}); await sleep(250);
      for (const theme of ['dark','light']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(200);
        if (prep) await prep();
        await page.mouse.move(0,0); await sleep(60);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shot', name);
  }

  // ── Dashboard (admin team panel) ──
  await page.evaluate(()=>nav('dashboard')); await sleep(4200);
  const dashProbe = await page.evaluate(()=>{
    const cards=[...document.querySelectorAll('#pg-dashboard .nx-card')];
    const panel=cards.find(c=>/Recovery team/i.test(c.textContent));
    return { hasPanel: !!panel };
  });
  console.log('DASH_PANEL', JSON.stringify(dashProbe));
  await shoot('dashboard');

  // ── Team page (populated leaderboard, default = This month) ──
  await page.evaluate(()=>nav('team')); await sleep(3000);
  const teamProbe = await page.evaluate(()=>({
    rows: document.querySelectorAll('#team-body .nx-table tbody tr').length,
    tabs: document.querySelectorAll('#team-filt .nx-tab').length,
    firstOfficer: document.querySelector('#team-body .nx-table tbody tr')?.innerText.replace(/\s+/g,' ').slice(0,80)
  }));
  console.log('TEAM', JSON.stringify(teamProbe));
  await shoot('team_leaderboard');

  // ── Per-officer drawer ──
  await page.evaluate(()=>{ const id=(_teamRows&&_teamRows[0])&&_teamRows[0].user_id; if(id) _teamDrawer(String(id)); }); await sleep(1400);
  await shoot('team_drawer');
  await page.evaluate(()=>{ document.querySelector('.dx-drawer-x')?.click(); }); await sleep(500);

  // ── Report #9 — Officer Performance ──
  await page.evaluate(()=>nav('reports')); await sleep(1500);
  await page.evaluate(()=>openRptViewer('team_performance')); await sleep(3000);
  const rptProbe = await page.evaluate(()=>({
    title: document.querySelector('#pg-reports .nxr-title, #pg-reports h1, #pg-reports .nx-modal-title')?.textContent||'',
    bodyRows: document.querySelectorAll('#nxr-body table tbody tr').length,
    cols: document.querySelectorAll('#nxr-body table thead th').length
  }));
  console.log('REPORT9', JSON.stringify(rptProbe));
  await shoot('report9_officer_perf');

  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,12).join(' | '));
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
