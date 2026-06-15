/**
 * Sanctioned-batch UI verification — screenshots of the touched surfaces with
 * caches stubbed (auth-free). Shows: ClientForm nominee CNIC + photo (#19/#20),
 * and the bulk generator's floor-code column + type-default prefill (#16/floor_code).
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4213;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots_batch');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1440,960'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate(() => {
    S = { cid: 'fg', userId: 'u', role: 'admin', name: 'Rashid Ali', coName: 'Fourteen Group of companies', isProjectAdmin: true };
    window.hasProjectAccess = () => true;
    window._projectsCache = [{ id: 'p1', projectName: 'Sapphire Heights', name: 'Sapphire Heights' }];
    window.gprojects = () => window._projectsCache;
    window._floorsCache = [
      { id: 'f1', name: 'Ground',     floorCode: 'G',  sortOrder: 0, isActive: true },
      { id: 'f2', name: 'Upper Ground', floorCode: 'UG', sortOrder: 1, isActive: true },
      { id: 'f3', name: '1st Floor',  floorCode: '1',  sortOrder: 2, isActive: true },
      { id: 'f4', name: '2nd Floor',  floorCode: '2',  sortOrder: 3, isActive: true }
    ];
    window._typesCache = [
      { id: 't1', name: '2 Bed Apartment', typeName: '2 Bed Apartment', defaultArea: 1200, defaultPrice: 8500000, isActive: true },
      { id: 't2', name: 'Shop',            typeName: 'Shop',            defaultArea: 250,  defaultPrice: 4000000, isActive: true }
    ];
    window._statusesCache = [{ id: 's1', name: 'Available', isAvailable: true, isActive: true }];
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof stopLoginAnimations === 'function') try { stopLoginAnimations(); } catch (e) {}
    if (typeof buildSB === 'function') buildSB();
  });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);

    // ── ClientForm (add) — open + expand "More details" to reveal nominee CNIC + photo
    await page.evaluate(() => {
      document.querySelectorAll('#cfm-modal').forEach(m => m.remove());
      ClientForm.open({ projectId: 'p1' });
      const d = document.querySelector('#cfm-modal details'); if (d) d.open = true;
    });
    await new Promise(r => setTimeout(r, 250));   // let the open() autofocus fire first
    await page.evaluate(() => { const k = document.getElementById('cfm-kin_cnic'); if (k) k.scrollIntoView({ block: 'center' }); });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, `clientform_${theme}.png`) });
    await page.evaluate(() => ClientForm.close());

    // ── Bulk generator — open, select a type (prefills area/price), build preview
    await page.evaluate(() => {
      openBulkGen();
      const sel = document.getElementById('bg-type'); if (sel) { sel.value = 't1'; }
      if (typeof _bgFillTypeDefaults === 'function') _bgFillTypeDefaults();
    });
    await new Promise(r => setTimeout(r, 450));
    await page.screenshot({ path: path.join(OUT, `bulkgen_${theme}.png`) });
    await page.evaluate(() => { if (typeof _uCloseModal === 'function') _uCloseModal(); });
    await new Promise(r => setTimeout(r, 150));
  }

  await browser.close(); srv.close();
  console.log('SHOTS →', OUT);
  console.log('console errors:', errs.length);
  if (errs.length) console.log(errs.slice(0, 15).join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
