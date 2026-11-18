#!/usr/bin/env node
/* Dry run of 20261118f_nf_awami_voucher_real_dates.sql: BEGIN; migration; checks; RAISE — all rolled back.
   Checks: per-date voucher counts equal the Excel tabs, legs and totals untouched, and the stored closing
   balances of the closed days vs the ledger before and after.
   Usage: node scripts/nf/dryrun-20261118f.js <xlsx-vs-nf.json> */
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('../_sbq');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118f_nf_awami_voucher_real_dates.sql'), 'utf8');
const res = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const xlPer = {};
for (const r of [...res.matched, ...res.dateDiffers]) {
  const to = { 'JV-85': '2026-10-06', 'JV-86': '2026-10-06', 'JV-88': '2026-11-16' }[r.no] || r.excel_date;
  xlPer[to] = (xlPer[to] || 0) + 1;
}
const expected = Object.entries(xlPer).map(([d, n]) => `('${d}'::date, ${n})`).join(',');
const snap = `(SELECT jsonb_build_object(
    'vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}'),
    'legs', (SELECT count(*) FROM nf_voucher_legs WHERE company_id = '${CO}'),
    'leg_hash', (SELECT md5(string_agg(id::text || account_code || debit::text || credit::text || coalesce(party_id::text,''), ',' ORDER BY id)) FROM nf_voucher_legs WHERE company_id = '${CO}'),
    'cash_now', (SELECT sum(l.debit - l.credit) FROM nf_voucher_legs l WHERE l.company_id = '${CO}' AND l.account_code = '10100'),
    'petty_now', (SELECT sum(l.debit - l.credit) FROM nf_voucher_legs l WHERE l.company_id = '${CO}' AND l.account_code = '10200'),
    'bank_now', (SELECT sum(l.debit - l.credit) FROM nf_voucher_legs l WHERE l.company_id = '${CO}' AND l.account_code = '10300'),
    'closed_days', (SELECT jsonb_agg(jsonb_build_object('day', d.closing_no || ' ' || d.business_date,
        'stored', jsonb_build_array(d.close_cash, d.close_petty, d.close_bank),
        'ledger', jsonb_build_array(
          (SELECT coalesce(sum(l.debit - l.credit), 0) FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND l.account_code = '10100' AND v.voucher_date <= d.business_date),
          (SELECT coalesce(sum(l.debit - l.credit), 0) FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND l.account_code = '10200' AND v.voucher_date <= d.business_date),
          (SELECT coalesce(sum(l.debit - l.credit), 0) FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND l.account_code = '10300' AND v.voucher_date <= d.business_date)))
        ORDER BY d.business_date) FROM nf_days d WHERE d.company_id = '${CO}' AND d.status = 'CLOSED')))`;
const BODY = String.raw`
DO $t$
DECLARE before jsonb := current_setting('dry.before')::jsonb; after jsonb := ${snap};
  bad_dates text; dc7_left int;
BEGIN
  SELECT string_agg(coalesce(e.d, a.d)::text || ' excel ' || coalesce(e.n, 0) || ' nf ' || coalesce(a.n, 0), '; ') INTO bad_dates
  FROM (VALUES ${expected}) e(d, n)
  FULL JOIN (SELECT v.voucher_date d, count(*) n FROM nf_vouchers v WHERE v.company_id = '${CO}' AND v.source <> 'IMPORT' AND v.status = 'POSTED'
               AND v.voucher_date BETWEEN '2026-09-19' AND '2026-11-16'
               AND (v.manual_no IS NOT NULL OR v.source = 'DAY') GROUP BY 1) a ON a.d = e.d
  WHERE coalesce(e.n, 0) <> coalesce(a.n, 0);
  SELECT count(*) INTO dc7_left FROM nf_vouchers v JOIN nf_days d ON d.id = v.day_id WHERE d.company_id = '${CO}' AND d.business_date = '2026-10-05' AND v.voucher_date = '2026-10-05';
  RAISE EXCEPTION 'DRYRUN_RESULT %', jsonb_build_object('before', before, 'after', after, 'dates_not_matching_excel', bad_dates, 'dc007_still_dated_05oct', dc7_left)::text;
END $t$;`;
(async () => {
  const query = `BEGIN;\nSELECT set_config('dry.before', ${snap}::text, true);\n${MIG}\n${BODY}`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const msg = r.ok ? 'NO EXCEPTION — check for leftovers' : await r.text();
  const m = /DRYRUN_RESULT (\{.*\})/.exec(JSON.parse(msg).message || msg);
  if (!m) { console.log(msg); process.exit(1); }
  const o = JSON.parse(m[1]);
  console.log(JSON.stringify(o, null, 1));
})();
