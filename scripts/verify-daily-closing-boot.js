#!/usr/bin/env node
/**
 * Daily Closing — the BOOT SEQUENCE, driven for real.
 *
 *   node scripts/verify-daily-closing-boot.js
 *
 * ── WHY THIS FILE EXISTS (standing rule SR-5) ───────────────────────────────
 * verify-daily-closing-shell.js has sixteen assertions about the feature gate
 * and every one of them passed while the module was invisible on the pilot.
 * It set `window._featureFlags` with `evaluateOnNewDocument` — BEFORE the page
 * loaded — so `buildSB()` always saw populated flags. It proved the gate's
 * LOGIC and never once touched the ORDER, and the bug was entirely in the
 * order: auth.js called buildSB() at line 383 and loadFeatureFlags() at 411.
 *
 * A test that supplies the state under test has not tested it.
 *
 * So this file supplies NOTHING. `window._featureFlags` starts undefined, the
 * real `_completeLogin()` out of js/auth.js runs, and the flags arrive only
 * when a stubbed network answers — late, on purpose. Only the network is
 * faked; the sequence is the real one.
 *
 * It covers three cases on the login path, because the interesting one is not
 * the happy path:
 *
 *   1 · flags answer quickly     → the item is there on first paint
 *   2 · flags answer SLOWLY,     → buildSB() runs without them, and the shell
 *       past the 1200 ms bound     REPAIRS ITSELF when they land
 *   3 · flags FAIL outright      → the sidebar still exists, every default-open
 *                                  page is still reachable, and Daily Closing
 *                                  fails CLOSED
 *
 * — and then does the whole thing again through the OTHER door.
 *
 * ── THE SECOND ROUND (standing rule SR-6) ──────────────────────────────────
 * RMS reaches the app shell two ways and they are separate code:
 *
 *     fresh login      _completeLogin()      js/auth.js
 *     returning visit  tryRestoreSession()   js/init.js
 *
 * The first version of this file drove only the first one, so it went green on
 * a fix that had been applied to only half the app. The second one is what a
 * hard refresh runs, which is how everybody but a developer arrives — and it
 * had never loaded the feature flags in its life. A fix verified on one entry
 * path is unverified on every other.
 *
 * So the restore path is driven too, and it is driven twice: once against the
 * real js/init.js, and once against the same file with the two shell-context
 * lines stripped out by the harness's own server. The second run must FAIL the
 * same assertions the first run passes, or section 6 is decoration.
 *
 * It also measures what the ordering fix costs a tenant with no flags at all —
 * KBH and FMH take both of these paths.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4478;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[verify-daily-closing-boot] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const is  = (got, want, what) => got === want ? ok(what)
  : bad(`${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const head = t => console.log('\n── ' + t);

/* The shell as login.html leaves it, plus the handful of globals auth.js
   reaches for that live in other files. NOTHING here sets _featureFlags. */
