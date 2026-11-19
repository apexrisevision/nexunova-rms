#!/usr/bin/env node
/* Dry run of 20261119e (the site cash box sees its own closing only): migration + checks in ONE request ending in
   RAISE — rolled back. As Sharose: direct table reads (SET ROLE authenticated, so row security applies) and every
   RPC he can call, scanned for Head Office markers; his 18-Nov sheet, the 05-Oct catch-up sheet and his 16-Nov
   WhatsApp report; the duplicate guard. As the director: nothing changed.
   Writes the Sharose day JSON (18-Nov) to <out.json> for the screen mockups.
   Usage: node scripts/nf/dryrun-20261119e.js <out.json> */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119e_nf_site_box_visibility.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const OUTJ = process.argv[2];
// Head Office markers that must never reach the site login: voucher numbers, amounts, balances
const MARK = ['BPV-0043', 'BPV-0044', 'BPV-0045', 'BPV-0046', 'BPV-0026', 'CPV-0170', 'CPV-0171', 'CPV-0172', 'BRV-0079', 'JV-0084', 'JV-0088',
              '415250', '26361788', '28161788', '2642330', '1313826265', 'Khyber Traders', 'Zia ul Haq', 'C/O Waqar'];
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.call(sql text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE r text; d text; BEGIN
  EXECUTE 'SELECT (' || sql || ')::text' INTO r; RETURN COALESCE(r, 'null');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL; RETURN 'REFUSED ' || SQLERRM || ' ' || COALESCE(d, ''); END $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; d18 uuid; d7 uuid; r jsonb := '{}'; k text; v text;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id INTO d18 FROM nf_days WHERE company_id = co AND business_date = '2026-11-18';
  SELECT id INTO d7 FROM nf_days WHERE company_id = co AND business_date = '2026-10-05';

  -- ── Sharose: tables, read directly (row security) ──
  PERFORM pg_temp.as_(sh);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := r || jsonb_build_object('tables', jsonb_build_object(
    'vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = co),
    'vouchers_not_his', (SELECT count(*) FROM nf_vouchers WHERE company_id = co AND created_by IS DISTINCT FROM sh),
    'legs', (SELECT count(*) FROM nf_voucher_legs WHERE company_id = co),
    'legs_on_ho_cash_or_bank', (SELECT count(*) FROM nf_voucher_legs WHERE company_id = co AND account_code IN ('10100', '10300')),
    'lines_view', (SELECT count(*) FROM nf_lines WHERE company_id = co),
    'days', (SELECT count(*) FROM nf_days WHERE company_id = co),
    'pdcs', (SELECT count(*) FROM nf_pdcs WHERE company_id = co),
    'audit', (SELECT count(*) FROM nf_audit WHERE company_id = co),
    'parties (master list, kept)', (SELECT count(*) FROM nf_parties WHERE company_id = co)));
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.as_(sh);

  -- ── Sharose: every RPC he can call ──
  r := r || jsonb_build_object('rpc', jsonb_build_object(
    'get_day 18-Nov', pg_temp.call(format($s$public.nf_get_day(%L, DATE '2026-11-18')$s$, co)),
    'get_day 05-Oct sheet', pg_temp.call(format($s$public.nf_get_day(%L, DATE '2026-10-05')$s$, co)),
    'get_day latest', pg_temp.call(format($s$public.nf_get_day(%L, NULL)$s$, co)),
    'list_days', pg_temp.call(format($s$public.nf_list_days(%L, NULL, NULL)$s$, co)),
    'jv_list', pg_temp.call(format($s$public.nf_jv_list(%L, NULL, NULL)$s$, co)),
    'day_report 16-Nov asks combined', pg_temp.call(format($s$public.nf_day_report(%L, DATE '2026-11-16', 'combined')$s$, co)),
    'day_report 05-Nov', pg_temp.call(format($s$public.nf_day_report(%L, DATE '2026-11-05', 'site')$s$, co)),
    'dup_check BRV-0079', pg_temp.call(format($s$public.nf_dup_check(%L, 'IN', 'Bank', '21100', 20000, 'Token #208 — Irfan Ullah, Unit 5F-501, ref 631813527836', 'Irfan Ullah', DATE '2026-11-14', NULL)$s$, co)),
    'dup_check Zia (warn)', pg_temp.call(format($s$public.nf_dup_check(%L, 'OUT', 'Petty', '53300', 50000, 'Speed money — Zia ul Haq', 'Zia Ul Haq', DATE '2026-11-16', NULL)$s$, co)),
    'save BPV-0045 again', pg_temp.call(format($s$public.nf_save_line(%L, NULL, 'OUT', 'S-BPV-9901', 'Cement — Khyber Traders, chq 6268', '52200', 'P-W', 'Bank', 200000, NULL, 'Khyber Traders')$s$, d18)),
    'report_day (print)', pg_temp.call(format($s$public.nf_get_report_day(%L)$s$, d18)),
    'report (director)', pg_temp.call(format($s$public.nf_get_report(%L)$s$, d18)),
    'unallocated_tokens', pg_temp.call(format($s$public.nf_unallocated_tokens(%L)$s$, co)),
    'site_get_day (retired)', pg_temp.call(format($s$public.nf_site_get_day(%L, DATE '2026-11-18')$s$, co)),
    'day_book', pg_temp.call(format($s$public.nf_day_book(%L, DATE '2026-11-16')$s$, co)),
    'trial_balance', pg_temp.call(format($s$public.nf_get_trial_balance(%L, DATE '2026-11-18')$s$, co)),
    'token_sync_list', pg_temp.call(format($s$public.nf_token_sync_list(%L)$s$, co)),
    'list_audit', pg_temp.call(format($s$public.nf_list_audit(%L)$s$, d18))));

  -- ── the director: unchanged ──
  PERFORM pg_temp.as_(rashid);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := r || jsonb_build_object('director_tables', jsonb_build_object('vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = co),
          'days', (SELECT count(*) FROM nf_days WHERE company_id = co)));
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.as_(rashid);
  r := r || jsonb_build_object('director', jsonb_build_object(
    'combined 16-Nov', public.nf_day_report(co, DATE '2026-11-16', 'combined'),
    'get_day 18-Nov rows', public.nf_get_day(co, DATE '2026-11-18')->'position'->'rows',
    'dup_check BRV-0079 as director (own, so none)', public.nf_dup_check(co, 'IN', 'Bank', '21100', 20000, 'Token #208 — ref 631813527836', 'Irfan Ullah', DATE '2026-11-14', NULL)));
  RAISE EXCEPTION 'DRYRUN_RESULT %', r::text;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const msg = JSON.parse(await res.text()).message;
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg); if (!m) { console.log(msg); process.exit(1); }
  const R = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, ''));
  console.log('SHAROSE — tables read directly:', JSON.stringify(R.tables));
  let leaks = 0;
  for (const [k, v] of Object.entries(R.rpc)) {
    const hits = MARK.filter(x => v.includes(x));
    const refused = v.startsWith('REFUSED');
    if (hits.length) leaks++;
    console.log((hits.length ? 'LEAK ' : 'ok   ') + k.padEnd(34), refused ? v.slice(0, 110) : (hits.length ? 'found: ' + hits.join(', ') : v.length + ' chars, no Head Office marker'));
  }
  const g18 = JSON.parse(R.rpc['get_day 18-Nov']), g7 = JSON.parse(R.rpc['get_day 05-Oct sheet']), wr = JSON.parse(R.rpc['day_report 16-Nov asks combined']);
  const row = j => j.position.rows.map(x => x.label + ' ' + x.opening + ' → ' + x.closing).join(', ');
  console.log('\nSharose 18-Nov sheet:', row(g18), '| lines', g18.lines.length, '| site extra', JSON.stringify(g18.site));
  console.log('Sharose 05-Oct catch-up sheet:', row(g7), '| lines', g7.lines.length, '| site extra', JSON.stringify(g7.site));
  console.log('Sharose 16-Nov WhatsApp:', wr.view, wr.boxes.map(b => b.label + ' ' + b.opening + ' → ' + b.closing).join(', '), '| transfers', JSON.stringify(wr.transfers), '| paid', JSON.stringify(wr.paid.map(x => [x.no, x.for, x.amount])));
  console.log('Duplicate guard (Sharose): BRV-0079 →', R.rpc['dup_check BRV-0079'], '| BPV-0045 save →', R.rpc['save BPV-0045 again'].slice(0, 120));
  console.log('\nDIRECTOR — tables:', JSON.stringify(R.director_tables), '| combined 16-Nov:', R.director['combined 16-Nov'].boxes.map(b => b.label + ' ' + b.closing).join(', '),
    '| paid', R.director['combined 16-Nov'].paid.reduce((t, x) => t + +x.amount, 0), '| 18-Nov rows', R.director['get_day 18-Nov rows'].length);
  console.log('\nRPC leaks:', leaks);
  if (OUTJ) fs.writeFileSync(OUTJ, JSON.stringify({ day18: g18, day7: g7 }));
  console.log('after rollback: helper exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = '_nf_site_view_day'`)));
})();
