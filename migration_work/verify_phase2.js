/**
 * Phase 2 functional verification (ZERO DB writes):
 *  1. boot the real app (fabricated admin session), navigate the 5 pages, and
 *     tally console errors split into 401-data-fetch (expected w/o auth) vs REAL
 *     JS errors (must be 0).
 *  2. print path: render NXPrint.reportFrame() output to a real PDF via Chrome
 *     and assert it's a valid openable PDF (%PDF + %%EOF). Also assert the legacy
 *     _printHTML now delegates to NXPrint.emit.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4204;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };
const PAGES = ['dashboard', 'units', 'clients', 'sales', 'reports'];

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
const ok = (n, p, d) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  // foundation loaded?
  const f = await page.evaluate(() => ({
    NX: typeof window.NX, NXPrint: typeof window.NXPrint,
    emit: !!(window.NXPrint && window.NXPrint.emit), frame: !!(window.NXPrint && window.NXPrint.reportFrame),
    printDelegates: typeof _printHTML === 'function' && _printHTML.toString().includes('NXPrint'),
    tokenPrimary: getComputedStyle(document.documentElement).getPropertyValue('--fk-primary').trim()
  }));
  ok('foundation kit.js loaded (window.NX object)', f.NX === 'object');
  ok('foundation print.js loaded (NXPrint.emit + reportFrame)', f.emit && f.frame);
  ok('legacy _printHTML delegates to NXPrint.emit', f.printDelegates);
  ok('--fk-primary token resolves to indigo #4F46E5', /4f46e5/i.test(f.tokenPrimary), f.tokenPrimary);

  // boot app + navigate pages
  await page.evaluate(() => {
    S = { cid:'test-cid', userId:'u', role:'admin', name:'Admin', username:'admin', coName:'Fourteen Group', coCode:'14', permissions:{}, assignedProjectIds:null, isProjectAdmin:true, hasFinanceUser:true, subStatus:'active', sessionVersion:1 };
    Object.assign(window, { _unitsCache:[], _unitsCacheLoaded:true, _clientsCache:[], _clientsCacheLoaded:true, _projectsCache:[], _projectsCacheLoaded:true, _appUsersCache:[], _contactLogsCache:[], _salesCache:[], _agentsCache:[] });
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof buildSB === 'function') buildSB();
  });
  for (const pg of PAGES) {
    await page.evaluate(p => { try { nav(p); } catch (e) { console.error('NAVTHROW ' + p + ' ' + e.message); } }, pg);
    await new Promise(r => setTimeout(r, 500));
  }

  const is401 = s => /Failed to load resource/.test(s) && /401/.test(s);
  const realErrs = errs.filter(e => !is401(e));
  ok('no REAL JS console errors across 5 pages (401 data-fetch excluded)', realErrs.length === 0,
     `${errs.length} total, ${errs.length - realErrs.length} are 401; real=${realErrs.length}` + (realErrs.length ? '\n  ' + realErrs.slice(0,8).join('\n  ') : ''));

  // PRINT PATH → real PDF from the standard report frame
  const html = await page.evaluate(() => NXPrint.reportFrame({
    title: 'Sales Register (print-path test)', company: 'Fourteen Group of Companies',
    project: 'Tower A', period: 'Jan–Jun 2026', orientation: 'landscape',
    bodyHTML: '<table><thead><tr><th>Client</th><th class="num">Net Price</th><th class="num">Recovered</th></tr></thead>' +
      '<tbody><tr><td>Ali Raza</td><td class="num">12,500,000</td><td class="num">4,820,000</td></tr>' +
      '<tr><td>Sara Khan</td><td class="num">9,000,000</td><td class="num">9,000,000</td></tr></tbody></table>'
  }));
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(html, { waitUntil: 'networkidle0' });
  const pdfPath = path.join(OUT, 'print_path_test.pdf');
  await pdfPage.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true });
  const buf = fs.readFileSync(pdfPath);
  const head = buf.slice(0, 5).toString('latin1');
  const tail = buf.slice(-1024).toString('latin1');
  ok('print path produces a valid openable PDF (%PDF header + %%EOF)', head === '%PDF-' && tail.includes('%%EOF'), `${buf.length} bytes -> ${pdfPath}`);

  await browser.close(); srv.close();
  const fails = results.filter(r => !r.p).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
