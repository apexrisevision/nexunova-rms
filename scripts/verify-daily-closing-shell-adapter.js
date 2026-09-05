#!/usr/bin/env node
/**
 * Daily Closing — THE SHELL ADAPTER, on the genuine path.
 *
 *   node scripts/verify-daily-closing-shell-adapter.js
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * On 2026-09-05 the screen was stuck on skeletons on the pilot. The cause was
 * `global.supabase.rpc` in the thirty-line shell adapter at the bottom of
 * js/pages/daily-closing.js: js/supabase.js:37 creates the client as a `const`,
 * which is NOT a property of window, and `window.supabase` is still the
 * supabase-js UMD library, which has no .rpc. The call threw synchronously, out
 * of load(), out of mount(), out of rDailyClosing(), out of nav() — which
 * catches promise rejections only — so the DOM stayed exactly as render(true)
 * had left it. For ever. No error on screen, no empty state, no button.
 *
 * Seventeen suites were green. Every one of them missed it, for one reason:
 *
 *   verify-daily-closing-screen.js  158 assertions, drives daily-closing.html
 *                                   ?stub=1 — a standalone page. Not login.html,
 *                                   not nav(), not the adapter.
 *   verify-daily-closing-shell.js    23 assertions, and line 124 REPLACES the
 *                                   real rDailyClosing with its own two-line
 *                                   stub. It tests nav()'s routing, not the page.
 *   verify-daily-closing-tile.js     13 assertions, pure SQL. No browser.
 *
 * So lines 1214-1277 of daily-closing.js and 213-244 of daily-closing-tile.js —
 * the only code in the module that touches an RMS global — had never once been
 * executed by a test. The bug lived exactly where the coverage stopped.
 *
 * This file drives that code and nothing else pretends to: the real login.html,
 * the real 44-script boot, the real nav(), the real lazy loader, the real
 * adapter, against Awami Market's genuinely empty state.
 *
 * ── WHAT IS REPLICATED, AND WHAT IS NOT (read this before trusting it) ──────
 * The failure was caused by the SHAPE OF THE GLOBALS, so the globals are loaded,
 * never constructed. A harness that writes `window.supabase = {...}` has already
 * destroyed the thing under test — the first attempt at reproducing this bug did
 * exactly that and passed.
 *
 *   REPLICATED, by loading the real file:
 *     · js/vendor/supabase-js-2.34.0.umd.js — the genuine UMD library, so
 *       `window.supabase` is the genuine wrong object.
 *     · js/supabase.js — the genuine `const supabase = createClient(...)`, so
 *       the client is a genuine script-scope lexical binding that is not on
 *       window. Nothing here assigns either of them.
 *     · login.html, ui.js, init.js, auth.js, lazy-pages.js and the rest of the
 *       shell, unmodified.
 *
 *   REPLICATED, from live production, captured at run time by impersonating the
 *   Awami owner through the Management API:
 *     · every Daily Closing RPC payload, including get_cash_day_summary's
 *       {exists:false} and get_daily_closing_tile's zeros. Captured rather than
 *       written down, so the suite cannot drift from what the pilot returns —
 *       and §0 below FAILS if Awami stops being empty, rather than quietly
 *       testing a different case.
 *
 *   NOT REPLICATED — stated rather than approximated:
 *     · The NETWORK. window.fetch is intercepted before any script runs. That is
 *       deliberate (SR-5: stub the network, not the state) but it means TLS,
 *       PostgREST's own routing, and the real 401/403 path are not exercised
 *       here. verify-daily-closing-isolation.js covers those over real HTTPS.
 *     · AUTHENTICATION. A session is placed in localStorage the way a signed-in
 *       browser holds one, with a syntactically real but UNSIGNED JWT. supabase-js
 *       does not verify signatures client-side, so getSession() is satisfied and
 *       never reaches the network. No password is typed, and no real credential
 *       exists for the Awami owner that a test may use.
 *     · RPCs BELONGING TO OTHER MODULES. login.html boots 44 scripts and many of
 *       them fetch. Anything not in the captured map is answered with a benign
 *       empty result AND RECORDED; the run prints the list, so a gap is visible
 *       instead of silently shaping the outcome.
 *
 * ── THE RED PROOF (SR-2, SR-6) ─────────────────────────────────────────────
 * The harness's own server will also serve js/pages/daily-closing.js and
 * daily-closing-tile.js with `supabase.rpc` rewritten back to
 * `global.supabase.rpc` — generated from the real files, so it cannot rot. Every
 * assertion below must go RED against those. A suite that cannot fail here would
 * be the fourth green suite in a row that could not see this bug.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { q } = require('./_sbq.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4481;

const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';   // Awami Market
const PJ = '59ded55b-9bc2-45b2-a372-49fc31807fa9';   // Awami Market (project)
const AUTH_UID = '315f2852-852f-4653-9253-a5a27a7828c8';
const USER_ID = '03b790d0-199b-4f5c-9010-a60a4129dc66';
const REF = 'itqxljtfbrppntgyfush';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[verify-daily-closing-shell-adapter] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  \u2705 ' + m); };
const bad = m => { fail++; console.log('  \u274C ' + m); };
const is  = (got, want, what) => got === want ? ok(what)
  : bad(`${what} \u2014 got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const head = t => console.log('\n\u2500\u2500 ' + t);

/* ── capture what production actually answers, as the Awami owner ────────── */
const IMP = `select set_config('request.jwt.claims', json_build_object('sub','${AUTH_UID}')::text, true);`;
async function callAs(sql) {
  const rows = await q('BEGIN; ' + IMP + ' ' + sql + '; ROLLBACK;');
  const row = Array.isArray(rows) ? rows.find(x => x && x.r !== undefined) : null;
  return row ? row.r : null;
}

