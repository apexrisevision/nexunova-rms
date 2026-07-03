/**
 * LEAD-ENTRY OPERATOR module — headless verification + screenshots (light/dark, 390px).
 * ZERO network / ZERO DB: supabase createClient is wrapped before any page script runs,
 * every sb.rpc() answers from an in-page mock DB (window.__NXMOCK). Flow tested:
 *   login-restore → Add lead (happy path, client dup hint, server duplicate) →
 *   My leads (groups, search, forwarded chip) → Connections / Website / WhatsApp / Instagram.
 * Reports console errors + horizontal overflow per screen. Shots → migration_work/le_shots/.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4231;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'le_shots');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };

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

// ── the mock installed BEFORE any page script (wraps supabase.createClient → rpc answers locally) ──
const MOCK_BOOT = `(() => {
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const db = {
    rows: [
      { id:'L1', name:'Ali Raza',   phone:'0300 1234567', source:'facebook',  project_name:'Fourteen Manzil Height', created_at: iso(2*3600e3) },
      { id:'L2', name:'Sana Tariq', phone:'0301 7654321', source:'whatsapp',  project_name:'',                       created_at: iso(26*3600e3) },
      { id:'L3', name:'Umar Farooq',phone:'0345 5556677', source:'website',   project_name:'Khushal Bagh Heights',   created_at: iso(3*86400e3) },
      { id:'L4', name:'Hina Aslam', phone:'0333 9998877', source:'instagram', project_name:'Fourteen Manzil Height', created_at: iso(5*86400e3) }
    ],
    nextId: 5,
    campaigns: [
      { id:'C1', platform:'facebook', campaign_name:'June Apartments Boost', amount:45000, start_date:'2026-06-01', end_date:'2026-06-30', notes:null, created_at: iso(2*86400e3) }
    ],
    campNextId: 2
  };
  const digits = v => String(v||'').replace(/\\D/g,'');
  const enteredPayload = () => ({ success:true,
    today: db.rows.filter(r => new Date(r.created_at).toDateString() === new Date().toDateString()).length,
    rows: db.rows.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)) });
  const adSpendPayload = () => {
    const byMonth = {};
    db.campaigns.forEach(c => { const m = c.start_date.slice(0,7);
      byMonth[m] = byMonth[m] || { month:m, month_label:new Date(c.start_date).toLocaleString('en-US',{month:'short',year:'numeric'}), total:0, campaigns:0 };
      byMonth[m].total += Number(c.amount); byMonth[m].campaigns += 1; });
    return { success:true, rows: db.campaigns.slice().sort((a,b)=>new Date(b.start_date)-new Date(a.start_date)),
      monthly: Object.values(byMonth).sort((a,b)=> b.month.localeCompare(a.month)) };
  };
  const handlers = {
    get_availability_board: () => ({ success:true, projects:[] }),
    get_my_profile: () => ({ success:true, profile:{ full_name:'Ayesha Khan', role:'lead_entry', company_name:'Fourteen Group', parent_sales_user_id:null } }),
    get_agreement_for_session: () => ({ success:true, pending:[], hold:false, is_initial:false }),
    get_sales_announcements: () => ({ success:true, announcements:[], unread:0, unread_announcements:0 }),
    get_my_lead_config: () => ({ success:true, role:'lead_entry', role_label:'Lead Entry', can_have_leads:true, can_assign:false,
      sources:[ {value:'facebook',label:'Facebook'},{value:'whatsapp',label:'WhatsApp'},{value:'instagram',label:'Instagram'},{value:'manual',label:'Manual'},{value:'website',label:'Website'} ] }),
    get_my_entered_leads: () => enteredPayload(),
    list_my_projects: () => ({ success:true, projects:[ {id:'P1',code:'FMH',name:'Fourteen Manzil Height'}, {id:'P2',code:'KBH',name:'Khushal Bagh Heights'} ] }),
    list_fb_connections: () => ({ success:true, pages:[ {page_id:'FB1', page_name:'FMH Official', status:'active'} ] }),
    get_connections_overview: () => ({ success:true,
      facebook:[ {name:'FMH Official', status:'active', leads:38, last_event: iso(3*3600e3), project:'Fourteen Manzil Height'} ],
      whatsapp:[ {name:'0311 4455667', active:true, leads:12, last_event: iso(20*3600e3), project:null} ],
      instagram:[],
      website:{ configured:true, leads:5 } }),
    get_web_lead_config: () => ({ success:true, intake_key:'nx_live_8f3kd93kq2', default_project_id:null, active:true }),
    list_whatsapp_connections: () => ({ success:true, connections:[ { phone_number_id:'104857xxxx', display_number:'0311 4455667',
      verify_token:'nxwa_9f8e7d6c', project_id:'P1', project_name:'Fourteen Manzil Height', has_token:false, active:true, leads_count:12, last_event_at: iso(20*3600e3) } ] }),
    list_instagram_connections: () => ({ success:true, connections:[] }),
    create_lead: (args) => {
      const p = (args && args.p_payload) || {};
      const d = digits(p.phone);
      if (d && db.rows.some(r => digits(r.phone) === d)) return { success:false, error:'duplicate_owned' };
      const projs = { P1:'Fourteen Manzil Height', P2:'Khushal Bagh Heights' };
      db.rows.unshift({ id:'L'+(db.nextId++), name:p.name, phone:p.phone, source:p.source, project_name:projs[p.project_id]||'', created_at:new Date().toISOString() });
      return { success:true, id:'L'+(db.nextId-1) };
    },
    get_my_ad_spend: () => adSpendPayload(),
    log_ad_spend: (args) => {
      const a = args || {};
      if (!['facebook','instagram','whatsapp'].includes(a.p_platform)) return { success:false, error:'bad_platform' };
      if (!a.p_campaign_name || !String(a.p_campaign_name).trim()) return { success:false, error:'name_required' };
      if (a.p_amount == null || Number(a.p_amount) < 0) return { success:false, error:'bad_amount' };
      if (!a.p_start_date || !a.p_end_date || a.p_end_date < a.p_start_date) return { success:false, error:'bad_dates' };
      db.campaigns.unshift({ id:'C'+(db.campNextId++), platform:a.p_platform, campaign_name:a.p_campaign_name, amount:Number(a.p_amount),
        start_date:a.p_start_date, end_date:a.p_end_date, notes:a.p_notes||null, created_at:new Date().toISOString() });
      return { success:true, id:'C'+(db.campNextId-1) };
    }
  };
  window.__NXMOCK = { calls: [], db };
  const answer = (fn, args) => {
    window.__NXMOCK.calls.push(fn);
    const h = handlers[fn];
    return { data: h ? h(args) : { success:true }, error:null };
  };
  let real;
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    get(){ return real; },
    set(v){
      if (v && typeof v.createClient === 'function') {
        const orig = v.createClient.bind(v);
        v.createClient = (...a) => { const c = orig(...a); c.rpc = async (fn, args) => answer(fn, args); return c; };
      }
      real = v;
    }
  });
  // restore-ready session + suppress the PWA install nudge in shots
  try {
    localStorage.setItem('rms.sales.token', 'NX-TEST-TOKEN');
    localStorage.setItem('rms.sales.active', String(Date.now()));
    localStorage.setItem('rms.sales.theme', 'light');           // deterministic light sweep first
    localStorage.setItem('nx.pwa.installed', '1');
    sessionStorage.setItem('nx.pwa.dismissed', '1');            // keep the install banner out of shots
  } catch(e) {}
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.evaluateOnNewDocument(MOCK_BOOT);

  await page.goto(BASE + '/sales-portal.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#le-name', { timeout: 15000 });   // bootstrap → _showApp → leadentry
  await sleep(400);

  const overflow = {};
  async function shot(name){
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    overflow[name] = await page.evaluate(() => {
      const vw = window.innerWidth;
      const over = document.documentElement.scrollWidth - vw;
      const bad = [];
      document.querySelectorAll('#screen-app *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 2 && getComputedStyle(el).display !== 'none' && el.offsetParent !== null)
          bad.push(((el.id ? '#'+el.id : '') + '.' + (el.className||'').toString().split(' ').filter(Boolean).slice(0,2).join('.')) + ' w=' + Math.round(r.width));
      });
      return { over, bad: [...new Set(bad)].slice(0, 8) };
    });
  }
  async function go(tab){ await page.evaluate(t => setTab(t), tab); await sleep(650); }
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };

  /* ═══ 1. ADD LEAD — happy path ═══ */
  await shot('01_add_light');
  const statBefore = await page.evaluate(() => document.querySelector('.le2-stats .le2-stat-n').textContent);
  await page.type('#le-name', 'Bilal Ahmed');
  await page.type('#le-phone', '0301 2345678');
  await page.evaluate(() => { document.querySelector('.le-chip[data-v="instagram"]').click(); });
  await page.evaluate(() => { document.getElementById('le-project').value = 'P1'; });
  await page.evaluate(() => document.getElementById('le-cta').click());
  await sleep(600);
  const afterAdd = await page.evaluate(() => ({
    toast: document.getElementById('toastbar').className.includes('show') ? document.getElementById('toastbar').textContent : '',
    name: document.getElementById('le-name').value,
    phone: document.getElementById('le-phone').value,
    src: document.getElementById('le-source').value,
    proj: document.getElementById('le-project').value,
    stat: document.querySelector('.le2-stats .le2-stat-n').textContent,
    focused: document.activeElement && document.activeElement.id
  }));
  expect(/added/i.test(afterAdd.toast), 'success toast after add (got: ' + afterAdd.toast + ')');
  expect(afterAdd.name === '' && afterAdd.phone === '', 'form clears for the next entry');
  expect(afterAdd.src === 'instagram' && afterAdd.proj === 'P1', 'source + project kept for batch entry');
  expect(Number(afterAdd.stat) === Number(statBefore) + 1, 'Added-today stat bumps in place');
  expect(afterAdd.focused === 'le-name', 'focus returns to Name');
  await shot('02_add_after_save_light');

  /* ═══ 2. client-side duplicate hint while typing ═══ */
  await page.type('#le-phone', '03001234567');
  await sleep(250);
  const hint = await page.evaluate(() => { const h = document.getElementById('le-phone-hint'); return h && h.style.display !== 'none' ? h.textContent : ''; });
  expect(/already added/i.test(hint), 'live duplicate hint under the phone field (got: ' + hint + ')');
  await shot('03_dup_hint_light');

  /* ═══ 3. server duplicate on save ═══ */
  await page.type('#le-name', 'Ali Raza Again');
  await page.evaluate(() => document.getElementById('le-cta').click());
  await sleep(500);
  const dupErr = await page.evaluate(() => ({
    err: (document.getElementById('le-err')||{}).textContent || '',
    marked: (document.getElementById('le-phone')||{}).className || ''
  }));
  expect(/already exists/i.test(dupErr.err), 'server duplicate shows inline error');
  expect(/input-err/.test(dupErr.marked), 'phone field gets the error ring');
  await shot('04_dup_server_light');

  /* ═══ 4. MY LEADS — groups, forwarded chip, search ═══ */
  await go('myleads');
  const list = await page.evaluate(() => ({
    secs: [...document.querySelectorAll('.le-dsec')].map(d => d.textContent.trim()),
    rows: document.querySelectorAll('.lrow').length,
    firstName: (document.querySelector('.lrow .lr-name')||{}).textContent || '',
    pool: [...document.querySelectorAll('.lrow')].filter(r => /In pool/.test(r.textContent)).length
  }));
  expect(list.secs.some(s => /^Today/.test(s)) && list.secs.some(s => /^Earlier/.test(s)), 'Today/Earlier groups render');
  expect(list.firstName === 'Bilal Ahmed', 'newest first (Bilal on top, got: ' + list.firstName + ')');
  expect(list.pool === list.rows, 'every row shows the forwarded "In pool" state');
  await shot('05_myleads_light');
  await page.type('.le-search .input', 'bilal');
  await sleep(300);
  const found = await page.evaluate(() => document.querySelectorAll('#le-listhost .lrow').length);
  expect(found === 1, 'search by name filters to 1 row (got ' + found + ')');
  await shot('06_myleads_search_light');
  await page.evaluate(() => _leSetQ('99999'));
  await sleep(200);
  const none = await page.evaluate(() => (document.querySelector('#le-listhost .empty .et')||{}).textContent || '');
  expect(/No match/.test(none), 'search empty state');

  /* ═══ 5. remaining screens (light) ═══ */
  await go('conn');       await shot('07_connections_light');
  await go('webleads');   await shot('08_website_light');
  await go('whatsapp');   await shot('09_whatsapp_light');
  await go('igdm');       await shot('10_instagram_light');
  await go('fbconnect');  await shot('11_fbconnect_light');

  /* ═══ 5b. AD SPEND — validation error, then happy path ═══ */
  await go('adspend');
  await shot('12_adspend_light');
  await page.evaluate(() => document.getElementById('ad-cta').click());   // empty form
  await sleep(300);
  const adValErr = await page.evaluate(() => (document.getElementById('ad-err')||{}).textContent || '');
  expect(/name is required/i.test(adValErr), 'ad-spend blocks an empty campaign name (got: ' + adValErr + ')');
  await page.type('#ad-name', 'July Instagram Push');
  await page.evaluate(() => document.querySelector('.le-chip[data-v="instagram"]').click());
  await page.type('#ad-amount', '25000');
  await page.evaluate(() => document.getElementById('ad-cta').click());
  await sleep(600);
  const afterAd = await page.evaluate(() => ({
    toast: document.getElementById('toastbar').className.includes('show') ? document.getElementById('toastbar').textContent : '',
    firstCampaign: (document.querySelector('#ad-camps-list .lr-name')||{}).textContent || '',
    rowCount: document.querySelectorAll('.le-dsec .nb')[0] ? document.querySelectorAll('.le-dsec')[0].textContent : ''
  }));
  expect(/logged/i.test(afterAd.toast), 'success toast after logging a campaign (got: ' + afterAd.toast + ')');
  expect(afterAd.firstCampaign === 'July Instagram Push', 'new campaign appears at the top of the list (got: ' + afterAd.firstCampaign + ')');
  await shot('13_adspend_after_save_light');

  // drawer open (nav grouping)
  await page.evaluate(() => openSidebar()); await sleep(350);
  await page.screenshot({ path: path.join(OUT, '14_drawer_light.png') });
  const drawerHas = await page.evaluate(() => !!document.querySelector('.ni[data-tab="adspend"]'));
  expect(drawerHas, 'Ad Spend nav button present in the drawer');
  await page.evaluate(() => closeSidebar()); await sleep(250);

  /* ═══ 6. DARK theme sweep ═══ */
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme','dark'); try{ localStorage.setItem('rms.sales.theme','dark'); }catch(e){} if (typeof _updateThemeBtn==='function') _updateThemeBtn(); });
  await sleep(250);
  await go('leadentry');  await shot('21_add_dark');
  await go('myleads');    await shot('22_myleads_dark');
  await go('conn');       await shot('23_connections_dark');
  await go('webleads');   await shot('24_website_dark');
  await go('whatsapp');   await shot('25_whatsapp_dark');
  await go('igdm');       await shot('26_instagram_dark');
  await go('adspend');    await shot('27_adspend_dark');
  await page.evaluate(() => openSidebar()); await sleep(350);
  await page.screenshot({ path: path.join(OUT, '28_drawer_dark.png') });

  await browser.close(); srv.close();

  console.log('SHOTS →', OUT);
  console.log('\n=== FLOW ASSERTIONS ===');
  console.log(failures.length ? failures.map(f => 'FAIL: ' + f).join('\n') : 'ALL PASS');
  console.log('\n=== HORIZONTAL OVERFLOW (px past 390 viewport) ===');
  for (const k of Object.keys(overflow)) if (overflow[k].over > 0 || overflow[k].bad.length) console.log(k, JSON.stringify(overflow[k]));
  if (!Object.keys(overflow).some(k => overflow[k].over > 0 || overflow[k].bad.length)) console.log('none');
  console.log('\n=== CONSOLE ERRORS ===');
  console.log(consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 20).join('\n') : 'none');
  process.exit(failures.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
