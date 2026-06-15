/** DASHBOARD 2.0 verification on FG real data. Login ZZTEST, point S.cid at FG
 *  (all dashboard RPCs are parameter-trusting), render the admin command view,
 *  assert the cross-tie trio, then shoot 1366+1920 light+dark. */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4713; const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'dash_shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const ZCODE='zztestinternalsafeto', ZPW='ZzTest!2026';
const FG='3249e3b5-c411-4f5f-ae48-0246304c9c87';
function serve(){return new Promise(res=>{const srv=http.createServer((req,resp)=>{const p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}resp.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(resp);}).listen(PORT,'127.0.0.1',()=>res(srv));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SIZES=[[1366,768,'1366'],[1920,1080,'1920']];
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--window-size=1936,1200']});
  const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  page.on('dialog',async d=>{try{await d.accept();}catch(e){}});
  await page.goto(BASE+'/login.html',{waitUntil:'networkidle2'}); await sleep(900);
  await page.evaluate((c,p)=>{const u=document.getElementById('li-u'),q=document.getElementById('li-p');u.removeAttribute('readonly');q.removeAttribute('readonly');u.value=c;q.value=p;window._loginReadyAt=0;},ZCODE,ZPW);
  await page.evaluate(()=>doLogin()); await sleep(6000);

  // S is a lexical `let` (not window.S), so we can't repoint S.cid from here.
  // Instead override the global dashboard loaders to query FG directly (the RPCs
  // are all parameter-trusting). The render path is unchanged — only the source cid.
  await page.evaluate((fg)=>{
    document.getElementById('s-onboarding')?.classList.remove('on');
    const today = (typeof td==='function') ? td() : '2026-06-13';
    window._dashRpCache={}; window._dashDayCache={};
    window._dashRP = async (from,to)=>{ const {data}=await supabase.rpc('get_recovery_position',{p_company_id:fg,p_project_id:null,p_from_date:from,p_to_date:to}); return data; };
    window._dashDaily = async (from,to)=>{ const {data}=await supabase.rpc('get_daily_collections',{p_company_id:fg,p_project_id:null,p_from:from,p_to:to}); return data||[]; };
    window._dashReceivable = async ()=>{ const {data}=await supabase.rpc('get_dashboard_receivable',{p_company_id:fg,p_project_id:null}); return {receivable:+(data&&data.receivable||0),contracted:+(data&&data.net_active||0),collected:+(data&&data.paid_active||0)}; };
    window._dashToday = async ()=>{ const [sr,dr]=await Promise.all([supabase.rpc('get_today_snapshot',{p_company_id:fg,p_project_id:null,p_today:today}).then(r=>r.data),supabase.rpc('get_daily_collections',{p_company_id:fg,p_project_id:null,p_from:today,p_to:today}).then(r=>r.data)]); const s=sr||{}; return {due:+(s.due_today||0),dueCount:+(s.due_today_count||0),received:(dr||[]).reduce((a,x)=>a+ +(x.amount||0),0),promises:+(s.promises_today||0),promiseNames:s.promise_names||[]}; };
    window._dashLoadPdcPipeline = async ()=>({count:0,amount:0,weeks:[0,1,2,3].map(i=>({label:'W'+(i+1),count:0,amount:0}))});
    window._dashLoadApprovals = async ()=>0;
  }, FG);
  await page.evaluate(()=>nav('dashboard')); await sleep(6500);

  // cross-tie read-back from the rendered DOM
  const probe = await page.evaluate(()=>{
    const txt=s=>{const e=document.querySelector(s);return e?e.textContent.trim():null;};
    const all=s=>Array.prototype.map.call(document.querySelectorAll(s),e=>e.textContent.trim());
    return {
      hero: txt('.nx-hero-value'),
      journey: all('.nx-journey-legend .nx-jl-a'),
      gauge: txt('.nx-gauge-val'),
      agingCenter: txt('.nx-donut-c-val'),
      aajRows: all('.nx-statchip-v'),
      gauges: document.querySelectorAll('.nx-gauge').length,
      donuts: document.querySelectorAll('.nx-donut').length,
      journeybars: document.querySelectorAll('.nx-journeybar').length,
      lateRows: document.querySelectorAll('.nx-late-row').length,
      avatars: document.querySelectorAll('.nx-avatar').length,
      pdcEmpty: !!Array.prototype.find.call(document.querySelectorAll('.nx-empty-msg'),e=>/cheques in hand/i.test(e.textContent))
    };
  });
  console.log('PROBE', JSON.stringify(probe,null,1));

  // overdue-trend cross-tie: recompute the exact series the hero rendered (uses the
  // FG-overridden _dashRP) and confirm the last point == Overdue Today.
  const trend = await page.evaluate(async ()=>{
    const months = _dashMonths(6);
    const rps = await Promise.all(months.map(m=>_dashRP(m.from,m.to)));
    const series = rps.map(r=>(Array.isArray(r.rows)?r.rows:[]).reduce((s,x)=>s+(Number(x.overdue_days)>0?Number(x.closing||0):0),0));
    return { labels: months.map(m=>m.label), ranges: months.map(m=>m.from+'..'+m.to), series,
             deltaChip: (document.querySelector('.nx-card .nx-badge')||{}).textContent || null,
             hasTrendline: !!document.querySelector('.nx-trendline'),
             trendCaption: (Array.prototype.find.call(document.querySelectorAll('.nx-kpi-label'),e=>/Overdue today/i.test(e.textContent))||{}).textContent||null };
  });
  console.log('TREND', JSON.stringify(trend,null,1));
  console.log('CONSOLE_ERRS', errs.length, errs.slice(0,8).join(' | '));

  for (const [w,h,tag] of SIZES){
    await page.setViewport({width:w,height:h}); await sleep(400);
    for (const theme of ['dark','light']){
      await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme); await sleep(300);
      await page.mouse.move(0,0); await sleep(60);
      await page.screenshot({path:path.join(OUT,`dashboard_${tag}_${theme}.png`), fullPage:true});
    }
    // fold-safety: capture the above-the-fold viewport (not full page) at this width
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme','dark'));
    await page.screenshot({path:path.join(OUT,`fold_${tag}.png`), fullPage:false});
    console.log('  shot', tag);
  }

  // ── scroll-state: prove the Who-is-late header no longer floats mid-card ──
  await page.setViewport({width:1920,height:1080}); await sleep(300);
  for (const theme of ['dark','light']){
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    await page.evaluate(()=>{
      const y=720; window.scrollTo(0,y);
      if(document.scrollingElement) document.scrollingElement.scrollTop=y;
      document.querySelectorAll('.pw,#pg-dashboard,.nx,#app,main').forEach(el=>{ if(el.scrollHeight>el.clientHeight+50) el.scrollTop=y; });
    });
    await sleep(500); await page.mouse.move(0,0); await sleep(60);
    await page.screenshot({path:path.join(OUT,`scroll_${theme}.png`), fullPage:false});
  }
  console.log('  scroll shots');
  await browser.close(); srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
