#!/usr/bin/env node
/* Dry run of 20261118h: BEGIN; migration; checks; RAISE — everything rolls back.
   Checks: site cash box (10200) by ledger at the end of every day = the plan; head office cash and BOP
   today; DC-007 / 17-Nov / 18-Nov stored or live positions; number of vouchers; nothing else moved. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('../_sbq');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118h_nf_awami_site_entries_05_18_nov.sql'), 'utf8');
const PLAN = { '2026-11-05': 55250, '2026-11-06': 50250, '2026-11-07': 41420, '2026-11-08': 40160, '2026-11-09': 38240, '2026-11-10': 35890,
  '2026-11-11': 32420, '2026-11-12': 29770, '2026-11-13': 23950, '2026-11-14': 15350, '2026-11-15': 14140, '2026-11-16': 53200,
  '2026-11-17': 39250, '2026-11-18': 146450 };
const bal = (acc, d) => `(SELECT coalesce(sum(l.debit - l.credit), 0) FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id
   WHERE v.company_id = '${CO}' AND v.status = 'POSTED' AND l.account_code = '${acc}'${d ? ` AND v.voucher_date <= DATE '${d}'` : ''})`;
const snap = `jsonb_build_object('vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}'),
  'ho_cash', ${bal('10100')}, 'site_cash', ${bal('10200')}, 'bop', ${bal('10300')},
  'expense_total', (SELECT sum(l.debit - l.credit) FROM nf_voucher_legs l WHERE l.company_id = '${CO}' AND l.account_code >= '50000'),
  'token_total', ${bal('21100')})`;
const BODY = `
DO $t$
DECLARE r jsonb := '{}'; d text; dc record; bad text := '';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','315f2852-852f-4653-9253-a5a27a7828c8','role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub','315f2852-852f-4653-9253-a5a27a7828c8', true);
${Object.entries(PLAN).map(([d, v]) => `  IF ${bal('10200', d)} <> ${v} THEN bad := bad || ' ${d}=' || ${bal('10200', d)} || '(plan ${v})'; END IF;`).join('\n')}
  r := jsonb_build_object('before', current_setting('dry.before')::jsonb, 'after', ${snap}, 'site_cash_days_not_matching_plan', NULLIF(bad, ''));
  FOR dc IN SELECT d0.closing_no, d0.business_date, d0.status, d0.close_cash, d0.close_petty, d0.close_bank, p.close_cash pc, p.close_petty pp, p.close_bank pb
              FROM nf_days d0, public.nf_position_row(d0.id) p WHERE d0.company_id = '${CO}' AND d0.business_date >= '2026-10-05' ORDER BY d0.business_date LOOP
    r := r || jsonb_build_object(coalesce(dc.closing_no, '?') || ' ' || dc.business_date, jsonb_build_object('status', dc.status,
      'stored', jsonb_build_array(dc.close_cash, dc.close_petty, dc.close_bank), 'live', jsonb_build_array(dc.pc, dc.pp, dc.pb)));
  END LOOP;
  r := r || jsonb_build_object('repointed', (SELECT jsonb_agg(v.manual_no || ' ' || l.account_code || ' Dr ' || l.debit || ' Cr ' || l.credit ORDER BY v.manual_no, l.line_no)
     FROM nf_vouchers v JOIN nf_voucher_legs l ON l.voucher_id = v.id WHERE v.company_id = '${CO}' AND v.manual_no IN ('BPV-0026','BPV-0046','CPV-0170','CPV-0171','CPV-0172')),
     'site_vouchers_by_date', (SELECT jsonb_object_agg(dt, n) FROM (SELECT v.voucher_date::text dt, count(*) n FROM nf_vouchers v WHERE v.company_id = '${CO}' AND v.narration LIKE '%site cash, Sharose%' GROUP BY 1) x),
     'audit_actors', (SELECT jsonb_agg(DISTINCT actor_name) FROM nf_audit WHERE company_id = '${CO}' AND at >= now()));
  RAISE EXCEPTION 'DRYRUN_RESULT %', r::text;
END $t$;`;
(async () => {
  const query = `BEGIN;\nSELECT set_config('dry.before', (${snap})::text, true);\n${MIG}\n${BODY}`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const t = await res.text();
  let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(res.ok ? 'NO EXCEPTION — check for leftovers' : msg); process.exit(1); }
  console.log(JSON.stringify(JSON.parse(m[1]), null, 1));
})();
