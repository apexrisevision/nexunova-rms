/**
 * MEASUREMENT — how often does a late renderManagerHome paint over the Reserve Desk?
 *
 * Finding 2026-09-07-G says the shell has no guard against a slow renderer
 * landing on #app-body after the user has already opened something else. The
 * question that decides whether it is worth a Stage 4 is not "can it happen"
 * — it demonstrably can — but "how wide is the window a person has to tap in".
 *
 * So: sign in for real, wait N ms, open the desk, wait for the dust to settle,
 * and record whether the desk survived. Sweep N, and repeat the whole sweep
 * under a throttled connection, because this portal lives on phones on mobile
 * data and a window measured on localhost is not the window that matters.
 *
 *   ZZTEST_PIN=<6 digits> node scripts/measure-desk-overpaint.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4190;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/sales-portal.html`;

const ZZ_CODE = 'zztestinternalsafeto';
const ZZ_DIR  = '3e5ec7c8-89c8-435f-8f52-141b87c4b5b0';
const ZZ_PHONE = '+923459990000';
const ZZ_PIN = process.env.ZZTEST_PIN || '';

const DELAYS = [0, 200, 400, 700, 1000, 1500, 2000, 3000];
const SETTLE = 4000;          // how long to wait for a late paint to land

const NETS = [
  { name: 'localhost (no throttle)', cond: null },
  { name: 'slow 3G (400kbps, 400ms RTT)',
    cond: { offline: false, downloadThroughput: 400 * 1024 / 8,
            uploadThroughput: 400 * 1024 / 8, latency: 400 } },
];

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1]
              || 'itqxljtfbrppntgyfush';
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => r.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    req.on('error', rej); req.write(body); req.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}
async function until(page, fn, ms = 30000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }); return true; }
  catch (e) { return false; }
}

(async () => {
  if (!ZZ_PIN) { console.log('SKIPPED — set ZZTEST_PIN first.'); process.exit(0); }
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('No Chrome/Edge found'); process.exit(2); }

  await sql(`update public.sales_users
                set pin_hash = extensions.crypt('${ZZ_PIN}', extensions.gen_salt('bf', 8)),
                    failed_pin_attempts = 0, locked_until = null
              where id = '${ZZ_DIR}';`);

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
                                           args: ['--no-sandbox', '--window-size=430,900'] });

  const results = [];
  for (const net of NETS) {
    console.log('\n\u2550\u2550 ' + net.name + ' \u2550\u2550');
    for (const delay of DELAYS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });
      const cdp = await page.target().createCDPSession();
      if (net.cond) await cdp.send('Network.emulateNetworkConditions', net.cond);

      // fresh login, every time
      await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.setItem('nx.hub.bounce','1'); } catch (e) {} });
      await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
      await until(page, () => !!document.getElementById('i-pin'));
      await page.evaluate((co, ph, pin) => {
        document.getElementById('i-co').value = co;
        document.getElementById('i-phone').value = ph;
        document.getElementById('i-pin').value = pin;
      }, ZZ_CODE, ZZ_PHONE, ZZ_PIN);

      const t0 = Date.now();
      await page.evaluate(() => doLogin());
      const inApp = await until(page, () => typeof ME !== 'undefined' && ME && !!ME.sales_user_name, 40000);
      const tLogin = Date.now() - t0;
      if (!inApp) { console.log(`  delay ${String(delay).padStart(4)}ms  →  LOGIN TIMED OUT`); await page.close(); continue; }

      // how long the shell's own home render takes, measured separately
      await sleep(delay);
      await page.evaluate(() => {
        try { if (typeof _vgHide === 'function') _vgHide(); } catch (e) {}
        ['verify-gate','pwa-bar','loc-bar'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display='none'; });
      });
      await page.evaluate(() => setTab('desk'));

      const appeared = await until(page, () => !!document.getElementById('rd-root'), 20000);
      await sleep(SETTLE);
      const st = await page.evaluate(() => ({
        root: !!document.getElementById('rd-root'),
        TAB: (typeof TAB !== 'undefined') ? TAB : '?',
        body: ((document.getElementById('app-body') || {}).innerHTML || '').slice(0, 24)
      }));
      const survived = st.root;
      const inconsistent = !st.root && st.TAB === 'desk';   // the exact finding-G state
      results.push({ net: net.name, delay, appeared, survived, inconsistent, tLogin });
      console.log(`  delay ${String(delay).padStart(4)}ms  login ${String(tLogin).padStart(5)}ms  ` +
                  `desk ${appeared ? 'painted' : 'NEVER  '}  ` +
                  `after ${SETTLE}ms: ${survived ? '\u2705 still there' : '\u274C OVERPAINTED (TAB=' + st.TAB + ')'}`);
      await page.close();
    }
  }

  await browser.close(); server.close();
  await sql(`delete from public.sales_sessions where sales_user_id='${ZZ_DIR}';`);

  console.log('\n' + '\u2550'.repeat(60));
  for (const net of NETS) {
    const rows = results.filter(r => r.net === net.name);
    const bad = rows.filter(r => !r.survived);
    const worst = bad.length ? Math.max(...bad.map(r => r.delay)) : -1;
    console.log(`${net.name}`);
    console.log(`   overpainted at delays: ${bad.length ? bad.map(r => r.delay + 'ms').join(', ') : 'none'}`);
    console.log(`   widest failing tap window: ${worst < 0 ? '0ms (never)' : '0\u2013' + worst + 'ms after login completes'}`);
    console.log(`   median login time: ${rows.length ? rows.map(r=>r.tLogin).sort((a,b)=>a-b)[Math.floor(rows.length/2)] : '?'}ms`);
  }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
