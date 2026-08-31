/**
 * Nexunova RMS — "signed out while I was still using it"
 *
 * The portal used to end a session two ways, and neither of them measured
 * disuse:
 *
 *   - the browser gave up after 30 minutes idle, and its idle clock only moved
 *     when somebody NAVIGATED, so reading one screen looked like going home;
 *   - sales_login stamped the session with a fixed 8 hours from sign-in, so a
 *     full working day ended in a sign-out no matter how busy it was.
 *
 * It should now end after a WEEK OF NOT BEING USED, on both clocks. This drives
 * the real portal in a real browser against real sessions minted in the
 * database, because the server half cannot be proved any other way.
 *
 *   node scripts/verify-session-week.js
 *
 * Every session it mints is prefixed zzweek_ and deleted again at the end, and
 * it never reads or prints anybody's real token.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4193;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const TAG = 'zzweek_' + Math.random().toString(36).slice(2, 10);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── DB access (same management endpoint the other harnesses use) ────────────
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

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
               '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon' };
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

/* Open the portal already signed in, with the local activity stamp set to a
   chosen age. ageMs is how long ago the portal last saw this person do
   anything. */
async function openWith(browser, token, ageMs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 140)));
  await page.evaluateOnNewDocument((tok, age) => {
    try {
      localStorage.setItem('rms.sales.token', tok);
      localStorage.setItem('rms.sales.active', String(Date.now() - age));
    } catch (e) {}
    // record every call the page makes so the renewal can be seen
    window.__rpc = [];
    const patch = () => {
      if (!window.supabase || window.__patched) return false;
      window.__patched = true;
      const cc = window.supabase.createClient;
      window.supabase.createClient = function () {
        const c = cc.apply(this, arguments);
        const r = c.rpc.bind(c);
        c.rpc = function (name, args) { window.__rpc.push(name); return r(name, args); };
        return c;
      };
      return true;
    };
    if (!patch()) {
      const iv = setInterval(() => { if (patch()) clearInterval(iv); }, 5);
      setTimeout(() => clearInterval(iv), 4000);
    }
  }, token, ageMs);
  await page.goto(PAGE, { waitUntil: 'networkidle2' });
  return { page, errs };
}

/* Ask the SCREEN, not the variable. TOKEN and IDLE_MS are declared with const
   inside the portal's one inline script, so they are module-scoped and never
   become properties of window — reading window.TOKEN reports "signed out" on a
   page that is plainly showing the app. Which screen is up is the honest
   witness, and it is what the person in front of it actually sees. */
const signedIn = page => page.evaluate(() => {
  const shown = id => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
  return { onLogin: shown('screen-login'), inApp: shown('screen-app'),
           rpcs: (window.__rpc || []).slice() };
});

/* IDLE_MS is module-scoped for the same reason, so the shipped constant is read
   out of the source. The point of the assertion is that what ships is a week. */
function idleDaysInSource() {
  const src = fs.readFileSync(path.join(ROOT, 'sales-portal.html'), 'utf8');
  const m = src.match(/const IDLE_MS=([^;]+);/);
  if (!m) return null;
  return Function('"use strict";return (' + m[1] + ')')() / 86400000;
}

