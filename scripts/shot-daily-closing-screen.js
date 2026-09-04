#!/usr/bin/env node
/**
 * Daily Closing — screenshots of S1 in each of its three states.
 *
 *   node scripts/shot-daily-closing-screen.js
 *
 * Three states × two widths → docs/daily-closing/design/. Driven through
 * ?stub=1, so the pictures are of the SCREEN and not of whatever the database
 * happened to hold this morning.
 *
 * Skips loudly if Chrome or puppeteer-core is missing, rather than exiting
 * green and looking like a pass.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'daily-closing', 'design');
const PORT = 4474;
const MISSED = [];

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) {
  console.log('[shot-daily-closing-screen] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  No screenshots were written. This is a skip, not a pass.');
  process.exit(0);
}

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = decodeURIComponent(q.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'daily-closing.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        MISSED.push(p); r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

/* `prep` runs in the page after it has loaded, so a screenshot can show a
   state that only exists after an interaction — the close panel, the row
   menu. It clicks the same things a person would. */
const STATES = [
  { state: 'notopened', label: 'notopened' },
  { state: 'open',      label: 'open' },
  { state: 'closed',    label: 'closed' },
  {
    state: 'open', label: 'closepanel', wait: '#dc-counted',
    prep: async page => {
      await page.click('#dc-close');
      await page.waitForSelector('#dc-counted', { timeout: 8000 });
      await page.type('#dc-den-5000', '18');
      await page.type('#dc-var-r', 'cashier short, recovering tomorrow');
    }
  },
  {
    state: 'open', label: 'rowmenu', wait: '[role="menu"]:not([hidden])',
    prep: async page => {
      await page.click('.dc-ledger tbody tr:first-child [data-menu-btn]');
      await page.waitForSelector('.dc-ledger [role="menu"]:not([hidden])', { timeout: 8000 });
    }
  },
  {
    state: 'open', label: 'days', wait: '.dc-days tbody tr',
    prep: async page => {
      await page.click('#dc-view-days');
      await page.waitForSelector('.dc-days tbody tr', { timeout: 8000 });
    }
  },
  // P8 — the audit tab, and the same day seen by a Director who may not write.
  { state: 'closed', label: 'audit', role: 'CFO', full: true,
    prep: async page => {
      await page.click('#dc-view-audit');
      await page.waitForSelector('.dc-audit-row', { timeout: 8000 });
    }
  },
  { state: 'open', label: 'director', role: 'DIRECTOR', full: true }
];
const WIDTHS = [{ w: 1280, h: 900 }, { w: 375, h: 812 }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'] });
  const errors = [];
  try {
    for (const s of STATES) {
      for (const v of WIDTHS) {
        const page = await browser.newPage();
        page.on('pageerror', e => errors.push(`${s.label}/${v.w}: ${e.message}`));
        page.on('console', m => {
          if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
            errors.push(`${s.label}/${v.w}: ${m.text()}`);
          }
        });
        await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 2 });
        await page.goto(`http://127.0.0.1:${PORT}/daily-closing.html?stub=1&state=${s.state}`
          + (s.role ? `&role=${s.role}` : ''),
          { waitUntil: 'networkidle2' });
        await page.waitForSelector('.dc-band', { timeout: 8000 });
        if (s.prep) await s.prep(page);
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await new Promise(r => setTimeout(r, 350));

        const name = `s1-${s.label}-${v.w}`;
        const file = path.join(OUT, name + '.png');
        // A panel is fixed to the viewport; fullPage would photograph the page
        // scrolled past it and lose the thing being shown.
        // A panel or a popover is fixed to the viewport, so fullPage would
        // photograph the page scrolled past it. A view that is just a longer
        // page (audit, director) still wants the whole thing.
        await page.screenshot({ path: file, fullPage: !s.prep || !!s.full });
        console.log(`  ${name.padEnd(22)} ${String(Math.round(fs.statSync(file).size/1024)).padStart(5)} KB`);
        await page.close();
      }
    }
  } finally { await browser.close(); srv.close(); }

  const real = [...new Set(MISSED)].filter(p => p !== '/favicon.ico');
  if (real.length) errors.push('missing files: ' + real.join(', '));

  if (errors.length) {
    console.log('\n❌ errors while rendering:');
    errors.forEach(e => console.log('   ' + e));
    process.exitCode = 1;
    return;
  }
  console.log(`\n✅ ${STATES.length * WIDTHS.length} screenshots written, no console errors.`);
})();
