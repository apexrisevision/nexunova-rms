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

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${url('')}/">
<link rel="stylesheet" href="${url('css/nf/nf.css')}"><link rel="stylesheet" href="${url('css/nf/nf-reports-menu.css')}">
</head><body><div id="nf-root"></div>
${['js/nf/nf-format.js', 'js/nf/nf-pick.js', 'js/nf/nf-drill.js', 'js/nf/nf-reports-menu.js', 'js/nf/nf-messages.js',
   'js/nf/nf-voucher-popup.js', 'js/nf/nf-day-excel.js', 'js/nf/nf-whatsapp-report.js', 'js/nf/nf-sheet.js', 'node_modules/xlsx/dist/xlsx.full.min.js'].map(s => `<script src="${url(s)}"></script>`).join('\n')}
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
  // a deposit he made today (docs/PLAN.md §53)
  day.transfers = [{ voucher_id: 'tv1', line_id: 'tl1', voucher_no: 'CPV-000300', manual_no: null, number_pending: true, version: 1,
    narration: 'Cash deposited in BOP from Site Cash — slip DS77123', amount: 50000, from: 'Site Cash', to: 'BOP bank', by_name: 'Sharose', by_box: 'Petty', mine: site }];
  window.NfWaReport.vendorBase = '${url('vendor')}/';
  function ok(x) { return Promise.resolve(JSON.parse(JSON.stringify(x))); }
  var api = {
    getDay: function () { return ok(day); }, listHeads: function () { return ok(fix.heads); }, listFloors: function () { return ok(fix.floors); },
    listVias: function () { return ok(fix.vias); }, listAllParties: function () { return ok(fix.parties); },
    saveCashTransfer: function () { window.__calls.push(['saveCashTransfer'].concat([].slice.call(arguments))); return ok(day); },
    saveDeposit: function () { window.__calls.push(['saveDeposit'].concat([].slice.call(arguments))); return ok(day); },
    saveLine: function () { window.__calls.push(['saveLine'].concat([].slice.call(arguments))); return ok(day); },
    deleteLine: function () { window.__calls.push(['deleteLine'].concat([].slice.call(arguments))); return ok(day); },
    setRemarks: function () { return ok(day); }, setTransfers: function () { return ok(day); },
    dayReport: function (c, d, v) { window.__calls.push(['dayReport', d, v]); return ok({ title: 'Awami Market Karkhano — Daily Closing', date: d, view: site ? 'site' : v, view_name: site || v === 'site' ? 'Site' : v === 'ho' ? 'Head Office' : 'Combined', boxes: [{ via: 'Petty', label: 'Site Cash', opening: 0, received: 0, paid: 0, transfers: 0, closing: 0 }], received: [], paid: [], transfers: [], prepared_by: site ? 'Sharose' : 'Rashid' }); },
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
      tags: [...document.querySelectorAll('.row[data-saved] .nf-by')].map(x => x.textContent),
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
    check('HO: the old "Head Office Cash given to Site Cash" box is gone (a popup voucher now, §54)', !t.tri && !t.triLabel, t.triLabel.trim());
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
    await pg.type('[data-pick="nfv-head"] .nfpick-in', 'site');
    await pg.waitForFunction(() => [...document.querySelectorAll('[data-pick="nfv-head"] .nfpick-opt')].some(o => /Cash given to/.test(o.textContent)), { timeout: 5000 }).catch(() => {});
    const hoOpt = await q(pg, () => [...document.querySelectorAll('[data-pick="nfv-head"] .nfpick-opt')].map(o => o.textContent).join(' | '));
    check('HO (director): Cash payment from Head Office Cash offers "Cash given to Site Cash"', hoOpt.indexOf('Cash given to Site Cash') >= 0, hoOpt);
    await pg.evaluate(() => { const o = [...document.querySelectorAll('[data-pick="nfv-head"] .nfpick-opt')].find(o => /Cash given to/.test(o.textContent)); if (o) o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); if (o) o.click(); });
    await pg.type('#nfv-amt', '50000');
    if (outDir) await pg.screenshot({ path: require('path').join(outDir, 'cash transfer - head office gives Site Cash.png') });
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
    // WhatsApp report: three views for head office; a picture and a PDF come out
    await pg.evaluate(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); }; });
    await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]');
    const radios = await q(pg, () => [...document.querySelectorAll('#nf-wa-dialog input[name="nf-wa-view"]')].map(r => r.value));
    check('HO: WhatsApp report offers Site / Head Office / Combined', radios.join(',') === 'site,ho,combined', radios.join(','));
    await pg.evaluate(() => { document.querySelector('#nf-wa-date').value = '2026-11-16'; document.querySelector('input[value="ho"]').checked = true; });
    await pg.click('#nf-wa-dialog [data-wa="preview"]'); await pg.waitForSelector('#nfwa-preview .wa');
    const pv = await q(pg, () => ({ dlBefore: window.__dl.length, title: document.querySelector('#nfwa-preview .nfwa-bar .t').textContent }));
    check('HO: Preview shows the report first, nothing saved yet', pv.dlBefore === 0 && /Head Office view/.test(pv.title), JSON.stringify(pv));
    await pg.waitForFunction(() => !document.querySelector('#nfwa-preview [data-act="jpg"]').disabled || /Could not/.test(document.querySelector('#nfwa-preview .nfwa-msg').textContent), { timeout: 20000 }).catch(() => {});
    await pg.click('#nfwa-preview [data-act="jpg"]'); await pg.waitForFunction(() => window.__dl.length >= 1, { timeout: 20000 }).catch(() => {});
    await pg.click('#nfwa-preview [data-act="close"]');
    await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]');
    await pg.evaluate(() => { document.querySelector('#nf-wa-date').value = '2026-11-16'; document.querySelector('input[value="combined"]').checked = true; });
    await pg.click('#nf-wa-dialog [data-wa="preview"]'); await pg.waitForSelector('#nfwa-preview .wa');
    await pg.click('#nfwa-preview [data-act="pdf"]'); await pg.waitForFunction(() => window.__dl.length >= 2, { timeout: 20000 }).catch(() => {});
    await pg.click('#nfwa-preview [data-act="close"]');
    check('HO: Close removes the preview', await q(pg, () => !document.querySelector('#nfwa-preview')));
    const dl = await q(pg, () => window.__dl), calls = await q(pg, () => window.__calls.filter(c => c[0] === 'dayReport'));
    check('HO: picture and PDF saved from the preview, for the chosen views', dl[0] === 'Awami Daily Closing 16-Nov-2026 Head Office.jpg' && dl[1] === 'Awami Daily Closing 16-Nov-2026 Combined.pdf' && calls.map(c => c[2]).join() === 'ho,combined', dl.join(' | ') + ' · ' + JSON.stringify(calls));
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
    if (width < 600) {
      await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]');
      await pg.click('#nf-wa-dialog [data-wa="preview"]'); await pg.waitForSelector('#nfwa-preview .wa');
      await new Promise(r => setTimeout(r, 300));
      const fit = await q(pg, () => document.querySelector('#nfwa-preview .nfwa-fit').getBoundingClientRect().width <= window.innerWidth);
      check('Site phone: the preview fits the screen', fit);
      await pg.screenshot({ path: path.join(outDir, '8 WhatsApp report preview - phone.png') });
      await pg.click('#nfwa-preview [data-act="close"]');
    }
    if (width > 600) {
      await pg.click('[data-vtype="CPV"]');
      await pg.waitForSelector('.vp-seg');
      const opts = await q(pg, () => [...document.querySelectorAll('.vp-seg [data-via]')].map(b => b.getAttribute('data-via') + ':' + b.textContent));
      check('Site: the cash payment popup offers only Site Cash', opts.length === 1 && opts[0] === 'Petty:Site Cash', opts.join(','));
      await pg.keyboard.press('Escape');
      await pg.evaluate(() => { const b = document.querySelector('.nf-dialog-backdrop, .vp-backdrop'); if (b) b.remove(); });
      const via = await q(pg, () => { const own = document.querySelector('.row[data-saved]:not([data-ro]) select[data-k="m"]'); return [...own.options].map(o => o.value + ':' + o.textContent); });
      check('Site: a saved cash line can only be on Site Cash', via.length === 1 && via[0] === 'Petty:Site Cash', via.join(','));
      // cash into the bank, from the Cash payment popup
      const trf = await q(pg, () => (document.body.innerText.match(/Site Cash → BOP bank/) || []).length);
      check('Site: his deposit shows under Transfers (Site Cash → BOP bank)', trf === 1);
      await pg.click('[data-vtype="CPV"]'); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-in');
      await pg.type('[data-pick="nfv-head"] .nfpick-in', 'deposit'); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-opt');
      const first = await q(pg, () => document.querySelector('[data-pick="nfv-head"] .nfpick-opt').textContent);
      check('Site: Cash payment offers "Cash deposited in BOP (bank)"', /Cash deposited in BOP \(bank\)/.test(first), first);
      await pg.click('[data-pick="nfv-head"] .nfpick-opt');
      const rows = await q(pg, () => ({ party: document.querySelector('#nfv-party-row').hidden, floor: document.querySelector('#nfv-floor-row').hidden, ref: !document.querySelector('#nfv-ref-row').hidden }));
      check('Site: choosing it asks for the slip, not party or floor', rows.party && rows.floor && rows.ref, JSON.stringify(rows));
      await pg.type('#nfv-amt', '50000'); await pg.type('#nfv-ref', 'DS-77123'); await pg.click('#nfv-save');
      await new Promise(r => setTimeout(r, 300));
      const dep = await q(pg, () => window.__calls.filter(c => c[0] === 'saveDeposit')[0]);
      check('Site: it saves as a deposit from Site Cash (nf_save_deposit)', dep && dep[3] === 'Petty' && dep[4] === 50000 && dep[5] === 'DS-77123', JSON.stringify(dep));
      await pg.evaluate(() => { const b = document.querySelector('#nf-vpop'); if (b) b.remove(); });
      // cash back to head office, from the same Cash payment popup (docs/PLAN.md §54)
      for (const [vt, word, label, from, to] of [['CPV', 'head office', 'Cash given to Head Office Cash', 'Petty', 'Cash'], ['CRV', 'head office', 'Cash received from Head Office Cash', 'Cash', 'Petty']]) {
        await pg.click('[data-vtype="' + vt + '"]'); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-in');
        await pg.type('[data-pick="nfv-head"] .nfpick-in', word); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-opt');
        const opt = await q(pg, () => document.querySelector('[data-pick="nfv-head"] .nfpick-opt').textContent);
        check('Site: ' + vt + ' offers "' + label + '"', opt.indexOf(label) >= 0, opt);
        await pg.click('[data-pick="nfv-head"] .nfpick-opt');
        const hid = await q(pg, () => ({ party: document.querySelector('#nfv-party-row').hidden, floor: document.querySelector('#nfv-floor-row').hidden }));
        await pg.type('#nfv-manual', vt === 'CPV' ? 'S-CPV-77' : 'S-CRV-78'); await pg.type('#nfv-amt', '25000');
        if (outDir) await pg.screenshot({ path: require('path').join(outDir, 'cash transfer - site ' + vt + ' ' + label + '.png') });
        await pg.click('#nfv-save');
        await new Promise(r => setTimeout(r, 300));
        const c = await q(pg, () => window.__calls.filter(c => c[0] === 'saveCashTransfer').pop());
        check('Site: ' + vt + ' cash transfer asks no party or floor, saves ' + from + ' → ' + to + ' (nf_save_cash_transfer)',
          hid.party && hid.floor && c && c[2] === vt && c[4] === from && c[5] === to && c[6] === 25000, JSON.stringify({ hid, c }));
        await pg.evaluate(() => { const b = document.querySelector('#nf-vpop'); if (b) b.remove(); });
      }
      await pg.evaluate(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); }; });
      await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]');
      const wa = await q(pg, () => ({ radios: document.querySelectorAll('#nf-wa-dialog input[name="nf-wa-view"]').length, only: (document.querySelector('.nf-wa-only') || {}).textContent }));
      check('Site: WhatsApp report has no view choice — Site only', wa.radios === 0 && wa.only === 'Site view', JSON.stringify(wa));
      await pg.evaluate(() => { document.querySelector('#nf-wa-date').value = '2026-11-18'; });
      await pg.click('#nf-wa-dialog [data-wa="preview"]'); await pg.waitForSelector('#nfwa-preview .wa');
      await pg.waitForFunction(() => !document.querySelector('#nfwa-preview [data-act="jpg"]').disabled || /Could not/.test(document.querySelector('#nfwa-preview .nfwa-msg').textContent), { timeout: 20000 }).catch(() => {});
      await pg.click('#nfwa-preview [data-act="jpg"]'); await pg.waitForFunction(() => window.__dl.length >= 1, { timeout: 20000 }).catch(() => {});
      await pg.click('#nfwa-preview [data-act="close"]');
      const sdl = await q(pg, () => ({ dl: window.__dl, calls: window.__calls.filter(c => c[0] === 'dayReport') }));
      check('Site: the preview asks for and saves Site', sdl.calls.length === 1 && sdl.calls[0][2] === 'site' && sdl.dl[0] === 'Awami Daily Closing 18-Nov-2026 Site.jpg', JSON.stringify(sdl));
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