(async () => {
  const exe = BROWSERS.find(fs.existsSync);
  if (!exe) { console.error('no browser found'); process.exit(2); }

  const who = await sql(`select id, company_id from public.sales_users
                         where status='active' order by created_at limit 1;`);
  if (!who.length) { console.error('no active sales user to test with'); process.exit(2); }
  const { id: SU, company_id: CO } = who[0];

  const mint = async (suffix, expiresSql) => {
    const tok = TAG + '_' + suffix;
    await sql(`insert into public.sales_sessions(company_id, sales_user_id, session_token, expires_at)
               values ('${CO}','${SU}','${tok}', ${expiresSql});`);
    return tok;
  };
  const expiryOf = async tok => (await sql(
    `select round(extract(epoch from (expires_at - now()))/86400.0, 3) as d
       from public.sales_sessions where session_token='${tok}';`))[0];

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  try {
    // ── the server's half ──────────────────────────────────────────────────
    step('A new sign-in is good for a week, not eight hours');
    const def = await sql(`select column_default from information_schema.columns
                           where table_schema='public' and table_name='sales_sessions'
                             and column_name='expires_at';`);
    assert(/7 days/.test(def[0].column_default),
      'sales_sessions defaults to seven days \u2014 ' + def[0].column_default);
    const login = await sql(`select pg_get_functiondef(p.oid) ilike '%7 days%' as seven,
                                    pg_get_functiondef(p.oid) ilike '%8 hours%' as eight
                             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                             where n.nspname='public' and p.proname='sales_login';`);
    assert(login[0].seven && !login[0].eight, 'sales_login issues seven days and no longer eight hours');

    const short = await sql(`select pg_get_functiondef(p.oid) ilike '%2 minutes%' as two
                             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                             where n.nspname='public' and p.proname='create_lead_from_web';`);
    assert(short[0].two, 'the web-lead throwaway session is still two minutes, not a week');

    step('Using the portal pushes the server window back out');
    const tokUse = await mint('use', `now() + interval '2 hours'`);
    const beforeD = (await expiryOf(tokUse)).d;
    const { page: p1, errs: e1 } = await openWith(browser, tokUse, 60 * 1000);
    await sleep(3500);
    const afterD = (await expiryOf(tokUse)).d;
    assert(Number(beforeD) < 0.2 && Number(afterD) > 6.5,
      'a session with two hours left came back to a week \u2014 ' + beforeD + 'd \u2192 ' + afterD + 'd');
    const s1 = await signedIn(p1);
    assert(s1.rpcs.includes('sales_touch_session'), 'the portal called sales_touch_session on open');
    assert(!s1.onLogin && s1.inApp, 'and it is signed in, not sitting on the login screen');
    assert(e1.length === 0, 'no console errors \u2014 ' + (e1[0] || 'none'));

    step('The renewal is debounced, not fired on every click');
    const before2 = (await sql(`select expires_at from public.sales_sessions where session_token='${tokUse}';`))[0].expires_at;
    await p1.mouse.click(640, 400); await sleep(300);
    await p1.mouse.click(640, 420); await sleep(300);
    await p1.keyboard.press('Escape'); await sleep(1200);
    const after2 = (await sql(`select expires_at from public.sales_sessions where session_token='${tokUse}';`))[0].expires_at;
    const calls = (await p1.evaluate(() => window.__rpc.filter(n => n === 'sales_touch_session').length));
    assert(calls === 1, 'still exactly one renewal after several clicks \u2014 ' + calls);
    assert(before2 === after2, 'so the server row was written once, not per click');
    await p1.close();

    // ── the browser's half ─────────────────────────────────────────────────
    step('Idle for two hours \u2014 which used to be a sign-out');
    const tokIdle = await mint('idle', `now() + interval '7 days'`);
    const { page: p2, errs: e2 } = await openWith(browser, tokIdle, 2 * 60 * 60 * 1000);
    await sleep(3000);
    const s2 = await signedIn(p2);
    assert(idleDaysInSource() === 7, 'the browser window is seven days \u2014 ' + idleDaysInSource() + ' days');
    assert(!s2.onLogin && s2.inApp, 'two hours of doing nothing no longer signs anybody out');
    assert(e2.length === 0, 'no console errors \u2014 ' + (e2[0] || 'none'));
    await p2.close();

    step('Idle for eight days \u2014 which is what SHOULD sign you out');
    const tokDead = await mint('dead', `now() + interval '7 days'`);
    const { page: p3 } = await openWith(browser, tokDead, 8 * 24 * 60 * 60 * 1000);
    await sleep(3000);
    const s3 = await signedIn(p3);
    assert(s3.onLogin, 'a week of not touching it lands on the login screen');
    assert(!s3.rpcs.includes('sales_touch_session'),
      'and a session the browser has already written off is not renewed behind the scenes');
    const deadRow = await expiryOf(tokDead);
    assert(!!deadRow, 'the server row is left for sales_login to clear, not silently extended');
    await p3.close();

    step('An expired server session cannot be revived by using the portal');
    const tokGone = await mint('gone', `now() - interval '1 minute'`);
    const r = await sql(`select public.sales_touch_session('${tokGone}')::text as res;`);
    assert(/session_expired/.test(r[0].res), 'sales_touch_session refuses a dead token \u2014 ' + r[0].res);
    const stillDead = await expiryOf(tokGone);
    assert(Number(stillDead.d) < 0, 'and it stayed dead \u2014 ' + stillDead.d + ' days');

    step('The lock on the new function is a real lock');
    const acl = await sql(`select coalesce(array_to_string(p.proacl::text[],' | '),'(PUBLIC)') as acl
                           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public' and p.proname='sales_touch_session';`);
    assert(!/^=X/.test(acl[0].acl) && !/\| =X/.test(acl[0].acl),
      'PUBLIC holds no grant on sales_touch_session \u2014 ' + acl[0].acl);
    assert(/anon=X/.test(acl[0].acl), 'and the browser (anon) can call it');
  } finally {
    const gone = await sql(`delete from public.sales_sessions
                            where session_token like '${TAG}%' returning 1;`);
    console.log('\n  (cleaned up ' + gone.length + ' test session' + (gone.length === 1 ? '' : 's') + ')');
    await browser.close(); server.close();
  }

  console.log('\n' + '\u2500'.repeat(54));
  console.log(`RESULT: ${FAIL ? '\u274C FAIL' : '\u2705 PASS'}  (${PASS} passed, ${FAIL} failed)`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
