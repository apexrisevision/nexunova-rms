#!/usr/bin/env node
/* Read-only: compares the owner's "Daily closing.xlsx" (one tab per date) with Awami's NexuFinance
   vouchers, matched by voucher number (CRV-000027 = CRV-0027 = CRV-27). For every voucher it reports
   the Excel date, the NF date, and the Excel amount vs the NF voucher total.
   Usage: node scripts/nf/compare-daily-closing-xlsx.js "<xlsx>" <out.json>   (writes nothing to the DB) */
const fs = require('fs');
const X = require('xlsx');
const { q } = require('../_sbq');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const [file, out] = process.argv.slice(2);
const norm = s => { const m = /^([A-Z]{2,4})-0*(\d+)$/.exec(String(s).trim()); return m ? m[1] + '-' + (+m[2]) : null; };
const num = s => +String(s).replace(/[,\s]/g, '') || 0;
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
(async () => {
  const wb = X.readFile(file);
  const xl = {};                                   // norm no -> { dates:Set, amount, details:[] }
  for (const n of wb.SheetNames) {
    const m = /^(\d{2})-([A-Z][a-z]{2})$/.exec(n); if (!m) continue;
    const date = `2026-${String(MON[m[2]]).padStart(2, '0')}-${m[1]}`;
    const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
    for (const r of rows.slice(6)) {
      for (const [c0, cDet, cCash, cBank] of [[0, 1, 3, 4], [6, 7, 9, 10]]) {
        const k = norm(r[c0]); if (!k) continue;
        const e = xl[k] || (xl[k] = { dates: new Set(), amount: 0, details: [] });
        e.dates.add(date); e.amount += num(r[cCash]) + num(r[cBank]); e.details.push(String(r[cDet]).slice(0, 70));
      }
    }
  }
  const nf = await q(`select v.id, v.voucher_no, v.manual_no, v.voucher_date, v.source, d.business_date day_date,
      (select sum(l.debit) from nf_voucher_legs l where l.voucher_id = v.id) total, left(v.narration, 80) narration
    from nf_vouchers v left join nf_days d on d.id = v.day_id
    where v.company_id = '${CO}' and v.source <> 'IMPORT' and v.status = 'POSTED'`);
  const byNo = {};
  for (const v of nf) { const k = norm(v.manual_no || v.voucher_no); if (k) (byNo[k] = byNo[k] || []).push(v); }
  const res = { matched: [], dateDiffers: [], amountDiffers: [], multiDateInExcel: [], onlyInExcel: [], onlyInNF: [], dupNoInNF: [] };
  for (const [k, e] of Object.entries(xl)) {
    const dates = [...e.dates].sort();
    if (dates.length > 1) res.multiDateInExcel.push({ no: k, dates });
    const vs = byNo[k];
    if (!vs) { res.onlyInExcel.push({ no: k, dates, amount: e.amount, detail: e.details[0] }); continue; }
    if (vs.length > 1) res.dupNoInNF.push({ no: k, nf: vs.map(v => v.voucher_no + ' ' + v.voucher_date) });
    const v = vs[0], nfAmt = +v.total;
    const row = { id: v.id, no: k, nf_no: v.voucher_no, source: v.source, excel_date: dates[0], nf_date: v.voucher_date, excel_amount: e.amount, nf_amount: nfAmt, detail: e.details[0] };
    if (Math.abs(nfAmt - e.amount) > 0.5) res.amountDiffers.push(row);
    if (dates[0] !== v.voucher_date) res.dateDiffers.push(row); else res.matched.push(row);
  }
  for (const [k, vs] of Object.entries(byNo)) if (!xl[k]) for (const v of vs)
    res.onlyInNF.push({ id: v.id, no: k, nf_no: v.voucher_no, source: v.source, nf_date: v.voucher_date, nf_amount: +v.total, narration: v.narration });
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const byPair = {};
  for (const r of res.dateDiffers) { const p = r.source + ' ' + r.nf_date + ' -> ' + r.excel_date.slice(0, 7); byPair[p] = (byPair[p] || 0) + 1; }
  console.log('excel vouchers', Object.keys(xl).length, '| nf vouchers (non-import)', nf.length);
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(18), v.length);
  console.log('date moves by NF date -> Excel month:', JSON.stringify(byPair));
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
