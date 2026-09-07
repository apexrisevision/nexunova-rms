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
const ZZ_PHONE = '+923459990000';   // doLogin rejects anything not in +92########## form
/* The PIN is NOT in this file. It is a credential, and a credential written into
   a committed script is a habit that eventually gets repeated against a real
   tenant. This one only ever unlocks ZZTEST, which is safe to wipe — but the
   habit is the risk, not this value.

   Set it before running, and the script will set that PIN on the ZZTEST
   director and then sign in with it:
       PowerShell   $env:ZZTEST_PIN = '<6 digits>'; npm run verify:desk
       bash         ZZTEST_PIN=<6 digits> npm run verify:desk                  */
const ZZ_PIN = process.env.ZZTEST_PIN || '';
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
  if (!ZZ_PIN) {
    console.log('\nSKIPPED — ZZTEST_PIN is not set.\n');
    console.log('  This driver signs in through the real login form, so it needs a PIN to');
    console.log('  set on the ZZTEST director (' + ZZ_PHONE + ', company ' + ZZ_CODE + ').');
    console.log('  ZZTEST is the internal scratch tenant and is safe to wipe; no real');
    console.log('  tenant credential is involved.\n');
    console.log('    PowerShell   $env:ZZTEST_PIN = \'<6 digits>\'; npm run verify:desk');
    console.log('    bash         ZZTEST_PIN=<6 digits> npm run verify:desk\n');
    process.exit(0);              // a missing local secret is not a failing build
  }
  if (!/^\d{4,6}$/.test(ZZ_PIN)) {
    console.error('\nZZTEST_PIN must be 4 to 6 digits.\n');
    process.exit(2);
  }

  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('No Chrome/Edge found'); process.exit(2); }

  // ZZTEST is safe to wipe; give the director a PIN we know, the system's own way
  await sql(`update public.sales_users
                set pin_hash = extensions.crypt('${ZZ_PIN}', extensions.gen_salt('bf', 8)),
                    failed_pin_attempts = 0, locked_until = null
              where id = '${ZZ_DIR}';`);
  await sql(`delete from public.sales_sessions where sales_user_id = '${ZZ_DIR}';`);

  /* A name collision, on purpose. Awami has two real "Fawad khan" and that is
     the case that must not resolve by guesswork, but booking on Awami is a live
     write — so the same shape is built here, where it is safe to wipe. */
  await sql(`delete from public.agents where company_id='${ZZ_CO}' and agent_code='ZZAG-TWIN';`);
  await sql(`insert into public.agents (company_id, project_id, agent_code, full_name, cnic, phone, status, join_date)
             values ('${ZZ_CO}','${ZZ_PROJ}','ZZAG-TWIN','ZZTEST Agent','99999-9999999-9','03009998877','active', current_date);`);
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

    /* ══ nav token — the whole point is that NOTHING is left out ═════════ */
    step('Navigation token wrapped every renderer, by name');
    const nav = await page.evaluate(() => {
      if (typeof NAV === 'undefined') return { absent: true };
      return { wrapped: NAV.wrapped, missing: NAV.missing.slice(),
               listed: (typeof NAV_RENDERERS !== 'undefined') ? NAV_RENDERERS.length : -1,
               seq: NAV.seq,
               // every renderer setTab can reach must carry the wrapper's mark
               unmarked: (typeof NAV_RENDERERS === 'undefined') ? ['NAV_RENDERERS missing']
                 : NAV_RENDERERS.filter(n => !(window[n] && window[n].__navWrapped)) };
    });
    assert(!nav.absent, 'the NAV token exists in the shell');
    assert(nav.missing.length === 0,
           nav.missing.length ? 'renderers NOT wrapped: ' + nav.missing.join(', ')
                              : 'no renderer missing from NAV_RENDERERS');
    assert(nav.unmarked.length === 0,
           nav.unmarked.length ? 'renderers without the wrapper mark: ' + nav.unmarked.join(', ')
                               : 'every listed renderer carries __navWrapped');
    assert(nav.wrapped === nav.listed,
           'all ' + nav.listed + ' dispatched renderers wrapped (' + nav.wrapped + ')');
    assert(nav.seq > 0, 'navigations are being counted (seq=' + nav.seq + ')');

    /* Guard against the list silently drifting from the dispatch chain: read
       setTab's own source and diff the render names it can call. */
    const drift = await page.evaluate(() => {
      const src = String(setTab);
      // only names that are actually CALLED. Matching every "render*" word made
      // this cry wolf on the word "renderer" inside a comment in setTab.
      const called = [...new Set((src.match(/\brender[A-Za-z0-9_]+(?=\s*\()/g) || []))];
      const listed = new Set(NAV_RENDERERS);
      return called.filter(n => !listed.has(n));
    });
    assert(drift.length === 0,
           drift.length ? 'setTab dispatches renderers missing from NAV_RENDERERS: ' + drift.join(', ')
                        : 'NAV_RENDERERS matches every renderer setTab dispatches');

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

    step('Identical labels resolve to DIFFERENT ids, and the booking records the one picked');
    const twins = await page.evaluate(async () => {
      const r = await sb.rpc('get_reserve_desk', { p_session_token: TOKEN, p_project_id: null });
      const all = (r.data && r.data.requesters) || [];
      const mine = all.filter(x => x.name === 'ZZTEST Agent');
      return { n: mine.length, ids: mine.map(x => x.id), codes: mine.map(x => x.code),
               phones: mine.map(x => x.phone), companies: mine.map(x => x.company) };
    });
    assert(twins.n === 2, 'two requesters share the name "ZZTEST Agent" (' + twins.n + ')');
    assert(new Set(twins.ids).size === 2,
           'they are DIFFERENT agent ids — a label never collapses two identities');
    const labels = await page.evaluate(() => {
      const r = document.getElementById('rd-root');
      return [...r.querySelectorAll('#rd-reqlist option')].map(o => o.value)
               .filter(v => v.indexOf('ZZTEST Agent') === 0);
    });
    assert(labels.length === 2 && new Set(labels).size === 2,
           'both are separately selectable in the picker: ' + JSON.stringify(labels));

    // pick the TWIN specifically — the one that is NOT the original
    const twinLabel = labels.find(l => /ZZAG-TWIN/.test(l));
    assert(!!twinLabel, 'the twin is addressable by its own label: ' + twinLabel);
    await page.evaluate(l => {
      const r = document.getElementById('rd-root');
      const el = r.querySelector('#rd-req');
      el.value = l; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, twinLabel);
    await sleep(150);
    const resolved = await page.evaluate(() => {
      const r = document.getElementById('rd-root');
      return { echo: r.querySelector('#rd-reqhit').textContent.trim() };
    });
    assert(/ZZAG-TWIN/.test(resolved.echo), 'the desk resolved the twin, not its namesake: ' + resolved.echo);

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
    // compare against what was actually typed — the label now carries the code
    // and phone, so hard-coding the bare name made this assert a stale value
    assert(after.req === twinLabel,
           'requester deliberately kept for the next booking (' + after.req + ')');
    assert(after.rows >= 1, "today's list shows the booking (" + after.rows + ' row/s, count=' + after.count + ')');

    step('The stored reservation names the exact agent row that was picked');
    const stored = await sql(`select r.requested_by_agent_id::text as agent_id,
                                     a.agent_code, a.full_name, a.company_id::text as agent_company,
                                     u.unit_no, p.company_id::text as project_company,
                                     (a.company_id = p.company_id) as same_company
                                from public.reservations r
                                join public.units u    on u.id = r.unit_id
                                join public.projects p on p.id = r.project_id
                                left join public.agents a on a.id = r.requested_by_agent_id
                               where r.company_id='${ZZ_CO}' and r.status='active'
                               order by r.created_at desc limit 1;`);
    const row = stored[0] || {};
    const twinId = await sql(`select id::text from public.agents
                               where company_id='${ZZ_CO}' and agent_code='ZZAG-TWIN';`);
    assert(!!row.agent_id, 'the reservation carries a requested_by_agent_id');
    assert(row.agent_id === (twinId[0] || {}).id,
           'it is the EXACT agent row that was picked (' + row.agent_code + ')');
    assert(row.same_company === true,
           "that agent's company matches the unit's project company (" +
           row.agent_company + ' vs ' + row.project_company + ')');

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
    /* Colliding names must be separable at the moment of typing, unique ones
       must stay clean. Awami has two live "Fawad khan" — different people,
       different CNICs — so this is asserted against real data, not a fixture. */
    const dis = await page.evaluate(() => {
      const r = document.getElementById('rd-root'); if (!r) return null;
      const opts = [...r.querySelectorAll('#rd-reqlist option')].map(o => o.value);
      const byName = {};
      opts.forEach(v => { const n = v.split(' · ')[0].trim().toLowerCase();
                          (byName[n] = byName[n] || []).push(v); });
      const collided = Object.keys(byName).filter(n => byName[n].length > 1);
      const unique = Object.keys(byName).filter(n => byName[n].length === 1);
      const hasPhone = v => /\b0\d{3}-\d{6,8}\b/.test(v);
      return {
        total: opts.length,
        collidedNames: collided.length,
        collidedLabels: collided.reduce((a, n) => a.concat(byName[n]), []),
        collidedAllPhoned: collided.every(n => byName[n].every(hasPhone)),
        uniqueWithPhone: unique.filter(n => hasPhone(byName[n][0])).length
      };
    });
    assert(dis && dis.total > 0, 'requester datalist rendered (' + (dis && dis.total) + ' options)');
    assert(dis.collidedNames > 0, dis.collidedNames + ' name(s) collide in Awami — real data to test against');
    assert(dis.collidedAllPhoned, 'every colliding entry carries a phone: ' + JSON.stringify(dis.collidedLabels));
    assert(dis.uniqueWithPhone === 0, 'no unique name was given a phone (' + dis.uniqueWithPhone + ')');

    /* The desk's OWN cache, not a hand-scoped RPC call. It opened with no
       project argument, which used to fall through to the whole umbrella group:
       2,244 units, 250 unit numbers appearing twice, and LG-12 matching two
       different flats in two different towers. */
    const cache = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#rd-root #rd-reqlist option')].map(o => o.value);
      return { reqOptions: opts.length, dupLabels: opts.length - new Set(opts).size };
    });
    const idxState = await page.evaluate(async () => {
      const r = await sb.rpc('get_reserve_desk', { p_session_token: TOKEN });   // no project arg
      const u = (r.data && r.data.units) || [];
      const seen = {}; let dup = 0, lg = 0;
      u.forEach(x => { const k = String(x.n).toUpperCase();
        if (seen[k]) dup++; seen[k] = 1; if (k === 'LG-12') lg++; });
      return { units: u.length, dup, lg, reqs: (r.data.requesters || []).length,
               floors: new Set(u.map(x => x.f)).size };
    });
    assert(idxState.units === 1467,
           'opening with NO project argument loads one tower, not the group (' + idxState.units + ')');
    assert(idxState.dup === 0, 'no duplicate unit numbers in the index (' + idxState.dup + ')');
    assert(idxState.lg === 1, 'LG-12 matches exactly one unit (' + idxState.lg + ')');
    assert(idxState.floors === 7, 'seven Awami floors, not three towers (' + idxState.floors + ')');
    assert(idxState.reqs < 40,
           'requester picker scoped to the project: ' + idxState.reqs + ' (was 125 across the group)');
    assert(cache.dupLabels === 0,
           'no two picker options share a label (' + cache.dupLabels + ' duplicates)');

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

    /* ══ BOARD CARDS — price hidden, layout intact at 430px ══════════════ */
    step('Board unit cards at 430px — no price, nothing else shifted');
    await page.evaluate(() => setTab('board'));
    await until(page, () => !!document.getElementById('bv-body'), null, 30000);
    await clearChrome(page);
    // the board opens grouped by floor; the unit CARDS live in 'Every unit'
    await page.evaluate(() => { if (typeof _bvMode === 'function') _bvMode('detailed'); });
    await until(page, () => document.querySelectorAll('.units .unit').length > 0, null, 30000);
    const cards = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.units .unit')];
      const rows = {};
      els.forEach(e => {
        const r = Math.round(e.getBoundingClientRect().top);
        (rows[r] = rows[r] || []).push(Math.round(e.getBoundingClientRect().height));
      });
      const heights = Object.values(rows);
      return {
        n: els.length,
        priceSpans: document.querySelectorAll('.units .unit .upr').length,
        areaSpans: document.querySelectorAll('.units .unit .uar').length,
        // the card must carry NO money at all: no total, and no per-sqft rate
        moneyOnCards: [...document.querySelectorAll('.units .unit')]
          .filter(e => /[₨]|\bRs\b|\bPKR\b|@|\d{1,3}(,\d{3})+/.test(e.textContent)).length,
        sampleCard: (document.querySelector('.units .unit') || {}).textContent || '',
        unoSpans: document.querySelectorAll('.units .unit .uno').length,
        ustSpans: document.querySelectorAll('.units .unit .ust').length,
        // every card in a given row must be the same height (grid-auto-rows:1fr)
        raggedRows: heights.filter(h => new Set(h).size > 1).length,
        minH: Math.min(...els.map(e => e.getBoundingClientRect().height)),
        // nothing may push the page sideways on a 430px phone
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        anyOverflow: els.some(e => e.getBoundingClientRect().right > window.innerWidth + 1)
      };
    });
    assert(cards.n > 0, cards.n + ' unit cards rendered');
    assert(cards.priceSpans === 0, 'no .upr price element on any card (found ' + cards.priceSpans + ')');
    assert(cards.unoSpans === cards.n && cards.ustSpans === cards.n,
           'unit number and status still on every card');
    assert(cards.areaSpans > 0, 'the area line survives (' + cards.areaSpans + ' cards carry it)');
    assert(cards.moneyOnCards === 0,
           'no money on any card — no total, no @rate (' + cards.moneyOnCards + ' offenders)');
    console.log('     a card now reads: ' + JSON.stringify(cards.sampleCard.replace(/\s+/g, ' ').trim()));
    assert(cards.raggedRows === 0, 'no ragged row — every card in a row is the same height');
    assert(cards.minH >= 56, 'cards keep their min-height (' + Math.round(cards.minH) + 'px)');
    assert(cards.docW <= cards.winW + 1,
           'no horizontal overflow at ' + cards.winW + 'px (document is ' + cards.docW + 'px)');
    assert(!cards.anyOverflow, 'no card extends past the right edge');
    try {
      await page.screenshot({ path: path.join(ROOT, 'marketing_shots', 'board-cards-430.png') });
      console.log('     screenshot: marketing_shots/board-cards-430.png');
    } catch (e) {}

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
    await sql(`delete from public.agents where company_id='${ZZ_CO}' and agent_code='ZZAG-TWIN';`);
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
