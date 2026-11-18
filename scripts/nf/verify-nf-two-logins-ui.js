#!/usr/bin/env node
/* Browser check of the "one closing, two logins" Daily Closing screen (docs/PLAN.md §49), with NO database
   writes: the real NexuFinance scripts and CSS are loaded into a harness page, and the API is a stand-in
   that serves a fixture (a read-only copy of a real day, plus the fields migration 20261118i adds: who
   entered each line, his cash box, "mine", and the cash box labels).
   Checks the head office (director) view and the site (accountant on Petty) view, desktop and phone,
   and saves screenshots.
   Usage: node scripts/nf/verify-nf-two-logins-ui.js <fixture.json> <screenshot dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const [fixtureFile, outDir] = process.argv.slice(2);
const FIX = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const url = p => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${url('css/nf/nf.css')}"><link rel="stylesheet" href="${url('css/nf/nf-reports-menu.css')}">
</head><body><div id="nf-root"></div>
${['js/nf/nf-format.js', 'js/nf/nf-pick.js', 'js/nf/nf-drill.js', 'js/nf/nf-reports-menu.js', 'js/nf/nf-messages.js',
   'js/nf/nf-voucher-popup.js', 'js/nf/nf-day-excel.js', 'js/nf/nf-sheet.js', 'node_modules/xlsx/dist/xlsx.full.min.js'].map(s => `<script src="${url(s)}"></script>`).join('\n')}
<script>
window.__boot = function (fix, as) {
  var site = as === 'site';
  var LABEL = { Cash: 'Head Office Cash', Petty: 'Site Cash' };
  fix.vias.forEach(function (v) { if (LABEL[v.via]) v.label = LABEL[v.via]; });
  var day = JSON.parse(JSON.stringify(fix.day));
  (day.position.rows || []).forEach(function (r) { if (LABEL[r.via]) r.label = LABEL[r.via]; });
  day.lines.forEach(function (l) { l.by_name = 'Sharose'; l.by_box = 'Petty'; l.mine = site; });
  // one head office line, so both kinds are on the page
  day.lines.push({ id: 'ho-line-1', side: 'OUT', voucher_no: 'CPV-000240', manual_no: 'CPV-0173', number_pending: false,
    description: 'Tea for the CFO meeting', head_code: '60400', head_name: 'Events & Client Entertainment', floor_code: 'P-W',
    via: 'Cash', amount: 1200, sort: 99, version: 1, party_id: null, party_name: null, voucher_id: 'ho-v-1',
    by_name: 'Rashid', by_box: 'Cash', mine: !site });
  window.__calls = [];
  function ok(x) { return Promise.resolve(JSON.parse(JSON.stringify(x))); }
  var api = {
    getDay: function () { return ok(day); }, listHeads: function () { return ok(fix.heads); }, listFloors: function () { return ok(fix.floors); },
    listVias: function () { return ok(fix.vias); }, listAllParties: function () { return ok(fix.parties); },
    saveLine: function () { window.__calls.push(['saveLine'].concat([].slice.call(arguments))); return ok(day); },
    deleteLine: function () { window.__calls.push(['deleteLine'].concat([].slice.call(arguments))); return ok(day); },
    setRemarks: function () { return ok(day); }, setTransfers: function () { return ok(day); },
    dayBook: function (c, d) { window.__calls.push(['dayBook', d]); return ok({ date: d, title: 'AWAMI MARKET KARKHANO — DAILY CASH & BANK BOOK', boxes: [], vouchers: [] }); },
  };
  return window.NfSheet.mount(document.getElementById('nf-root'), {
    api: api, companyId: day.day.company_id, role: site ? 'accountant' : 'director', cashVia: site ? 'Petty' : 'Cash',
    displayName: site ? 'Sharose' : 'Rashid', companyName: 'Fourteen Group of Companies', settings: { mark: 'AWAMI', company_line: 'Fourteen Group of Companies · Awami Market, Karkhano, Peshawar' },
  });
};
</script></body></html>`;

(async () => {
  const harness = path.join(path.dirname(fixtureFile), 'two-logins-harness.html');
  fs.writeFileSync(harness, HTML);
  fs.mkdirSync(outDir, { recursive: true });
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const results = []; let fail = 0; const missing = new Set();
  const check = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) fail++; };
  async function open(as, width) {
    const pg = await br.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
    // a file:// harness has no web root: a missing image or font is reported, a missing SCRIPT fails
    pg.on('requestfailed', r => { if (/\.js(\?|$)/.test(r.url())) errs.push('script not loaded: ' + r.url()); else missing.add(r.url().replace(/^.*nexunova-rms/, '')); });
    await pg.setViewport({ width, height: 900, deviceScaleFactor: width < 600 ? 2 : 1.25 });
    await pg.goto('file:///' + harness.replace(/\\/g, '/'), { waitUntil: 'load' });
    await pg.evaluate((fix, as) => window.__boot(fix, as), FIX, as);
    await pg.waitForSelector('.row[data-saved]');
    return { pg, errs };
  }
  const q = (pg, fn, ...a) => pg.evaluate(fn, ...a);

  // ── head office (director), desktop ──
  {
    const { pg, errs } = await open('ho', 1300);
    const t = await q(pg, () => ({
      who: (document.querySelector('.nf-who') || {}).textContent,
      reports: !!document.querySelector('#nf-rpm-toggle'), dir: !!document.querySelector('#nf-toDir'),
      pos: [...document.querySelectorAll('table.pos tbody tr td:first-child')].map(td => td.textContent),
      tags: [...document.querySelectorAll('.nf-by')].map(x => x.textContent),
      ro: document.querySelectorAll('.row[data-ro]').length, close: !!document.querySelector('#nf-close'),
      tri: !!document.querySelector('#nf-tPetty'), triLabel: (document.querySelector('#nf-tPetty') || { closest: () => null }).closest('tr') ? document.querySelector('#nf-tPetty').closest('tr').textContent : '',
      rows: document.querySelectorAll('.row[data-saved]').length,
    }));
    check('HO: signed-in chip says Rashid', /Rashid/.test(t.who || ''), t.who);
    check('HO: Reports menu and Director report are there', t.reports && t.dir);
    check('HO: position rows are Head Office Cash / Site Cash / bank', t.pos.some(s => /Head Office Cash/.test(s)) && t.pos.some(s => /Site Cash/.test(s)), t.pos.join(' | '));
    check('HO: every line names who entered it', t.tags.length === t.rows && t.tags.includes('Head Office') && t.tags.includes('Sharose'), t.tags.join(','));
    check('HO (director): no line is read-only, no lock', t.ro === 0 && !t.tags.some(s => /🔒/.test(s)));
    check('HO: Close day is there', t.close);
    check('HO: transfer reads "Head Office Cash given to Site Cash"', /Head Office Cash given to Site Cash/.test(t.triLabel), t.triLabel.trim());
    await pg.screenshot({ path: path.join(outDir, '3 Head Office - real screen.png'), fullPage: true });
    await pg.click('[data-whose="site"]');
    const nSite = await q(pg, () => document.querySelectorAll('.row[data-saved]').length);
    await pg.click('[data-whose="ho"]');
    const nHo = await q(pg, () => document.querySelectorAll('.row[data-saved]').length);
    await pg.click('[data-whose="all"]');
    check('HO: filter shows only Sharose / only Head Office lines', nSite === 5 && nHo === 1, 'site ' + nSite + ', ho ' + nHo);
    await pg.click('[data-vtype="CPV"]');
    await pg.waitForSelector('.vp-seg');
    const opts = await q(pg, () => [...document.querySelectorAll('.vp-seg [data-via]')].map(b => b.textContent));
    check('HO (director): the cash payment popup offers both cash boxes', opts.length === 2, opts.join(','));
    await pg.keyboard.press('Escape'); await pg.evaluate(() => { const b = document.querySelector('.nf-dialog-backdrop, .vp-backdrop'); if (b) b.remove(); });
    await pg.evaluate(() => { window.__saved = null; window.XLSX.writeFile = function (wb, name) { window.__saved = { name: name, tabs: wb.SheetNames }; }; });
    const hasX = await q(pg, () => !!document.querySelector('#nf-dayXlsx'));
    check('HO (director): Excel button next to Director report', hasX);
    if (hasX) {
      await pg.click('#nf-dayXlsx'); await pg.waitForSelector('#nf-xlsx-go');
      await pg.evaluate(() => { document.querySelector('#nf-xlsx-date').value = '2026-11-16'; });
      await pg.click('#nf-xlsx-go'); await new Promise(r => setTimeout(r, 400));
      const saved = await q(pg, () => window.__saved);
      check('HO: Download makes "AWAMI MARKET KARKHANO 16-Nov-2026.xlsx" with tab 16-Nov', saved && saved.name === 'AWAMI MARKET KARKHANO 16-Nov-2026.xlsx' && saved.tabs[0] === '16-Nov', JSON.stringify(saved));
    }
    check('HO: no script errors', errs.length === 0, errs.join(' / '));
    await pg.close();
  }
  // ── site (Sharose), desktop and phone ──
  for (const width of [1300, 390]) {
    const { pg, errs } = await open('site', width);
    const t = await q(pg, () => {
      const ho = document.querySelector('.row[data-id="ho-line-1"]');
      const own = document.querySelector('.row[data-saved]:not([data-ro])');
      return {
        who: (document.querySelector('.nf-who') || {}).textContent,
        reports: !!document.querySelector('#nf-rpm-toggle'), dir: !!document.querySelector('#nf-toDir'), xlsx: !!document.querySelector('#nf-dayXlsx'),
        close: !!document.querySelector('#nf-close'), submit: !!document.querySelector('#nf-submit'),
        tri: !!document.querySelector('#nf-tPetty'), pdc: !!document.querySelector('#nf-pdcIn'),
        hoRo: !!(ho && ho.hasAttribute('data-ro')), hoInputsOff: ho ? [...ho.querySelectorAll('input,select')].every(x => x.disabled) : false,
        hoDel: ho ? !!ho.querySelector('[data-del-saved]') : true, hoTag: ho ? (ho.querySelector('.nf-by') || {}).textContent : '',
        ownEditable: own ? !own.querySelector('input.amt').disabled : false, ownDel: own ? !!own.querySelector('[data-del-saved]') : false,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    const tag = width < 600 ? 'phone' : 'desktop';
    check(`Site ${tag}: signed-in chip says Sharose · Site Cash`, /Sharose · Site Cash/.test(t.who || ''), t.who);
    check(`Site ${tag}: no Reports menu, no Director report, no Excel button`, !t.reports && !t.dir && !t.xlsx);
    check(`Site ${tag}: no Submit / Close, no transfers, no PDCs`, !t.close && !t.submit && !t.tri && !t.pdc);
    check(`Site ${tag}: head office line is locked (all fields off, no delete, 🔒 tag)`, t.hoRo && t.hoInputsOff && !t.hoDel && /🔒/.test(t.hoTag), t.hoTag);
    check(`Site ${tag}: his own lines stay editable with delete`, t.ownEditable && t.ownDel);
    if (width < 600) check('Site phone: nothing wider than the screen', t.overflow <= 1, 'overflow ' + t.overflow + 'px');
    if (width > 600) {
      await pg.click('[data-vtype="CPV"]');
      await pg.waitForSelector('.vp-seg');
      const opts = await q(pg, () => [...document.querySelectorAll('.vp-seg [data-via]')].map(b => b.getAttribute('data-via') + ':' + b.textContent));
      check('Site: the cash payment popup offers only Site Cash', opts.length === 1 && opts[0] === 'Petty:Site Cash', opts.join(','));
      await pg.keyboard.press('Escape');
      await pg.evaluate(() => { const b = document.querySelector('.nf-dialog-backdrop, .vp-backdrop'); if (b) b.remove(); });
      const via = await q(pg, () => { const own = document.querySelector('.row[data-saved]:not([data-ro]) select[data-k="m"]'); return [...own.options].map(o => o.value + ':' + o.textContent); });
      check('Site: a saved cash line can only be on Site Cash', via.length === 1 && via[0] === 'Petty:Site Cash', via.join(','));
    }
    await pg.screenshot({ path: path.join(outDir, (width < 600 ? '5 Sharose - real screen, phone.png' : '4 Sharose - real screen.png')), fullPage: true });
    check(`Site ${tag}: no script errors`, errs.length === 0, errs.join(' / '));
    await pg.close();
  }
  await br.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
