#!/usr/bin/env node
/* THE AWAMI ALLOTMENT LETTER BOX IS FROZEN — this proves it on every push.

   The box prints onto a pre-printed sheet. It was trued against a test print on
   2026-10-26 (AL_AWAMI in js/pages/sales.js) and drifted before whenever the
   code or the data changed its size. This renders _alBand / _alCSS straight
   from js/pages/sales.js on the 8.5 x 14.5 in page, with short, real and
   extreme data, and fails if the box is not exactly where it was frozen or if
   any value no longer fits inside it.

   Runs in `npm run gate` (the push hook). If a new test print really calls for
   a new position, change AL_AWAMI and FROZEN below together, in one commit.

   node scripts/check-allotment-frozen.js                                       */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const FROZEN = { top: 3.45, bottom: 5.23, left: 1.10, right: 8.5 - 1.10 };   // inches, sheet edge → box border
const TOL = 0.006;
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
                  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

const CASES = [
  { label: 'short address', d: { unit_no: 'LG-135', floor_label: 'Lower Ground', area_sqft: 242.96, net_amount: 17310900, sale_date: '2026-10-24', client_name: 'imran khan' },
    c: { client_code: 'CLT-2026-0003', father_name: 'Mukhtair Khan', cnic: '17301-5778556-1', phone_primary: '0332-2202220', address: 'House No.337, Street No.13,Sector D-3,Mohalla Phase 1.Peshawar.' }, note: 'ABC1234567' },
  { label: 'longest real address (SAL-2026-0006)', d: { unit_no: 'LG-57', floor_label: 'Lower Ground', area_sqft: 171.19, net_amount: 11089000, sale_date: '2026-10-23', client_name: 'Irfan Ullah Shah' },
    c: { client_code: 'CLT-2026-0002', father_name: 'Seyyed Raza shah', cnic: '21201-2880079-5', phone_primary: '0316-1924366', address: 'Qoam Malik din khel,Thapa Daulat khel,kandy Umer khel,P.O  Bara,Nala khuar,Tehsil Bara,Distt khybery' }, note: 'AND3492002' },
  { label: 'extreme: long name, 250-char address', d: { unit_no: 'FF-1104', floor_label: 'Mezzanine Floor', area_sqft: 12345.67, net_amount: 1234567890, sale_date: '2026-12-31', client_name: 'Muhammad Abdul Rehman Khan Yousafzai Afridi Sahibzada' },
    c: { client_code: 'CLT-2026-99999', father_name: 'Haji Muhammad Abdul Ghafoor Khan Yousafzai Afridi', cnic: '17301-5778556-1', phone_primary: '0332-2202220 / 0300-1234567',
         address: 'House No. 1234-B, Street No. 56, Sector D-3, Phase 1, Hayatabad Township, near the big mosque and the old bus stand, Tehsil and District Peshawar, Khyber Pakhtunkhwa, Pakistan, Postal Code 25100, second house on the left after the bakery' }, note: 'XYZ9999999999' },
  { label: 'empty values', d: { unit_no: 'LG-1', client_name: 'A' }, c: {}, note: 'N1' }
];

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'sales.js'), 'utf8');
  const a = src.indexOf('const AL_TOP'), b = src.indexOf('// Full letter for plain paper');
  if (a < 0 || b < a) { console.error('FAIL: could not find the allotment-letter code in js/pages/sales.js'); process.exit(1); }
  const code = 'function esc(x){return String(x).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}\n' + src.slice(a, b);

  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('FAIL: no Chrome/Edge found to measure the letter'); process.exit(1); }
  const br = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  let bad = 0;
  try {
    const pg = await br.newPage();
    await pg.setViewport({ width: 816, height: 1392 });   // 8.5 x 14.5 in at 96 px/in
    for (const k of CASES) {
      await pg.setContent('<html><head></head><body></body></html>');
      await pg.addScriptTag({ content: code });
      const m = await pg.evaluate(k => {
        document.head.innerHTML = '<style>' + _alCSS() + '</style>';
        document.body.innerHTML = '<div class="al-page">' + _alBand(k.d, k.c, k.note) + '</div>';
        const box = document.querySelector('.al-wrap').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.al-wrap .al-l, .al-wrap .al-br')];
        const lastBottom = Math.max(...rows.map(r => r.getBoundingClientRect().bottom));
        const addr = rows.find(r => /Address/.test(r.textContent)).querySelector('.v');
        const lh = parseFloat(getComputedStyle(addr).lineHeight);
        const note = rows.find(r => /Currency Note/i.test(r.textContent));
        return { top: box.top / 96, bottom: box.bottom / 96, left: box.left / 96, right: box.right / 96,
                 contentFits: lastBottom <= box.bottom - 1, addressLines: Math.round(addr.getBoundingClientRect().height / lh),
                 noteInRightColumn: !!(note && note.closest('.al-box')) };
      }, k);
      const fails = [];
      for (const s of ['top', 'bottom', 'left', 'right'])
        if (Math.abs(m[s] - FROZEN[s]) > TOL) fails.push(s + ' ' + m[s].toFixed(3) + 'in, frozen ' + FROZEN[s].toFixed(2) + 'in');
      if (!m.contentFits) fails.push('the last row runs past the bottom border');
      if (m.addressLines > 2) fails.push('address takes ' + m.addressLines + ' lines (max 2)');
      if (!m.noteInRightColumn) fails.push('currency note is not in the right column');
      if (fails.length) { bad++; console.log('FAIL  ' + k.label + ': ' + fails.join('; ')); }
      else console.log('ok    ' + k.label + ': box ' + m.top.toFixed(2) + '-' + m.bottom.toFixed(2) + 'in, address ' + m.addressLines + ' line(s)');
    }
  } finally { await br.close(); }
  if (bad) { console.log('\nAwami allotment-letter box MOVED or no longer fits — it is frozen (AL_AWAMI in js/pages/sales.js). Push refused.'); process.exit(1); }
  console.log('\nAwami allotment-letter box: frozen position holds (' + CASES.length + ' cases).');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
