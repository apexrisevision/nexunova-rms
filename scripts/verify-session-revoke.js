#!/usr/bin/env node
/**
 * Nexunova RMS — SESSION REVOKE / FORCE SIGN-OUT (real browser)
 *
 * When the office blocks a sales person we delete their sales_sessions row. Until now
 * an already-open portal tab never noticed: _refreshProfile() got {success:false,
 * error:'session_expired'} back and simply returned, so the blocked user kept looking
 * at a live-looking app shell until they happened to refresh the page.
 *
 * This drives the REAL page in REAL Chrome and asserts both directions:
 *   A. session still valid  → _refreshProfile() must NOT sign the tab out (fail-open)
 *   B. session row deleted  → the very next _refreshProfile() lands on the login screen
 *                             and the stored token is gone
 *   C. a hard reload after revocation also lands on the login screen
 *
 * Uses the same throwaway session the portal smoke uses; it is deleted in `finally`.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4189;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;

// same Awami director the portal smoke drives — read-only here
const COMPANY = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const DIRECTOR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const TOKEN = 'revoke_' + Math.random().toString(36).slice(2, 12);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log('  \u2705 ' + m); };
const bad = (m) => { FAIL++; console.log('  \u274C ' + m); };
const step = (m) => console.log('\n\u2500\u2500 ' + m);
const assert = (cond, m) => { cond ? ok(m) : bad(m); return !!cond; };

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

async function until(page, fn, arg, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 120 }, arg); return true; }
  catch (e) { return false; }
}

// the profile watch is debounced to one check a minute — clear it, then run the check
const poke = (page) => page.evaluate(async () => { _lastProfChk = 0; await _refreshProfile(); });
// showScreen() marks exactly one .screen as .active — ask which one is up, and prove it is on screen
const shownScreen = (page) => page.evaluate(() => {
  const el = document.querySelector('.screen.active');
  if (!el) return '(none)';
  const r = el.getBoundingClientRect();
  return (r.width > 0 && r.height > 0 && el.offsetParent !== null) ? el.id : el.id + ' (not visible)';
});
const onLogin = async (page) => (await shownScreen(page)) === 'screen-login';

(async () => {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.log('No Chrome/Edge found'); process.exit(2); }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 SESSION REVOKE \u2192 FORCE SIGN-OUT (real browser) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  await sql(`insert into public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
             values ('${COMPANY}','${DIRECTOR}',null,'${TOKEN}', now() + interval '15 minutes');`);

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--window-size=430,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });

  try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t); localStorage.setItem('rms.sales.active', String(Date.now())); }, TOKEN);
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

    step('A — the tab is signed in, and a live session must NOT be signed out');
    // ME is populated part-way through enterApp(), BEFORE the app screen is shown — waiting on
    // ME alone races and leaves the login screen up, which would make step B pass for free.
    // Wait for the app screen itself.
    const booted = await until(page, () => { const e = document.querySelector('.screen.active'); return !!e && e.id === 'screen-app'; });
    assert(booted, 'app screen is up from the seeded session — showing: ' + await shownScreen(page));
    await poke(page);
    assert(!(await onLogin(page)), 'a VALID session survives _refreshProfile() — no false eviction, showing: ' + await shownScreen(page));
    assert(await page.evaluate(() => !!localStorage.getItem('rms.sales.token')), 'token still stored');

    step('B — office revokes the session; the open tab must sign itself out');
    await sql(`delete from public.sales_sessions where session_token='${TOKEN}';`);
    await poke(page);
    assert(await onLogin(page), 'the open tab landed on the login screen without a manual refresh — showing: ' + await shownScreen(page));
    assert(await page.evaluate(() => !localStorage.getItem('rms.sales.token')), 'stored token cleared');
    assert(await page.evaluate(() => typeof TOKEN === 'undefined' || TOKEN === null), 'in-memory token cleared');
    const msg = await page.evaluate(() => (document.getElementById('login-err') || {}).textContent || '');
    assert(/sign in again/i.test(msg), 'told to sign in again — got: "' + msg.trim() + '"');

    step('C — and a hard reload cannot resurrect it');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await until(page, () => { const e = document.querySelector('.screen.active'); return !!e && e.id === 'screen-login'; }, null, 15000);
    assert(await onLogin(page), 'reload lands on the login screen, not the app — showing: ' + await shownScreen(page));

  } finally {
    await browser.close();
    server.close();
    try { await sql(`delete from public.sales_sessions where session_token='${TOKEN}';`); } catch (e) {
      console.log('  \u26A0 leftover session, remove by hand: ' + TOKEN);
    }
  }

  console.log(`\n\u2550\u2550\u2550\u2550 ${PASS} passed, ${FAIL} failed \u2550\u2550\u2550\u2550\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
