#!/usr/bin/env node
/**
 * Daily Closing — P8 verification: the shell mount, and that it is INERT for
 * every tenant that does not have the module.
 *
 *   node scripts/verify-daily-closing-shell.js
 *
 * P8 puts a nav item and a page into js/ui.js and login.html — files Khushal
 * Bagh and FMH load on every sign-in. The instruction was "do not touch KBH or
 * FMH navigation or behaviour", so this is the test that says whether that
 * held. It runs the REAL buildSB() and the REAL nav() out of js/ui.js in
 * Chrome, against a stubbed shell, twice: once with no daily_closing flag and
 * once with it explicitly on.
 *
 * ⚠️ WHY NOT hasFeature(). Because hasFeature() returns TRUE for a key it has
 * never seen — the SaaS model is default-open — so routing this module through
 * it would have put the cash book in both other tenants' sidebars. The gate is
 * an explicit === true, and the first assertion below is the one that would
 * have caught that.
 *
 * ── SR-2 ────────────────────────────────────────────────────────────────────
 * "The item is absent" is an absent-thing assertion. Every one of them here is
 * paired with the same call under the flag, where the item must be PRESENT —
 * so a harness that renders nothing at all fails rather than passes.
 *
 * ── ⚠️ WHAT THIS FILE CANNOT SEE, AND DID NOT (standing rule SR-5) ──────────
 * `shell()` below sets `window._featureFlags` with `evaluateOnNewDocument`,
 * i.e. BEFORE the page loads. So every assertion here runs against a shell that
 * already had its flags, and the file is a test of the GATE'S LOGIC only.
 *
 * It is not a test of WHEN the flags arrive, and on 2026-09-05 that distinction
 * cost the pilot a working module: all sixteen assertions below were green
 * while Daily Closing was invisible on Awami, because js/auth.js called
 * buildSB() at line 383 and loadFeatureFlags() at line 411 — the gate was
 * correct and it was evaluated against `null`.
 *
 * A test that supplies the state under test has not tested it.
 *
 * The ordering is covered by **scripts/verify-daily-closing-boot.js**, which
 * seeds nothing and drives the real _completeLogin(). Do not add ordering
 * assertions here; they would be answered by the seed, not by the code.
 *
 * The rest of the module's browser suites were audited for the same shape:
 *   · verify-daily-closing-screen.js — stubs the NETWORK (?stub=1), not the
 *     state. The screen still calls get_my_daily_closing_access and awaits it,
 *     so its async path is real. It never reaches the feature-flag gate at all
 *     (the host page returns before it in stub mode), so it would not have
 *     caught this either — stated here rather than assumed.
 *   · the tile tests, same: scripted answers, real awaits.
 *   · verify-daily-closing-load.js only READS window.__dcPaintStart.
 *   · the SQL, PDF, attachment and concurrency suites use the real database.
 * One pre-seeder outside this module — scripts/verify-session-week.js:83 —
 * has the same shape and has NOT been audited here.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4475;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[verify-daily-closing-shell] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const is  = (got, want, what) => got === want ? ok(what)
  : bad(`${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const head = t => console.log('\n── ' + t);

/* A shell with the shape ui.js expects and nothing else. Everything ui.js
   reaches for that belongs to another file is stubbed to something harmless,
   so what is being exercised is ui.js's own logic and not the whole app. */
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><title>shell harness</title></head>
<body>
  <div class="sb"><div class="sb-nav" id="sb-nav"></div></div>
  <div class="pw">
    <div id="pg-dashboard" class="pg on"></div>
    <div id="pg-units" class="pg"></div>
    <div id="pg-dailyclosing" class="pg"></div>
  </div>
  <div id="tb-t"></div><div id="nav-crumb-page"></div>
  <div id="nav-actions"><button id="nav-back"></button></div>
  <!-- what rDash() leaves behind, so _dcTile() has something to insert into -->
  <div id="dash-mock"><div class="nx"><div class="nx-page-header">Dashboard</div>
    <div class="nx-card">the rest of the dashboard</div></div></div>
