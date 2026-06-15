/**
 * Phase 3A dashboard screenshots (admin + staff, light + dark) + redirect check.
 * Headless has no prod auth, so supabase.rpc is stubbed with REAL KBH sample data
 * (top-10 overdue clients + real 6-month collections, fetched via MCP). The render
 * is internally consistent (Total Outstanding == Overdue Today == Σ shown rows) and
 * clearly a 10-client sample; full-book real totals are proven separately by SQL.
 * ZERO DB writes (the stub never touches the network).
 */
const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4211;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };

const ROWS10 = [{"closing":7550000,"sale_id":"a4aa44ca-9c91-4431-8f83-f87d15038a37","unit_no":"G-02","floor_name":"Ground","client_code":"KBH-C-0116","client_name":"MUHAMMAD AMIR KHAN","overdue_days":232,"last_payment_date":null,"last_payment_amount":0},{"closing":6109716,"sale_id":"06d5641e-dc88-49f4-ac44-3085a6cfba36","unit_no":"1-10","floor_name":"1st Floor","client_code":"KBH-C-0037","client_name":"SHUKAR ULLAH","overdue_days":955,"last_payment_date":"2025-11-01","last_payment_amount":100000},{"closing":5739286,"sale_id":"c357d59a-2df0-4ef0-b3b2-36f138d4cf57","unit_no":"4-09","floor_name":"4th Floor","client_code":"KBH-C-0045","client_name":"SAJJAD ALI","overdue_days":767,"last_payment_date":"2025-01-02","last_payment_amount":208334},{"closing":5330060,"sale_id":"45989159-cc69-4ac4-8037-c7958544d258","unit_no":"UG-13","floor_name":"Upper Ground","client_code":"KBH-C-0026","client_name":"ABDUS SAMI","overdue_days":572,"last_payment_date":"2025-10-24","last_payment_amount":4000000},{"closing":4977818,"sale_id":"9ae2ff2f-6da2-46dd-ad66-3b4e0a4dcc28","unit_no":"6-14","floor_name":"6th Floor","client_code":"KBH-C-0005","client_name":"SAYYED AHSAN ALI","overdue_days":1066,"last_payment_date":"2025-01-02","last_payment_amount":500000},{"closing":4855000,"sale_id":"2b779109-a334-4860-9108-0cdde489a4e1","unit_no":"2-18","floor_name":"2nd Floor","client_code":"KBH-C-0038","client_name":"AMAN ULLAH","overdue_days":924,"last_payment_date":"2025-11-01","last_payment_amount":100000},{"closing":4637600,"sale_id":"7f03a514-542f-424d-ae02-6dae5998c138","unit_no":"3-17","floor_name":"3rd Floor","client_code":"KBH-C-0007","client_name":"WAQAR AZIZ","overdue_days":730,"last_payment_date":"2024-09-09","last_payment_amount":300000},{"closing":4416332,"sale_id":"4f141577-07fb-49a7-a36a-6939e514b02f","unit_no":"3-18","floor_name":"3rd Floor","client_code":"KBH-C-0044","client_name":"JAMAL HUSSAIN&HASHIM ALI","overdue_days":766,"last_payment_date":"2025-01-02","last_payment_amount":208334},{"closing":3978000,"sale_id":"72a54322-b5fb-4f15-ad62-dc4019116a8b","unit_no":"1-09","floor_name":"1st Floor","client_code":"KBH-C-0001","client_name":"SHAKEELA DURRANI","overdue_days":924,"last_payment_date":"2026-06-05","last_payment_amount":200000},{"closing":3718146,"sale_id":"ddbd2678-b98d-46f3-8b40-51aab8df8628","unit_no":"8-16","floor_name":"8th Floor","client_code":"KBH-C-0066","client_name":"MUHAMMAD IQBAL SHAH","overdue_days":600,"last_payment_date":"2026-02-19","last_payment_amount":212000}];
const MONTHS6 = { Jan:16215800, Feb:20269000, Mar:8112500, Apr:13197643, May:12275100, Jun:3781500 };

