/**
 * Nexunova RMS — Presentation Screenshot Capturer
 *
 * Auto-logs in as the demo company, navigates each module, and saves a
 * 1920x1080 PNG per module per theme into ../presentation-screenshots/.
 *
 * Run:  npm run shots    (after adding the npm script)
 *   or: node scripts/capture-screenshots.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'presentation-screenshots');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 2 };

// Modules to capture — module IDs match nav() keys in js/ui.js
// `wait` is extra ms to allow charts / data loads to settle after page swap.
const MODULES = [
  { id: 'dashboard',      label: '01-Dashboard',           wait: 2500 },
  { id: 'projects',       label: '02-Projects',            wait: 1500 },
  { id: 'units',          label: '03-Units-Inventory',     wait: 2000 },
  { id: 'clients',        label: '04-Clients',             wait: 1800 },
  { id: 'agents',         label: '05-Agents',              wait: 1500 },
  { id: 'sales',          label: '06-Sales',               wait: 1800 },
  { id: 'newsale',        label: '07-New-Sale-Form',       wait: 1800 },
  { id: 'recovery',       label: '08-Payments-Hub',        wait: 2000 },
  { id: 'addpayment',     label: '09-Add-Payment',         wait: 2200 },
  { id: 'pdc',            label: '10-PDC-Register',        wait: 1500 },
  { id: 'radar',          label: '11-Recovery-Radar',      wait: 2200 },
  { id: 'paylinks',       label: '12-Smart-Payment-Links', wait: 1800 },
  { id: 'payment-methods',label: '13-Payment-Methods',     wait: 1500 },
  { id: 'reports',        label: '14-Reports',             wait: 1800 },
  { id: 'categories',     label: '15-Categories',          wait: 1500 },
  { id: 'cancelledunits', label: '16-Cancelled-Ledger',    wait: 1800 },
  { id: 'transferunits',  label: '17-Transferred-Ledger',  wait: 1800 },
  { id: 'contacts',       label: '18-Call-Logs',           wait: 1500 },
  { id: 'reminders',      label: '19-Reminders',           wait: 1500 },
  { id: 'documents',      label: '20-Documents',           wait: 1500 },
  { id: 'users',          label: '21-User-Management',     wait: 1500 },
  { id: 'admin',          label: '22-Admin-Panel',         wait: 1500 },
];

const THEMES = ['dark', 'light'];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
  '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp',
  '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf',
  '.otf':'font/otf','.map':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8',
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
        if (pathname === '/') pathname = '/index.html';
        const filePath = path.normalize(path.join(ROOT, pathname));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        });
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`✓ Static server on ${BASE}`);
      resolve(server);
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForDashboard(page) {
  // 1) Wait for the app shell itself to become visible (login completed).
  //    S is declared `let` so it isn't on window — read it by bare identifier.
  await page.waitForFunction(
    () => document.querySelector('#s-app.on') !== null
       && typeof S !== 'undefined' && S && S.cid,
    { timeout: 45_000, polling: 400 }
  );
  // 2) Wait for the dashboard page to be active inside the shell
  await page.waitForFunction(
    () => document.querySelector('#pg-dashboard.on') !== null,
    { timeout: 15_000, polling: 300 }
  );
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (_) {}
  }, theme);
  await sleep(400);
}

async function navTo(page, id, waitMs) {
  await page.evaluate((pgId) => {
    if (typeof window.nav === 'function') window.nav(pgId);
  }, id);
  // Wait until the target page becomes active
  try {
    await page.waitForFunction(
      (pgId) => document.querySelector(`#pg-${pgId}.on`) !== null,
      { timeout: 15_000, polling: 250 },
      id,
    );
  } catch (_) {
    // Some modules may use slightly different IDs; we still proceed.
  }
  await sleep(waitMs);
  // Force any scrollable container to top so the screenshot lands on the header
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector('.main, .pg-wrap, .content');
    if (main) main.scrollTop = 0;
  });
  await sleep(200);
}

async function capture(page, theme, label) {
  const file = path.join(OUT_DIR, `${label}__${theme}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${path.basename(file)}`);
}

(async () => {
  const server = await startStaticServer();
  console.log(`✓ Launching Chromium…`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    defaultViewport: VIEWPORT,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning') {
        console.log(`  [page ${t}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => console.log(`  [page error] ${err.message}`));
    page.on('requestfailed', (req) => {
      console.log(`  [req fail] ${req.url()} — ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        console.log(`  [http ${res.status()}] ${res.url()}`);
      }
    });

    await page.goto(`${BASE}/login.html`, { waitUntil: 'load' });
    await sleep(500);

    console.log('⏳ Triggering demo login directly…');
    await page.waitForFunction(
      () => typeof doLogin === 'function'
            && document.getElementById('li-u')
            && document.getElementById('li-p'),
      { timeout: 15_000, polling: 200 }
    );
    // Past initLogin's 1500ms ignore window
    await sleep(1800);
    // Reset any half-finished state from dev-helper's KBH attempt, then call doLogin.
    await page.evaluate(() => {
      // Force-reset session state
      try { S = null; } catch (_) {}
      try { sessionStorage.removeItem('nxn_sess'); } catch (_) {}
      document.getElementById('s-login')?.classList.add('on');
      document.getElementById('s-app')?.classList.remove('on');
      document.getElementById('s-payment-wall')?.classList.remove('on');
      const err = document.getElementById('lerr'); if (err) err.style.display = 'none';
      // Fill demo creds
      const u = document.getElementById('li-u'); u.removeAttribute('readonly'); u.value = 'demo@DEMO';
      const p = document.getElementById('li-p'); p.removeAttribute('readonly'); p.value = 'Demo1234';
      // Defeat initLogin's ignore window (it's a `let`, not window.*)
      try { _loginReadyAt = 0; } catch (_) {}
      return doLogin();
    });

    console.log('⏳ Waiting for app shell → dashboard…');
    try {
      await waitForDashboard(page);
    } catch (err) {
      const dbg = path.join(OUT_DIR, '_DEBUG_login_timeout.png');
      await page.screenshot({ path: dbg, fullPage: false });
      const state = await page.evaluate(() => ({
        url: location.href,
        hasS: typeof S !== 'undefined' && !!S,
        sCid: (typeof S !== 'undefined' && S) ? S.cid : null,
        sAppOn: !!document.querySelector('#s-app.on'),
        sLoginOn: !!document.querySelector('#s-login.on'),
        sPwOn: !!document.querySelector('#s-payment-wall.on'),
        lerr: document.getElementById('lerr')?.textContent?.trim() || '',
        lerrVisible: document.getElementById('lerr')?.style?.display !== 'none',
        liU: document.getElementById('li-u')?.value || '',
      }));
      console.log('  [debug state]', JSON.stringify(state));
      throw err;
    }
    await sleep(2500); // let initial data caches hydrate

    for (const theme of THEMES) {
      console.log(`\n▶ Theme: ${theme.toUpperCase()}`);
      await setTheme(page, theme);
      // Re-navigate to dashboard first so the change applies cleanly
      await navTo(page, 'dashboard', 1200);

      for (const mod of MODULES) {
        try {
          await navTo(page, mod.id, mod.wait);
          await capture(page, theme, mod.label);
        } catch (err) {
          console.warn(`  ⚠ ${mod.label} (${mod.id}): ${err.message}`);
        }
      }
    }

    console.log(`\n✓ Done. Files saved to:\n  ${OUT_DIR}`);
  } catch (err) {
    console.error('✗ Capture failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
