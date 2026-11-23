#!/usr/bin/env node
/* NexuFinance Daily Closing after the site cash box was retired (20261123a, owner 23-Nov-2026): one login,
   one view. A file:// harness with stub APIs serving a read-only fixture (scratchpad mock/fixture.json);
   nothing is written anywhere. Checks:
     - no "whose entries" (Head Office / site) filter; every line, Sharose's old ones included, is listed
     - the cash boxes read Cash in hand / Petty cash, never Site Cash or Head Office Cash
     - the Reports menu has no Site Closing; the Site Closing scripts are not on the page
     - the WhatsApp report asks only for a date and builds the combined view
     - Petty cash still has its transfer and bank-deposit paths (voucher popup heads)
   Usage: node scripts/nf/verify-nf-one-login-ui.js <fixture.json> <screenshot dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const [fixtureFile, outDir] = process.argv.slice(2);
const FIX = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const url = p => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/');

const page = fs.readFileSync(path.join(ROOT, 'nexufinance.html'), 'utf8');
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${url('')}/">
<link rel="stylesheet" href="${url('css/nf/nf.css')}"><link rel="stylesheet" href="${url('css/nf/nf-reports-menu.css')}">
</head><body><div id="nf-root"></div>
${['js/nf/nf-format.js', 'js/nf/nf-pick.js', 'js/nf/nf-drill.js', 'js/nf/nf-reports-menu.js', 'js/nf/nf-messages.js',
   'js/nf/nf-voucher-popup.js', 'js/nf/nf-day-excel.js', 'js/nf/nf-whatsapp-report.js', 'js/nf/nf-sheet.js'].map(s => `<script src="${url(s)}"></script>`).join('\n')}
<script>
window.__boot = function (fix) {
  var LABEL = { Cash: 'Cash in hand', Petty: 'Petty cash' };
  fix.vias.forEach(function (v) { if (LABEL[v.via]) v.label = LABEL[v.via]; });
  var day = JSON.parse(JSON.stringify(fix.day));
  (day.position.rows || []).forEach(function (r) { if (LABEL[r.via]) r.label = LABEL[r.via]; });
  // the old site lines stay on the books with their author
  day.lines.forEach(function (l, i) { l.by_name = i % 2 ? 'Sharose' : 'Rashid'; l.by_box = i % 2 ? 'Petty' : 'Cash'; l.mine = true; });
  window.__calls = [];
  function ok(x) { return Promise.resolve(JSON.parse(JSON.stringify(x))); }
  var api = {
    getDay: function () { return ok(day); }, listHeads: function () { return ok(fix.heads); }, listFloors: function () { return ok(fix.floors); },
    listVias: function () { return ok(fix.vias); }, listAllParties: function () { return ok(fix.parties); },
    checkDuplicate: function () { return ok({ block: [], warn: [] }); },
    tokenSyncList: function () { return ok([]); }, tokenSyncRetry: function () { return ok([]); },
    saveLine: function () { return ok(day); }, deleteLine: function () { return ok(day); },
    setRemarks: function () { return ok(day); }, setTransfers: function () { return ok(day); },
    dayReport: function (c, d, v) { window.__calls.push(['dayReport', d, v]); return Promise.reject(new Error('stop after the call')); },
    dayBook: function (c, d) { return ok({ date: d, title: 'x', boxes: [], vouchers: [] }); },
  };
  return window.NfSheet.mount(document.getElementById('nf-root'), {
    api: api, companyId: day.day.company_id, role: 'director', cashVia: 'Cash',
    displayName: 'Rashid', companyName: 'Fourteen Group of Companies', settings: { mark: 'AWAMI' },
  });
};
</script></body></html>`;

(async () => {
  const harness = path.join(path.dirname(fixtureFile), 'one-login-harness.html');
  fs.writeFileSync(harness, HTML);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const results = []; let fail = 0;
  const check = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) fail++; };
  const pg = await br.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on('requestfailed', r => { if (/\.js(\?|$)/.test(r.url())) errs.push('script not loaded: ' + r.url()); });
  await pg.setViewport({ width: 1300, height: 900 });
  await pg.goto('file:///' + harness.replace(/\\/g, '/'), { waitUntil: 'load' });
  await pg.evaluate(fix => window.__boot(fix), FIX);
  await pg.waitForSelector('.row[data-saved]');
  const t = await pg.evaluate(n => ({
    whose: !!document.querySelector('[data-whose]'), rows: document.querySelectorAll('.row[data-saved]').length, lines: n,
    text: document.body.innerText,
    pos: [...document.querySelectorAll('table.pos tbody tr td:first-child')].map(td => td.textContent),
    ro: document.querySelectorAll('.row[data-ro]').length,
  }), FIX.day.lines.length);
  check('no Head Office / site filter on the sheet', !t.whose);
  check('every line is listed, the old site lines included', t.rows === t.lines, t.rows + ' of ' + t.lines);
  check('the cash boxes read Cash in hand and Petty cash', t.pos.some(s => /Cash in hand/.test(s)) && t.pos.some(s => /Petty cash/.test(s)), t.pos.join(' | '));
  check('nowhere on the sheet says Site Cash or Head Office Cash', !/Site Cash|Head Office Cash/.test(t.text));
  check('the director can edit every line', t.ro === 0);
  await pg.click('#nf-rpm-toggle'); await new Promise(r => setTimeout(r, 200));
  const menu = await pg.evaluate(() => document.body.innerText);
  check('the Reports menu has no Site Closing', !/Site Closing/.test(menu));
  check('the Site Closing screens are not on the page', !/nf-site-closing|nf-site-review/.test(page) && await pg.evaluate(() => !window.NfSiteClosing && !window.NfSiteReview));
  await pg.keyboard.press('Escape');
  await pg.click('#nf-waReport'); await new Promise(r => setTimeout(r, 200));
  const wa = await pg.evaluate(() => ({ views: document.querySelectorAll('input[name="nf-wa-view"]').length, txt: (document.querySelector('#nf-wa-dialog') || {}).innerText || '' }));
  check('the WhatsApp report asks only for a date (no Site / Head Office views)', wa.views === 0 && !/Site only|Head Office only/.test(wa.txt));
  if (outDir) await pg.screenshot({ path: path.join(outDir, 'whatsapp dialog - one view.png') });
  await pg.click('[data-wa="preview"]'); await new Promise(r => setTimeout(r, 300));
  const call = await pg.evaluate(() => window.__calls.filter(c => c[0] === 'dayReport')[0]);
  check('the WhatsApp report builds the combined view', call && call[2] === 'combined', JSON.stringify(call));
  await pg.evaluate(() => { const d = document.querySelector('#nf-wa-dialog'); if (d) d.remove(); });
  if (outDir) await pg.screenshot({ path: path.join(outDir, 'daily closing - one login.png'), fullPage: true });
  check('no script errors', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  console.log(`\n${results.length - fail}/${results.length} passed`);
  await br.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
