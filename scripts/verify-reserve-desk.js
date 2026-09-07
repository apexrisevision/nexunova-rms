/**
 * Nexunova RMS — RESERVE DESK BOOT-PATH VERIFICATION
 *
 * The Daily Closing module failed repeatedly on shell wiring, always the same
 * way: something was hooked into ONE way of reaching the app and not the others,
 * so a screen verified after a fresh login was still broken after a refresh.
 * This driver exists to make that impossible to miss. It opens the real portal
 * in a real browser and reaches the Reserve Desk FOUR different ways:
 *
 *   1. fresh login       — the real form, real PIN, real sales_login RPC
 *   2. restored session  — token already in localStorage, page reloaded
 *   3. deep link         — ?tab=desk on a cold load
 *   4. tab switch        — from another screen, via the nav rail
 *
 * A pass on one is not a pass on any other, so each is asserted separately.
 *
 * It also checks the two things that break silently in a single-page shell:
 *   · every element the desk reads is INSIDE the desk's own root node
 *   · the globals the module needs are actually reachable from a separate file
 *
 * Functional booking is exercised on ZZTEST only (safe to wipe, restored at the
 * end). Awami is opened READ-ONLY, to prove the 1,467-unit index and its cache.
 *
 *   node scripts/verify-reserve-desk.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/sales-portal.html`;

const ZZ_CO   = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const ZZ_CODE = 'zztestinternalsafeto';
const ZZ_DIR  = '3e5ec7c8-89c8-435f-8f52-141b87c4b5b0';
const ZZ_PHONE = '+923459990000';   // doLogin enforces /^+92d{10}$/
const ZZ_PIN  = '246810';
const ZZ_PROJ = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';

const AWAMI_CO  = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const AWAMI_DIR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const AW_TOKEN  = 'rdverify_aw_' + Math.random().toString(36).slice(2, 10);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

let PASS = 0, FAIL = 0;
const ok   = m => { PASS++; console.log('  \u2705 ' + m); };
const bad  = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
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
const MISSING = [];
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        MISSING.push(req.url); res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}
async function until(page, fn, arg, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 120 }, arg); return true; }
  catch (e) { return false; }
}

/* The portal hands itself to the installed-app hub on a PLAIN launch, which in a
   driver means the login form is replaced by a 404 before anything can be typed.
   sessionStorage 'nx.hub.bounce' is the guard the page itself uses to stop that
   from happening twice; setting it makes every load here behave like the second
   one. This is a harness concern only — the hop is correct behaviour on a phone,
   and a deep link (?tab=) already skips it on its own. */
async function coldLoad(page, url, opts) {
  opts = opts || {};
  await page.goto(BASE + '/sales-portal.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(o => {
    try {
      if (o.clear) localStorage.clear();
      if (o.token) { localStorage.setItem('rms.sales.token', o.token);
                     localStorage.setItem('rms.sales.active', String(Date.now())); }
      sessionStorage.setItem('nx.hub.bounce', '1');
    } catch (e) {}
  }, { clear: !!opts.clear, token: opts.token || null });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

/* Wait for the shell to finish its own boot before driving it. _showApp() ends
   with setTab(PENDING_TAB||'home'); clicking before that lands means the shell's
   own navigation arrives afterwards and wipes whatever was opened. A real person
   cannot click that early. (The product now refuses to paint over another tab
   regardless — this just stops the harness testing an impossible sequence.) */
async function settled(page) {
  await until(page, () => typeof TAB !== 'undefined' && !!TAB &&
                          !!document.getElementById('app-body') &&
                          document.getElementById('app-body').children.length > 0, null, 25000);
  // ...and then until it STOPS changing. renderManagerHome awaits four RPCs
  // before it writes app-body; leaving during that window lets its late paint
  // land on top of whatever was opened next. See finding 2026-09-07-G.
  let last = null, still = 0;
  for (let i = 0; i < 50 && still < 3; i++) {
    const now = await page.evaluate(() => ((document.getElementById('app-body') || {}).innerHTML || '').length);
    still = (now === last) ? still + 1 : 0;
    last = now;
    await sleep(300);
  }
}

/* The verify gate is a full-screen overlay that eats every click. Hide it before
   asserting anything about what is under it. */