const HARNESS = qs => `<!doctype html><html><head><meta charset="utf-8"><title>boot harness</title></head>
<body>
  <div id="s-login" class="on"></div>
  <div id="s-app"></div>
  <div id="sb-av"></div><div id="sb-un"></div><div id="sb-ur"></div>
  <div class="sb"><div class="sb-nav" id="sb-nav"></div></div>
  <div class="pw">
    <div id="pg-dashboard" class="pg on"><div class="nx"><div class="nx-page-header">Dashboard</div></div></div>
    <div id="pg-units" class="pg"></div>
    <div id="pg-dailyclosing" class="pg"></div>
  </div>
  <div id="tb-t"></div><div id="tb-c"></div><div id="nav-crumb-page"></div>
  <div id="toast"><span id="t-ic"></span><span id="t-m"></span></div>
  <div id="nav-actions"><button id="nav-back"></button></div>
<script>
  // ── the network, and only the network ──────────────────────────────────
  window.__flagDelay = 0;         // ms before get_my_feature_flags answers
  window.__brandDelay = 0;        // ms before get_company_branding answers
  window.__flagFails = false;     // make it reject instead
  window.__rpcLog = [];
  window.__t0 = 0;
  window.__mark = {};

  window.supabase = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'auth-1' } } } }),
      onAuthStateChange: () => {},
    },
    rpc: (name, args) => {
      window.__rpcLog.push({ name, at: Math.round(performance.now() - window.__t0) });
      if (name === 'get_my_feature_flags') {
        if (window.__flagFails) {
          return new Promise((_, rej) =>
            setTimeout(() => rej(new Error('network down')), window.__flagDelay));
        }
        return new Promise(res => setTimeout(() => {
          window.__mark.flagsAnswered = Math.round(performance.now() - window.__t0);
          res({ data: window.__flagRows });
        }, window.__flagDelay));
      }
      if (name === 'get_company_branding') {
        // The pilot's real shape, and the reason the company chip disagreed
        // with itself: the DISPLAY name and the legal name are different
        // words. Read it and the chip says "Fourteen Group of Companies";
        // miss it and coDisplayName() falls back to S.coName.
        return new Promise(res => setTimeout(() => res({
          data: { company_name: 'Awami Market',
                  display_name: 'Fourteen Group of Companies' },
        }), window.__brandDelay));
      }
      if (name === 'get_user_projects') return Promise.resolve({ data: { rows: [] } });
      return Promise.resolve({ data: null });
    },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  };

  // ── the globals auth.js expects from elsewhere in the app ──────────────
  window.notify = { success(){}, error(){}, info(){} };
  window.toast = function(){};
  window.ini = n => String(n||'?').slice(0,2).toUpperCase();
  window.gfus = () => ({});
  window.effectiveRole = () => (window.S && window.S.role) || 'owner';
  window.hasPermission = () => true;
  window.hasModuleGrant = () => true;
  window.hasProjectAccess = () => true;
  window.lucide = { createIcons(){} };
  window.closeMobileSidebar = function(){};
  window.atbSyncCurrent = function(){};
  window.cleanLeakedCodeText = function(){};
  window._showFeatureGate = function(){};
  window.toggleNavGroup = function(){};
  window.toggleNavMore = function(){};
  window._navLazyGuard = () => false;
  window._projectsCache = [{ id: 'p-1', project_name: 'Awami Market' }];
  // js/init.js's DOMContentLoaded handler calls these two out of js/data.js,
  // which is a localStorage database this file has no use for.
  window.gdb = () => ({});
  window.APP_BUILD = 'boot-harness';
  window._lazyLoadFiles = () => Promise.resolve();

  // The RMS foundation kit. dashboard.js references NX while it loads, and
  // without it the whole file throws — which silently takes _dcTile() with it
  // and makes "no tile" look like a gate decision rather than a missing script.
  window.NX = new Proxy({}, { get: () => (() => '') });
  window.esc = s => String(s == null ? '' : s);
  window.fmtPKR = n => String(n);
  window.td = () => new Date().toISOString().slice(0, 10);

  // ── a realistic cache phase to overlap with ────────────────────────────
  // _completeLogin awaits seven cache loaders before it reaches buildSB().
  // Without them the harness finishes in 10 ms and any flag fetch looks like
  // pure added latency, which is the opposite of what production does. 200 ms
  // is a conservative stand-in for that phase.
  window.__cacheMs = 200;
  const _slow = () => new Promise(r => setTimeout(() => r(true), window.__cacheMs));
  window.loadFloorsCache = _slow;   window.loadTypesCache    = _slow;
  window.loadStatusesCache = _slow; window.loadSaleTypesCache = _slow;
  window.loadProjectsCache = _slow; window.loadClientsCache  = _slow;
  window.loadUnitsCache = _slow;

  window.rDailyClosingTile = function () {   // the tile itself is not under test here
    const h = document.getElementById('dc-tile-host');
    if (h) h.innerHTML = '<div class="dc-tile">tile</div>';
  };
  // js/data.js declares these with let, so they are real globals in the app
  // but not on window. ui.js and auth.js write to them.
  var _navStack = []; var _navBack = false; var _prevPg = null; var _uid = null;
  var _leakGuardOn = false; var _coid = null; var S = null;
<\/script>
<script src="js/helpers.js?boot=1"><\/script>
<script src="js/ui.js?boot=1"><\/script>
<script src="js/pages/company-branding.js?boot=1"><\/script>
<script src="js/pages/dashboard.js?boot=1"><\/script>
<script src="js/auth.js?boot=1"><\/script>
<script src="js/init.js?${qs}"><\/script>
<script>
  /* THE REAL rDash() RUNS. Only the two branches it picks between are stubbed
     — _dashAdmin needs six months of RPCs that are not what this file is about
     — so the real rDash body, including its _dcTile(pg) call, is the code
     under test. Stubbed HERE, after dashboard.js has loaded, because a
     function declaration in that file would otherwise overwrite an earlier
     stub of the same name. */
  window._dashAdmin = window._dashStaff = async function (pg) {
    window.__mark.rDash = Math.round(performance.now() - window.__t0);
    pg.innerHTML = '<div class="nx"><div class="nx-page-header">Dashboard</div>' +
                   '<div class="nx-card">the rest of the dashboard</div></div>';
  };

  // buildSB records the moment it ran, so the ORDER can be asserted rather
  // than inferred from the result.
  (function () {
    const real = window.buildSB;
    window.buildSB = function () {
      window.__mark.buildSB = Math.round(performance.now() - window.__t0);
      window.__mark.flagsAtBuildSB = window._featureFlags === undefined ? 'undefined'
        : window._featureFlags === null ? 'null' : JSON.stringify(window._featureFlags);
      window.__mark.buildCount = (window.__mark.buildCount || 0) + 1;
      return real.apply(this, arguments);
    };
  })();

  /* ── THE OTHER DOOR ────────────────────────────────────────────────────
     __boot() above drives _completeLogin(): a fresh sign-in. This one drives
     tryRestoreSession() out of js/init.js: a returning visit — every hard
     refresh, every reopened tab, and the way Rashid and every user of the
     pilot actually arrives at the app. It is a DIFFERENT function with its own
     copy of the boot sequence, and for a week it was the one that had never
     been driven by anything.

     It seeds only what a browser would already hold: a saved nxn_sess and a
     live Supabase token. window._featureFlags stays undefined. */
  window.__bootRestore = function (rows, delay, fails) {
    window.__flagRows = rows;
    window.__flagDelay = delay || 0;
    window.__flagFails = !!fails;
    window.__rpcLog = []; window.__mark = {};
    window._featureFlags = undefined;      // NOT SEEDED — the point of the file
    window._featureFlagsReady = false;
    window._sbBuiltWithoutFlags = false;
    window._cobranding = null;
    window.__shellCtx = null;
    window.S = null;
    localStorage.setItem('nxn_sess', JSON.stringify({
      cid: 'co-1', userId: 'u-1', authUid: 'auth-1', name: 'Awami',
      role: 'owner', coName: 'Awami Market', subStatus: 'active',
      onboardingComplete: true, modulePermissions: {},
    }));
    localStorage.removeItem('nxn_active');   // never stamped → not idle-evicted
    document.getElementById('s-app').classList.remove('on');
    document.getElementById('s-login').classList.add('on');
    document.getElementById('sb-nav').innerHTML = '';
    window.__t0 = performance.now();
    return tryRestoreSession()
      .then(() => Math.round(performance.now() - window.__t0));
  };

  window.__boot = function (rows, delay, fails) {
    window.__flagRows = rows;
    window.__flagDelay = delay || 0;
    window.__flagFails = !!fails;
    window.__rpcLog = []; window.__mark = {};
    window._featureFlags = undefined;      // ⚠️ NOT SEEDED. The point of the file.
    window._featureFlagsReady = false;
    window._sbBuiltWithoutFlags = false;
    window.__t0 = performance.now();
    return _completeLogin(
      { id: 'u-1', name: 'Awami', username: 'awami', role: 'owner',
        module_permissions: {}, session_version: 1 },
      { id: 'co-1', name: 'Awami Market', code: 'AM', onboarding_complete: true,
        sub_status: 'active' }
    ).then(() => Math.round(performance.now() - window.__t0));
  };
<\/script>
</body></html>`;

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((rq, r) => {
      const p = decodeURIComponent(rq.url.split('?')[0]);
      if (p === '/boot.html') {
        r.writeHead(200, { 'Content-Type': 'text/html' });
        return r.end(HARNESS(/unfixed=1/.test(rq.url) ? 'strip=1' : 'boot=1'));
      }
      if (p === '/js/init.js' && /strip=1/.test(rq.url)) {
        // js/init.js as it stood before this fix: the two shell-context lines
        // removed and NOTHING else touched. Serving it is how the restore-path
        // assertions below are proved to be detectors rather than decoration
        // (SR-2), and it is generated from the real file so it cannot rot.
        const src = fs.readFileSync(path.join(ROOT, 'js', 'init.js'), 'utf8');
        const NL = String.fromCharCode(10);
        const out = src.split(NL)
          .filter(l => !/startShellContext|awaitShellContext/.test(l))
          .join(NL);
        if (out === src) { r.writeHead(500); return r.end('nothing to strip'); }
        r.writeHead(200, { 'Content-Type': 'text/javascript' });
        return r.end(out);
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

const AWAMI = [{ feature_key: 'daily_closing', enabled: true }];
const OTHER = [{ feature_key: 'pdc', enabled: true }];   // KBH/FMH shape: no daily_closing

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'] });
  const errors = [];

  // A wait that never comes true is a NAMED failure, not a stack trace (SR-2's
  // cousin, and the same wrapper the screen suite carries).
  function nameTheTimeouts(page, label) {
    for (const m of ['waitForSelector', 'waitForFunction']) {
      const orig = page[m].bind(page);
      page[m] = async (...args) => {
        try { return await orig(...args); }
        catch (e) {
          const seen = [e && e.name, e && e.message,
                        e && e.cause && e.cause.name, e && e.cause && e.cause.message]
            .filter(Boolean).join(' | ');
          if (/timeouterror|timeout|waiting failed/i.test(seen)) {
            const t = typeof args[0] === 'string' ? args[0]
              : String(args[0]).replace(/\s+/g, ' ').slice(0, 70);
            bad(`[${label}] gave up waiting for ${t}`);
            return null;
          }
          throw e;
        }
      };
    }
  }

  async function open(label, opts) {
    const page = await browser.newPage();
    nameTheTimeouts(page, label);
    page.on('pageerror', e => errors.push(e.message));
    // Every page starts as a browser that has never seen this app. Pages share
    // one profile, so without this the nxn_sess a previous case wrote would be
    // found by js/init.js's own DOMContentLoaded handler and a whole extra
    // restore would run before the case under test ever began.
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) {} });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/boot.html` + ((opts && opts.unfixed) ? '?unfixed=1' : ''),
      { waitUntil: 'networkidle2' });
    return page;
  }
  /* the FRESH-LOGIN door */
  async function boot(rows, delay, fails) {
    const page = await open(`login flags+${delay || 0}ms${fails ? '/fail' : ''}`);
    const took = await page.evaluate((r, d, f) => window.__boot(r, d, f), rows, delay || 0, !!fails);
    return { page, took };
  }
  /* the RETURNING-VISIT door — the same four cases, the other function */
  async function restore(rows, delay, opts) {
    const page = await open(`restore flags+${delay || 0}ms${(opts && opts.unfixed) ? '/unfixed' : ''}`, opts);
    const took = await page.evaluate((r, d) => window.__bootRestore(r, d, false), rows, delay || 0);
    return { page, took };
  }
  // updateCoLogo() draws the chip as an initial-avatar span followed by a name
  // span, so the name is the LAST child, not the whole textContent.
  const chip = page => page.$eval('#tb-c',
    n => (n.querySelector('span:last-child') || n).textContent.trim()).catch(() => '');
  const items = page => page.$$eval('.sb [data-pg]', n => n.map(x => x.dataset.pg));

  try {
    // ═══ 1 · THE FLAGS ANSWER QUICKLY ══════════════════════════════════
    // 80 ms, not 0. With no delay the flag promise and the race timer are both
    // macrotasks and which wins is luck — the pre-fix code passed this case
    // about half the time. A delay the fix must actually wait through makes
    // this case a detector rather than a coin toss.
    head('Awami, flags answering promptly — the item is there on first paint');
    {
      const { page } = await boot(AWAMI, 80);
      const m = await page.evaluate(() => window.__mark);

      // THE ASSERTION THE OLD SUITE COULD NOT MAKE: what did buildSB SEE?
      is(m.flagsAtBuildSB, '{"daily_closing":true}',
        'buildSB() ran with the flags already populated');
      is((await items(page)).includes('dailyclosing'), true,
        'and the Daily Closing item is in the sidebar');
      is(m.buildCount, 1, 'the sidebar was built once — no repair was needed');
      is(!!(await page.$('#dc-tile-host')), true, 'and the dashboard tile host is on the page');
      await page.close();
    }

    // ═══ 2 · THE FLAGS ARRIVE LATE ═════════════════════════════════════
    // 1800 ms is past the 1200 ms bound on purpose: buildSB() MUST go ahead
    // without them, and the shell must then repair itself.
    head('Awami, flags arriving after the bound — the shell repairs itself');
    {
      const { page, took } = await boot(AWAMI, 1800);
      const early = await page.evaluate(() => window.__mark);
      // Either "undefined" (a fresh page) or "null" (after a logout) — both
      // mean "not populated", and both are what the old code shipped with.
      is(['undefined', 'null'].includes(early.flagsAtBuildSB), true,
        `buildSB() ran without the flags (${early.flagsAtBuildSB}), as it must rather than hang`);
      is((await items(page)).includes('dailyclosing'), false,
        'so the item is legitimately absent at that moment');
      took < 1800
        ? ok(`and login did not wait for them — ${took} ms, bound is 1200 ms`)
        : bad(`login waited ${took} ms for a flag fetch it should have given up on`);

      // now let them land
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 5000 });
      await page.waitForFunction(
        () => !!document.querySelector('.sb [data-pg="dailyclosing"]'), { timeout: 5000 });
      const m = await page.evaluate(() => window.__mark);
      is((await items(page)).includes('dailyclosing'), true,
        'THE ITEM APPEARS BY ITSELF once the flags land — no reload, no second login');
      is(m.buildCount, 2, 'the sidebar was rebuilt exactly once to repair it');
      is(!!(await page.$('#dc-tile-host')), true, 'and the dashboard was re-rendered with the tile');
      await page.close();
    }

    // ═══ 3 · THE FLAGS FAIL ════════════════════════════════════════════
    head('the fetch throws — the shell must survive it');
    {
      const { page } = await boot(AWAMI, 40, true);
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 5000 });
      const nav = await items(page);
      nav.length > 5
        ? ok(`the sidebar is still there — ${nav.length} items`)
        : bad(`the sidebar has ${nav.length} items after a failed flag fetch`);
      is(nav.includes('units') && nav.includes('recovery'), true,
        'and every default-open page is still reachable');
      is(nav.includes('dailyclosing'), false,
        'Daily Closing fails CLOSED — the money module does not appear on a guess');
      is(await page.evaluate(() => JSON.stringify(window._featureFlags)), '{}',
        'the flags fall back to {}, which hasFeature() reads as "allow everything"');
      await page.close();
    }

    // ═══ 4 · A TENANT WITH NO FLAGS AT ALL ═════════════════════════════
    // KBH and FMH have zero rows in company_feature_flags and take this exact
    // login path. This is the blast-radius check.
    head('Khushal Bagh / FMH shape — no daily_closing row anywhere');
    {
      const { page } = await boot(OTHER, 0);
      const nav = await items(page);
      is(nav.includes('dailyclosing'), false, 'no Daily Closing item, as before');
      is(await page.$('#dc-tile-host'), null, 'and no tile host on the dashboard');
      is(nav.includes('units') && nav.includes('pdc'), true,
        'and their own sidebar is intact');
      is(await page.evaluate(() => window.__mark.buildCount), 1,
        'built once — a tenant without the module pays for no rebuild');
      await page.close();
    }


    // 6 · THE OTHER DOOR — A RETURNING VISIT
    // Everything above drives _completeLogin(). This is tryRestoreSession(),
    // which is how the pilot actually arrives, and the reason SR-6 exists: the
    // ordering fix was verified on one entry path and was unverified on this
    // one, where it had not been made at all.
    head('Awami on a RETURNING VISIT — the path everybody actually takes');
    {
      const { page } = await restore(AWAMI, 80);
      is(await page.evaluate(() => document.getElementById('s-app').classList.contains('on')),
        true, 'the session restored and the app shell is showing');
      const m = await page.evaluate(() => window.__mark);
      is(m.flagsAtBuildSB, '{"daily_closing":true}',
        'buildSB() ran with the flags already populated — on THIS path too');
      is((await items(page)).includes('dailyclosing'), true,
        'and Daily Closing is in the sidebar after a refresh, not only after a login');
      is(m.buildCount, 1, 'built once — no repair was needed');
      // the cosmetic half of the same bug, and the thing Rashid actually saw
      is(await chip(page), 'Fourteen Group of Companies',
        'the company chip shows the BRAND name — cobranding loaded here as well');
      await page.close();
    }

    // 7 · THE SAME PATH, UNFIXED — proof the four above are detectors
    // Serving js/init.js with the two shell-context lines removed and nothing
    // else changed. If this page passes, section 6 proves nothing (SR-2).
    head('the same visit against the UNFIXED js/init.js — the assertions must fire');
    {
      const { page } = await restore(AWAMI, 80, { unfixed: true });
      is(await page.evaluate(() => document.getElementById('s-app').classList.contains('on')),
        true, 'the shell still boots — the bug was never a crash, which is why it survived');
      const m = await page.evaluate(() => window.__mark);
      is(['undefined', 'null'].includes(m.flagsAtBuildSB), true,
        `RED: buildSB() saw no flags (${m.flagsAtBuildSB}) — the bug, reproduced`);
      is((await items(page)).includes('dailyclosing'), false,
        'RED: Daily Closing is missing from the sidebar, exactly as reported');
      is(await chip(page), 'Awami Market',
        'RED: and the chip falls back to the legal name — the label Rashid saw flip');
      // and it never repairs, because nothing ever asked for the flags
      await new Promise(r => setTimeout(r, 600));
      is(await page.evaluate(() => window._featureFlagsReady === true), false,
        'RED: the flags are never fetched at all, so the shell cannot repair itself');
      await page.close();
    }

    // 8 · KBH / FMH ON THE RESTORE PATH — the blast radius of the second fix
    head('Khushal Bagh / FMH shape on a returning visit');
    {
      const { page } = await restore(OTHER, 0);
      const nav = await items(page);
      is(nav.includes('dailyclosing'), false, 'no Daily Closing item, as before');
      is(nav.includes('units') && nav.includes('pdc'), true, 'and their own sidebar is intact');
      is(await page.evaluate(() => window.__mark.buildCount), 1,
        'built once — a tenant without the module pays for no rebuild here either');
      await page.close();
    }
    // ═══ 5 · WHAT THE ORDERING COSTS ═══════════════════════════════════
    head('the cost of awaiting the flags, measured');
    {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const { page, took } = await boot(OTHER, 60);   // 60 ms = a plausible RPC
        runs.push(took);
        await page.close();
      }
      const med = runs.slice().sort((a, b) => a - b)[2];
      console.log(`     login → dashboard, five runs: ${runs.join(', ')} ms (median ${med})`);
      const { page: p2, took: t2 } = await boot(OTHER, 0);
      await p2.close();
      console.log(`     with the flags answering instantly: ${t2} ms`);
      med - t2 < 120
        ? ok(`a 60 ms flag fetch adds ${Math.max(0, med - t2)} ms — it overlaps the cache phase`)
        : bad(`the flag fetch is adding ${med - t2} ms to every tenant's login`);
    }
  } catch (e) {
    bad(`the run stopped early: ${(e && e.message ? e.message : String(e)).split('\n')[0]}`);
  } finally {
    await browser.close();
    srv.close();
  }

  if (errors.length) {
    console.log('\n── page errors');
    [...new Set(errors)].forEach(e => bad(e));
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                         : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})();
