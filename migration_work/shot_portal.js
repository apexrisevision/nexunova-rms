const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TOKEN = 'ZZMERAHISAAB_DEMO';
const PORT = 8799;
const OUT = path.join(__dirname, 'portal_shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  const cases = [
    { name: 'mobile_light', w: 390, h: 844, theme: 'light' },
    { name: 'mobile_dark',  w: 390, h: 844, theme: 'dark'  },
    { name: 'w1366_light',  w: 1366, h: 900, theme: 'light' },
    { name: 'w1920_light',  w: 1920, h: 1080, theme: 'light' },
    { name: 'w1920_dark',   w: 1920, h: 1080, theme: 'dark'  },
  ];
  let probe = null;
  for (const c of cases) {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${c.name}] console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[${c.name}] pageerror: ${e.message}`));
    await page.setViewport({ width: c.w, height: c.h });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: c.theme }]);
    await page.goto(`http://localhost:${PORT}/buyer-portal.html?t=${TOKEN}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero-unit, .empty, .banner.show', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(OUT, c.name + '.png'), fullPage: true });
    if (!probe) {
      probe = await page.evaluate(() => {
        const txt = document.body.innerText;
        const tabClick = t => { const b = document.querySelector(`.tab[data-tab="${t}"]`); if (b) b.click(); };
        return {
          hero: (document.querySelector('.hero-unit') || {}).innerText || null,
          proj: (document.querySelector('.hero-proj') || {}).innerText || null,
          who: (document.getElementById('who') || {}).innerText || null,
          pct: (document.querySelector('.journey-legend .pc') || {}).innerText || null,
          schedRows: document.querySelectorAll('.pane[data-pane="schedule"] tbody tr').length,
          hasCheque: /cheque|bank/i.test(txt),
          theme: document.documentElement.getAttribute('data-theme'),
        };
      });
      // capture payments tab too
      await page.evaluate(() => { const b = document.querySelector('.tab[data-tab="payments"]'); if (b) b.click(); });
      await new Promise(r => setTimeout(r, 300));
      await page.screenshot({ path: path.join(OUT, 'payments_tab.png'), fullPage: true });
      probe.payCount = await page.evaluate(() => document.querySelectorAll('.pane[data-pane="payments"] .pay-row').length);
      probe.payText = await page.evaluate(() => (document.querySelector('.pane[data-pane="payments"]') || {}).innerText || '');
    }
    await page.close();
  }
  await browser.close();
  server.close();
  console.log('PROBE:', JSON.stringify(probe, null, 2));
  console.log('JS ERRORS (' + errors.length + '):');
  errors.forEach(e => console.log('  ' + e));
  console.log('Shots in', OUT);
})();
