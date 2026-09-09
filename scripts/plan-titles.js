/* ══ WHICH SHEET IS WHICH FLOOR ═════════════════════════════════════════════
   Every sheet says what it is on its own face. This crops the title band at
   the foot of each page and stitches them into one image, so the answer comes
   from the drawing rather than from the order of the file.

   node scripts/plan-titles.js [dir]   →  <dir>/_titles.png
*/
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const DIR = process.argv[2] || 'marketing_shots/plan';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const panels = [];
for (let n = 1; n <= 8; n++) {
  const f = path.join(DIR, 'page' + n + '.svg');
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  /* the black text sitting below the drawing */
  const keep = [];
  let lo = 1e9, hi = -1e9;
  const re = /<path d="([^"]*)"([^>]*)\/>/g; let m;
  const all = [];
  while ((m = re.exec(src))) {
    const c = /[ML]([-\d.]+) ([-\d.]+)/.exec(m[1]);
    if (!c) continue;
    all.push({ x: Number(c[1]), y: Number(c[2]), s: m[0] });
    if (all[all.length - 1].y > hi) hi = all[all.length - 1].y;
  }
  /* the bottom 6% of whatever this sheet actually uses */
  const band = hi - (hi - 0) * 0.06;
  const inBand = all.filter(p => p.y >= band - 40);
  const xs = inBand.map(p => p.x).sort((a, b) => a - b);
  const X = xs.length ? xs[Math.floor(xs.length * 0.02)] - 20 : 900;
  const X2 = xs.length ? xs[Math.floor(xs.length * 0.98)] + 20 : 1500;
  const Y = band - 40, H = hi - Y + 20, W = Math.max(120, X2 - X);
  inBand.forEach(p => keep.push(p.s));
  panels.push({ n: n, paths: keep.length,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + X + ' ' + Y + ' ' + W + ' ' + H +
      '" width="900" height="' + Math.max(60, Math.round(900 * H / W)) + '">' +
      '<style>path{stroke-width:0.25 !important}</style>' +
      '<rect x="' + X + '" y="' + Y + '" width="' + W + '" height="' + H + '" fill="#fff"/>' +
      keep.join('') + '</svg>' });
}

const html = '<style>body{margin:0;font:14px system-ui;background:#fff}' +
  '.c{border-bottom:2px solid #333}.h{font-weight:700;padding:4px 6px;background:#111;color:#fff}</style>' +
  panels.map(p => '<div class="c"><div class="h">FILE PAGE ' + p.n + '  (' + p.paths + ' paths in the title band)</div>' +
    p.svg + '</div>').join('');
const out = path.join(DIR, '_titles.html');
fs.writeFileSync(out, html);

(async () => {
  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)),
                                           headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 930, height: 1200, deviceScaleFactor: 2 });
  await page.goto('file:///' + path.resolve(out).split(path.sep).join('/'), { waitUntil: 'load' });
  await sleep(1500);
  await page.screenshot({ path: path.join(DIR, '_titles.png'), fullPage: true });
  console.log('written', path.join(DIR, '_titles.png'));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
