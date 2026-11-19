#!/usr/bin/env node
/* Dry run of 20261119i (delete token #317, Riaz Ahmad, SF-208, 1,00,000, 18-Nov): the migration and the checks in
   ONE request ending in RAISE — rolled back. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119i_nf_awami_delete_token_317.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const SNAP = `jsonb_build_object(
  'vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}'),
  'ho', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10100'),
  'site', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10200'),
  'bop', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10300'),
  'tokens', (SELECT sum(credit - debit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '21100'),
  'v317', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}' AND voucher_no = 'CRV-000062'),
  'sf208', (SELECT jsonb_build_object('status', r.status, 'token', r.token_amount, 'received', r.token_received, 'client', r.client_name)
              FROM reservations r JOIN units u ON u.id = r.unit_id WHERE u.company_id = '${CO}' AND u.unit_code = 'SF-208' ORDER BY r.created_at DESC LIMIT 1),
  'days', (SELECT jsonb_object_agg(closing_no, status) FROM nf_days WHERE company_id = '${CO}' AND business_date >= DATE '2026-11-16'))`;
(async () => {
  const sql = `BEGIN;
CREATE TEMP TABLE _b AS SELECT ${SNAP} AS s;
${MIG}
DO $t$ DECLARE a jsonb := ${SNAP}; b jsonb := (SELECT s FROM _b);
  r18 jsonb; r19 jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '315f2852-852f-4653-9253-a5a27a7828c8', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '315f2852-852f-4653-9253-a5a27a7828c8', true);
  r18 := public.nf_day_report('${CO}', DATE '2026-11-18', 'site');
  r19 := public.nf_day_report('${CO}', DATE '2026-11-19', 'site');
  RAISE EXCEPTION 'DRYRUN_RESULT %', jsonb_build_object('before', b, 'after', a,
    'site_18', jsonb_build_object('boxes', r18->'boxes', 'received', r18->'received'),
    'site_19_boxes', r19->'boxes',
    'audit', (SELECT jsonb_agg(jsonb_build_object('entity', entity, 'action', action, 'after', after)) FROM nf_audit
               WHERE company_id = '${CO}' AND at >= now() AND entity IN ('rms_token', 'nf_days')))::text;
END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(msg); process.exit(1); }
  console.log(JSON.stringify(JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, '')), null, 1));
  console.log('after rollback: CRV-000062 still there:', JSON.stringify(await q(`select count(*) n from nf_vouchers where company_id = '${CO}' and voucher_no = 'CRV-000062'`)));
})();
