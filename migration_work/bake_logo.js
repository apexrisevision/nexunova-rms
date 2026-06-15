// Phase-2 F: bake the runtime alpha-matte (logo.js cleanLogo) into a static PNG.
// Reads js/logo.js RAW data-URI, runs the EXACT knockout in headless Chrome,
// writes assets/img/nexunova-logo.png. One-off build tool (lives in migration_work).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const logoJs = fs.readFileSync(path.join(ROOT, 'js', 'logo.js'), 'utf8');
  const m = logoJs.match(/"(data:image\/png;base64,[A-Za-z0-9+/=]+)"/);
  if (!m) { console.error('RAW data-URI not found in logo.js'); process.exit(1); }
  const RAW = m[1];
  console.log('RAW length:', RAW.length);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');

  // EXACT cleanLogo algorithm from js/logo.js (THR=55 near-black → transparent)
  const cleaned = await page.evaluate(async (RAW) => {
    function cleanLogo(uri) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = function () {
          // matte at native res first (THR=55 near-black -> transparent)
          const nc = document.createElement('canvas');
          nc.width = img.naturalWidth; nc.height = img.naturalHeight;
          const nctx = nc.getContext('2d');
          nctx.drawImage(img, 0, 0);
          const id = nctx.getImageData(0, 0, nc.width, nc.height);
          const px = id.data; const THR = 55;
          for (let i = 0; i < px.length; i += 4) {
            const br = Math.max(px[i], px[i + 1], px[i + 2]);
            if (br < THR) { px[i + 3] = Math.round((br / THR) * px[i + 3]); }
          }
          nctx.putImageData(id, 0, 0);
          // downscale to a display-appropriate size (retina-safe for ~50-100px use)
          const MAX = 320;
          const scale = Math.min(1, MAX / Math.max(nc.width, nc.height));
          const ow = Math.round(nc.width * scale), oh = Math.round(nc.height * scale);
          const oc = document.createElement('canvas');
          oc.width = ow; oc.height = oh;
          const octx = oc.getContext('2d');
          octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
          octx.drawImage(nc, 0, 0, ow, oh);
          resolve({ url: oc.toDataURL('image/png'), w: ow, h: oh });
        };
        img.src = uri;
      });
    }
    return await cleanLogo(RAW);
  }, RAW);

  await browser.close();

  const b64 = cleaned.url.replace(/^data:image\/png;base64,/, '');
  const outDir = path.join(ROOT, 'assets', 'img');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'nexunova-logo.png');
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  const bytes = fs.statSync(outFile).size;
  console.log(`baked ${cleaned.w}x${cleaned.h} -> assets/img/nexunova-logo.png  (${bytes} bytes)`);
})().catch(e => { console.error('BAKE FAILED:', e); process.exit(1); });