<script>
  // ── the globals ui.js expects from the rest of the app ──
  window.S = { cid: 'co-1', userId: 'u-1', role: 'owner', projectId: null, assignedProjectIds: null };
  window._projectsCache = [{ id: 'p-1', project_name: 'Awami Market' }];
  window.gfus = function () { return {}; };
  window.effectiveRole = function () { return 'owner'; };
  window.hasPermission = function () { return true; };
  window.hasModuleGrant = function () { return true; };
  window.hasProjectAccess = function () { return true; };
  window.hasFeature = function (k) {
    // The real one, copied from js/pages/company-branding.js — DEFAULT-OPEN.
    if (!window._featureFlags) return true;
    if (!(k in window._featureFlags)) return true;
    return window._featureFlags[k] === true;
  };
  window.lucide = { createIcons: function () {} };
  window.closeMobileSidebar = function () {};
  window.atbSyncCurrent = function () {};
  window.cleanLeakedCodeText = function () {};
  window._showFeatureGate = function (pg) { window.__gated = pg; };
  window.toggleNavGroup = function () {};
  window.toggleNavMore = function () {};
  window.rDash = function () { window.__rendered = 'dashboard'; };
  window.rUnits = function () { window.__rendered = 'units'; };
  window.rDailyClosing = function () { window.__rendered = 'dailyclosing'; };
  window._navLazyGuard = function () { return false; };   // pretend every module is loaded
  // js/data.js declares these with let, so they are real globals in the app
  // but not on window. nav() writes to them.
  var _navStack = []; var _navBack = false; var _prevPg = null; var _uid = null;
