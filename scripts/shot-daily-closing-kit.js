#!/usr/bin/env node
/**
 * Daily Closing — screenshots of the Ledger kit.
 *
 *   node scripts/shot-daily-closing-kit.js
 *
 * Serves the working tree, opens daily-closing-kit.html at 375 px and 1280 px
 * in light and dark, and writes full-page PNGs to docs/daily-closing/design/.
 *
 * It uses ?preview=1, which renders the kit from sample data without a session.
 * Nothing on the page is real, so no tenant row is read to take a picture of a
 * component gallery.
 *
 * Same Chrome + puppeteer-core resolution as scripts/smoke-pages.js. If neither
 * is present this SKIPS with exit 0 — and says so, because a silent skip that
 * looks like a pass is the thing this whole session has been hunting.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'daily-closing', 'design');
const PORT = 4471;
const MISSED = [];   // paths the page asked for that this server does not have

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }

if (!puppeteer || !CHROME) {
  console.log('[shot-daily-closing-kit] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  No screenshots were written. This is a skip, not a pass.');
  process.exit(0);
}

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
               '.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = decodeURIComponent(q.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'daily-closing-kit.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        // Name what was missing. "a 404" tells you nothing; "/favicon.ico"
        // tells you whether it matters.
        MISSED.push(p);
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

const SHOTS = [
  { name: 'kit-1280-light', width: 1280, height: 900, theme: 'light' },
  { name: 'kit-1280-dark',  width: 1280, height: 900, theme: 'dark'  },
  { name: 'kit-375-light',  width: 375,  height: 812, theme: 'light' },
  { name: 'kit-375-dark',   width: 375,  height: 812, theme: 'dark'  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'] });
  let errors = [];
  try {
    for (const s of SHOTS) {
      const page = await browser.newPage();
      page.on('pageerror', e => errors.push(`${s.name}: ${e.message}`));
      // A 404 surfaces here only as a bare "Failed to load resource" with no
      // path. The path is collected server-side instead and judged below —
      // the browser asks for /favicon.ico unprompted, and that is not a defect.
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
          errors.push(`${s.name}: ${m.text()}`);
        }
      });
      await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 2 });
      await page.goto(`http://127.0.0.1:${PORT}/daily-closing-kit.html?preview=1`,
        { waitUntil: 'networkidle2' });
      if (s.theme === 'dark') {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      }
      // let the webfont settle so the tabular figures measure correctly
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise(r => setTimeout(r, 400));

      const visible = await page.evaluate(() => !document.getElementById('kit').hidden);
      if (!visible) errors.push(`${s.name}: the kit did not render`);

      const file = path.join(OUT, s.name + '.png');
      await page.screenshot({ path: file, fullPage: true });
      const kb = Math.round(fs.statSync(file).size / 1024);
      console.log(`  ${s.name.padEnd(18)} ${String(s.width).padStart(4)}px  ${String(kb).padStart(5)} KB`);
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }

  const realMisses = [...new Set(MISSED)].filter(p => p !== '/favicon.ico');
  if (realMisses.length) errors.push('missing files: ' + realMisses.join(', '));
  else if (MISSED.length) console.log('  (the browser asked for /favicon.ico on its own; the page needs none)');

  if (errors.length) {
    console.log('\n❌ console/page errors while rendering:');
    errors.forEach(e => console.log('   ' + e));
    process.exitCode = 1;
    return;
  }
  console.log(`\n✅ ${SHOTS.length} screenshots written to docs/daily-closing/design/, no console errors.`);
})();
