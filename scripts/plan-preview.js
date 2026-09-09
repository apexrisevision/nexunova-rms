/* ══ THE FLOOR AS IT WOULD LOOK ═════════════════════════════════════════════
   Draws what the flood found, coloured by what the system says about each unit,
   with a cross over anything that is not available and the number written where
   the drawing wrote it. This is not the page a dealer will see — it is the
   proof that the shapes and the numbers belong to each other, at a size an eye
   can check.

   node scripts/plan-preview.js <dir> <pageN> <states.json>
*/
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const DIR = process.argv[2] || 'marketing_shots/plan';
const PAGE = process.argv[3] || 'page1';
const STATES = process.argv[4];
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const R = JSON.parse(fs.readFileSync(path.join(DIR, PAGE + '-rooms.json'), 'utf8'));
const S = STATES ? JSON.parse(fs.readFileSync(STATES, 'utf8')) : {};
const PX = R.px;

/* every filled run becomes a rectangle: exact, and nothing is invented by
   smoothing a shape into something tidier than the walls allow */
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
Object.values(R.units).forEach(u => {
  X0 = Math.min(X0, u.x0); Y0 = Math.min(Y0, u.y0);
  X1 = Math.max(X1, u.x1); Y1 = Math.max(Y1, u.y1);
});
const W = X1 - X0, H = Y1 - Y0;

const COL = { free: '#DCEBD8', hold: '#F3E2C7', reserved: '#DDE6F6', booked: '#DDE6F6',
              sold_entry_pending: '#E9D6DE', pagri: '#E4DAEC', landowner: '#E4DAEC',
              sold: '#E9D6DE', held: '#EDEDEC' };
const EDGE = { free: '#5E8A52', hold: '#A9772A', reserved: '#3E6DB5', booked: '#3E6DB5',
               sold_entry_pending: '#A6486A', pagri: '#7A5AA6', landowner: '#7A5AA6',
               sold: '#A6486A', held: '#999' };

const parts = [];
let nFree = 0, nGone = 0;
Object.keys(R.units).forEach(u => {
  const r = R.units[u];
  const st = S[u] || 'held';
  const free = st === 'free';
  if (free) nFree++; else nGone++;
  const fill = COL[st] || '#EDEDEC', edge = EDGE[st] || '#999';
  /* the runs, as one path */
  let d = '';
  r.rows.forEach(rw => {
    const y = rw[0] / PX, x0 = rw[1] / PX, x1 = (rw[2] + 1) / PX, h = 1 / PX;
    d += 'M' + (x0 - X0).toFixed(2) + ' ' + (y - Y0).toFixed(2) +
         'h' + (x1 - x0).toFixed(2) + 'v' + h.toFixed(3) +
         'h' + (-(x1 - x0)).toFixed(2) + 'Z';
  });
  parts.push('<path d="' + d + '" fill="' + fill + '" stroke="none"/>');
  const cx = (r.x0 + r.x1) / 2 - X0, cy = (r.y0 + r.y1) / 2 - Y0;
  const bw = r.x1 - r.x0, bh = r.y1 - r.y0;
  parts.push('<rect x="' + (r.x0 - X0).toFixed(2) + '" y="' + (r.y0 - Y0).toFixed(2) +
             '" width="' + bw.toFixed(2) + '" height="' + bh.toFixed(2) +
             '" fill="none" stroke="' + edge + '" stroke-width="0.35"/>');
  if (!free) {
    parts.push('<path d="M' + (r.x0 - X0).toFixed(2) + ' ' + (r.y0 - Y0).toFixed(2) +
               'L' + (r.x1 - X0).toFixed(2) + ' ' + (r.y1 - Y0).toFixed(2) +
               'M' + (r.x1 - X0).toFixed(2) + ' ' + (r.y0 - Y0).toFixed(2) +
               'L' + (r.x0 - X0).toFixed(2) + ' ' + (r.y1 - Y0).toFixed(2) +
               '" stroke="' + edge + '" stroke-width="0.5" fill="none" opacity=".75"/>');
  }
  parts.push('<text x="' + cx.toFixed(2) + '" y="' + (cy + 1.4).toFixed(2) +
             '" font-size="4" font-family="system-ui" text-anchor="middle" fill="#14171C">' +
             u.replace(/^LG-/, '') + '</text>');
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1) +
  '" width="' + Math.round(W * 3) + '" height="' + Math.round(H * 3) + '">' +
  '<rect width="' + W.toFixed(1) + '" height="' + H.toFixed(1) + '" fill="#F5F5F4"/>' +
  parts.join('') + '</svg>';
fs.writeFileSync(path.join(DIR, PAGE + '-preview.svg'), svg);
console.log('units drawn ' + Object.keys(R.units).length + '   available ' + nFree + '   not available ' + nGone);

(async () => {
  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)),
                                           headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: Math.round(W * 3) + 20, height: 1200, deviceScaleFactor: 1 });
  await page.goto('file:///' + path.resolve(DIR, PAGE + '-preview.svg').split(path.sep).join('/'),
                  { waitUntil: 'load', timeout: 180000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(DIR, PAGE + '-preview.png'), fullPage: true });
  console.log('written ' + path.join(DIR, PAGE + '-preview.png'));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
