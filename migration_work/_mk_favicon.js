const puppeteer = require('puppeteer-core');
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = path.join(ROOT, 'Logo', 'Nexunova logos', 'NexuNova_Icon_512px.png');
(async () => {
  const b64 = fs.readFileSync(SRC).toString('base64');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<img id="s" src="data:image/png;base64,' + b64 + '">');
  await page.waitForSelector('#s');
  for (const sz of [64, 180]) {
    const dataUrl = await page.evaluate((size) => {
      const img = document.getElementById('s');
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    }, sz);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const out = path.join(ROOT, 'assets', 'favicon-' + sz + '.png');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
