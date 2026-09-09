/* a window out of one page, drawn at size, to look at with eyes.

   EVERY point of a path is tested, not its first one: a wall that starts off
   the window still crosses it, and filtering on the first point quietly
   deletes exactly the long lines a reader is trying to see. That mistake once
   made a row of shops look as though it had no side walls at all. */
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const [, , DIR, PAGE, X, Y, W, H, OUT] = process.argv;
const PEN = process.argv[10] || '1.2';
const src = fs.readFileSync(path.join(DIR, PAGE + '.svg'), 'utf8');
const x = Number(X), y = Number(Y), w = Number(W), h = Number(H);
const keep = [];
const re = /<path d="([^"]*)"([^>]*)\/>/g;
let m;
while ((m = re.exec(src))) {
  const pts = [...m[1].matchAll(/([-\d.]+) ([-\d.]+)/g)];
  if (!pts.length) continue;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const px = Number(p[1]), py = Number(p[2]);
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  if (x1 < x - 40 || x0 > x + w + 40 || y1 < y - 40 || y0 > y + h + 40) continue;
  keep.push(m[0]);
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x + ' ' + y + ' ' + w + ' ' + h +
  '" width="1000" height="' + Math.round(1000 * h / w) + '"><rect x="' + x + '" y="' + y +
  '" width="' + w + '" height="' + h + '" fill="#fff"/>' +
  /* THE PEN, THINNED. Every path in the converted page carries stroke-width
     1.2, which on a filled letter fattens it until an o closes and a dot
     becomes an L. A thinner pen shows the glyph the draughtsman drew. */
  '<style>path{stroke-width:' + PEN + ' !important}</style>' +
  keep.join('') + '</svg>';
const f = path.join(DIR, '_crop.html');
fs.writeFileSync(f, '<body style="margin:0">' + svg);
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
           'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
(async () => {
  const br = await puppeteer.launch({ executablePath: B.find(p => fs.existsSync(p)),
                                      headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1010, height: 900, deviceScaleFactor: 2 });
  await pg.goto('file:///' + path.resolve(f).split(path.sep).join('/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 900));
  await pg.screenshot({ path: OUT, fullPage: true });
  await br.close();
  console.log('written ' + OUT + '   (' + keep.length + ' paths)');
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
