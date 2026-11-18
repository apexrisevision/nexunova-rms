#!/usr/bin/env node
/* Mockup / sample (read-only): one date's tab in the layout of the owner's "Daily closing.xlsx" — receipts A–E
   (V. No, Detail, Head, Cash, Bank), payments G–K, adjustments (JVs) and a closing block — for Head Office
   Cash, Site Cash and BOP, with who entered every line. By DATE (a voucher's real date), not by day sheet:
   DC-007 holds 05-Oct to 16-Nov.
   Usage: node scripts/nf/export-day-xlsx.js <company id> <YYYY-MM-DD> <out.xlsx> */
const X = require('xlsx');
const { q } = require('../_sbq');
const [CO, DATE, OUT] = process.argv.slice(2);
(async () => {
  const vouchers = await q(`
    WITH v AS (SELECT v.*, COALESCE(v.real_date, v.voucher_date) AS rd FROM nf_vouchers v
                WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND COALESCE(v.real_date, v.voucher_date) = DATE '${DATE}')
    SELECT v.id, COALESCE(v.manual_no, v.voucher_no) AS no, v.voucher_no, v.narration, v.source, v.sort, v.created_at,
           m.display_name AS by_name, m.cash_via AS by_box,
           json_agg(json_build_object('acc', g.account_code, 'name', a.name, 'via', a.via, 'label', a.via_label, 'dr', g.debit, 'cr', g.credit,
                    'party', p.name) ORDER BY g.line_no) AS legs
      FROM v JOIN nf_voucher_legs g ON g.voucher_id = v.id JOIN nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN nf_parties p ON p.id = g.party_id
      LEFT JOIN nf_members m ON m.company_id = v.company_id AND m.user_id = v.created_by
     GROUP BY v.id, v.manual_no, v.voucher_no, v.narration, v.source, v.sort, v.created_at, m.display_name, m.cash_via
     ORDER BY v.created_at, v.sort`);
  const boxes = await q(`SELECT a.code, a.via, a.via_label,
      COALESCE(sum(g.debit - g.credit) FILTER (WHERE COALESCE(v.real_date, v.voucher_date) < DATE '${DATE}'), 0) AS opening
    FROM nf_accounts a LEFT JOIN nf_voucher_legs g ON g.company_id = a.company_id AND g.account_code = a.code
    LEFT JOIN nf_vouchers v ON v.id = g.voucher_id AND v.status = 'POSTED'
   WHERE a.company_id = '${CO}' AND a.via IS NOT NULL GROUP BY a.code, a.via, a.via_label ORDER BY a.code`);
  const coName = (await q(`select coalesce(display_name, company_name) n from companies where id = '${CO}'`))[0].n;

  const box = {}; boxes.forEach(b => { box[b.via] = { label: b.via_label, opening: +b.opening, in: 0, out: 0, trf: 0 }; });
  const rec = [], pay = [], adj = [];
  const who = v => (v.by_name ? (v.by_box === 'Petty' ? v.by_name : 'Head Office') : 'Imported');
  for (const v of vouchers) {
    const via = v.legs.filter(l => l.via), head = v.legs.filter(l => !l.via);
    if (!via.length) {   // a JV: no cash, no bank
      const dr = head.filter(l => +l.dr > 0), cr = head.filter(l => +l.cr > 0);
      adj.push([v.no, v.narration + ' · ' + who(v), cr.map(l => l.party || l.name).join(', '), dr.map(l => l.party || l.name).join(', '), dr.reduce((t, l) => t + +l.dr, 0)]);
      continue;
    }
    if (!head.length) {  // a transfer: the box it went into is a receipt, the box it left a payment
      for (const l of via) {
        const amt = +l.dr || +l.cr, isBank = l.via === 'Bank';
        const row = [v.no, v.narration + ' · ' + who(v), 'Transfer — ' + l.label, isBank ? '' : amt, isBank ? amt : '', l.via];
        if (+l.dr > 0) { rec.push(row); box[l.via].trf += amt; } else { pay.push(row); box[l.via].trf -= amt; }
      }
      continue;
    }
    const m = via[0], amt = +m.dr || +m.cr, isBank = m.via === 'Bank';
    const h = head[0];
    const detail = v.narration + ' · ' + who(v) + (isBank ? '' : ' (' + m.label + ')');
    const row = [v.no, detail, h.party && h.party !== h.name ? h.name + ' · ' + h.party : h.name, isBank ? '' : amt, isBank ? amt : '', m.via];
    if (+m.dr > 0) { rec.push(row); box[m.via].in += amt; } else { pay.push(row); box[m.via].out += amt; }
  }

  const d = new Date(DATE + 'T00:00:00Z');
  const title = d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const A = [];
  A[0] = [coName.toUpperCase() + ' — DAILY CASH & BANK BOOK'];
  A[1] = ['Date:', title];
  A[2] = ['Cash = Head Office Cash or Site Cash (named in the detail); Bank = BOP. "· Sharose" / "· Head Office" = who entered it.'];
  A[4] = ['RECEIPTS  (money IN)', '', '', '', '', '', 'PAYMENTS  (money OUT)'];
  A[5] = ['V. No', 'Detail (from whom / for what) · entered by', 'Head', 'Cash', 'Bank', '', 'V. No', 'Detail (to whom / for what) · entered by', 'Head', 'Cash', 'Bank'];
  const n = Math.max(rec.length, pay.length, 1);
  for (let i = 0; i < n; i++) {
    const r = rec[i] || ['', '', '', '', ''], p = pay[i] || ['', '', '', '', ''];
    A[6 + i] = [r[0], r[1], r[2], r[3], r[4], '', p[0], p[1], p[2], p[3], p[4]];
  }
  let y = 6 + n + 1;
  const sum = (rows, k) => rows.reduce((t, r) => t + (+r[k] || 0), 0);
  A[y] = ['', '', 'Total received', sum(rec, 3), sum(rec, 4), '', '', '', 'Total paid', sum(pay, 3), sum(pay, 4)];
  y += 2;
  A[y] = ['', 'CLOSING', 'Head Office Cash', 'Site Cash', 'BOP', '', 'ADJUSTMENTS  (JVs — no cash, no bank)'];
  A[y + 1] = ['', 'Opening (b/f)', box.Cash.opening, box.Petty.opening, box.Bank.opening, '', 'V. No', 'Detail · entered by', 'Received from', 'Paid to', 'Amount'];
  const B = [['Add: received today', 'in'], ['Less: paid today', 'out'], ['Transfers (net)', 'trf']];
  B.forEach(([lbl, k], i) => { A[y + 2 + i] = ['', lbl, box.Cash[k] * (k === 'out' ? -1 : 1), box.Petty[k] * (k === 'out' ? -1 : 1), box.Bank[k] * (k === 'out' ? -1 : 1)]; });
  const close = v => box[v].opening + box[v].in - box[v].out + box[v].trf;
  A[y + 5] = ['', 'Closing balance (c/f)', close('Cash'), close('Petty'), close('Bank')];
  adj.forEach((a, i) => { const row = A[y + 2 + i] || ['', '', '', '', '']; while (row.length < 6) row.push(''); A[y + 2 + i] = row.concat(a); });
  A[y + 8] = ['', 'Prepared by: ____________________', '', '', '', '', '', 'Checked by:  ____________________'];
  const ws = X.utils.aoa_to_sheet(A.map(r => r || []));
  ws['!cols'] = [10, 58, 26, 14, 14, 2, 10, 58, 26, 14, 14].map(w => ({ wch: w }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } }];
  for (const addr of Object.keys(ws)) if (/^[C-EJK]\d+$/.test(addr) && typeof ws[addr].v === 'number') ws[addr].z = Number.isInteger(ws[addr].v) ? '#,##0;(#,##0);"–"' : '#,##0.00;(#,##0.00);"–"';
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace(' ', '-'));
  X.writeFile(wb, OUT);
  console.log(JSON.stringify({ date: DATE, receipts: rec.length, payments: pay.length, jvs: adj.length,
    closing: { HO_cash: close('Cash'), site_cash: close('Petty'), bop: close('Bank') },
    totals: { rec_cash: sum(rec, 3), rec_bank: sum(rec, 4), pay_cash: sum(pay, 3), pay_bank: sum(pay, 4) } }));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
