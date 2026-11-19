#!/usr/bin/env node
/* Mockups (no database writes): Sharose's Daily Closing as the screen draws it from what nf_get_day returns to the
   site cash box after 20261119e (the dry run saved it). Desktop and phone, the 18-Nov sheet and the 05-Oct catch-up
   sheet. Also checks the page holds no Head Office marker.
   Usage: node scripts/nf/mockup-site-box-screen.js <sharose-day.json> <lookups fixture.json> <out dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const [dayFile, fixFile, OUT] = process.argv.slice(2);
const days = JSON.parse(fs.readFileSync(dayFile, 'utf8')), fix = JSON.parse(fs.readFileSync(fixFile, 'utf8'));
const MARK = ['BPV-0043', 'BPV-0045', 'BPV-0046', 'BPV-0026', 'CPV-0170', 'CPV-0171', 'CPV-0172', 'BRV-0079', 'Khyber', 'Zia ul Haq', 'Waqar', '4,15,250', '2,63,61', '🔒'];
const url = p => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/');
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${url('')}/">
<link rel="stylesheet" href="${url('css/nf/nf.css')}"><link rel="stylesheet" href="${url('css/nf/nf-reports-menu.css')}"></head><body><div id="nf-root"></div>
${['js/nf/nf-format.js', 'js/nf/nf-pick.js', 'js/nf/nf-drill.js', 'js/nf/nf-reports-menu.js', 'js/nf/nf-messages.js', 'js/nf/nf-voucher-popup.js',
   'js/nf/nf-day-excel.js', 'js/nf/nf-whatsapp-report.js', 'js/nf/nf-sheet.js'].map(s => `<script src="${url(s)}"></script>`).join('\n')}
<script>window.__boot = function (day, fix) {
  fix.vias.forEach(function (v) { v.label = { Cash: 'Head Office Cash', Petty: 'Site Cash', Bank: 'BOP bank' }[v.via]; });
  function ok(x) { return Promise.resolve(JSON.parse(JSON.stringify(x))); }
  var api = { getDay: function () { return ok(day); }, listHeads: function () { return ok(fix.heads); }, listFloors: function () { return ok(fix.floors); },
    listVias: function () { return ok(fix.vias); }, listAllParties: function () { return ok(fix.parties); } };
  return window.NfSheet.mount(document.getElementById('nf-root'), { api: api, companyId: day.day.company_id, role: 'accountant', cashVia: 'Petty',
    displayName: 'Sharose', companyName: 'Fourteen Group of Companies', settings: { mark: 'AM', company_line: 'Fourteen Group of Companies · Awami Market, Karkhano, Peshawar' } });
};</script></body></html>`;
(async () => {
  const harness = path.join(path.dirname(fixFile), 'site-box-harness.html');
  fs.writeFileSync(harness, HTML);
  fs.mkdirSync(OUT, { recursive: true });
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  for (const [name, day] of [['18-Nov', days.day18], ['05-Oct catch-up (to 16-Nov)', days.day7]]) {
    for (const [w, tag] of [[1300, 'desktop'], [390, 'phone']]) {
      const pg = await br.newPage(); const errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.setViewport({ width: w, height: 900, deviceScaleFactor: w < 600 ? 2 : 1.25 });
      await pg.goto('file:///' + harness.replace(/\\/g, '/'), { waitUntil: 'load' });
      await pg.evaluate((d, f) => window.__boot(d, f), day, fix);
      await pg.waitForSelector('.sheet .pos');
      const t = await pg.evaluate(() => ({ text: document.body.innerText, filter: !!document.querySelector('[data-whose]'), ro: document.querySelectorAll('.row[data-ro]').length,
        rows: [...document.querySelectorAll('table.pos tbody tr td:first-child')].map(x => x.textContent), overflow: document.documentElement.scrollWidth - window.innerWidth }));
      const hits = MARK.filter(m => t.text.includes(m));
      console.log(`${name} ${tag}: position rows [${t.rows.join(' | ')}] · filter ${t.filter} · locked lines ${t.ro} · Head Office markers ${hits.length ? hits.join(',') : 'none'} · overflow ${t.overflow}px · errors ${errs.length}`);
      await pg.screenshot({ path: path.join(OUT, `Sharose ${name} ${tag}.png`), fullPage: true });
      if (w > 600) await pg.screenshot({ path: path.join(OUT, `Sharose ${name} ${tag} - top.png`), clip: { x: 0, y: 0, width: w, height: 660 } });
      await pg.close();
    }
  }
  await br.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