async function capture() {
  const [access, summary, payees, accounts, units, days, tile, flags, projects] = await Promise.all([
    callAs(`select get_my_daily_closing_access('${CO}','${PJ}') as r`),
    callAs(`select get_cash_day_summary('${CO}','${PJ}', current_date) as r`),
    callAs(`select list_payees('${CO}','${PJ}') as r`),
    callAs(`select list_qb_accounts_for_project('${CO}','${PJ}') as r`),
    callAs(`select list_units_for_picker('${CO}','${PJ}') as r`),
    callAs(`select list_cash_days('${CO}','${PJ}', 60) as r`),
    callAs(`select get_daily_closing_tile(p_company_id=>'${CO}'::uuid, p_project_id=>'${PJ}'::uuid) as r`),
    q(`select coalesce(jsonb_agg(jsonb_build_object('feature_key',feature_key,'enabled',is_enabled)),'[]'::jsonb) as r
         from company_feature_flags where company_id='${CO}'`).then(r => r[0].r),
    callAs(`select list_projects('${CO}') as r`),
  ]);
  return {
    rpc: {
      get_my_daily_closing_access: access,
      get_cash_day_summary: summary,
      list_payees: payees,
      list_qb_accounts_for_project: accounts,
      list_units_for_picker: units,
      list_cash_days: days,
      get_daily_closing_tile: tile,
      get_my_feature_flags: flags,
      list_projects: projects,
    },
  };
}

/* ── the session a signed-in browser holds ───────────────────────────────── */
function b64u(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fakeJwt() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  // Unsigned on purpose: supabase-js never verifies a signature in the browser,
  // and no real Awami credential exists that a test may use. Stated, not hidden.
  return b64u({ alg: 'HS256', typ: 'JWT' }) + '.' +
         b64u({ sub: AUTH_UID, role: 'authenticated', aud: 'authenticated', exp }) + '.' +
         'not-a-real-signature';
}

/* ── the server ──────────────────────────────────────────────────────────── */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.woff2':'font/woff2', '.ico':'image/x-icon' };

// The two module files as they stood BEFORE the fix: `supabase.` put back to
// `global.supabase.` inside the shell adapter, and nothing else touched.
// Generated from the real files at request time so it can never go stale.
function unfix(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = src.replace(/(\n\s*)return supabase\.(rpc|auth)\b/g, '$1return global.supabase.$2');
  return { src, out };
}

