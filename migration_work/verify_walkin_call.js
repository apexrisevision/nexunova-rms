/**
 * VERIFY: Walk-in + Call lead sources for the lead_entry operator.
 * Mirrors the REAL post-UPDATE lead_role_config.create_sources
 * (["facebook","instagram","whatsapp","website","walkin","call","manual"])
 * through the mocked get_my_lead_config, then asserts:
 *   1. Both "Walk-in" and "Call" chips render (correct data-v + label + icon glyph).
 *   2. Selecting each chip and saving posts the right source tag to create_lead.
 *   3. My Leads renders those rows with the proper icon + source label.
 * ZERO DB / ZERO network (same mock pattern as shot_lead_entry.js).
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4237;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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

const MOCK_BOOT = `(() => {
  const db = { rows: [], nextId: 1 };
  const digits = v => String(v||'').replace(/\\D/g,'');
  const enteredPayload = () => ({ success:true,
    today: db.rows.length,
    rows: db.rows.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)) });
  // ── REAL post-UPDATE source list from lead_role_config.create_sources ──
  const SOURCES = [
    {value:'facebook',label:'Facebook'},{value:'instagram',label:'Instagram'},
    {value:'whatsapp',label:'WhatsApp'},{value:'website',label:'Website'},
    {value:'walkin',label:'Walk-in'},{value:'call',label:'Call'},
    {value:'manual',label:'Manual'} ];
  const handlers = {
    get_availability_board: () => ({ success:true, projects:[] }),
    get_my_profile: () => ({ success:true, profile:{ full_name:'Ayesha Khan', role:'lead_entry', company_name:'Fourteen Group', parent_sales_user_id:null } }),
    get_agreement_for_session: () => ({ success:true, pending:[], hold:false, is_initial:false }),
    get_sales_announcements: () => ({ success:true, announcements:[], unread:0, unread_announcements:0 }),
    get_my_lead_config: () => ({ success:true, role:'lead_entry', role_label:'Lead Entry', can_have_leads:true, can_assign:false, sources: SOURCES }),
    get_my_entered_leads: () => enteredPayload(),
    list_my_projects: () => ({ success:true, projects:[ {id:'P1',code:'FMH',name:'Fourteen Manzil Height'} ] }),
    get_connections_overview: () => ({ success:true, facebook:[], whatsapp:[], instagram:[], website:{configured:false,leads:0} }),
    get_my_ad_spend: () => ({ success:true, rows:[], monthly:[] }),
    create_lead: (args) => {
      const p = (args && args.p_payload) || {};
      const d = digits(p.phone);
      if (d && db.rows.some(r => digits(r.phone) === d)) return { success:false, error:'duplicate_owned' };
      db.rows.unshift({ id:'L'+(db.nextId++), name:p.name, phone:p.phone, source:p.source, project_name:'Fourteen Manzil Height', created_at:new Date().toISOString() });
      return { success:true, id:'L'+(db.nextId-1) };
    }
  };
  window.__NXMOCK = { calls: [], db };
  const answer = (fn, args) => { window.__NXMOCK.calls.push({fn,args}); const h = handlers[fn]; return { data: h ? h(args) : { success:true }, error:null }; };
  let real;
  Object.defineProperty(window, 'supabase', { configurable:true,
    get(){ return real; },
    set(v){ if (v && typeof v.createClient === 'function') { const orig = v.createClient.bind(v); v.createClient = (...a) => { const c = orig(...a); c.rpc = async (fn, args) => answer(fn, args); return c; }; } real = v; } });
  try {
    localStorage.setItem('rms.sales.token', 'NX-TEST-TOKEN');
    localStorage.setItem('rms.sales.active', String(Date.now()));
    localStorage.setItem('rms.sales.theme', 'light');
    localStorage.setItem('nx.pwa.installed', '1');
    sessionStorage.setItem('nx.pwa.dismissed', '1');
  } catch(e) {}
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.evaluateOnNewDocument(MOCK_BOOT);
  await page.goto(BASE + '/sales-portal.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#le-name', { timeout: 15000 });
  await sleep(400);

  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); else console.log('  PASS: ' + msg); };
  const go = async (tab) => { await page.evaluate(t => setTab(t), tab); await sleep(500); };

  /* 1. Both chips render with the right label + a non-empty icon glyph */
  const chips = await page.evaluate(() => {
    const map = {};
    document.querySelectorAll('.le-chip').forEach(c => {
      map[c.getAttribute('data-v')] = { label: c.textContent.trim(), hasIcon: !!c.querySelector('svg') };
    });
    return map;
  });
  expect(chips.walkin && chips.walkin.label === 'Walk-in', 'Walk-in chip renders with label (got: ' + JSON.stringify(chips.walkin) + ')');
  expect(chips.walkin && chips.walkin.hasIcon, 'Walk-in chip shows an icon glyph');
  expect(chips.call && chips.call.label === 'Call', 'Call chip renders with label (got: ' + JSON.stringify(chips.call) + ')');
  expect(chips.call && chips.call.hasIcon, 'Call chip shows an icon glyph');

  /* 2a. Save a Walk-in lead → create_lead gets source:'walkin' */
  await page.type('#le-name', 'Walk In Guy');
  await page.type('#le-phone', '0300 1112222');
  await page.evaluate(() => document.querySelector('.le-chip[data-v="walkin"]').click());
  const selWalk = await page.evaluate(() => document.getElementById('le-source').value);
  expect(selWalk === 'walkin', 'selecting Walk-in sets hidden source=walkin (got: ' + selWalk + ')');
  await page.evaluate(() => document.getElementById('le-cta').click());
  await sleep(600);

  /* 2b. Save a Call lead → create_lead gets source:'call' */
  await page.type('#le-name', 'Call In Girl');
  await page.type('#le-phone', '0300 3334444');
  await page.evaluate(() => document.querySelector('.le-chip[data-v="call"]').click());
  const selCall = await page.evaluate(() => document.getElementById('le-source').value);
  expect(selCall === 'call', 'selecting Call sets hidden source=call (got: ' + selCall + ')');
  await page.evaluate(() => document.getElementById('le-cta').click());
  await sleep(600);

  const saved = await page.evaluate(() => window.__NXMOCK.calls.filter(c => c.fn === 'create_lead').map(c => (c.args.p_payload||{}).source));
  expect(saved.includes('walkin'), 'create_lead received source=walkin (got: ' + JSON.stringify(saved) + ')');
  expect(saved.includes('call'), 'create_lead received source=call (got: ' + JSON.stringify(saved) + ')');

  /* 3. My Leads renders both rows with proper icon + source label */
  await go('myleads');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.lrow')].map(r => ({
    name: (r.querySelector('.lr-name')||{}).textContent || '',
    chip: (r.querySelector('.spill')||{}).textContent || '',
    icon: !!r.querySelector('.le-srcic svg')
  })));
  const walkRow = rows.find(r => r.name === 'Walk In Guy');
  const callRow = rows.find(r => r.name === 'Call In Girl');
  expect(walkRow && /Walk-in/.test(walkRow.chip) && walkRow.icon, 'My Leads: Walk-in row shows "Walk-in" label + icon (got: ' + JSON.stringify(walkRow) + ')');
  expect(callRow && /Call/.test(callRow.chip) && callRow.icon, 'My Leads: Call row shows "Call" label + icon (got: ' + JSON.stringify(callRow) + ')');

  await browser.close(); srv.close();
  console.log('\n=== RESULT ===');
  console.log(failures.length ? failures.map(f => 'FAIL: ' + f).join('\n') : 'ALL ' + '10' + ' ASSERTIONS PASS');
  console.log('\n=== CONSOLE ERRORS ===');
  console.log(consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 20).join('\n') : 'none');
  process.exit(failures.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