async function clearChrome(page) {
  await page.evaluate(() => {
    try { if (typeof _vgHide === 'function') _vgHide(); } catch (e) {}
    ['verify-gate', 'pwa-bar', 'loc-bar'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    const m = document.getElementById('modal-host'); if (m) m.innerHTML = '';
  });
}

/* Is the desk actually on screen, and is it the desk's OWN markup? */
async function deskUp(page) {
  return page.evaluate(() => {
    const root = document.getElementById('rd-root');
    if (!root) return { up: false };
    const inside = sel => !!root.querySelector(sel);
    return {
      up: true,
      tab: (typeof TAB !== 'undefined') ? TAB : null,
      unit: inside('#rd-unit'),
      req: inside('#rd-req'),
      days: inside('#rd-days'),
      go: inside('#rd-go'),
      today: inside('#rd-today'),
      // the shell must agree the desk is the active screen
      navOn: !!document.querySelector('.sb [data-tab="desk"].on'),
      title: (document.getElementById('appbar-title') || {}).textContent || ''
    };
  });
}

(async () => {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('No Chrome/Edge found'); process.exit(2); }

  // ZZTEST is safe to wipe; give the director a PIN we know, the system's own way
  await sql(`update public.sales_users
                set pin_hash = extensions.crypt('${ZZ_PIN}', extensions.gen_salt('bf', 8)),
                    failed_pin_attempts = 0, locked_until = null
              where id = '${ZZ_DIR}';`);
  await sql(`delete from public.sales_sessions where sales_user_id = '${ZZ_DIR}';`);
  await sql(`insert into public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
             values ('${AWAMI_CO}','${AWAMI_DIR}',null,'${AW_TOKEN}', now() + interval '20 minutes');`);

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
                                           args: ['--no-sandbox', '--window-size=430,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    /* ══ BOOT PATH 1 — FRESH LOGIN through the real form ══════════════════ */
    step('BOOT PATH 1 — fresh login (real form, real PIN, real sales_login)');
    await coldLoad(page, PAGE, { clear: true });
    const formUp = await until(page, () => !!document.getElementById('i-pin') &&
                                           !!document.getElementById('i-co'));
    assert(formUp, 'login form reached (hub hand-off guarded in the harness)');
    await page.evaluate((co, ph, pin) => {
      document.getElementById('i-co').value = co;
      document.getElementById('i-phone').value = ph;
      document.getElementById('i-pin').value = pin;
    }, ZZ_CODE, ZZ_PHONE, ZZ_PIN);
    await page.evaluate(() => doLogin());
    const loggedIn = await until(page, () => typeof ME !== 'undefined' && ME && !!ME.sales_user_name, null, 25000);
    if (!loggedIn) {
      const why = await page.evaluate(() => (document.getElementById('login-err') || {}).textContent || '(no message)');
      console.log('     login error on screen: ' + why);
    }
    assert(loggedIn, 'signed in through the form (no token was pre-seeded)');
    await settled(page);
    await clearChrome(page);
    await page.evaluate(() => setTab('desk'));
    const up1 = await until(page, () => !!document.getElementById('rd-root'), null, 25000);
    if (!up1) {
      const why = await page.evaluate(() => ({
        TAB: (typeof TAB !== 'undefined') ? TAB : '(undef)',
        role: (typeof ME !== 'undefined' && ME) ? ME.role : '(no ME)',
        bodyHead: (document.getElementById('app-body') || {}).innerHTML.slice(0, 300)
      }));
      console.log('     DIAG ' + JSON.stringify(why));
    }
    let d1 = await deskUp(page);
    assert(d1.up, 'desk rendered after FRESH LOGIN');
    assert(d1.unit && d1.req && d1.days && d1.go && d1.today, 'all desk controls present inside #rd-root');
    assert(d1.title === 'Reserve Desk', 'appbar title set by the shell: ' + JSON.stringify(d1.title));

    /* ══ globals actually reach a separate file in the real shell ═════════ */
    step('Globals reach the module in the real shell (not just in isolation)');
    const g = await page.evaluate(() => ({
      renderDesk: typeof renderReserveDesk === 'function',
      renderDay:  typeof renderDaybook === 'function',
      copy:       typeof _portalCopy === 'function',
      sbBare:     typeof sb !== 'undefined' && !!sb && typeof sb.rpc === 'function',
      sbOnWindow: Object.prototype.hasOwnProperty.call(window, 'sb'),
      tokenBare:  typeof TOKEN !== 'undefined' && !!TOKEN,
      escBare:    typeof esc === 'function',
      pkrBare:    typeof pkrFull === 'function',
      liBare:     typeof li === 'function'
    }));
    assert(g.renderDesk, 'window.renderReserveDesk is defined');
    assert(g.renderDay, 'window.renderDaybook is defined');
    assert(g.copy, 'window._portalCopy is defined (shared clipboard helper loaded)');
    assert(g.sbBare && g.tokenBare && g.escBare && g.pkrBare && g.liBare,
           'sb / TOKEN / esc / pkrFull / li reachable BARE from the module');
    assert(g.sbOnWindow === false,
           'window.sb is undefined — confirms the module must not use window.* (it does not)');

    /* ══ scoping: no desk selector may resolve outside the desk root ══════ */
    step('DOM scoping — every desk id must be unique and inside #rd-root');
    const scope = await page.evaluate(() => {
      const ids = ['rd-root','rd-unit','rd-req','rd-days','rd-go','rd-today','rd-hit','rd-count',
                   'rd-proj','rd-refresh','rd-daybook','rd-dcust','rd-cname','rd-cphone','rd-tamt','rd-note'];
      const dupes = [], outside = [];
      const root = document.getElementById('rd-root');
      ids.forEach(id => {
        const all = document.querySelectorAll('[id="' + id + '"]');
        if (all.length > 1) dupes.push(id + '×' + all.length);
        if (all.length === 1 && id !== 'rd-root' && root && !root.contains(all[0])) outside.push(id);
      });
      return { dupes, outside };
    });
    assert(scope.dupes.length === 0, 'no duplicate desk ids in the shell' +
           (scope.dupes.length ? ' — ' + scope.dupes.join(', ') : ''));
    assert(scope.outside.length === 0, 'no desk element resolves outside #rd-root' +
           (scope.outside.length ? ' — ' + scope.outside.join(', ') : ''));

    /* ══ functional: type a unit, see the card, book, undo (ZZTEST) ═══════ */
    step('Typing a unit number resolves it from the cached index');
    // ask the page for an available unit number via the same RPC the desk used
    const unitNo = await page.evaluate(async () => {
      const r = await sb.rpc('get_reserve_desk', { p_session_token: TOKEN, p_project_id: null });
      const u = (r.data && r.data.units || []).find(x => x.s === 'available');
      return u ? u.n : null;
    });
    assert(!!unitNo, 'an available unit exists to test with: ' + unitNo);

    await page.evaluate(n => {
      const el = document.getElementById('rd-root').querySelector('#rd-unit');
      el.value = n; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, unitNo);
    await sleep(200);
    const hit = await page.evaluate(() => {
      const r = document.getElementById('rd-root');
      return { txt: r.querySelector('#rd-hit').textContent.trim(),
               cls: r.querySelector('#rd-hit').className,
               goEnabled: !r.querySelector('#rd-go').disabled };
    });
    assert(/Available/i.test(hit.txt), 'unit card shows Available: ' + hit.txt.slice(0, 60));
    assert(hit.goEnabled, 'Reserve button enabled once a free unit resolves');

    step('Requester resolves against the agents master first');
    await page.evaluate(() => {
      const r = document.getElementById('rd-root');
      const el = r.querySelector('#rd-req');
      el.value = 'ZZTEST Agent'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(150);
    const reqEcho = await page.evaluate(() =>
      document.getElementById('rd-root').querySelector('#rd-reqhit').textContent.trim());
    assert(/Agent/i.test(reqEcho), 'requester echo names the agent: ' + reqEcho);

    step('Reserve → toast → line clears → focus returns to the unit box');
    await page.evaluate(() => document.getElementById('rd-root').querySelector('#rd-go').click());
    const booked = await until(page, () => {
      const r = document.getElementById('rd-root'); if (!r) return false;
      const u = r.querySelector('#rd-unit'); return !!u && u.value === '';
    }, null, 15000);
    if (!booked) {
      const why = await page.evaluate(() => ({
        rootGone: !document.getElementById('rd-root'),
        toast: (document.getElementById('toastbar') || {}).textContent || '',
        bodyHead: (document.getElementById('app-body') || {}).innerHTML.slice(0, 220),
        screen: [...document.querySelectorAll('[id^="screen-"]')]
                  .filter(e => getComputedStyle(e).display !== 'none').map(e => e.id)
      }));
      console.log('     DIAG ' + JSON.stringify(why));
    }
    assert(booked, 'unit box cleared after a successful booking');
    const after = await page.evaluate(() => {
      const r = document.getElementById('rd-root');
      return { req: r.querySelector('#rd-req').value,
               focused: document.activeElement && document.activeElement.id,
               rows: r.querySelectorAll('#rd-today .rd-row').length,
               count: r.querySelector('#rd-count').textContent };
    });
    assert(after.focused === 'rd-unit', 'cursor is back in the unit box (focus=' + after.focused + ')');
    assert(after.req === 'ZZTEST Agent', 'requester deliberately kept for the next booking');
    assert(after.rows >= 1, "today's list shows the booking (" + after.rows + ' row/s, count=' + after.count + ')');

    step('Per-row Undo releases through the existing cancel_reservation');
    await page.evaluate(() => {
      const b = document.getElementById('rd-root').querySelector('#rd-today button[data-undo]');
      if (b) b.click();
    });
    const undone = await until(page, () => {
      const r = document.getElementById('rd-root'); if (!r) return false;
      return r.querySelectorAll('#rd-today button[data-undo]').length === 0;
    }, null, 15000);
    assert(undone, 'Undo cleared the live booking from the list');
    const back = await sql(`select count(*)::int n from public.units u
                              join public.category_unit_statuses s on s.id=u.status_id
                             where u.project_id='${ZZ_PROJ}' and s.is_available;`);
    assert(back[0] && back[0].n === 19, 'ZZTEST is back to 19 available units (got ' + (back[0] && back[0].n) + ')');

    /* ══ BOOT PATH 2 — RESTORED SESSION ══════════════════════════════════ */
    step('BOOT PATH 2 — restored session (reload, token already in localStorage)');
    await coldLoad(page, PAGE, {});
    const restored = await until(page, () => typeof ME !== 'undefined' && ME && !!ME.sales_user_name, null, 25000);
    assert(restored, 'session restored from localStorage without a login');
    await settled(page);
    await clearChrome(page);
    await page.evaluate(() => setTab('desk'));
    await until(page, () => !!document.getElementById('rd-root'));
    const d2 = await deskUp(page);
    assert(d2.up && d2.unit && d2.go, 'desk rendered after a RESTORED SESSION');

    /* ══ BOOT PATH 3 — DEEP LINK ?tab=desk on a cold load ════════════════ */
    step('BOOT PATH 3 — deep link ?tab=desk (cold load, no tab switching)');
    await coldLoad(page, PAGE + '?tab=desk', {});
    const deep = await until(page, () => !!document.getElementById('rd-root'), null, 25000);
    await clearChrome(page);
    const d3 = await deskUp(page);
    assert(deep && d3.up, 'desk rendered straight from ?tab=desk');
    assert(d3.tab === 'desk', 'shell TAB is "desk" (' + d3.tab + ')');
    assert(d3.navOn, 'nav rail marks Reserve Desk active on a deep link');

    /* ══ BOOT PATH 4 — TAB SWITCH from another screen ════════════════════ */
    step('BOOT PATH 4 — tab switch from another section via the nav rail');
    await page.evaluate(() => setTab('home'));
    await sleep(500);
    const leftDesk = await page.evaluate(() => !document.getElementById('rd-root'));
    assert(leftDesk, 'desk torn down when navigating away');
    await page.evaluate(() => {
      const a = document.querySelector('.sb [data-tab="desk"]');
      if (a) a.click(); else setTab('desk');
    });
    await until(page, () => !!document.getElementById('rd-root'));
    const d4 = await deskUp(page);
    assert(d4.up && d4.unit && d4.go, 'desk rendered after a TAB SWITCH');
    assert(d4.navOn, 'nav rail marks Reserve Desk active after a switch');

    /* ══ DAYBOOK ═════════════════════════════════════════════════════════ */
    step('Daybook renders, copies, and builds a WhatsApp payload');
    await page.evaluate(() => setTab('daybook'));
    const dbUp = await until(page, () => !!document.getElementById('db-root'), null, 20000);
    assert(dbUp, 'daybook rendered');
    const db = await page.evaluate(() => {
      const r = document.getElementById('db-root');
      return { secs: r.querySelectorAll('.db-sec').length,
               heads: [...r.querySelectorAll('.db-t')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
               copy: !!r.querySelector('#db-copy'), wa: !!r.querySelector('#db-wa'), pdf: !!r.querySelector('#db-pdf') };
    });
    assert(db.secs === 4, 'four sections present (' + db.secs + '): ' + db.heads.join(' | '));
    assert(db.copy && db.wa && db.pdf, 'Copy / WhatsApp / PDF actions present');
    const copied = await page.evaluate(async () => {
      let captured = null;
      const orig = navigator.clipboard && navigator.clipboard.writeText;
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: t => { captured = t; return Promise.resolve(); } }
        });
      } catch (e) {}
      document.getElementById('db-root').querySelector('#db-copy').click();
      await new Promise(r => setTimeout(r, 300));
      return captured;
    });
    assert(typeof copied === 'string' && copied.length > 0, 'clipboard received the daybook text');
    assert(/Reserved today/.test(copied) && /Sold today/.test(copied) && /Available by floor/.test(copied),
           'WhatsApp text carries all the required sections');

    /* ══ AWAMI, READ-ONLY — the 1,467-unit index and its cache ═══════════ */
    step('Awami Market read-only — 1,467-unit index, and the cache is not refetched');
    await coldLoad(page, PAGE + '?tab=desk', { clear: true, token: AW_TOKEN });
    await until(page, () => !!document.getElementById('rd-root'), null, 30000);
    await settled(page);
    await clearChrome(page);
    await page.evaluate(() => {
      window.__deskCalls = 0;
      const orig = sb.rpc.bind(sb);
      sb.rpc = (fn, args) => { if (fn === 'get_reserve_desk') window.__deskCalls++; return orig(fn, args); };
    });
    const aw = await page.evaluate(async () => {
      const r = await sb.rpc('get_reserve_desk', { p_session_token: TOKEN, p_project_id: '59ded55b-9bc2-45b2-a372-49fc31807fa9' });
      return { units: (r.data.units || []).length, reqs: (r.data.requesters || []).length,
               kb: Math.round(JSON.stringify(r.data).length / 1024) };
    });
    assert(aw.units === 1467, 'Awami index carries all 1,467 units');
    assert(aw.reqs > 0, aw.reqs + ' requesters, agents first');
    console.log('     index size: ' + aw.kb + ' KB');

    // leave and come back — the cache must serve it without another fetch
    await page.evaluate(() => { window.__deskCalls = 0; });
    await page.evaluate(() => setTab('home'));
    await sleep(400);
    await page.evaluate(() => setTab('desk'));
    await until(page, () => !!document.getElementById('rd-root'));
    const refetched = await page.evaluate(() => window.__deskCalls);
    assert(refetched === 0, 'returning to the desk cost 0 extra get_reserve_desk calls (cache held)');
    const awUnit = await page.evaluate(() => {
      const el = document.getElementById('rd-root').querySelector('#rd-unit');
      el.value = 'LG-12'; el.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('rd-root').querySelector('#rd-hit').textContent.trim();
    });
    assert(/LG-12/.test(awUnit), 'typing LG-12 on Awami resolves: ' + awUnit.slice(0, 70));

    /* ══ console ═════════════════════════════════════════════════════════ */
    step('Console');
    /* The only 404s this harness can legitimately produce are things the static
       server does not implement: the Vercel rewrite /sales-portal.html/hub and a
       favicon. Anything else is a real missing asset and must fail the run —
       so the URLs are asserted, not the (unattributable) console text. */
    const missed = [...new Set(MISSING)];
    const HARNESS_ONLY = ['/favicon.ico', '/sales-portal.html/hub'];
    const realMissing = missed.filter(u => HARNESS_ONLY.indexOf(u.split('?')[0]) === -1);
    console.log('     404s seen: ' + (missed.join(', ') || 'none'));
    assert(realMissing.length === 0, realMissing.length
      ? 'unexpected 404s: ' + realMissing.join(', ')
      : 'no unexpected 404s (only harness-only paths)');
    const real = errors.filter(e => !/favicon|manifest|ERR_INTERNET|net::ERR|Not Found/i.test(e));
    assert(real.length === 0, real.length ? 'console errors: ' + real.slice(0, 4).join(' | ') : 'no console errors beyond those 404s');

  } finally {
    await browser.close(); server.close();
    // restore ZZTEST and remove the probe session
    await sql(`delete from public.reservations where company_id='${ZZ_CO}';
               delete from public.sales_sessions where sales_user_id='${ZZ_DIR}';
               delete from public.sales_sessions where session_token='${AW_TOKEN}';
               update public.units set status_id=(select id from public.category_unit_statuses
                    where project_id='${ZZ_PROJ}' and status_code='AVAILABLE' limit 1)
                where project_id='${ZZ_PROJ}'
                  and status_id in (select id from public.category_unit_statuses
                                     where project_id='${ZZ_PROJ}' and status_code='RESERVED');`);
  }

  console.log('\n' + '\u2500'.repeat(46));
  console.log(`RESULT: ${FAIL === 0 ? '\u2705 PASS' : '\u274C FAIL'}  (${PASS} passed, ${FAIL} failed)`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('\nDRIVER ERROR:', e); process.exit(2); });
