/**
 * "Unit map" in the sidebar — verified by CLICKING IT, not by calling the function.
 *
 *   node scripts/verify-unitmap-nav.js
 *
 * The gap this closes: the map worked, but nothing in sales-portal.html ever called
 * renderUnitMap(). Every earlier Phase 5 run drove it with page.evaluate, so the map
 * was proven to work while being unreachable for a human. So this harness is not
 * allowed to call renderUnitMap at all — it finds the nav item by its label, clicks
 * it, and asserts what appears.
 *
 * Read-only throughout: opening the map and a floor writes nothing. Sessions are
 * minted and deleted again.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4206;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'unitmap_nav');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const stepH = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
let n = 0;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f }); console.log('     \u{1F4F7} ' + path.basename(f));
}
const until = (page, fn, ms = 25000) =>
  page.waitForFunction(fn, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);

(async () => {
  stepH('Sessions');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-nav-%';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id,
      CASE full_name WHEN 'ZZ Rep One' THEN 'zz-nav-zrep' WHEN 'ZZ Director' THEN 'zz-nav-zdir'
                     WHEN 'Muhammad Saeed' THEN 'zz-nav-rep' WHEN 'Rashid Manzoor' THEN 'zz-nav-dir'
                     ELSE 'zz-nav-op' END, now()+interval '30 minutes'
      FROM public.sales_users
     WHERE (company_id='${ZZ}' AND full_name IN ('ZZ Rep One','ZZ Director'))
        OR full_name IN ('Muhammad Saeed','Rashid Manzoor','Nimra Khan')`);
  const made = await sql(`SELECT s.session_token, su.full_name, su.role FROM sales_sessions s
     JOIN sales_users su ON su.id=s.sales_user_id WHERE s.session_token LIKE 'zz-nav-%' ORDER BY s.session_token`);
  assert(made.length === 5, '5 sessions minted: ' + made.map(m => m.full_name + '/' + m.role).join(', '));

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  // Open the portal the way a person on a laptop does: the sidebar rail is visible.
  async function open(token, wide) {
    const page = await browser.newPage();
    await page.setViewport(wide ? { width: 1320, height: 900, deviceScaleFactor: 1.5 }
                                : { width: 430, height: 950, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now())); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    await until(page, () => { const b = document.getElementById('app-body');
                              return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
    await page.waitForFunction(() => { const b = document.getElementById('app-body'); if (!b) return false;
      const now = b.innerHTML.length; if (window.__l === now) return true; window.__l = now; return false;
    }, { timeout: 25000, polling: 350 }).catch(() => {});
    await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    return { page, errs };
  }

  // Find the sidebar link by the words on it, and click it like a finger would.
  const findItem = page => page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Unit map');
    if (!a) return { there: false };
    const grp = a.closest('.ni-grp');
    const r = a.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { there: true, group: grp && grp.getAttribute('data-grp'),
             visible: !!a.offsetParent && r.width > 0 && r.height > 0,
             clickable: !!el && (el === a || a.contains(el)),
             tab: a.getAttribute('data-tab') };
  });
  const clickItem = page => page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Unit map');
    if (!a) return false;
    const g = a.closest('.ni-grp'); if (g && !g.classList.contains('open')) {
      const b = g.querySelector('[data-grp-btn]'); if (b) b.click();
    }
    a.click(); return true;
  });

  async function run(label, token, expectFloors) {
    stepH(label);
    const { page, errs } = await open(token, true);
    // ME is module-scope, not on window — read who the sidebar says is signed in
    const who = await page.evaluate(() => ((document.getElementById('sb-uname') || {}).textContent || '?') +
      ' / ' + ((document.getElementById('sb-urole') || {}).textContent || '?'));
    ok('signed in as ' + who);
    const item = await findItem(page);
    assert(item.there, 'the sidebar has a "Unit map" item');
    assert(item.group === 'workspace', 'it sits in the Workspace group');
    assert(item.visible, 'it is visible on screen');
    assert(item.clickable, 'and a real click lands on it, nothing on top');
    await shot(page, label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-sidebar');

    assert(await clickItem(page), 'clicked it');
    assert(await until(page, () => document.querySelectorAll('.umv-floor').length > 0),
           'the floor list opened FROM THE BUTTON (renderUnitMap never called by hand)');
    const floors = await page.evaluate(() => [...document.querySelectorAll('.umv-floor')]
      .map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    assert(floors.length >= expectFloors, floors.length + ' floors listed');
    const title = await page.evaluate(() => (document.getElementById('appbar-title') || {}).textContent);
    assert(title === 'Unit map', 'the app bar reads "Unit map"');
    const onState = await page.evaluate(() => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Unit map');
      return a.classList.contains('on');
    });
    assert(onState, 'and the sidebar marks it as the current page');
    await shot(page, label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-floors');

    // and one floor, so the button is proven to reach the drawing, not just a list
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.umv-floor')].find(x => !x.classList.contains('soon'));
      if (!b) return null; b.click(); return b.textContent.replace(/\s+/g, ' ').trim();
    });
    if (opened) {
      assert(await until(page, () => document.querySelectorAll('#umv-svg polygon').length > 0),
             'a floor opens and draws: ' + opened);
      await sleep(700);
      await shot(page, label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-floor');
    }
    assert(errs.length === 0, 'no JS errors' + (errs.length ? ' — ' + errs[0] : ''));
    await page.close();
  }

  await run('ZZTEST rep', 'zz-nav-zrep', 1);
  await run('ZZTEST director', 'zz-nav-zdir', 1);
  await run('LIVE Awami rep (Muhammad Saeed)', 'zz-nav-rep', 8);
  await run('LIVE Awami director (Rashid Manzoor)', 'zz-nav-dir', 8);

  stepH('The operator must NOT get it');
  {
    const { page } = await open('zz-nav-op', true);
    const who = await page.evaluate(() => ({
      name: (document.getElementById('sb-uname') || {}).textContent,
      // the operator is the one role whose own apps show and whose Workspace group does not
      ops: !!document.querySelector('[data-le]') &&
           getComputedStyle(document.querySelector('[data-le]')).display !== 'none',
      workspace: getComputedStyle(document.querySelector('[data-grp="workspace"]')).display,
    }));
    assert(who.ops && who.workspace === 'none',
           'signed in as the operator ' + who.name + ' — their own apps show, Workspace does not');
    const item = await findItem(page);
    assert(!item.there || !item.visible, 'the operator has no "Unit map" item'
           + (item.there ? ' (present in markup but hidden with the Workspace group)' : ''));
    await shot(page, 'operator-no-item');
    await page.close();
  }

  stepH('On a phone, in the drawer');
  {
    const { page } = await open('zz-nav-rep', false);
    await page.evaluate(() => openSidebar());
    await sleep(500);
    const item = await findItem(page);
    assert(item.there && item.visible, 'the drawer carries "Unit map" too');
    assert(item.clickable, 'and it is tappable there');
    await shot(page, 'phone-drawer');
    assert(await clickItem(page), 'tapped it');
    assert(await until(page, () => document.querySelectorAll('.umv-floor').length > 0), 'the map opened on the phone');
    await shot(page, 'phone-floors');
    await page.close();
  }

  stepH('Clean up');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-nav-%'`);
  const left = await sql(`SELECT count(*)::int n FROM sales_sessions WHERE session_token LIKE 'zz-nav-%'`);
  assert(Number(left[0].n) === 0, 'every test session removed');

  await browser.close(); server.close();
  console.log(`\n${'='.repeat(56)}\n  PASS ${PASS}   FAIL ${FAIL}\n  shots \u2192 migration_work/unitmap_nav/\n${'='.repeat(56)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.stack || e.message); process.exit(1); });
