#!/usr/bin/env node
/* Writes supabase/migrations/20261118f_nf_awami_voucher_real_dates.sql from the comparison JSON made by
   compare-daily-closing-xlsx.js. Every voucher whose date differs from the owner's "Daily closing.xlsx"
   tab gets that tab's date, plus three dates the owner gave in chat on 18-Nov (CRV-0035 → 28-Sep,
   JV-0085/0086 → 06-Oct, JV-0088 → 16-Nov). Each row carries its id AND its current date; the migration
   refuses to run if any row has moved since, or if the count is not exact.
   Usage: node scripts/nf/gen-20261118f-awami-voucher-dates.js <xlsx-vs-nf.json> */
const fs = require('fs'), path = require('path');
const res = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const owner = { 'CRV-35': '2026-09-28', 'JV-85': '2026-10-06', 'JV-86': '2026-10-06', 'JV-88': '2026-11-16' };
const rows = [];
for (const r of res.dateDiffers) {
  const to = owner[r.no] || r.excel_date;
  if (owner[r.no] && owner[r.no] !== r.excel_date) throw new Error(r.no + ': Excel says ' + r.excel_date + ', owner said ' + owner[r.no]);
  rows.push({ id: r.id, key: r.no, no: r.nf_no, from: r.nf_date, to });
}
const crv35 = res.onlyInNF.find(r => r.no === 'CRV-35');
if (!crv35) throw new Error('CRV-35 not found');
rows.push({ id: crv35.id, key: crv35.no, no: crv35.nf_no, from: crv35.nf_date, to: owner['CRV-35'] });
// The one numberless voucher on the 05-Oct sheet: cash 28,00,000 put into BOP. The Excel's 12-Oct tab
// ("Cash deposited in BOP from cash in hand (12-Oct)") and its BOP Reco tab both date it 12-Oct.
rows.push({ id: 'a52f2b8a-2108-46a3-9217-335416b0df3b', key: 'XFR 28,00,000', no: 'XFR-BANK-E4DA11D4-89D7-43AE-B502-255BE2E939A6', from: '2026-10-05', to: '2026-10-12' });
for (const k of Object.keys(owner)) if (!rows.some(r => r.key === k)) throw new Error('owner date not used: ' + k);
rows.sort((a, b) => a.to.localeCompare(b.to) || a.no.localeCompare(b.no));
const N = rows.length;
const sql = `-- ══ NexuFinance Awami: every voucher on its real date (20261118f) ══
-- NOT APPLIED until the owner says yes.
--
-- Head office kept posting into the 05-Oct day sheet (DC-007) from 05-Oct to 16-Nov, so those vouchers
-- all carry 05-Oct. The owner's "D:\\Claude Cowork\\Daily closing.xlsx" has one tab per real date. Matched
-- by voucher number (scripts/nf/compare-daily-closing-xlsx.js), each voucher gets its tab's date.
-- Three dates are the owner's own words in chat (18-Nov): CRV-0035 → 28-Sep (money reached BOP on
-- 28-Sep, per the BOP Reco tab), JV-0085 / JV-0086 → 06-Oct, JV-0088 → 16-Nov.
--
-- Only nf_vouchers.voucher_date changes. Amounts, heads, parties, legs, days and voucher numbers do not.
-- The vouchers stay in the day sheet they were posted in (a voucher can never change day). None of them
-- is in an IIF batch. ${N} vouchers; each row names its id and its current date, and the migration stops
-- if any row no longer matches or if the count is not exactly ${N}.

DO $m$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b JOIN (VALUES
${rows.map(r => `    ('${r.id}'::uuid)`).join(',\n')}
  ) x(id) ON x.id = b.voucher_id) THEN
    RAISE EXCEPTION 'a voucher in this list is already in an IIF batch — stop';
  END IF;

  UPDATE public.nf_vouchers v SET voucher_date = x.to_date, updated_at = now()
  FROM (VALUES
${rows.map(r => `    ('${r.id}'::uuid, '${r.no}', DATE '${r.from}', DATE '${r.to}')`).join(',\n')}
  ) x(id, voucher_no, from_date, to_date)
  WHERE v.id = x.id AND v.voucher_no = x.voucher_no AND v.voucher_date = x.from_date
    AND v.company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> ${N} THEN
    RAISE EXCEPTION 'expected ${N} vouchers to move, % matched — something changed since the list was made', n;
  END IF;
END $m$;
`;
const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118f_nf_awami_voucher_real_dates.sql');
fs.writeFileSync(f, sql);
const per = {}; rows.forEach(r => per[r.to] = (per[r.to] || 0) + 1);
console.log('written', f, 'rows', N);
console.log(JSON.stringify(per));
fs.writeFileSync(f.replace('.sql', '.list.csv'), 'voucher_no,manual_no,from,to\n' + rows.map(r => `${r.no},${r.key},${r.from},${r.to}`).join('\n') + '\n');
