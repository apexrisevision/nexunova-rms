/**
 * Nexunova RMS — SALES PORTAL CLICK-THROUGH SMOKE TEST
 *
 * Why this exists: predeploy-check.js only reads the source. It cannot tell you
 * that a fixed action bar landed off-screen, that a button calls a screen which
 * needs state the caller never set, or that a bulk action sent 1 id instead of 6.
 * Every one of those shipped and had to be reported from the field. This driver
 * opens the real portal in a real browser, clicks the real buttons, and asserts
 * what the user would see.
 *
 *   node scripts/smoke-portal.js            # against the working tree
 *   npm run smoke:portal
 *
 * It signs in by minting a short-lived sales_session straight in the DB and
 * dropping the token into localStorage — no password needed, and the session is
 * deleted again at the end. Assign/delete RPCs are intercepted in the page, so a
 * smoke run never moves a real lead; the arguments are captured and asserted.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/sales-portal.html`;

// the director whose screens we are testing (Awami tenant)
const COMPANY = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const DIRECTOR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const TOKEN = 'smoke_' + Math.random().toString(36).slice(2, 12);
const FIXTURE = 'ZZSMOKE-' + Date.now();          // lead names we create and delete
const FIXTURE_N = 4;

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

let PASS = 0, FAIL = 0;
const ok   = (m) => { PASS++; console.log('  \u2705 ' + m); };
const bad  = (m) => { FAIL++; console.log('  \u274C ' + m); };
const step = (m) => console.log('\n\u2500\u2500 ' + m);
function assert(cond, m) { cond ? ok(m) : bad(m); return !!cond; }

// ── DB access (same management endpoint the migration runner uses) ───────────
function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => r.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    req.on('error', rej); req.write(body); req.end();
  });
}

// ── tiny static server for the working tree ─────────────────────────────────
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// wait for a page condition instead of guessing with sleeps
async function until(page, fn, arg, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 120 }, arg); return true; }
  catch (e) { return false; }
}

// long-press: pointerdown, hold past the 420ms threshold, pointerup
// Long-press on a touch viewport. NOTE: with touch emulation on, Chrome's
// mouse input does NOT raise pointerdown, so page.mouse silently does nothing —
// use the touchscreen, and fall back to a synthetic PointerEvent.
async function longPress(page, sel, nth) {
  const box = await page.evaluate((s, n) => {
    const el = document.querySelectorAll(s)[n || 0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return (r.width && r.height) ? { x: r.x + r.width / 2, y: r.y + 14 } : null;
  }, sel, nth || 0);
  if (!box) return false;

  try {
    if (page.touchscreen && page.touchscreen.touchStart) {
      await page.touchscreen.touchStart(box.x, box.y);
      await sleep(700);
      await page.touchscreen.touchEnd();
      await sleep(350);
      return true;
    }
  } catch (e) { /* fall through to the synthetic path */ }

  await page.evaluate(async (s, n, x, y) => {
    const el = document.querySelectorAll(s)[n || 0]; if (!el) return;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    await new Promise(r => setTimeout(r, 650));
    el.dispatchEvent(new PointerEvent('pointerup', o));
  }, sel, nth || 0, box.x, box.y);
  await sleep(350);
  return true;
}

// A real user closes the first-run prompts. Until they are gone a full-screen
// .overlay covers the page, so every touch lands on the overlay instead of the row
// — which is exactly why this whole flow looked broken from the driver's side.
async function dismissOverlays(page) {
  const LABELS = ['not now', 'skip for now', 'got it', 'dismiss', 'close', 'later'];
  for (let round = 0; round < 5; round++) {
    const done = await page.evaluate(labels => {
      let acted = false;
      const btns = [...document.querySelectorAll('#modal-host button, #modal-host .btn, .overlay button, .overlay .btn')];
      for (const b of btns) {
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (labels.includes(t)) { b.click(); acted = true; break; }
      }
      if (!acted) { const x = document.querySelector('#modal-host .icon-btn, .overlay .icon-btn'); if (x) { x.click(); acted = true; } }
      ['pwa-bar', 'loc-bar'].forEach(id => {
        const bar = document.getElementById(id);
        if (bar && bar.offsetParent) { const c = bar.querySelector('.icon-btn, button:last-of-type'); if (c) { c.click(); acted = true; } }
      });
      return !acted && !document.querySelector('.overlay');
    }, LABELS);
    if (done) return true;
    await sleep(400);
  }
  return !(await page.evaluate(() => !!document.querySelector('.overlay')));
}

