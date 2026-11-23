#!/usr/bin/env node
/* Dry run of 20261123a (retire the site cash box) AND its rollback, in ONE request that ends in RAISE —
   nothing is kept. Checks the books are untouched, DC-011 can be closed by head office, Sharose is shut
   out, and the rollback puts every object back. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const M = p => fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', p), 'utf8');
const MIG = M('20261123a_nf_retire_site_box.sql'), RB = M('20261123a_nf_retire_site_box_rollback.sql');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8', SHAROSE = '671bc3d9-f794-4e75-ab18-8fab2feb1466';
const as = uid => `PERFORM set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${uid}', true);`;
const BOOKS = `jsonb_build_object(
  'vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}'),
  'legs', (SELECT count(*) FROM nf_voucher_legs WHERE company_id = '${CO}'),
  'sharose_vouchers', (SELECT count(*) FROM nf_vouchers WHERE company_id = '${CO}' AND created_by = '${SHAROSE}'),
  'cash_10100', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10100'),
  'petty_10200', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10200'),
  'bop_10300', (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '10300'),
  'tokens_21100', (SELECT sum(credit - debit) FROM nf_voucher_legs WHERE company_id = '${CO}' AND account_code = '21100'))`;
const OBJ = `jsonb_build_object(
  'site_tables', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('nf_site_days','nf_site_lines','nf_combined_closings')),
  'site_functions', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'nf\\_site%' OR proname LIKE '\\_nf\\_site%' OR proname IN ('_nf_ho_open_day','_nf_ho_voucher_edit','nf_vouchers_site_match_guard')) AND proname <> '_nf_site_view_day'),
  'match_trigger', (SELECT count(*) FROM pg_trigger WHERE tgname = 'nf_vouchers_site_match_guard'),
  'bill_policies', (SELECT count(*) FROM pg_policies WHERE policyname LIKE 'nf_site_bills%'),
  'bucket', (SELECT count(*) FROM storage.buckets WHERE id = 'nf-site-bills'),
  'role_check', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'nf_members_role_check'),
  'sharose', (SELECT jsonb_build_object('active', active, 'role', role, 'via', cash_via) FROM nf_members WHERE company_id = '${CO}' AND user_id = '${SHAROSE}'),
  'labels', (SELECT jsonb_object_agg(code, via_label) FROM nf_accounts WHERE company_id = '${CO}' AND via IN ('Cash','Petty')),
  'dc011', (SELECT jsonb_build_object('by', CASE created_by WHEN '${RASHID}' THEN 'Head Office' WHEN '${SHAROSE}' THEN 'Sharose' ELSE created_by::text END, 'status', status) FROM nf_days WHERE company_id = '${CO}' AND closing_no = 'DC-011'),
  'guard_trigger_on', (SELECT tgenabled <> 'D' FROM pg_trigger WHERE tgname = 'nf_days_guard'))`;
(async () => {
  const sql = `BEGIN;
CREATE TEMP TABLE _r (k text PRIMARY KEY, v jsonb);
INSERT INTO _r VALUES ('1_before_books', ${BOOKS}), ('1_before_objects', ${OBJ});
${MIG}
INSERT INTO _r VALUES ('2_after_books', ${BOOKS}), ('2_after_objects', ${OBJ});
-- head office can still read and close DC-011; Sharose is shut out
DO $t$ DECLARE d record; j jsonb; BEGIN
  ${as(RASHID)}
  SELECT id, version INTO d FROM nf_days WHERE company_id = '${CO}' AND closing_no = 'DC-011';
  j := public.nf_day_json(d.id);
  INSERT INTO _r VALUES ('3_brief_19nov_mentions', jsonb_build_object('Site Cash', public.nf_day_report('${CO}', DATE '2026-11-19', 'combined')::text LIKE '%Site Cash%', 'Head Office Cash', public.nf_day_report('${CO}', DATE '2026-11-19', 'combined')::text LIKE '%Head Office Cash%', 'Petty cash', public.nf_day_report('${CO}', DATE '2026-11-19', 'combined')::text LIKE '%Petty cash%'));
  INSERT INTO _r VALUES ('3_dc011_lines_seen_by_HO', to_jsonb(jsonb_array_length(COALESCE(j->'lines', '[]'::jsonb))));
  DECLARE res text; BEGIN
    BEGIN
      PERFORM public.nf_close_day(d.id, d.version, NULL);
      res := (SELECT status FROM nf_days WHERE id = d.id) || ' (then undone)';
      RAISE EXCEPTION 'UNDO';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'UNDO' THEN res := 'REFUSED: ' || SQLERRM; END IF; END;
    INSERT INTO _r VALUES ('3_dc011_close_by_HO', to_jsonb(res));
  END;
END $t$;
DO $t$ BEGIN
  ${as(SHAROSE)}
  BEGIN INSERT INTO _r VALUES ('4_sharose_context', public.nf_get_context());
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('4_sharose_context', to_jsonb('refused: ' || SQLERRM)); END;
  BEGIN PERFORM public.nf_day_json((SELECT id FROM nf_days WHERE company_id = '${CO}' AND closing_no = 'DC-011')); INSERT INTO _r VALUES ('4_sharose_open_day', '"ALLOWED"');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('4_sharose_open_day', to_jsonb('refused: ' || SQLERRM)); END;
  BEGIN PERFORM public.nf_list_days('${CO}', DATE '2026-11-01', DATE '2026-11-30'); INSERT INTO _r VALUES ('4_sharose_list_days', '"ALLOWED"');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('4_sharose_list_days', to_jsonb('refused: ' || SQLERRM)); END;
END $t$;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
${RB}
INSERT INTO _r VALUES ('5_after_rollback_books', ${BOOKS}), ('5_after_rollback_objects', ${OBJ});
DO $t$ BEGIN RAISE EXCEPTION 'DRYRUN_RESULT %', (SELECT jsonb_object_agg(k, v) FROM _r)::text; END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(msg.slice(0, 3000)); process.exit(1); }
  console.log(JSON.stringify(JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, '')), null, 1));
  console.log('after the request (nothing kept): ', JSON.stringify(await q(`select (select count(*) from pg_class where relname='nf_site_days') site_days_table, (select active from nf_members where user_id='${SHAROSE}' and company_id='${CO}') sharose_active`)));
})();
