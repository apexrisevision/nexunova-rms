const puppeteer = require('puppeteer-core');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const PORT = 4234;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() { return new Promise(res => { const s = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, p === '/' ? 'login.html' : p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT, '127.0.0.1', () => res(s)); }); }
(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  pg.on('requestfailed', r => { if (/reports|foundation/.test(r.url())) errs.push('REQFAIL ' + r.url().split('/').pop()); });
  await pg.goto('http://127.0.0.1:' + PORT + '/login.html', { waitUntil: 'networkidle2' });
  const t = await pg.evaluate(() => ({ openRptViewer: typeof openRptViewer, rReports: typeof rReports, NXReport: typeof NXReport, REPORTS: typeof REPORTS, _rpRun: typeof _rpRun, NX: typeof NX, NXPrint: typeof NXPrint }));
  console.log('typeofs:', JSON.stringify(t));
  console.log('pageerrors:\n  ' + (errs.slice(0, 8).join('\n  ') || '(none)'));
  await b.close(); srv.close();
})();
