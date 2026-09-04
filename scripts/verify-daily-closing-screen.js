#!/usr/bin/env node
/**
 * Daily Closing — P6 verification: the S1 Day Workspace, in a real browser.
 *
 *   node scripts/verify-daily-closing-screen.js
 *
 * Drives daily-closing.html?stub=1 with Chrome. The database is replaced by
 * js/pages/daily-closing-stub.js, so a failure here means the SCREEN is wrong
 * — not that a row moved overnight or that nobody is signed in. The RPC
 * contract itself is proved by the P3 and P4 suites against the live schema.
 *
 * It clicks and types like a person: no calling the render functions directly.
 * The unit map once worked for six commits while being unreachable, and every
 * test drove it directly (scripts/verify-team-report.js says so at more
 * length). Nothing here writes to any database.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4473;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core',
  { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }

if (!puppeteer || !CHROME) {
  console.log('[verify-daily-closing-screen] SKIPPED — puppeteer-core or Chrome not found.');
  console.log('  Nothing was verified. This is a skip, not a pass.');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const is  = (got, want, what) => got === want ? ok(`${what}`)
  : bad(`${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const head = t => console.log('\n── ' + t);

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = decodeURIComponent(q.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'daily-closing.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}

const url = state => `http://127.0.0.1:${PORT}/daily-closing.html?stub=1&state=${state}`;

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'] });
  const errors = [];

  async function open(state, width = 1280) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(`${state}: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        errors.push(`${state}: ${m.text()}`);
      }
    });
    await page.setViewport({ width, height: 900 });
    await page.goto(url(state), { waitUntil: 'networkidle2' });
    await page.waitForSelector('.dc', { timeout: 8000 });
    return page;
  }

  try {
    // ═══ VOUCHER DERIVATION ════════════════════════════════════════════
    head('the voucher chip is derived, live, from mode + direction');
    {
      const page = await open('open');
      await page.waitForSelector('#dc-chip', { timeout: 8000 });
      is(await page.$eval('#dc-chip', e => e.textContent.trim()), 'CRV',
        'CASH + IN shows CRV on load');

      // click, like a person — not by calling the binder
      await page.click('#dc-dir button[data-value="OUT"]');
      is(await page.$eval('#dc-chip', e => e.textContent.trim()), 'CPV', 'CASH + OUT → CPV');

      await page.click('#dc-mode button[data-value="BANK"]');
      is(await page.$eval('#dc-chip', e => e.textContent.trim()), 'BPV', 'BANK + OUT → BPV');

      await page.click('#dc-dir button[data-value="IN"]');
      is(await page.$eval('#dc-chip', e => e.textContent.trim()), 'BRV', 'BANK + IN → BRV');

      // §A11: ← and → move between options
      await page.focus('#dc-mode button[aria-selected="true"]');
      await page.keyboard.press('ArrowLeft');
      is(await page.$eval('#dc-mode button[aria-selected="true"]', e => e.dataset.value),
        'CASH', 'ArrowLeft moves the segmented control');
      is(await page.$eval('#dc-chip', e => e.textContent.trim()), 'CRV',
        'and the chip follows the keyboard, not just the mouse');
      await page.close();
    }

    // ═══ OVERRIDE REASON REVEAL ════════════════════════════════════════
    head('the override reason appears only when the head leaves its default');
    {
      const page = await open('open');
      const shown = () => page.$eval('#dc-qb-ovr', e => e.classList.contains('dc-open'));
      is(await shown(), false, 'hidden while the default 2020 is selected');
      is(await page.$eval('#dc-qb', e => e.value), 'acc-2020',
        'CLIENT_RECEIPT defaults to 2020 Advance from Customers');

      await page.select('#dc-qb', 'acc-6050');
      is(await shown(), true, 'revealed the moment a different head is chosen');
      is(await page.$eval('#dc-qb-reason', e => e.required), true, 'and the reason is required');

      await page.select('#dc-qb', 'acc-2020');
      is(await shown(), false, 'hidden again on returning to the default');
      is(await page.$eval('#dc-qb-reason', e => e.value), '',
        'and the abandoned reason is cleared, not left to be submitted');
      await page.close();
    }

    // ═══ DUPLICATE_VOUCHER INLINE ══════════════════════════════════════
    head('a §A9 error lands under the field it belongs to');
    {
      const page = await open('open');
      await page.evaluate(() => window.__dcStub.scriptNext({
        success: false, error: 'DUPLICATE_VOUCHER',
        message: 'CRV 0041 was already used on 2026-09-03.',
        conflicting_date: '2026-09-03'
      }));
      await page.type('#dc-voucher-no', '0041');
      await page.type('#dc-amount', '150000');
      await page.click('#dc-save');
      await page.waitForFunction(() => !document.getElementById('dc-voucher-no-err').hidden,
        { timeout: 5000 });
      const msg = await page.$eval('#dc-voucher-no-err', e => e.textContent);
      msg.includes('already used')
        ? ok('DUPLICATE_VOUCHER shows under Voucher #, with the conflicting date')
        : bad(`the message was ${JSON.stringify(msg)}`);
      is(await page.$eval('#dc-voucher-no', e => e.closest('.dc-field') !== null &&
           e.closest('.dc-field').classList.contains('dc-field--error')), true,
        'and the field is marked in error');
      is(await page.evaluate(() => document.activeElement.id), 'dc-voucher-no',
        'and focus moves to it, so the fix needs no hunting');
      await page.close();
    }

    // ═══ IDEMPOTENCY KEY REUSE ═════════════════════════════════════════
    head('the idempotency key is generated once and REUSED on retry');
    {
      const page = await open('open');
      await page.evaluate(() => window.__dcStub.scriptNext({
        success: false, error: 'DUPLICATE_VOUCHER', message: 'already used' }));
      await page.type('#dc-voucher-no', '0041');
      await page.type('#dc-amount', '100');
      await page.click('#dc-save');
      await page.waitForFunction(() => !document.getElementById('dc-voucher-no-err').hidden);
      await page.click('#dc-save');   // press Save again, as a person would
      await page.waitForFunction(() =>
        window.__dcStub.calls.filter(c => c.name === 'record_cash_entry').length >= 2);
      const keys = await page.evaluate(() => window.__dcStub.calls
        .filter(c => c.name === 'record_cash_entry').map(c => c.args.p_idempotency_key));
      is(keys.length >= 2, true, 'two save attempts were sent');
      is(keys[0] === keys[1], true,
        'both carried the SAME key — a retry cannot become a second entry');
      is(/^[0-9a-f-]{36}$/i.test(keys[0]), true, 'and it is a uuid');
      await page.close();
    }

    // ═══ NOT OPENED → OPEN ═════════════════════════════════════════════
    head('not-opened → open day');
    {
      const page = await open('notopened');
      const empty = await page.$eval('.dc-empty p', e => e.textContent);
      empty.includes('No day open') ? ok(`empty state reads “${empty}”`)
                                    : bad(`empty state reads “${empty}”`);
      is(await page.$('#dc-form'), null, 'no composer is offered before a day exists');
      await page.click('#dc-open');
      await page.waitForSelector('#dc-form', { timeout: 5000 });
      ok('clicking Open day calls open_cash_day and the composer appears');
      is(await page.evaluate(() =>
        window.__dcStub.calls.some(c => c.name === 'open_cash_day')), true,
        'and the RPC really was called');
      await page.close();
    }

    // ═══ SETUP_OPENING_REQUIRED ════════════════════════════════════════
    head('SETUP_OPENING_REQUIRED offers the CFO the opening dialog');
    {
      const page = await open('needsopening');
      await page.click('#dc-open');
      await page.waitForSelector('.dc-modal', { timeout: 6000 });
      ok('SETUP_OPENING_REQUIRED opens the module dialog, not window.prompt');
      const inputs = await page.$$('.dc-modal .dc-money-input input');
      is(inputs.length, 2, 'with two money fields — cash and bank');

      // submit empty: it must refuse rather than send nulls
      await page.click('.dc-modal button[type=submit]');
      is(await page.$eval('.dc-modal .dc-error', e => !e.hidden), true,
        'and it refuses an empty submit instead of sending nothing');
      is(await page.evaluate(() =>
        window.__dcStub.calls.some(c => c.name === 'setup_cash_opening')), false,
        'nothing was sent on that empty submit');

      await inputs[0].type('17723');
      await inputs[1].type('1000');
      await page.click('.dc-modal button[type=submit]');
      await page.waitForFunction(() =>
        window.__dcStub.calls.some(c => c.name === 'setup_cash_opening'), { timeout: 6000 });
      const sent = await page.evaluate(() => window.__dcStub.calls
        .find(c => c.name === 'setup_cash_opening').args);
      is(sent.p_cash, 17723, 'the cash figure reached the server as a number');
      is(sent.p_bank, 1000, 'and so did the bank figure');
      await page.close();
    }

    // ═══ CLOSED STATE ══════════════════════════════════════════════════
    head('a closed day is read-only, with its adjustments and their reasons');
    {
      const page = await open('closed');
      is(await page.$('#dc-form'), null, 'the composer is gone');
      is(!!(await page.$('.dc-lockbadge')), true, 'a lock badge says when it closed');
      is(!!(await page.$('#dc-adjust')), true, 'the CFO is offered Add adjustment');
      is(await page.$eval('#dc-pdf', e => e.disabled), true,
        'Director PDF is present but disabled until P7');
      const reason = await page.$eval('.dc-adj-reason', e => e.textContent);
      reason.includes('short by 3')
        ? ok(`the adjustment carries its reason — “${reason}”`)
        : bad(`the adjustment reason was “${reason}”`);
      is(await page.$('#dc-void'), null, 'and nothing can be voided on a closed day');
      await page.close();
    }

    // ═══ THE LEDGER, AND WHAT IT NEVER OFFERS ══════════════════════════
    head('the ledger, and the two things it must never offer');
    {
      const page = await open('open');
      is(await page.$$eval('.dc-ledger tbody tr', r => r.length), 5, 'five rows listed');
      is(await page.$$eval('.dc-ledger tbody tr.dc-voided', r => r.length), 1,
        'the voided row is dimmed');
      is(!!(await page.$('.dc-ledger tbody tr.dc-voided a.dc-link')), true,
        'and links to its reversal');
      const totals = await page.$$eval('.dc-ledger tfoot td.dc-num', t => t.map(x => x.textContent.trim()));
      is(totals[0], '200,500', 'In total');
      is(totals[1], '77,500',  'Out total');

      const body = await page.$eval('.dc', e => e.textContent.toLowerCase());
      is(/\bedit\b/.test(body), false, 'the word "edit" appears nowhere — invariant 1');
      is(/\bdelete\b/.test(body), false, 'nor "delete"');
      is(!!(await page.$('#dc-void')), true, 'voiding is the only way back, and it is offered');
      await page.close();
    }

    // ═══ TOAST BURST COLLAPSING ════════════════════════════════════════
    head('a burst of saves collapses into one toast');
    {
      const page = await open('open');
      await page.evaluate(() => {
        window.DCKit.toast('CRV-0041 recorded', { collapse: 'entry',
          plural: n => n + ' entries recorded' });
        window.DCKit.toast('CRV-0042 recorded', { collapse: 'entry',
          plural: n => n + ' entries recorded' });
        window.DCKit.toast('CRV-0043 recorded', { collapse: 'entry',
          plural: n => n + ' entries recorded' });
      });
      is(await page.$$eval('.dc-toast', t => t.length), 1, 'three saves, one toast');
      is(await page.$eval('.dc-toast', t => t.textContent), '3 entries recorded',
        'and it counts up rather than repeating itself');
      await page.evaluate(() => window.DCKit.toast('Could not reach the server'));
      is(await page.$$eval('.dc-toast', t => t.length), 2,
        'a different message still gets its own line');
      await page.close();
    }

    // ═══ RESPONSIVE ════════════════════════════════════════════════════
    head('layout');
    {
      const wide = await open('open', 1280);
      is(await wide.$eval('.dc-2col', e => getComputedStyle(e).gridTemplateColumns.split(' ').length),
        2, 'two columns at 1280');
      is(await wide.$eval('.dc-sticky-totals', e => getComputedStyle(e).display), 'none',
        'and no second totals bar, because the ledger already has one');
      await wide.close();

      const narrow = await open('open', 375);
      is(await narrow.$eval('.dc-2col', e => getComputedStyle(e).gridTemplateColumns.split(' ').length),
        1, 'one column at 375');
      is(await narrow.$eval('.dc-sticky-totals', e => getComputedStyle(e).position), 'sticky',
        'with the totals pinned to the bottom');
      await narrow.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }

  if (errors.length) {
    console.log('\n── console/page errors');
    errors.forEach(e => bad(e));
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(fail === 0 ? `✅ PASS  (${pass} assertions, 0 failed)`
                         : `❌ FAIL  (${pass} passed, ${fail} failed)`);
  if (fail) process.exitCode = 1;
})();
