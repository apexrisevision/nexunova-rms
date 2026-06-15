/**
 * Recovery Batch UI verification — inject mock data directly into page state vars
 * and call render functions (bypasses async Supabase entirely).
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT   = path.resolve(__dirname, '..');
const PORT   = 4221;
const BASE   = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT    = path.join(__dirname, 'recovery_shots');
const MIME   = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                 '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

// ── Mock datasets ──────────────────────────────────────────────
const TODAY = new Date().toISOString().split('T')[0];
const D3AGO = new Date(Date.now()-86400000*3).toISOString().split('T')[0];
const D7AGO = new Date(Date.now()-86400000*7).toISOString().split('T')[0];
const IN3   = new Date(Date.now()+86400000*3).toISOString().split('T')[0];
const IN7   = new Date(Date.now()+86400000*7).toISOString().split('T')[0];

const MOCK = {
  promises: [
    { id:'p1', client_name:'Ahmed Raza',      client_phone:'0300-1234567', status:'pending', promise_date:TODAY,  promised_amount:250000, promised_via:'call',      project_name:'Sapphire Heights', unit_info:'A-201', logged_by:'Usman',  reminder_sent_count:2 },
    { id:'p2', client_name:'Sara Khan',       client_phone:'0321-9876543', status:'pending', promise_date:D3AGO,  promised_amount:175000, promised_via:'whatsapp',  project_name:'Falcon Ridge',     unit_info:'B-105', logged_by:'Fatima', reminder_sent_count:0 },
    { id:'p3', client_name:'Tariq Mahmood',   client_phone:'0333-5555111', status:'kept',    promise_date:D7AGO,  promised_amount:500000, promised_via:'visit',     project_name:'Sapphire Heights', unit_info:'C-303', logged_by:'Usman',  actual_paid_amount:500000 },
    { id:'p4', client_name:'Mariam Siddiqui', client_phone:'0311-7777888', status:'broken',  promise_date:D3AGO,  promised_amount:300000, promised_via:'call',      project_name:'Arcadia',          unit_info:'D-406', logged_by:'Fatima', broken_reason:'Client unreachable' },
    { id:'p5', client_name:'Bilal Hassan',    client_phone:'0312-4444222', status:'pending', promise_date:IN7,    promised_amount:420000, promised_via:'meeting',   project_name:'Arcadia',          unit_info:'E-101', logged_by:'Usman',  reminder_sent_count:0 },
  ],
  prmStats: { kept:3, broken:1, kept_percent:75, broken_percent:25, recovery_rate:68, total_kept_amount:500000, today_count:1, today_amount:250000, overdue_count:1 },

  campaigns: [
    { id:'c1', campaign_name:'June Recovery Drive',  status:'active',    description:'Push on overdue accounts before month close', target_amount:5000000, collected_amount:2750000, client_count:18, start_date:'2026-06-01', end_date:'2026-06-30' },
    { id:'c2', campaign_name:'Q1 Legacy Accounts',   status:'completed', description:'Clearing long-outstanding Q1 arrears',        target_amount:3200000, collected_amount:3100000, client_count:12, start_date:'2026-03-01', end_date:'2026-03-31' },
    { id:'c3', campaign_name:'Pre-Eid Collection',   status:'active',    description:'Target clients with installments due in Eid window', target_amount:2800000, collected_amount:900000,  client_count:9,  start_date:'2026-06-10', end_date:'2026-06-20' },
  ],

  fieldvisits: [
    { id:'fv1', client_name:'Ahmed Raza',     client_phone:'0300-1234567', outcome:'payment_collected', visit_date:TODAY,  amount_collected:175000, project_name:'Sapphire Heights', unit_info:'A-201', officer_name:'Usman Ali',    notes:'Client was at home, paid cash on spot' },
    { id:'fv2', client_name:'Sara Khan',      client_phone:'0321-9876543', outcome:'promise_received',  visit_date:D3AGO,  amount_collected:0,      project_name:'Falcon Ridge',     unit_info:'B-105', officer_name:'Fatima Naz',   notes:'Promised to pay next Saturday' },
    { id:'fv3', client_name:'Tariq Mahmood',  client_phone:'0333-5555111', outcome:'not_found',         visit_date:D3AGO,  amount_collected:0,      project_name:'Sapphire Heights', unit_info:'C-303', officer_name:'Usman Ali',    notes:'Neighbour said he left for Karachi' },
    { id:'fv4', client_name:'Bilal Hassan',   client_phone:'0312-4444222', outcome:'refused',           visit_date:D7AGO,  amount_collected:0,      project_name:'Arcadia',          unit_info:'E-101', officer_name:'Fatima Naz',   notes:'Client refused and asked for company notice' },
    { id:'fv5', client_name:'Zainab Mirza',   client_phone:'0345-9990000', outcome:'contacted',         visit_date:TODAY,  amount_collected:0,      project_name:'Marwan Towers',    unit_info:'F-201', officer_name:'Imran Sheikh', notes:'Met client, explained installment schedule' },
  ],

  escalations: [
    { id:'e1', client_name:'Sara Khan',       unit_info:'B-105', project_name:'Falcon Ridge',     escalation_level:'L3', status:'open',        category:'non_payment',   created_at:new Date(Date.now()-86400000*14).toISOString(), assigned_to_name:'Regional Manager' },
    { id:'e2', client_name:'Bilal Hassan',    unit_info:'E-101', project_name:'Arcadia',          escalation_level:'L4', status:'in_progress', category:'legal_threat',  created_at:new Date(Date.now()-86400000*30).toISOString(), assigned_to_name:'CEO' },
    { id:'e3', client_name:'Mariam Siddiqui', unit_info:'D-406', project_name:'Arcadia',          escalation_level:'L2', status:'resolved',    category:'communication', created_at:new Date(Date.now()-86400000*60).toISOString(), assigned_to_name:'Branch Manager' },
    { id:'e4', client_name:'Zainab Mirza',    unit_info:'F-201', project_name:'Marwan Towers',    escalation_level:'L1', status:'open',        category:'non_payment',   created_at:new Date(Date.now()-86400000*5).toISOString(),  assigned_to_name:'Usman Ali' },
  ],

  legalcases: [
    { id:'lc1', client_name:'Bilal Hassan',    unit_info:'E-101', case_number:'CVL-2026-001', stage:'hearing_scheduled', case_type:'recovery', lawyer_name:'Adv. Shahid Qureshi', next_hearing_date:IN3,  outstanding_amount:1500000, total_legal_cost:85000,  notes:'Civil recovery suit.' },
    { id:'lc2', client_name:'Mariam Siddiqui', unit_info:'D-406', case_number:'CVL-2026-002', stage:'settled',           case_type:'recovery', lawyer_name:'Adv. Nadia Baig',     next_hearing_date:null, outstanding_amount:900000,  total_legal_cost:45000,  notes:'Settled out of court with payment plan.' },
    { id:'lc3', client_name:'Omar Farooq',     unit_info:'G-302', case_number:'CVL-2026-003', stage:'court_filed',       case_type:'fraud',    lawyer_name:'Adv. Tariq Shah',     next_hearing_date:IN7,  outstanding_amount:2200000, total_legal_cost:120000, notes:'Fraud case under investigation.' },
  ],
};

// ── Unlock app shell ───────────────────────────────────────────
async function unlockShell(page) {
  await page.evaluate(() => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    window.hasProjectAccess = () => true;
    document.getElementById('s-login')?.classList.remove('on');
    document.getElementById('s-app')?.classList.add('on');
    if (typeof stopLoginAnimations === 'function') try { stopLoginAnimations(); } catch(e) {}
    if (typeof buildSB === 'function') buildSB();
  });
  await new Promise(r => setTimeout(r, 500));
}

// ── Screenshot helpers ─────────────────────────────────────────
async function shot(page, name) {
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log('  ✓', name);
}

async function navTo(page, navKey) {
  await page.evaluate(k => {
    // Show target pg via class (same mechanism nav() uses)
    document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
    const target = document.getElementById('pg-' + k);
    if (target) target.classList.add('on');
  }, navKey);
  await new Promise(r => setTimeout(r, 300));
}

// ── Page renderers ─────────────────────────────────────────────
async function renderPromises(page, mock) {
  await page.evaluate(m => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    // Build page shell
    const pg = document.getElementById('pg-promises');
    if (!pg) return;
    pg.innerHTML = '';
    // Call rPromises to build the shell, then inject data
    if (typeof rPromises !== 'function') return;

    // Override _prmLoad to inject data instead of hitting Supabase
    window._prmLoad = async function() {
      _prmAllData = m.promises;
      _prmStats   = m.prmStats;
      _prmRenderStats();
      _prmRenderTabs();
      _prmRenderDueAlert();
      _prmRender();
    };
    rPromises();
  }, mock);
  await new Promise(r => setTimeout(r, 800));
}

async function renderCampaigns(page, mock) {
  await page.evaluate(m => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    _camList   = m.campaigns;
    _camFilter = 'active';
    const pg = document.getElementById('pg-campaigns');
    if (!pg) return;
    if (typeof _camRenderList === 'function') _camRenderList(pg);
    if (typeof _camRenderTabs === 'function') _camRenderTabs();
    if (typeof _camRenderGrid === 'function') _camRenderGrid();
  }, mock);
  await new Promise(r => setTimeout(r, 600));
}

async function renderFieldVisits(page, mock) {
  await page.evaluate(m => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    _fvData      = m.fieldvisits;
    _fvAnalytics = {};
    _fvFilter    = 'all';
    const pg = document.getElementById('pg-fieldvisits');
    if (!pg) return;
    if (typeof rFieldVisits !== 'function') return;

    // Override _fvLoad to inject data
    window._fvLoad = async function() {
      _fvRenderStats();
      _fvRenderFilter();
      _fvRenderTable();
    };
    rFieldVisits();
  }, mock);
  await new Promise(r => setTimeout(r, 800));
}

async function renderEscalations(page, mock) {
  await page.evaluate(m => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    _escData      = m.escalations;
    _escCurFilter = 'open';
    const pg = document.getElementById('pg-escalations');
    if (!pg) return;
    if (typeof rEscalations !== 'function') return;

    // Override _escLoad
    window._escLoad = async function() {
      _escRenderStats({});
      _escRenderTabs();
      _escRenderTable();
    };
    rEscalations();
  }, mock);
  await new Promise(r => setTimeout(r, 800));
}

async function renderLegalCases(page, mock) {
  await page.evaluate(m => {
    S = { cid:'zztest', name:'Test Officer', username:'test', coName:'Fourteen Group', role:'recovery_officer' };
    _lcData      = m.legalcases;
    _lcAnalytics = {};
    _lcFilter    = 'active';
    const pg = document.getElementById('pg-legalcases');
    if (!pg) return;
    if (typeof rLegalCases !== 'function') return;

    // Override _lcLoad
    window._lcLoad = async function() {
      _lcRenderStats();
      _lcRenderTabs();
      _lcRenderTable();
    };
    rLegalCases();
  }, mock);
  await new Promise(r => setTimeout(r, 800));
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,960']
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,180)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0,180)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });
  await unlockShell(page);

  // ── 1366 light ─────────────────────────────────────────────
  await page.setViewport({ width:1366, height:900 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','light'));

  await navTo(page, 'promises');    await renderPromises(page, MOCK);    await shot(page, 'promises_1366_light.png');
  await navTo(page, 'campaigns');   await renderCampaigns(page, MOCK);   await shot(page, 'campaigns_1366_light.png');
  await navTo(page, 'fieldvisits'); await renderFieldVisits(page, MOCK); await shot(page, 'fieldvisits_1366_light.png');
  await navTo(page, 'escalations'); await renderEscalations(page, MOCK); await shot(page, 'escalations_1366_light.png');
  await navTo(page, 'legalcases');  await renderLegalCases(page, MOCK);  await shot(page, 'legalcases_1366_light.png');

  // ── 1366 dark ──────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','dark'));

  await navTo(page, 'promises');    await renderPromises(page, MOCK);    await shot(page, 'promises_1366_dark.png');
  await navTo(page, 'campaigns');   await renderCampaigns(page, MOCK);   await shot(page, 'campaigns_1366_dark.png');
  await navTo(page, 'fieldvisits'); await renderFieldVisits(page, MOCK); await shot(page, 'fieldvisits_1366_dark.png');
  await navTo(page, 'escalations'); await renderEscalations(page, MOCK); await shot(page, 'escalations_1366_dark.png');
  await navTo(page, 'legalcases');  await renderLegalCases(page, MOCK);  await shot(page, 'legalcases_1366_dark.png');

  // ── 1920 light ─────────────────────────────────────────────
  await page.setViewport({ width:1920, height:1080 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','light'));

  await navTo(page, 'promises');    await renderPromises(page, MOCK);    await shot(page, 'promises_1920_light.png');
  await navTo(page, 'campaigns');   await renderCampaigns(page, MOCK);   await shot(page, 'campaigns_1920_light.png');
  await navTo(page, 'fieldvisits'); await renderFieldVisits(page, MOCK); await shot(page, 'fieldvisits_1920_light.png');
  await navTo(page, 'escalations'); await renderEscalations(page, MOCK); await shot(page, 'escalations_1920_light.png');
  await navTo(page, 'legalcases');  await renderLegalCases(page, MOCK);  await shot(page, 'legalcases_1920_light.png');

  // ── 1920 dark ──────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','dark'));

  await navTo(page, 'promises');    await renderPromises(page, MOCK);    await shot(page, 'promises_1920_dark.png');
  await navTo(page, 'campaigns');   await renderCampaigns(page, MOCK);   await shot(page, 'campaigns_1920_dark.png');
  await navTo(page, 'fieldvisits'); await renderFieldVisits(page, MOCK); await shot(page, 'fieldvisits_1920_dark.png');
  await navTo(page, 'escalations'); await renderEscalations(page, MOCK); await shot(page, 'escalations_1920_dark.png');
  await navTo(page, 'legalcases');  await renderLegalCases(page, MOCK);  await shot(page, 'legalcases_1920_dark.png');

  // ── Modal forms (light, 1366) ──────────────────────────────
  await page.setViewport({ width:1366, height:900 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','light'));

  // Log Promise modal
  await navTo(page, 'promises'); await renderPromises(page, MOCK);
  await page.evaluate(() => {
    // Stub clients cache so modal doesn't wait on RPC
    _prmClientsCache = [
      { id:'c1', full_name:'Ahmed Raza', client_code:'FG-001', phone_primary:'0300-1234567' },
      { id:'c2', full_name:'Sara Khan',  client_code:'FG-002', phone_primary:'0321-9876543' },
    ];
    prmLogNew();
  });
  await new Promise(r => setTimeout(r, 500));
  await shot(page, 'modal_log_promise_light.png');

  // Field visit Log modal
  await navTo(page, 'fieldvisits'); await renderFieldVisits(page, MOCK);
  await page.evaluate(() => {
    _fvClientsCache = [
      { id:'c1', full_name:'Ahmed Raza', client_code:'FG-001' },
      { id:'c2', full_name:'Sara Khan',  client_code:'FG-002' },
    ];
    fvOpenLog();
  });
  await new Promise(r => setTimeout(r, 500));
  await shot(page, 'modal_log_visit_light.png');

  // New Escalation modal
  await navTo(page, 'escalations'); await renderEscalations(page, MOCK);
  await page.evaluate(() => {
    _escClientsCache = [
      { id:'c1', full_name:'Ahmed Raza', client_code:'FG-001' },
      { id:'c2', full_name:'Sara Khan',  client_code:'FG-002' },
    ];
    escOpenNew();
  });
  await new Promise(r => setTimeout(r, 500));
  await shot(page, 'modal_new_escalation_light.png');

  // ── Report ─────────────────────────────────────────────────
  const appErrs = errs.filter(e => !e.includes('401') && !e.includes('400') && !e.includes('dashboard'));
  console.log('\nApp JS errors:', appErrs.length ? appErrs.slice(0,10).join('\n') : '0 ✓');

  await browser.close();
  srv.close();
  process.exit(appErrs.length ? 1 : 0);
})();
