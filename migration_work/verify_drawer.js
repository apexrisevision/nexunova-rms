/**
 * POST-REVERT VERIFICATION — drawer nav restored for non-operator roles.
 * Per role (sale_rep/marketing_manager/director/admin=exec):
 *   - 5-tab bar GONE, drawer + hamburger present.
 *   - each destination the role should have is VISIBLE in the drawer (nav item +
 *     its .ni-grp not display:none) AND renders without throw/blank.
 *   - zero console errors on boot + every nav.
 * Zero network (supabase.createClient wrapped pre-boot; safe-proxy for unmocked RPCs).
 * Screenshots of the open drawer per role, light + dark, 390px.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4234;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'drawer_shots');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.webmanifest':'application/manifest+json' };

function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'sales-portal.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

function mockBoot(role){
  return `(() => {
    function safeProxy(){
      const arr = { map:()=>[],filter:()=>[],forEach:()=>{},some:()=>false,every:()=>true,find:()=>undefined,
        slice:()=>[],concat:()=>[],sort:()=>[],indexOf:()=>-1,includes:()=>false,join:()=>'',reduce:(fn,init)=>init };
      const h = { get(t,p){
        if(p==='success')return true; if(p==='length')return 0; if(p==='then')return undefined;
        if(p===Symbol.iterator)return function*(){}; if(p===Symbol.toPrimitive)return (hint)=>hint==='string'?'':0;
        if(typeof p==='symbol')return undefined; if(arr[p])return arr[p]; return safeProxy();
      }, apply(){return safeProxy();}, ownKeys(){return [];}, getOwnPropertyDescriptor(){return undefined;} };
      return new Proxy(function(){}, h);
    }
    const profiles = {
      sale_rep:{ full_name:'Rep Tester', role:'sale_rep', company_name:'Fourteen Group', parent_sales_user_id:'MGR1' },
      marketing_manager:{ full_name:'Manager Tester', role:'marketing_manager', company_name:'Fourteen Group', parent_sales_user_id:null },
      director:{ full_name:'Director Tester', role:'director', company_name:'Fourteen Group', parent_sales_user_id:null },
      admin:{ full_name:'Exec Tester', role:'admin', company_name:'Fourteen Group', parent_sales_user_id:null }
    };
    const ov = {
      get_my_profile: () => ({ success:true, profile: profiles['${role}'] }),
      get_agreement_for_session: () => ({ success:true, pending:[], hold:false, is_initial:false }),
      get_availability_board: () => ({ success:true, projects:[] }),
      get_sales_announcements: () => ({ success:true, announcements:[], unread:0, unread_announcements:0 }),
      list_my_leads: () => ({ success:true, leads:[], counts:{}, unchecked:0 }),
      get_my_lead_config: () => ({ success:true, role:'${role}', role_label:'${role}', can_have_leads:'${role}'!=='admin', sources:[], can_assign:('${role}'==='director'||'${role}'==='marketing_manager') })
    };
    window.__V = { calls: [] };
    const answer = (fn,args) => { window.__V.calls.push(fn); const h=ov[fn]; return { data: h?h(args):safeProxy(), error:null }; };
    let real;
    Object.defineProperty(window,'supabase',{ configurable:true, get(){return real;}, set(v){
      if(v&&typeof v.createClient==='function'){ const orig=v.createClient.bind(v); v.createClient=(...a)=>{ const c=orig(...a); c.rpc=async(fn,args)=>answer(fn,args); return c; }; }
      real=v;
    }});
    try{ localStorage.setItem('rms.sales.token','NX-V'); localStorage.setItem('rms.sales.active',String(Date.now()));
      localStorage.setItem('rms.sales.theme','light'); localStorage.setItem('nx.pwa.installed','1'); sessionStorage.setItem('nx.pwa.dismissed','1'); }catch(e){}
  })();`;
}

// destinations each role should be able to reach through the drawer
const EXPECT = {
  sale_rep:          ['home','leads','board','mine','mysales','clients','recovery','performance','rank'],
  marketing_manager: ['home','leads','distribute','team','teamrecovery','teamperf','targets','board','mine','mysales','rank'],
  director:          ['home','leads','distribute','fbsettings','team','teamrecovery','teamperf','targets','livemap','org','board','mine','mysales','rank','adroi'],
  admin:             ['home','adroi']
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const report = {};

  for (const role of Object.keys(EXPECT)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
    page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0,160)));
    await page.evaluateOnNewDocument(mockBoot(role));
    await page.goto(BASE + '/sales-portal.html', { waitUntil:'networkidle2' });
    try { await page.waitForSelector('#sb .sb-nav', { timeout:12000 }); } catch(e){}
    await sleep(500);

    const rr = { bootErrs: errs.slice(), noBottomBar:null, drawer:null, dests:{}, failures:[] };
    rr.noBottomBar = await page.evaluate(() => !document.getElementById('btabs'));
    rr.drawer = await page.evaluate(() => {
      const sb=document.getElementById('sb'); const tog=document.querySelector('.sb-toggle');
      return { present: !!sb, sbDisplay: sb?getComputedStyle(sb).display:'MISSING', toggleShown: tog?getComputedStyle(tog).display!=='none':false };
    });

    for (const dest of EXPECT[role]) {
      const vis = await page.evaluate((d) => {
        const el = document.querySelector('.sb [data-tab="'+d+'"]');
        if (!el) return { visible:false, reason:'no nav item' };
        // walk up: element + any ancestor must not be display:none
        let n = el;
        while (n && n !== document.body) { if (getComputedStyle(n).display === 'none') return { visible:false, reason:'hidden ancestor '+(n.className||n.tagName) }; n = n.parentElement; }
        return { visible:true };
      }, dest);

      // reset to Home first so a previous screen's async (e.g. Live Map GPS) can't bleed into this one
      await page.evaluate(() => { try{ setTab('home'); }catch(e){} });
      await sleep(250);
      const before = errs.length;
      await page.evaluate((d) => { try{ setTab(d); }catch(e){ window.__V.lastThrow = String(e && e.stack || e); } }, dest);
      await sleep(400);
      const jsThrow = await page.evaluate(() => { const t = window.__V.lastThrow; window.__V.lastThrow = null; return t || null; });
      const state = await page.evaluate(() => { const b=document.getElementById('app-body'); const h=b?b.innerHTML.trim():''; return { len:h.length, blank:h.length<20 }; });
      const navErrs = errs.slice(before);
      rr.dests[dest] = { visibleInDrawer: vis.visible, visReason: vis.reason||null, threw: jsThrow, blank: state.blank, len: state.len, consoleErrs: navErrs };
      if (!vis.visible) rr.failures.push(dest+': NOT visible in drawer ('+(vis.reason||'')+')');
      if (jsThrow) rr.failures.push(dest+': THREW '+jsThrow.split('\\n')[0]);
      if (state.blank) rr.failures.push(dest+': BLANK screen');
      if (navErrs.length) rr.failures.push(dest+': console '+navErrs[0]);
    }

    // open the drawer & shoot (light)
    await page.evaluate(() => { try{ setTab('home'); openSidebar(); }catch(e){} });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, role+'_drawer_light.png') });
    // dark
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme','dark'); try{ localStorage.setItem('rms.sales.theme','dark'); _updateThemeBtn&&_updateThemeBtn(); }catch(e){} });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, role+'_drawer_dark.png') });

    rr.bootErrs = rr.bootErrs.concat([]);
    report[role] = rr;
    await page.close();
  }

  await browser.close(); srv.close();

  console.log('DRAWER SHOTS →', OUT, '\\n');
  let allPass = true;
  for (const role of Object.keys(report)) {
    const r = report[role];
    const bar = r.noBottomBar ? 'no-btabs OK' : 'BTABS STILL PRESENT';
    const drw = (r.drawer.present && r.drawer.sbDisplay!=='none' && r.drawer.toggleShown) ? 'drawer+toggle OK' : ('DRAWER ISSUE '+JSON.stringify(r.drawer));
    const boot = r.bootErrs.length ? ('BOOT ERRS '+r.bootErrs.slice(0,3).join(' | ')) : 'boot clean';
    const verdict = (r.failures.length===0 && r.noBottomBar && r.drawer.present && r.drawer.sbDisplay!=='none' && r.drawer.toggleShown && r.bootErrs.length===0) ? 'PASS' : 'FAIL';
    if (verdict!=='PASS') allPass = false;
    console.log('['+verdict+'] '+role+' — '+bar+' · '+drw+' · '+boot+' · '+EXPECT[role].length+' destinations checked');
    if (r.failures.length) r.failures.forEach(f => console.log('        ✗ '+f));
  }
  console.log('\\n=== '+(allPass?'ALL ROLES PASS':'FAILURES ABOVE')+' ===');
  process.exit(allPass ? 0 : 2);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