function serve() {
  return new Promise(res => {
    const s = http.createServer((rq, r) => {
      const p = decodeURIComponent(rq.url.split('?')[0]);
      const unfixed = /unfixed=1/.test(rq.url);
      if (unfixed && (p === '/js/pages/daily-closing.js' || p === '/js/pages/daily-closing-tile.js')) {
        const { src, out } = unfix(p.slice(1));
        if (out === src) { r.writeHead(500); return r.end('nothing to un-fix in ' + p); }
        r.writeHead(200, { 'Content-Type': 'text/javascript' });
        return r.end(out);
      }
      const f = path.join(ROOT, p === '/' ? '/login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

(async () => {
  console.log('\u2500\u2500 asking production what Awami actually returns');
  const CAP = await capture();

  /* ═══ 0 · THE CASE UNDER TEST IS REALLY THE EMPTY ONE ═══════════════════
     If somebody opens a day on Awami, every assertion below still passes but
     stops meaning what it says. This fails loudly instead. */
  head('the pilot is still in the state this suite is about');
  is(CAP.rpc.get_cash_day_summary && CAP.rpc.get_cash_day_summary.exists, false,
    'Awami has no cash day for today \u2014 the genuinely empty case');
  is((CAP.rpc.list_cash_days.days || []).length, 0, 'and no cash day on any date');
  is((CAP.rpc.list_payees.payees || []).length, 0, 'and no payees \u2014 nothing has been set up');
  is(CAP.rpc.get_daily_closing_tile.status, null, 'the tile agrees: no day open');
  is(JSON.stringify(CAP.rpc.get_my_feature_flags).indexOf('daily_closing') > -1, true,
    'and the daily_closing flag is really on for this tenant');

  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'] });

  async function open(opts) {
    const page = await browser.newPage();
    const errors = [], unstubbed = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    const hang = !!(opts && opts.hangDailyClosing);
    await page.evaluateOnNewDocument((cap, uid, authUid, ref, jwt, co, pj, hang) => {
      try { localStorage.clear(); } catch (_) {}
      window.__unstubbed = [];
      window.__rpcCalls = [];

      // The browser's own storage, as a signed-in browser holds it. Not app state.
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600,
        expires_at: now + 3600, refresh_token: 'r',
        user: { id: authUid, aud: 'authenticated', role: 'authenticated',
                email: 'owner@awami.invalid', app_metadata: {}, user_metadata: {} },
      }));
      localStorage.setItem('nxn_sess', JSON.stringify({
        userId: uid, name: 'Awami', username: 'awami', role: 'owner', permissions: {},
        sessionVersion: 1, cid: co, coName: 'Awami Market', coCode: 'AM',
        authUid: authUid, onboardingComplete: true, subStatus: 'active',
      }));

      // ONLY the network. Installed before any script so nothing races it.
      const realFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('supabase.co') === -1) return realFetch(input, init);

        const json = body => Promise.resolve(new Response(JSON.stringify(body), {
          status: 200, headers: { 'Content-Type': 'application/json' } }));

        const m = url.match(/\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)/);
        if (m) {
          window.__rpcCalls.push(m[1]);
          // A request that never answers. Not an error, not a timeout — the
          // shape that leaves a promise chain hanging for ever.
          if (hang && /cash|payee|closing|qb_accounts|units_for_picker/.test(m[1])) {
            return new Promise(function () {});
          }
          if (Object.prototype.hasOwnProperty.call(cap.rpc, m[1])) return json(cap.rpc[m[1]]);
          window.__unstubbed.push(m[1]);
          // An ARRAY, not {}. Every RMS cache loader does (data || []).map(…)
          // on what it gets back, so {} makes a dozen unrelated modules throw
          // noise that has nothing to do with this suite.
          return json([]);                       // benign, and recorded
        }
        if (/\/rest\/v1\//.test(url)) return json([]);
        if (/\/auth\/v1\//.test(url)) return json({});
        return json({});
      };
    }, CAP, USER_ID, AUTH_UID, REF, fakeJwt(), CO, PJ, hang);

    await page.setViewport({ width: 1440, height: 950 });
    await page.goto(`http://127.0.0.1:${PORT}/login.html` + (opts && opts.unfixed ? '?unfixed=1' : ''),
      { waitUntil: 'networkidle2' });
    return { page, errors, unstubbed };
  }

  // The lazy loader appends <script src="js/pages/daily-closing.js?v=…">, which
  // must carry the unfixed flag too or the red run would quietly load the fix.
  async function forceUnfixedLazy(page) {
    await page.evaluate(() => {
      const real = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = real(tag);
        if (String(tag).toLowerCase() === 'script') {
          const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
          Object.defineProperty(el, 'src', {
            get() { return d.get.call(this); },
            set(v) { d.set.call(this, v + (v.indexOf('?') > -1 ? '&' : '?') + 'unfixed=1'); },
          });
        }
        return el;
      };
    });
  }

  async function driveToScreen(page) {
    await page.waitForFunction(
      () => document.getElementById('s-app') &&
            document.getElementById('s-app').classList.contains('on'), { timeout: 20000 });
    await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 20000 });
    const thrown = await page.evaluate(() => {
      try { nav('dailyclosing'); return null; } catch (e) { return String(e); }
    });
    // The lazy load is async; give the real loader time to fetch three files.
    await page.waitForFunction(
      () => { const h = document.getElementById('pg-dailyclosing');
              return !!(h && h.innerHTML.length > 200); }, { timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1800));
    return thrown;
  }

  const readScreen = page => page.evaluate(() => {
    const h = document.getElementById('pg-dailyclosing') || { innerHTML: '', innerText: '' };
    return {
      skeletons: h.querySelectorAll ? h.querySelectorAll('[class*=skel]').length : 0,
      openBtn: !!(h.querySelector && h.querySelector('#dc-open')),
      retryBtn: !!(h.querySelector && h.querySelector('#dc-retry')),
      hasError: !!(h.querySelector && h.querySelector('.dc-error-note')),
      text: ((h.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 240),
      rpcCalls: window.__rpcCalls.slice(),
      unstubbed: window.__unstubbed.slice(),
    };
  });

  // innerText is unreliable in a headless render (unlaid-out nodes collapse), so
  // the tile is read out of the DOM it actually built.
  const readTile = page => page.evaluate(() => {
    const h = document.getElementById('dc-tile-host') || null;
    if (!h) return { present: false };
    const txt = s => { const n = h.querySelector(s); return n ? n.textContent.trim() : null; };
    return {
      present: true,
      skeletons: h.querySelectorAll('[class*=skel]').length,
      figures: [...h.querySelectorAll('.dc-hero-value')].map(n => n.textContent.trim()),
      status: txt('.dc-tile-status .dc-chip'),
      counters: [...h.querySelectorAll('.dc-tile-counter .dc-tile-n')].map(n => n.textContent.trim()),
      unavailable: /unavailable|could not/i.test(h.textContent || ''),
    };
  });

  try {
    /* ═══ 1 · THE GLOBALS ARE PRODUCTION'S, NOT THE HARNESS'S ═════════════ */
    head('the shape that caused the bug is loaded, not constructed');
    {
      const { page, errors } = await open();
      const shape = await page.evaluate(() => ({
        winHasRpc: typeof (window.supabase || {}).rpc,
        winHasCreate: typeof (window.supabase || {}).createClient,
        bareIsClient: (function () {
          try { return typeof supabase.rpc === 'function'; } catch (e) { return 'threw'; }
        })(),
        sameObject: (function () {
          try { return supabase === window.supabase; } catch (e) { return 'threw'; }
        })(),
      }));
      is(shape.winHasCreate, 'function', 'window.supabase is the UMD library (has createClient)');
      is(shape.winHasRpc, 'undefined',
        'window.supabase has NO .rpc \u2014 the exact trap, reproduced by loading the real files');
      is(shape.bareIsClient, true, 'the bare name `supabase` IS the client');
      is(shape.sameObject, false, 'and the two are different objects \u2014 nothing was seeded');
      // Scoped on purpose. Other modules run against benign [] answers here and
      // may complain; that is a limit of this harness, not a finding, and \u00a75
      // lists exactly which calls those were. What must be silent is anything
      // touching the client shape.
      const shapeErrors = errors.filter(e => /supabase|is not a function/i.test(e));
      is(shapeErrors.length, 0, shapeErrors.length
        ? 'client-shape errors: ' + shapeErrors.slice(0, 2).join(' | ')
        : 'and the shell booted with no error about the client');
      await page.close();
    }

    /* ═══ 2 · THE GENUINE PATH, END TO END ═══════════════════════════════ */
    head('login.html \u2192 restored session \u2192 nav(\'dailyclosing\') \u2192 the real adapter');
    let firstUnstubbed = [];
    {
      const { page, errors } = await open();
      // The sidebar can only be judged once the shell has booted and the flags
      // have landed — reading it at networkidle2 is reading it too early.
      await page.waitForFunction(
        () => document.getElementById('s-app') &&
              document.getElementById('s-app').classList.contains('on'), { timeout: 20000 });
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 20000 });
      const inNav = await page.evaluate(
        () => !!document.querySelector('.sb [data-pg="dailyclosing"]'));
      is(inNav, true, 'Daily Closing is in the sidebar of the real shell');

      const thrown = await driveToScreen(page);
      is(thrown, null, thrown ? 'nav() threw: ' + thrown
                              : 'nav(\'dailyclosing\') returned without throwing');

      const s = await readScreen(page);
      firstUnstubbed = s.unstubbed;
      is(s.skeletons, 0, 'ZERO skeletons \u2014 the screen reached a terminal state');
      is(/No day open/.test(s.text), true,
        'it ends on "No day open" \u2014 the empty state, from a real {exists:false}');
      is(s.openBtn, true, 'and an Open-day button the owner can actually press');
      is(s.rpcCalls.indexOf('get_cash_day_summary') > -1, true,
        'the adapter really reached the network \u2014 get_cash_day_summary was called');
      is(s.rpcCalls.indexOf('list_qb_accounts_for_project') > -1, true,
        'and the rest of the load sequence ran');
      const dcErrors = errors.filter(e => /supabase|daily-closing|is not a function/i.test(e));
      is(dcErrors.length, 0, dcErrors.length
        ? 'Daily Closing errors: ' + dcErrors.slice(0, 2).join(' | ')
        : 'no Daily Closing error in the console');
      await page.close();
    }

    /* ═══ 3 · THE TILE, WHICH HAS BEEN FAILING IN SILENCE ════════════════ */
    // dashboard.js:145 wraps the tile in try/catch, so the same TypeError only
    // ever wrote "[daily-closing] tile skipped" to the console. A caught error
    // that produces no visible outcome is barely better than an uncaught one.
    head('the S8 tile renders real figures, not placeholders');
    {
      const { page, errors } = await open();
      await page.waitForFunction(
        () => document.getElementById('s-app') &&
              document.getElementById('s-app').classList.contains('on'), { timeout: 20000 });
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 20000 });
      await page.evaluate(() => nav('dashboard'));
      await page.waitForFunction(() => {
        const h = document.getElementById('dc-tile-host');
        return h && h.innerHTML.length > 100;
      }, { timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1800));

      const t = await readTile(page);
      is(t.present, true, 'the tile host is on the dashboard');
      is(t.skeletons, 0, 'and the tile is NOT sitting on placeholders');
      is(t.unavailable, false, 'and it is not showing its error state');
      // Real figures, not empty slots. Awami's are legitimately zero — the point
      // is that the number was fetched and formatted, not that it is non-zero.
      is(t.figures.length, 2, `both hero figures rendered (${JSON.stringify(t.figures)})`);
      is(t.figures.every(v => /^Rs\s/.test(v)), true,
        'closing cash and closing bank carry formatted money, not a placeholder');
      is(t.status, 'Not opened',
        'and the status chip states the real position for a day nobody has opened');
      is(t.counters.length, 5, `all five counters rendered (${t.counters.join('/')})`);
      const skipped = errors.filter(e => /tile skipped|tile failed/i.test(e));
      is(skipped.length, 0, skipped.length
        ? 'dashboard.js swallowed a tile error: ' + skipped[0]
        : 'dashboard.js\'s try/catch caught nothing \u2014 the tile did not throw');
      await page.close();
    }

    /* ═══ 4 · THE RED PROOF ══════════════════════════════════════════════ */
    // The same run against the two files with `supabase.` put back to
    // `global.supabase.`, generated from the real files. If this passes, every
    // assertion above is decoration (SR-2), and this suite would have been the
    // fourth green one that could not see the bug (SR-6).
    head('the same journey against the UNFIXED adapter \u2014 it must fail');
    {
      const { page, errors } = await open({ unfixed: true });
      await page.waitForFunction(
        () => document.getElementById('s-app') &&
              document.getElementById('s-app').classList.contains('on'), { timeout: 20000 });
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 20000 });
      await forceUnfixedLazy(page);

      const thrown = await page.evaluate(
        () => { try { nav('dailyclosing'); return null; } catch (e) { return String(e); } });
      await new Promise(r => setTimeout(r, 2500));
      const s = await readScreen(page);

      const sawTypeError = (thrown && /is not a function/.test(thrown)) ||
        errors.some(e => /supabase\.rpc is not a function/.test(e));
      is(sawTypeError, true,
        'RED: the TypeError is back \u2014 global.supabase.rpc is not a function');
      is(/No day open/.test(s.text), false, 'RED: and the empty state never draws');
      is(s.openBtn, false, 'RED: no Open-day button \u2014 the cash book is unusable');
      is(s.rpcCalls.indexOf('get_cash_day_summary') === -1, true,
        'RED: not one Daily Closing request ever left the browser');

      // \u2026and this is the part that changed. The ORIGINAL bug is faithfully back,
      // but it can no longer produce an indefinite skeleton: guarded() catches
      // the synchronous throw where it happens and the screen ends on something
      // the person can act on. A broken screen that says it is broken is a
      // different thing from a screen that lies about still loading.
      is(s.skeletons, 0,
        'even with the bug back, the screen does NOT sit on skeletons any more');
      is(s.hasError, true,
        'it ends on the error note \u2014 S.error is finally read, not just written');
      is(s.retryBtn, true, 'and a Try-again button, which is the way out');
      await page.close();
    }

    /* \u2550\u2550\u2550 4b \u00b7 NOTHING COMES BACK AT ALL \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
    // The other way to be stuck: a request that neither resolves nor rejects.
    // No harness hook shortens the watchdog \u2014 the real 15 s is waited out, which
    // is why this section is slow. A test timeout that is not the product's
    // timeout proves nothing about the product (SR-7).
    head('a load that never comes back \u2014 the watchdog must end it (~16s)');
    {
      const { page } = await open({ hangDailyClosing: true });
      await page.waitForFunction(
        () => document.getElementById('s-app') &&
              document.getElementById('s-app').classList.contains('on'), { timeout: 20000 });
      await page.waitForFunction(() => window._featureFlagsReady === true, { timeout: 20000 });
      await page.evaluate(() => { try { nav('dailyclosing'); } catch (e) {} });

      await new Promise(r => setTimeout(r, 6000));
      const mid = await readScreen(page);
      is(mid.skeletons > 0, true,
        'at six seconds it is still loading, and still says so \u2014 the watchdog has not fired early');

      await page.waitForFunction(
        () => { const h = document.getElementById('pg-dailyclosing');
                return !!(h && h.querySelector('#dc-retry')); }, { timeout: 20000 })
        .catch(() => {});
      const done = await readScreen(page);
      is(done.skeletons, 0, 'the watchdog fired and the skeletons are gone');
      is(done.retryBtn, true, 'the screen offers Try again rather than loading for ever');
      is(/did not finish loading/i.test(done.text), true,
        `and it says what happened (${JSON.stringify(done.text.slice(0, 60))})`);
      await page.close();
    }

    /* ═══ 5 · WHAT THIS HARNESS COULD NOT SERVE ══════════════════════════ */
    // Named rather than hidden: an RPC answered with [] shaped part of the run.
    head('what was answered with a benign default');
    if (!firstUnstubbed.length) {
      ok('every RPC the boot fired had a captured production payload');
    } else {
      console.log('     ' + [...new Set(firstUnstubbed)].join(', '));
      ok(`${new Set(firstUnstubbed).size} RPC(s) from other modules answered with [] \u2014 ` +
         'listed, not hidden; none of them is a Daily Closing call');
      const dcLeak = [...new Set(firstUnstubbed)].filter(n => /cash|payee|closing|qb_/.test(n));
      is(dcLeak.length, 0, dcLeak.length
        ? 'a Daily Closing RPC was NOT captured: ' + dcLeak.join(', ')
        : 'and no Daily Closing RPC fell through to the default');
    }
  } catch (e) {
    bad('the run stopped early: ' + ((e && e.message) || String(e)).split('\n')[0]);
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n' + '\u2500'.repeat(46));
  console.log(fail === 0 ? `\u2705 PASS  (${pass} assertions, 0 failed)`
                         : `\u274C FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})();