// Click by label, in-page. Coordinate clicks on a fixed bottom bar were landing
// nowhere; the bar's visibility is asserted separately by hit-test + viewport
// geometry, so the click itself does not need to be a synthetic mouse event.
async function clickText(page, selector, text) {
  const hit = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)]
      .find(e => (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  }, selector, text);
  if (hit) await sleep(350);
  return hit;
}

// Environment problems must NOT masquerade as product failures. A dropped network
// once produced 20 red lines that had nothing to do with the app — and left test
// leads behind because cleanup never ran. So: check first, create second.
async function preflight() {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.log('\n\u26A0\uFE0F  ENVIRONMENT: no Chrome/Edge found — cannot click through anything.'); return null; }
  try {
    const r = await sql('select 1 as ok;');
    if (!r || !r.length) throw new Error('empty reply');
  } catch (e) {
    console.log('\n\u26A0\uFE0F  ENVIRONMENT: database unreachable (' + String(e.message).split('\n')[0] + ')');
    console.log('   The portal cannot load data, so this gate cannot judge the app. Nothing was created.');
    return null;
  }
  return exe;
}

(async () => {
  const exe = await preflight();
  if (!exe) process.exit(2);            // 2 = could not run (distinct from 1 = app failed)

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 SALES PORTAL SMOKE (real browser) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  await sql(`insert into public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
             values ('${COMPANY}','${DIRECTOR}',null,'${TOKEN}', now() + interval '15 minutes');`);

  // Fixtures: leads the director still holds, so the selection rules allow picking
  // them. Named ZZSMOKE-… and deleted in the finally block.
  await sql(`insert into public.leads (company_id, project_id, owner_sales_user_id, name, phone, source, status, is_test)
             select '${COMPANY}', '7f70ba90-130e-42b5-801b-4c9bafa82975', '${DIRECTOR}',
                    '${FIXTURE} ' || g, '03000000' || lpad(g::text,3,'0'), 'walk-in', 'new', true
               from generate_series(1,${FIXTURE_N}) g;`);

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--window-size=430,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    // seed the session token, then let the app boot with it
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t); localStorage.setItem('rms.sales.active', String(Date.now())); }, TOKEN);
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    const booted = await until(page, () => typeof ME !== 'undefined' && ME && !!ME.sales_user_name);

    // capture RPC calls and neutralise the writes so a smoke run changes nothing
    await page.evaluate(() => {
      window.__rpc = [];
      const orig = sb.rpc.bind(sb);
      const NEUTRAL = { assign_leads_bulk: d => ({ success: true, assigned: (d.p_lead_ids || []).length, to_name: 'SMOKE' }),
                        assign_lead:       ()=> ({ success: true, to_name: 'SMOKE' }),
                        delete_leads_bulk: d => ({ success: true, deleted: (d.p_lead_ids || []).length }),
                        bulk_lead_action:  d => ({ success: true, done: (d.p_lead_ids || []).length }),
                        move_leads_project_bulk: d => ({ success: true, moved: (d.p_lead_ids || []).length, project_name: 'SMOKE' }) };
      sb.rpc = (fn, args) => { window.__rpc.push({ fn, args });
        return NEUTRAL[fn] ? Promise.resolve({ data: NEUTRAL[fn](args || {}), error: null }) : orig(fn, args); };
    });

    step('App boots as the director');
    assert(booted, 'session restored from the token and the app rendered');
    assert(await page.$('#app-body') !== null, 'app shell present');
    const who = await page.evaluate(() => (typeof ME !== 'undefined' && ME && ME.sales_user_name) || '');
    assert(/\w/.test(who), 'signed in as ' + (who || '(unknown)'));

    step('First-run prompts');
    assert(await dismissOverlays(page), 'notification / install prompts dismissed (they cover the whole page)');

    step('Leads screen');
    // The app finishes booting by navigating to its own default screen, so a setTab()
    // fired too early gets overridden and you end up back on Home mid-test. Drive it
    // until it actually stays on Leads.
    let onLeads = false;
    for (let attempt = 1; attempt <= 4 && !onLeads; attempt++) {
      await page.evaluate(() => setTab('leads'));
      onLeads = await until(page, () => typeof TAB !== 'undefined' && TAB === 'leads'
        && document.querySelectorAll('.lead-row').length > 0, null, 10000);
      if (!onLeads) await sleep(1500);
    }
    assert(onLeads, 'lead rows rendered and the screen stayed on Leads');

    // narrow to the fixtures this run created, so the rows we click are ours and
    // are still with the director (an assigned lead is not pickable by design)
    await page.evaluate((q) => { const el = document.getElementById('lead-q');
      if (el) { el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); } }, FIXTURE);
    const narrowed = await until(page, n => document.querySelectorAll('.lead-row').length === n, FIXTURE_N);
    const shown = await page.evaluate(() => document.querySelectorAll('.lead-row').length);
    assert(narrowed, `search narrowed to this run's ${FIXTURE_N} fixtures (showing ${shown})`);

    step('Long-press selects, and the action bar is REACHABLE');
    await dismissOverlays(page);
    const hit = await page.evaluate(() => {
      const r = document.querySelector('.lead-row'); if (!r) return { ok: false, what: 'no row' };
      const b = r.getBoundingClientRect();
      const el = document.elementFromPoint(b.x + b.width / 2, b.y + 14);
      return { ok: !!(el && el.closest && el.closest('.lead-row')), what: el ? (el.className || el.tagName) : 'none' };
    });
    assert(hit.ok, 'the lead row is genuinely touchable (hit test found: ' + hit.what + ')');
    assert(await page.evaluate(() => (typeof TAB !== 'undefined' && TAB === 'leads')
      && document.querySelectorAll('.lead-row').length > 0), 'still on Leads when the press starts');
    const pressed = await longPress(page, '.lead-row', 0);
    assert(pressed, 'long-press delivered');
    const entered = await until(page, () => typeof LEADSEL !== 'undefined' && LEADSEL.on && LEADSEL.ids.length === 1);
    if (!assert(entered, 'long-press entered selection mode')) {
      const why = await page.evaluate(() => ({
        toast: (document.getElementById('toastbar') || {}).textContent || '',
        pickable: (typeof LEADS !== 'undefined' && LEADS[0]) ? _leadPickable(LEADS[0]) : 'n/a',
        rows: document.querySelectorAll('.lead-row').length,
        tab: (typeof TAB !== 'undefined') ? TAB : '?',
        leadOpen: (typeof LEAD_OPEN !== 'undefined') ? !!LEAD_OPEN : '?',
        modal: !!document.querySelector('#modal-host .modal'),
        modalTitle: ((document.querySelector('.modal-title') || {}).textContent || '').slice(0, 60),
        heading: (document.querySelector('#app-body h1, #app-body .lead-h1, #app-body .dsec') || {}).textContent || '',
        firstText: ((document.getElementById('app-body') || {}).innerText || '').split(String.fromCharCode(10)).slice(0, 6).join(' | ') }));
      console.log('     ↳ diagnostics: ' + JSON.stringify(why));
      try { await page.screenshot({ path: '_smoke_fail.png' }); console.log('     ↳ screenshot: _smoke_fail.png'); } catch (e) {}
    }
    const barBox = await page.evaluate(() => {
      const b = document.querySelector('#selbar-host .selbar'); if (!b) return null;
      const r = b.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight, host: b.parentElement.id };
    });
    if (assert(barBox, 'selection bar exists after long-press')) {
      assert(barBox.host === 'selbar-host', 'bar is mounted on the body host (not inside the animated container)');
      assert(barBox.top >= 0 && barBox.bottom <= barBox.vh + 1, `bar is inside the viewport (top ${Math.round(barBox.top)}, bottom ${Math.round(barBox.bottom)} of ${barBox.vh})`);
      assert(barBox.h > 20, 'bar has real height');
    }

    step('No single-lead Assign button while selecting');
    const rowAssign = await page.evaluate(() =>
      [...document.querySelectorAll('.lead-row button')].filter(b => /assign to team/i.test(b.textContent || '')).length);
    assert(rowAssign === 0, 'per-row "Assign to team" is hidden in selection mode (it used to eat the selection)');

    step('Select all, then bulk assign');
    await clickText(page, '#selbar-host .selbar button', 'Select all');
    assert(await until(page, n => typeof LEADSEL !== 'undefined' && LEADSEL.ids.length === n, FIXTURE_N),
      `Select all picked all ${FIXTURE_N}`);
    const selCount = await page.evaluate(() => (typeof LEADSEL !== 'undefined' ? LEADSEL.ids.length : 0));
    const barLabel = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#selbar-host .selbar button')].find(x => /assign/i.test(x.textContent || ''));
      return b ? b.textContent.trim() : ''; });
    assert(new RegExp('assign\\s+' + selCount + '\\b', 'i').test(barLabel), `bar names the count ("${barLabel}")`);

    await clickText(page, '#selbar-host .selbar button', 'Assign');
    assert(await until(page, () => /which project/i.test((document.querySelector('.modal-title') || {}).textContent || '')),
      'step 1 modal opened');
    const projStep = await page.evaluate(() => ({
      asks: /which project/i.test((document.querySelector('.modal-title') || {}).textContent || ''),
      rows: document.querySelectorAll('#modal-host .modal-body .lrow').length,
    }));
    assert(projStep.asks, 'step 1 asks which project');
    assert(projStep.rows > 0, `project options listed (${projStep.rows})`);

    await page.evaluate(() => { const r = document.querySelector('#modal-host .modal-body .lrow'); if (r) r.click(); });
    assert(await until(page, () => /assign \d+ lead/i.test((document.querySelector('.modal-title') || {}).textContent || '')),
      'step 2 modal opened (members)');
    const memStep = await page.evaluate(() => ({ rows: document.querySelectorAll('#modal-host .modal-body .lrow').length }));
    assert(memStep.rows > 0, `step 2 lists members (${memStep.rows})`);

    await page.evaluate(() => { const r = document.querySelector('#modal-host .modal-body .lrow'); if (r) r.click(); });
    assert(await until(page, () => (window.__rpc || []).some(r => r.fn === 'assign_leads_bulk')), 'assign_leads_bulk called');
    const call = await page.evaluate(() => (window.__rpc || []).filter(r => r.fn === 'assign_leads_bulk').pop());
    if (assert(call, 'assign_leads_bulk was called')) {
      assert((call.args.p_lead_ids || []).length === selCount,
        `it sent ALL ${selCount} selected ids (sent ${(call.args.p_lead_ids || []).length}) — this is the "only 1 lead went" regression`);
    }

    step('Director board');
    await page.evaluate(() => setTab('home'));
    assert(await until(page, () => document.querySelectorAll('.tbd-c').length > 0), 'board rendered');
    const board = await page.evaluate(() => ({
      cards: document.querySelectorAll('.tbd-c').length,
      tabs: document.querySelectorAll('#tbd-wrap button').length,
    }));
    assert(board.cards > 0, `member cards rendered (${board.cards})`);
    assert(board.tabs > 0, `project tabs rendered (${board.tabs})`);

    step('Board card opens the full detail');
    await page.evaluate(() => { const c = document.querySelector('.tbd-c:not(.idle)') || document.querySelector('.tbd-c'); if (c) c.click(); });
    assert(await until(page, () => /leads you gave them/i.test(document.body.innerText || '')), 'detail shows "Leads you gave them"');
    const detail = await page.evaluate(() => document.body.innerText || '');
    assert(/stage breakdown/i.test(detail), 'detail shows the stage breakdown');
    assert(/never opened/i.test(detail), 'detail shows never-opened');

    step('"See their leads" actually opens a list');
    const clicked = await clickText(page, '#modal-host button', 'See their leads');
    assert(clicked, 'button found');
    const rendered = await until(page, () => {
      const t = document.body.innerText || '';
      return /your team/i.test(t) && (document.querySelectorAll('#app-body .lrow').length > 0 || /no leads here/i.test(t));
    });
    if (!assert(rendered, 'their-leads screen rendered')) {
      console.log('     ↳ ' + JSON.stringify(await page.evaluate(() => ({
        rows: document.querySelectorAll('#app-body .lrow').length,
        text: ((document.getElementById('app-body') || {}).innerText || '').split(String.fromCharCode(10)).slice(0, 8).join(' | ') }))));
    }
    const leadsView = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return { back: /your team/i.test(txt), rows: document.querySelectorAll('#app-body .lgroup .lrow').length,
               empty: /no leads here/i.test(txt), skel: document.querySelectorAll('#app-body .skel').length };
    });
    assert(leadsView.back, 'header shows the "‹ Your team" way back');
    assert(leadsView.rows > 0 || leadsView.empty, leadsView.rows > 0
      ? `their leads listed (${leadsView.rows})` : 'honest empty state (that member holds none)');
    assert(!leadsView.skel, 'not stuck on a skeleton');

    step('Console');
    const real = errors.filter(e => !/favicon|manifest|Failed to load resource/i.test(e));
    assert(real.length === 0, real.length ? 'console errors: ' + real.slice(0, 3).join(' | ') : 'no console errors');

  } catch (e) {
    bad('driver crashed: ' + (e && e.message));
  } finally {
    await browser.close();
    server.close();
    const CLEAN = [
      `delete from public.sales_sessions where session_token='${TOKEN}';`,
      `delete from public.lead_views       where lead_id in (select id from public.leads where name like '${FIXTURE}%');`,
      `delete from public.lead_activities  where lead_id in (select id from public.leads where name like '${FIXTURE}%');`,
      `delete from public.lead_assignments where lead_id in (select id from public.leads where name like '${FIXTURE}%');`,
      `delete from public.deals            where lead_id in (select id from public.leads where name like '${FIXTURE}%');`,
      `delete from public.leads            where name like '${FIXTURE}%';`,
    ];
    let cleaned = false;
    for (let attempt = 1; attempt <= 3 && !cleaned; attempt++) {
      try { for (const q of CLEAN) await sql(q); cleaned = true; }
      catch (e) { await sleep(1500 * attempt); }
    }
    if (!cleaned) {
      console.log('\n\u26A0\uFE0F  COULD NOT CLEAN UP the test fixtures — run this yourself:');
      CLEAN.forEach(q => console.log('   ' + q));
    } else {
      console.log('\n\u2713 fixtures removed (' + FIXTURE + ')');
    }
  }

  console.log('\n' + '\u2500'.repeat(46));
  console.log(`RESULT: ${FAIL ? '\u274C FAIL' : '\u2705 PASS'}  (${PASS} passed, ${FAIL} failed)`);
  process.exit(FAIL ? 1 : 0);
})();