<\/script>
<script src="js/ui.js?harness=1"><\/script>
</body></html>`;

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = decodeURIComponent(q.url.split('?')[0]);
      if (p === '/harness.html') {
        r.writeHead(200, { 'Content-Type': 'text/html' });
        return r.end(HARNESS);
      }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'] });
  const errors = [];

  async function shell(flags) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluateOnNewDocument(f => { window._featureFlags = f; }, flags);
    await page.goto(`http://127.0.0.1:${PORT}/harness.html`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof window.buildSB === 'function', { timeout: 8000 });
    return page;
  }

  try {
    // ═══ THE TENANT WITHOUT THE MODULE ═════════════════════════════════
    head('a tenant with no daily_closing flag — Khushal Bagh, FMH');
    {
      // Flags present, but the key has never been seen. This is exactly the
      // shape that makes hasFeature() answer TRUE.
      const page = await shell({ pdc: true, blacklist: true });
      is(await page.evaluate(() => window.hasFeature('daily_closing')), true,
        'hasFeature() says TRUE for the unseen key — which is why it is not used here');

      await page.evaluate(() => buildSB());
      const html = await page.$eval('.sb', e => e.innerHTML);
      is(/dailyclosing/.test(html), false, 'the sidebar has no Daily Closing item');
      is(/Daily Closing/.test(html), false, 'and the words appear nowhere in it');

      await page.evaluate(() => { window.__rendered = null; nav('dailyclosing'); });
      is(await page.evaluate(() => window.__rendered), 'dashboard',
        'nav("dailyclosing") lands on the dashboard instead');
      is(await page.evaluate(() =>
        document.getElementById('pg-dailyclosing').classList.contains('on')), false,
        'and the page never becomes the active one');

      // The rest of the sidebar is untouched — this is the "do not touch KBH
      // or FMH navigation" claim, stated as a number.
      const items = await page.$$eval('.sb [data-pg]', n => n.map(x => x.dataset.pg));
      is(items.includes('units') && items.includes('recovery'), true,
        `the rest of the nav is intact (${items.length} items)`);
      await page.evaluate(() => { window.__sbNoFlag = document.querySelector('.sb').innerHTML; });
      await page.close();
    }

    // ═══ THE TENANT WITH IT ════════════════════════════════════════════
    head('Awami Market, with daily_closing explicitly on');
    {
      const page = await shell({ pdc: true, blacklist: true, daily_closing: true });
      await page.evaluate(() => buildSB());
      const items = await page.$$eval('.sb [data-pg]', n => n.map(x => x.dataset.pg));
      is(items.includes('dailyclosing'), true, 'the Daily Closing item is in the sidebar');
      is(items.indexOf('dailyclosing') > items.indexOf('addpayment'), true,
        'and it sits with the money, after Record Payment');

      await page.evaluate(() => { window.__rendered = null; nav('dailyclosing'); });
      is(await page.evaluate(() => window.__rendered), 'dailyclosing',
        'nav("dailyclosing") reaches the page');
      is(await page.evaluate(() =>
        document.getElementById('pg-dailyclosing').classList.contains('on')), true,
        'and it becomes the active page');
      is(await page.evaluate(() => document.getElementById('tb-t').textContent), 'Daily Closing',
        'the title bar names it');
      await page.close();
    }

    // ═══ THE SIDEBAR IS OTHERWISE BYTE-IDENTICAL ═══════════════════════
    head('turning the flag on adds exactly one thing and changes nothing else');
    {
      const off = await shell({ pdc: true });
      await off.evaluate(() => buildSB());
      const a = await off.$eval('.sb', e => e.innerHTML);
      await off.close();

      const on = await shell({ pdc: true, daily_closing: true });
      await on.evaluate(() => buildSB());
      const b = await on.$eval('.sb', e => e.innerHTML);
      await on.close();

      // Strip the one item out of the flagged sidebar; what is left must be
      // the unflagged one, character for character.
      // Cut out the item's own element, whatever tag buildSB happens to use.
      const i = b.indexOf('data-pg="dailyclosing"');
      const start = b.lastIndexOf('<', i);
      const tag = /^<([\w-]+)/.exec(b.slice(start))[1];
      const close = '</' + tag + '>';
      const end = b.indexOf(close, i) + close.length;
      const stripped = b.slice(0, start) + b.slice(end);
      is(stripped === a, true,
        'with the item removed, the two sidebars are identical character for character');
      is(a.length < b.length, true, 'and the flagged one is the longer of the two');
    }

    // ═══ THE DASHBOARD HOOK ════════════════════════════════════════════
    // js/pages/dashboard.js is loaded eagerly by every tenant, so the one
    // function P9 adds to it has to be inert for the two that do not have the
    // module. _dcTile() is exercised for real here — not read, run.
    head('the dashboard hook does nothing at all without the flag');
    {
      const src = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'dashboard.js'), 'utf8');
      const fn = /function _dcTile\(pg\) \{[\s\S]*?\n\}/.exec(src);
      is(!!fn, true, '_dcTile is in dashboard.js and can be run on its own');

      const off = await shell({ pdc: true });
      await off.evaluate(f => { (0, eval)(f); }, fn[0]);
      const before = await off.$eval('#dash-mock', e => e.innerHTML);
      await off.evaluate(() => _dcTile(document.getElementById('dash-mock')));
      is(await off.$eval('#dash-mock', e => e.innerHTML), before,
        'with the flag absent the dashboard HTML is byte-identical after the hook runs');
      is(await off.$('#dc-tile-host'), null, 'and no host div is inserted');
      await off.close();

      const on = await shell({ pdc: true, daily_closing: true });
      await on.evaluate(f => { (0, eval)(f); }, fn[0]);
      await on.evaluate(() => { window._lazyLoadFiles = () => Promise.resolve(); });
      await on.evaluate(() => _dcTile(document.getElementById('dash-mock')));
      is(!!(await on.$('#dc-tile-host')), true, 'with the flag on, the host div appears');
      is(await on.$eval('#dc-tile-host',
        e => e.previousElementSibling.className.includes('nx-page-header')), true,
        'directly under the header, above the rest of the dashboard');
      await on.close();
    }

    // ═══ THE PAGE IS LAZY ══════════════════════════════════════════════
    head('the module is not downloaded by a tenant that cannot reach it');
    {
      const manifest = fs.readFileSync(path.join(ROOT, 'js', 'lazy-pages.js'), 'utf8');
      is(/dailyclosing:\s*\[/.test(manifest), true,
        'daily-closing.js is in the lazy manifest, not eager in login.html');
      is(/_lazyLoadFiles = loadSeq/.test(manifest), true,
        'and the loader exposes _lazyLoadFiles, so the tile can be fetched on demand too');
      const shellHtml = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
      is(/<script[^>]+js\/pages\/daily-closing\.js/.test(shellHtml), false,
        'and login.html does not load it with a script tag');
      is(/<script[^>]+js\/pages\/daily-closing-tile\.js/.test(shellHtml), false,
        'nor the tile');
      is(/id="pg-dailyclosing"/.test(shellHtml), true,
        'only the empty host div is in the shell');
    }
  } finally {
    await browser.close();
    srv.close();
  }

  if (errors.length) {
    console.log('\n── page errors');
    errors.forEach(e => bad(e));
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                         : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})();
