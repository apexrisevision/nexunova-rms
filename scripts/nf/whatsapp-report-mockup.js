#!/usr/bin/env node
/* MOCKUP (read-only): the daily WhatsApp report — one portrait image (JPG, 1080 px wide) and the same as PDF — for a
   date and a view: site | ho | combined. Data read straight from the live books; nothing is written.
     site      every line that moves Site Cash, plus bank lines the site login entered; only the Site Cash balance
     ho        every line that moves Head Office Cash or the bank; Head Office Cash and the bank balances
     combined  everything; all three balances; who entered each line
   Usage: node scripts/nf/whatsapp-report-mockup.js <YYYY-MM-DD> <site|ho|combined> <prepared by> <out dir> */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const { q } = require('../_sbq');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const [DATE, VIEW, PREPARED, OUT] = process.argv.slice(2);
const VIEWS = { site: 'Site', ho: 'Head Office', combined: 'Combined' };
const pk = n => (Math.round(Number(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pz = n => Number(n) ? pk(n) : '–';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n) => { s = String(s || '').replace(/\s*\((?:site cash, Sharose|cash)[^)]*\)\s*$/i, '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

(async () => {
  const vouchers = await q(`
    SELECT COALESCE(v.manual_no, v.voucher_no) AS no, v.narration, m.display_name AS by_name, m.cash_via AS by_box,
           json_agg(json_build_object('via', a.via, 'name', a.name, 'dr', g.debit, 'cr', g.credit, 'party', p.name) ORDER BY g.line_no) AS legs
      FROM nf_vouchers v JOIN nf_voucher_legs g ON g.voucher_id = v.id JOIN nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN nf_parties p ON p.id = g.party_id LEFT JOIN nf_members m ON m.company_id = v.company_id AND m.user_id = v.created_by
     WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND COALESCE(v.real_date, v.voucher_date) = DATE '${DATE}'
     GROUP BY v.id, v.manual_no, v.voucher_no, v.narration, m.display_name, m.cash_via ORDER BY v.created_at, v.sort`);
  const boxes = await q(`SELECT a.via, a.via_label AS label,
      COALESCE(sum(g.debit - g.credit) FILTER (WHERE COALESCE(v.real_date, v.voucher_date) < DATE '${DATE}'), 0) AS opening
    FROM nf_accounts a LEFT JOIN nf_voucher_legs g ON g.company_id = a.company_id AND g.account_code = a.code
    LEFT JOIN nf_vouchers v ON v.id = g.voucher_id AND v.status = 'POSTED'
   WHERE a.company_id = '${CO}' AND a.via IS NOT NULL GROUP BY a.via, a.via_label`);
  const B = {}; boxes.forEach(b => { B[b.via] = { label: b.label, opening: +b.opening, rec: 0, paid: 0, trf: 0 }; });
  const shown = { site: ['Petty'], ho: ['Cash', 'Bank'], combined: ['Cash', 'Petty', 'Bank'] }[VIEW];
  const who = v => v.by_box === 'Petty' ? v.by_name : 'Head Office';

  const rec = [], pay = [];
  for (const v of vouchers) {
    const via = v.legs.filter(l => l.via), head = v.legs.filter(l => !l.via);
    if (!via.length) continue;                                   // a JV moves no cash and no bank
    // which part of this voucher belongs in the view
    const mine = via.filter(l => shown.includes(l.via) || (VIEW === 'site' && l.via === 'Bank' && v.by_box === 'Petty' && head.length));
    if (!mine.length) continue;
    if (!head.length) {                                          // a transfer between a cash box and the bank
      for (const l of via) {
        if (!shown.includes(l.via)) continue;
        const other = via.find(x => x !== l), amt = +l.dr || +l.cr;
        const chq = (/chq\s*#?\s*(\d{4,})/i.exec(v.narration || '') || [])[1];
        const name = x => x.via === 'Bank' ? (VIEW === 'site' ? 'Head Office (BOP)' : 'BOP (bank)') : x.via === 'Petty' ? 'Site Cash' : 'Head Office Cash';
        const what = (other.via === 'Bank' || l.via === 'Bank') ? (+l.dr > 0 && l.via !== 'Bank' ? 'Cash withdrawn' : l.via === 'Bank' && +l.dr > 0 ? 'Cash deposited' : 'Cash withdrawn') : 'Cash moved';
        const row = { no: v.no, who: who(v), amt, trf: true, party: name(other), head: what + (chq ? ', chq …' + chq.slice(-4) : '') };
        if (+l.dr > 0) { rec.push(row); B[l.via].trf += amt; } else { pay.push(row); B[l.via].trf -= amt; }
      }
      continue;
    }
    const m = via[0], h = head[0], amt = +m.dr || +m.cr;
    const row = { no: v.no, who: who(v), amt, head: h.name + (m.via === 'Bank' ? ' · bank' : ''),
      party: h.party || short(v.narration, 42) };
    // a head that is itself the party (an advance to Naeem Hussain): say what it was for instead
    if (h.party && (h.party === h.name || h.name.indexOf(h.party) >= 0)) row.head = short(String(v.narration || '').split(' — ')[0], 40);
    if (shown.includes(m.via)) { if (+m.dr > 0) B[m.via].rec += amt; else B[m.via].paid += amt; }
    if (+m.dr > 0) rec.push(row); else pay.push(row);
  }
  const close = k => B[k].opening + B[k].rec - B[k].paid + B[k].trf;
  const date = new Date(DATE + 'T00:00:00Z');
  const dateText = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const now = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' });
  const combined = VIEW === 'combined';
  const tot = list => list.reduce((t, r) => t + r.amt, 0);
  const list = (title, rows, cls, partyHead) => `
    <section class="sec"><h2 class="${cls}">${title} <span>${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}</span></h2>
    ${rows.length ? `<table class="lst"><thead><tr><th>Voucher</th><th>${partyHead}</th><th>For</th>${combined ? '<th>By</th>' : ''}<th class="r">Amount</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.trf ? 'trf' : ''}"><td class="no">${esc(r.no)}</td><td class="pt">${esc(short(r.party, 34))}</td><td class="hd">${esc(short(r.head, 40))}</td>${combined ? `<td class="by ${r.who === 'Head Office' ? 'ho' : 'site'}">${esc(r.who)}</td>` : ''}<td class="r amt">${pk(r.amt)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="${combined ? 4 : 3}">Total ${title.toLowerCase()}</td><td class="r">${pk(tot(rows))}</td></tr></tfoot></table>` : '<p class="none">None.</p>'}</section>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:1080px 1500px;margin:0}
  *{box-sizing:border-box}body{margin:0;width:1080px;background:#fff;font-family:"Segoe UI",Inter,Arial,sans-serif;color:#14213d}
  .top{background:linear-gradient(120deg,#0b3d91,#1565c0 60%,#00a676);color:#fff;padding:40px 48px 34px}
  .top h1{margin:0;font-size:46px;font-weight:700;letter-spacing:.2px}.top .d{font-size:30px;margin-top:8px;opacity:.95}
  .view{display:inline-block;margin-top:16px;background:#ffd23f;color:#3d2c00;font-weight:700;font-size:26px;padding:6px 22px;border-radius:999px}
  .sec{padding:28px 48px 6px}.sec h2{font-size:32px;margin:0 0 14px;padding-left:14px;border-left:8px solid #1565c0}
  .sec h2 span{font-size:22px;color:#6b7383;font-weight:500;margin-left:10px}.sec h2.in{border-color:#00a676}.sec h2.out{border-color:#e63946}
  table{width:100%;border-collapse:collapse;font-size:25px}th{font-size:20px;color:#5b6475;text-align:left;font-weight:600;padding:10px 10px;border-bottom:3px solid #e3e7ee}
  td{padding:14px 10px;border-bottom:1px solid #edf0f5;vertical-align:top}.r{text-align:right;white-space:nowrap}
  .bal td{font-size:27px}.bal td:first-child{font-weight:700}.bal .cl{font-weight:800;font-size:30px;color:#0b3d91}.bal .z{color:#9aa3b2}
  .bal tr.total td{background:#f3f6fb;font-weight:800}
  .no{font-weight:700;white-space:nowrap;color:#0b3d91}.pt{font-weight:600}.hd{color:#4a5468}.amt{font-weight:800;font-size:27px}
  .lst tfoot td{font-weight:800;font-size:27px;background:#f3f6fb;border-bottom:0}.lst tr.trf td{background:#fff9e6}
  .by{font-size:20px;font-weight:700}.by.site{color:#0e7a5a}.by.ho{color:#2b4f8a}.none{font-size:24px;color:#6b7383;margin:0 0 10px}
  .foot{margin:26px 48px 36px;padding:22px 26px;background:#f3f6fb;border-radius:18px;font-size:23px;color:#4a5468;display:flex;justify-content:space-between;gap:20px}
  .foot b{color:#14213d}.net{font-size:26px;color:#14213d;font-weight:700}
  </style></head><body>
  <div class="top"><h1>Awami Market Karkhano — Daily Closing</h1><div class="d">${esc(dateText)}</div><span class="view">${VIEWS[VIEW]}</span></div>
  <section class="sec"><h2>Balances</h2><table class="bal"><thead><tr><th></th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfers</th><th class="r">Closing</th></tr></thead><tbody>
  ${shown.map(k => `<tr><td>${esc(k === 'Bank' ? 'BOP (bank)' : B[k].label)}</td><td class="r">${pk(B[k].opening)}</td><td class="r${B[k].rec ? '' : ' z'}">${pz(B[k].rec)}</td><td class="r${B[k].paid ? '' : ' z'}">${pz(B[k].paid)}</td><td class="r${B[k].trf ? '' : ' z'}">${B[k].trf > 0 ? '+' : ''}${pz(B[k].trf)}</td><td class="r cl">${pk(close(k))}</td></tr>`).join('')}
  </tbody></table></section>
  ${list('Money received', rec, 'in', 'From')}
  ${list('Money paid', pay, 'out', 'Paid to')}
  <div class="foot"><div><div class="net">Received ${pk(tot(rec))} · Paid ${pk(tot(pay))}</div>Rows on a yellow band are transfers between cash and the bank.</div>
  <div style="text-align:right">Prepared by <b>${esc(PREPARED)}</b><br>Generated ${esc(now)}</div></div>
  </body></html>`;

  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, `${DATE} ${VIEWS[VIEW]}`);
  fs.writeFileSync(base + '.html', html);
  const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1080, height: 1200, deviceScaleFactor: 1 });
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 90, fullPage: true });
  const h = await pg.evaluate(() => document.body.scrollHeight);
  await pg.pdf({ path: base + '.pdf', width: '1080px', height: h + 'px', printBackground: true, pageRanges: '1' });
  await br.close();
  fs.unlinkSync(base + '.html');
  console.log(JSON.stringify({ date: DATE, view: VIEW, received: rec.length, paid: pay.length,
    closing: Object.fromEntries(shown.map(k => [B[k].label, close(k)])) }));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
