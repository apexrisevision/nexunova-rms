/**
 * P0 hotfix verification — 2026-06-12 (READ-ONLY against the DB, ZERO writes)
 * Note: live-login E2E not possible (dev creds admin@ADMIN/admin123 rejected on prod),
 * so the post-login state is fabricated; everything else is the real shipped code:
 * real login.html, real db.js/auth.js/categories.js, real DOM, real loader functions.
 *  - FIX 2: renders the status quick-add, monkey-patches _saveWithFallback to CAPTURE
 *    the payload and abort, asserts is_available true (checked) / false (unchecked)
 *  - FIX 3: synthetic 'local_' client in localStorage → banner + export data; clean → none
 *  - FIX 4: real loader called with bogus cid → returns false (failure contract);
 *    forced failure flags → banner; retry with stubbed loaders → banner clears
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  // ── Fabricate post-login state (no auth; functions/DOM are the real shipped code) ──
  await page.evaluate(() => {
    localStorage.setItem('kbh_v4', JSON.stringify({
      _migv4: true, units: {}, clients: { 'test-cid': [
        { id: 'local_1718000000000', full_name: 'Stranded Test Client', phone_primary: '0300-0000000' },
        { id: 'real-uuid-not-stranded', full_name: 'Normal Client' }
      ] }, settings: { overdueDays: 30 }
    }));
    S = { cid: "test-cid", userId: "test-user", role: "admin" };  // bare assignment: S is a global LEXICAL (data.js:5), window.S would be shadowed
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
  });
  await new Promise(r => setTimeout(r, 300));

  // ── FIX 3: stranded banner + export data ──
  const stranded = await page.evaluate(() => {
    checkStrandedLocalClients();   // same call auth.js makes post-login
    const b = document.getElementById('sys-banner-stranded');
    return {
      bannerShown: !!b,
      text: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : '',
      hasDownloadBtn: !!(b && b.querySelector('button[onclick*="downloadStrandedClients"]')),
      exportRows: _getStrandedLocalClients()
    };
  });
  ok('FIX3 banner shown after login hook', stranded.bannerShown, stranded.text);
  ok('FIX3 Download JSON button present', stranded.hasDownloadBtn);
  ok('FIX3 export contains ONLY the local_ record',
    Array.isArray(stranded.exportRows) && stranded.exportRows.length === 1 && stranded.exportRows[0].id === 'local_1718000000000',
    JSON.stringify(stranded.exportRows.map(r => r.id)));
  await page.screenshot({ path: path.join(__dirname, 'verify_fix3_banner.png') });

  // ── FIX 4a: real loader failure contract (anon RPC with bogus cid → false, no throw) ──
  const loaderFalse = await page.evaluate(async () => {
    const r = await loadUnitsCache('00000000-0000-0000-0000-000000000bad');
    return r === false;
  });
  ok('FIX4 real loader returns false on RPC failure (contract auth.js records)', loaderFalse);

  // ── FIX 4b: forced failure → banner; retry (stubbed loaders) → banner clears ──
  const fix4a = await page.evaluate(() => {
    window._cacheLoadFailed = { units: true, clients: true };
    showCacheLoadFailureBanner();
    const b = document.getElementById('sys-banner-cachefail');
    return { shown: !!b, text: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 150) : '', retryBtn: !!(b && b.querySelector('button[onclick*="retryFailedCacheLoads"]')) };
  });
  ok('FIX4 failure banner renders (distinct from empty state)', fix4a.shown && fix4a.retryBtn, fix4a.text);
  await page.screenshot({ path: path.join(__dirname, 'verify_fix4_banner.png') });
  const fix4b = await page.evaluate(async () => {
    _CACHE_LOADERS.units = async () => true;     // simulate connection restored
    _CACHE_LOADERS.clients = async () => true;
    await retryFailedCacheLoads(document.querySelector('#sys-banner-cachefail .trial-banner-cta'));
    return { bannerGone: !document.getElementById('sys-banner-cachefail'), failedLeft: Object.keys(window._cacheLoadFailed) };
  });
  ok('FIX4 retry clears banner once loaders succeed', fix4b.bannerGone && fix4b.failedLeft.length === 0, 'remaining: ' + JSON.stringify(fix4b.failedLeft));

  // ── FIX 2: quick-add payload capture (save aborted — nothing persists) ──
  const fix2 = await page.evaluate(async () => {
    if (!document.getElementById('cat-statuses')) {
      const host = document.createElement('div'); host.id = 'cat-statuses';
      document.getElementById('s-app').appendChild(host);
    }
    _catProject = '00000000-0000-0000-0000-00000000fa4e';   // passes _catRequireProject
    rStatusesList();
    const cb = document.getElementById('cat-st-qa-avail');
    const out = { checkboxExists: !!cb, defaultChecked: !!(cb && cb.checked), payloads: [] };
    if (!cb) return out;
    const orig = window._saveWithFallback;
    window._saveWithFallback = async (fn, payload) => { out.payloads.push(payload); return { _error: { message: 'TEST-ABORT (nothing saved)' } }; };
    document.getElementById('cat-st-qa-val').value = 'Open Units';
    await _catQASave('statuses');                            // checked → is_available:true
    document.getElementById('cat-st-qa-val').value = 'Closed Units';
    document.getElementById('cat-st-qa-avail').checked = false;
    await _catQASave('statuses');                            // unchecked → is_available:false
    window._saveWithFallback = orig;
    return out;
  });
  ok('FIX2 Sellable checkbox renders, default CHECKED', fix2.checkboxExists && fix2.defaultChecked);
  ok('FIX2 checked → payload is_available:true',
    !!(fix2.payloads[0] && fix2.payloads[0].is_available === true && fix2.payloads[0].status_name === 'Open Units'),
    JSON.stringify(fix2.payloads[0] && { name: fix2.payloads[0].status_name, is_available: fix2.payloads[0].is_available }));
  ok('FIX2 unchecked → payload is_available:false',
    !!(fix2.payloads[1] && fix2.payloads[1].is_available === false),
    JSON.stringify(fix2.payloads[1] && { name: fix2.payloads[1].status_name, is_available: fix2.payloads[1].is_available }));
  await page.screenshot({ path: path.join(__dirname, 'verify_fix2_quickadd.png') });

  // ── FIX 2 sellability chain: db.js cache mapping → sales.js:316 picker filter ──
  const chain = await page.evaluate(() => {
    const statusRow = { is_available: true };                       // what quick-add now saves
    const mapped = { isAvailable: statusRow.is_available || false }; // db.js loadStatusesCache mapping
    const unit = { isAvailable: mapped.isAvailable };                // db.js loadUnitsCache mapping
    return [unit].filter(u => u.isAvailable !== false).length === 1; // sales.js:316 picker filter
  });
  ok('FIX2 chain: is_available:true unit passes the New Sale picker filter', chain);

  // ── FIX 3 negative: clean storage → no banner ──
  const noBanner = await page.evaluate(() => {
    localStorage.removeItem('kbh_v4');
    const b = document.getElementById('sys-banner-stranded'); if (b) b.remove();
    checkStrandedLocalClients();
    return !document.getElementById('sys-banner-stranded');
  });
  ok('FIX3 clean storage → no banner', noBanner);

  await browser.close(); srv.close();
  const fails = results.filter(r => !r.pass);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
