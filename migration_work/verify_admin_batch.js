/** ADMIN BATCH verification — Users & Roles · Settings · Team · Audit reskin.
 *  Logs into the ZZTEST scratch tenant (admin pages are company-scoped, so the
 *  user round-trip belongs here — never FG). Drives the real UI:
 *    create user (chosen username, no email) → on-screen temp pw → reset pw →
 *    deactivate → confirm each shows up in the Audit Trail.
 *  Then shoots every page at 1366+1920 × light/dark and reports console errors. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4719; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'admin_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];
const uname='qareskin'+Date.now().toString().slice(-6);

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
  page.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,200)));
  const badResp=[]; page.on('response',r=>{ if(r.status()>=400){ badResp.push(r.status()+' '+r.url().split('/').slice(-1)[0].slice(0,60)); } });
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6000);
  await page.evaluate(()=>{document.getElementById('s-onboarding')?.classList.remove('on');});

  const R={};

  // ── USERS & ROLES ───────────────────────────────────────────────────
  // DOM helpers (the page's _usersData / _audRows are lexical `let`, not on window)
  const rowByUname = un => page.evaluate((u)=>{
    const tr=[...document.querySelectorAll('#users-list-wrap tbody tr')].find(r=>r.textContent.includes('@'+u));
    if(!tr) return null;
    const btn=k=>{ const b=[...tr.querySelectorAll('button')].find(x=>(x.getAttribute('onclick')||'').includes(k)); return b?b.getAttribute('onclick'):null; };
    return { text: tr.textContent.replace(/\s+/g,' ').trim().slice(0,80), reset:btn('_umResetPw'), toggle:btn('_umToggle'), badge:(tr.querySelector('.nx-badge')||{}).textContent };
  }, un);

  await page.evaluate(()=>nav('users')); await sleep(2500);
  R.usersInit = await page.evaluate(()=>({
    table: !!document.querySelector('#users-list-wrap .nx-table'),
    header: !!document.querySelector('.nx-page-header'),
    avatars: document.querySelectorAll('#users-list-wrap tbody .nx-avatar').length,
    statchips: document.querySelectorAll('#um-stats .nx-statchip').length,
    rows: document.querySelectorAll('#users-list-wrap tbody tr').length
  }));

  // create user (chosen username, NO email) via the real modal
  await page.evaluate(()=>openAddUserModal()); await sleep(400);
  R.addModal = await page.evaluate(()=>({
    modal: !!document.querySelector('#um-modal-host .nx-modal'),
    fields: document.querySelectorAll('#um-modal-host .nx-input, #um-modal-host .nx-select').length
  }));
  await page.evaluate((un)=>{
    document.getElementById('um-name').value='QA Reskin Tester';
    const u=document.getElementById('um-username'); u.value=un; umUnamePrev();
    document.getElementById('um-role').value='recovery';
    document.getElementById('um-pass').value='QaReskin!2026';
  }, uname);
  await page.screenshot({path:path.join(OUT,'users_addmodal.png')});
  await page.evaluate(()=>saveUserModal()); await sleep(3500);
  R.createdRow = await rowByUname(uname);

  // reset password → no email → on-screen temp pw modal (run the row's reset action)
  if(R.createdRow && R.createdRow.reset){
    await page.evaluate(js=>{ (0,eval)(js); }, R.createdRow.reset); await sleep(3500);
    R.tempPw = await page.evaluate(()=>{ const v=document.getElementById('um-temppw-val'); return v?{shown:true,len:(v.textContent||'').length}:{shown:false}; });
    await page.screenshot({path:path.join(OUT,'users_temppw.png')});
    await page.evaluate(()=>umCloseTempPassword()); await sleep(400);

    // deactivate (run the row's toggle action)
    await page.evaluate(js=>{ (0,eval)(js); }, R.createdRow.toggle); await sleep(3500);
    R.afterToggle = await rowByUname(uname);
  }

  // ── AUDIT TRAIL — confirm the credential changes landed ──────────────
  await page.evaluate(()=>nav('audit')); await sleep(4000);
  R.audit = await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#aud-table-wrap tbody tr')];
    return {
      table: !!document.querySelector('#aud-table-wrap .nx-table'),
      kpis: document.querySelectorAll('#aud-stats-row .nx-kpi').length,
      rows: rows.length,
      appUserRows: rows.filter(r=>/app_users/.test(r.textContent)).length,
      actionBadges: document.querySelectorAll('#aud-table-wrap tbody .nx-badge').length
    };
  });
  // open a diff modal for screenshot (click first row)
  await page.evaluate(()=>{ const tr=document.querySelector('#aud-table-wrap tbody tr'); if(tr) tr.click(); }); await sleep(2500);
  R.auditModal = await page.evaluate(()=>!!document.querySelector('#aud-modal-host .nx-modal'));
  await page.screenshot({path:path.join(OUT,'audit_diff.png')});
  await page.evaluate(()=>_audCloseModal()); await sleep(300);

  // ── TEAM ─────────────────────────────────────────────────────────────
  await page.evaluate(()=>nav('team')); await sleep(2500);
  R.team = await page.evaluate(()=>({
    header: !!document.querySelector('.nx-page-header'),
    tableOrEmpty: !!document.querySelector('#team-body .nx-table') || !!document.querySelector('#team-body .nx-empty')
  }));

  // ── SETTINGS (admin hub) — tabs + save round-trip ───────────────────
  await page.evaluate(()=>nav('admin')); await sleep(2500);
  R.settingsInit = await page.evaluate(()=>({
    tabs: document.querySelectorAll('#adm-tabs .nx-tab').length,
    cards: document.querySelectorAll('#a-ct .nx-card').length
  }));
  // save settings round-trip
  await page.evaluate(()=>{ const od=document.getElementById('set-od'); if(od) od.value='45'; saveSettings(); }); await sleep(2000);
  // visit each tab
  for(const t of ['profile','security','plan','import']){
    await page.evaluate((tt)=>setAT(tt), t); await sleep(t==='security'||t==='plan'?2500:1200);
  }
  R.settingsTabs = await page.evaluate(()=>({
    activeTab: (document.querySelector('#adm-tabs .nx-tab--on span')||{}).textContent||null,
    importCard: !!document.querySelector('#a-ct .nx-card')
  }));
  await page.evaluate(()=>setAT('settings')); await sleep(1200);

  console.log('RESULT', JSON.stringify(R,null,1));
  console.log('CONSOLE_ERRS', errs.length, '\n  '+errs.slice(0,12).join('\n  '));
  console.log('BAD_RESPONSES', badResp.length, '\n  '+[...new Set(badResp)].slice(0,12).join('\n  '));

  // ── SCREENSHOTS: every page × size × theme ──────────────────────────
  const pages=[['users','users'],['team','team'],['audit','audit'],['admin','settings']];
  for(const [w,h,tag] of SIZES){
    await page.setViewport({width:w,height:h}); await sleep(300);
    for(const [route,name] of pages){
      await page.evaluate(r=>nav(r),route); await sleep(route==='audit'||route==='admin'?3000:1800);
      if(route==='admin'){ await page.evaluate(()=>setAT('settings')); await sleep(800); }
      for(const theme of ['light','dark']){
        await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(300);
        await page.mouse.move(0,0); await sleep(60);
        await page.screenshot({path:path.join(OUT,`${name}_${tag}_${theme}.png`), fullPage:true});
      }
    }
    console.log('  shots',tag);
  }

  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