function serve(){return new Promise(res=>{const s=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,p==='/'?'login.html':p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)}).listen(PORT,'127.0.0.1',()=>res(s))})}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
  await page.goto(BASE(), { waitUntil: 'networkidle2' });

  // Stub supabase.rpc with the real sample (supabase is a const object → mutate .rpc)
  await page.evaluate(({ ROWS10, MONTHS6 }) => {
    const closing = ROWS10.reduce((s, r) => s + r.closing, 0);
    const curMonth = new Date().getMonth();           // current month index
    supabase.rpc = async (name, args) => {
      if (name === 'get_recovery_position') {
        const from = new Date((args && args.p_from_date) || new Date());
        const mName = from.toLocaleString('en-US', { month: 'short' });
        if (from.getMonth() === curMonth) {            // current month MTD = KPIs + rows
          const received = MONTHS6[mName] || 0;
          return { data: { totals: { closing, received_total: received, due: 0,
            recovery_pct: +(received / (closing + received) * 100).toFixed(1), opening: closing + received },
            rows: ROWS10, officer_summary: [{ officer_name: 'All Officers', current_recovery_total: received }] }, error: null };
        }
        return { data: { totals: { received_total: MONTHS6[mName] || 0, closing: 0, due: 0, recovery_pct: 0 }, rows: [] }, error: null };
      }
      if (name === 'get_dashboard_receivable') return { data: { net_active: 1180442089, paid_active: 580096618, receivable: 600345471 }, error: null };
      if (name === 'get_pdc_register') return { data: { success: true, rows: [
        { amount: 1250000, status: 'pending', cheque_date: '2026-06-15' },
        { amount: 800000, status: 'deposited', cheque_date: '2026-06-17' } ] }, error: null };
      if (name === 'get_pending_approvals') return { data: [], error: null };   // 0 → card hidden
      return { data: null, error: null };
    };
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  }, { ROWS10, MONTHS6 });

  async function shoot(role, tag) {
    await page.evaluate((role, ROWS10) => {
      S = { cid: 'test-cid', userId: 'u1', role, name: 'Rashid Manzoor', username: 'rashid', coName: 'Fourteen Group of Companies', coCode: '14', permissions: {}, assignedProjectIds: null, isProjectAdmin: role === 'admin', hasFinanceUser: true, subStatus: 'active', sessionVersion: 1 };
      // staff personal data sample (real client, today's follow-up + a worked-arrears link)
      const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
      window._contactLogsCache = [
        { recovery_agent_id: 'u1', next_followup_date: today, client_name: 'SHUKAR ULLAH', client_code: 'KBH-C-0037', status_tag: 'Promised', promise_amount: 100000, sale_id: ROWS10[1].sale_id },
        { recovery_agent_id: 'u1', next_followup_date: today, client_name: 'SAJJAD ALI', client_code: 'KBH-C-0045', status_tag: 'Callback', promise_amount: 0, sale_id: ROWS10[2].sale_id }
      ];
      if (typeof buildSB === 'function') buildSB();
    }, role, ROWS10);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.evaluate(() => rDash());
      await new Promise(r => setTimeout(r, 900));
      await page.screenshot({ path: path.join(OUT, `dash_${tag}_${theme}.png`) });
    }
  }

  await shoot('admin', 'admin');
  await shoot('recovery', 'staff');

  // Redirect check: nav('radar') must land on dashboard, console clean
  const redirect = await page.evaluate(() => {
    const before = (document.querySelector('.pg.on') || {}).id;
    nav('radar'); nav('executive'); nav('recovery-dashboard');
    return { landed: (document.querySelector('.pg.on') || {}).id, before };
  });

  await browser.close(); srv.close();
  console.log('SHOTS: dash_admin_{light,dark}, dash_staff_{light,dark}');
  console.log('redirect nav(radar/executive/recovery-dashboard) → landed on:', redirect.landed);
  const real = errs.filter(e => !/Failed to load resource|401/.test(e));
  console.log('console errors total:', errs.length, '| real (non-401):', real.length);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });

function BASE() { return 'http://127.0.0.1:' + PORT + '/login.html'; }
