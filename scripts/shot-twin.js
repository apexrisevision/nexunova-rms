/* ══ PHOTOGRAPH THE MODEL ═════════════════════════════════════════════════
   The building is three-dimensional and a description of it is worth nothing:
   the only way to know whether it is right is to look at it. This serves the
   repo to a real Chrome, waits for the model to finish building, and takes a
   picture — which is how the rotation that sent the whole thing behind the
   camera, the fog that swallowed it and the canvas that showed one corner of
   itself were each found.

   node scripts/shot-twin.js
*/
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 4231;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = http.createServer((q, res) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const b = await puppeteer.launch({ channel: 'chrome', headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage();
  page.on('pageerror', e => console.log('  page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  console: ' + m.text()); });
  await page.setViewport({ width: 1400, height: 950, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:' + PORT + '/marketing_work/twin-proof.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window._twinReady === true, { timeout: 120000 });
  await new Promise(r => setTimeout(r, 1500));
  console.log(await page.evaluate(() => document.getElementById('stat').textContent));
  await page.screenshot({ path: 'marketing_work/twin-proof.png' });
  console.log('shot → marketing_work/twin-proof.png');
  await b.close(); server.close();
})().catch(e => { console.error(e.message); process.exit(1); });
