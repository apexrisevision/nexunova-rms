/**
 * Phase 2 shell verification — screenshots of the normalized shell + 5 pages in
 * light AND dark, plus a console-error tally per page.
 * Live login isn't possible (admin creds rejected on prod), so the post-login
 * state is fabricated exactly like verify_hotfix_20260612.js — everything else
 * is the real shipped code (real login.html, ui.js, foundation/*, page modules).
 * Page DATA won't load without auth; this verifies the SHELL chrome + that old
 * pages mount inside it without breaking. ZERO DB writes.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4203;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };
const PAGES = ['dashboard', 'units', 'clients', 'sales', 'reports'];

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  // ── Fabricate an admin post-login state (no auth) ──
  await page.evaluate(() => {
    S = {
      cid: 'test-cid', userId: 'test-user', role: 'admin', name: 'Admin', username: 'admin',
      coName: 'Fourteen Group of Companies', coCode: '14groupofcompanies', permissions: {},
      assignedProjectIds: null, isProjectAdmin: true, hasFinanceUser: true, subStatus: 'active',
      sessionVersion: 1
    };
    // empty-but-loaded caches so pages render their scaffolding instead of "loading"
    Object.assign(window, {
      _unitsCache: [], _unitsCacheLoaded: true, _clientsCache: [], _clientsCacheLoaded: true,
      _projectsCache: [], _projectsCacheLoaded: true, _appUsersCache: [], _contactLogsCache: [],
      _salesCache: [], _agentsCache: []
    });
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof stopLoginAnimations === 'function') try { stopLoginAnimations(); } catch (e) {}
    if (typeof buildSB === 'function') buildSB();
  });
  await new Promise(r => setTimeout(r, 400));

  const report = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      if (typeof buildSB === 'function') buildSB(); // resync sidebar theme icons
    }, theme);
    for (const pg of PAGES) {
      const before = consoleErrors.length;
      await page.evaluate((p) => { try { if (typeof nav === 'function') nav(p); } catch (e) { console.error('nav(' + p + ') ' + e.message); } }, pg);
      await new Promise(r => setTimeout(r, 700));
      const file = path.join(OUT, `${pg}_${theme}.png`);
      await page.screenshot({ path: file });
      report[`${pg}_${theme}`] = { errors: consoleErrors.length - before };
    }
  }

  await browser.close(); srv.close();
  console.log('SHOTS WRITTEN to migration_work/shots/');
  console.log(JSON.stringify(report, null, 2));
  console.log('TOTAL console errors across run:', consoleErrors.length);
  if (consoleErrors.length) console.log('--- first 25 errors ---\n' + consoleErrors.slice(0, 25).join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
