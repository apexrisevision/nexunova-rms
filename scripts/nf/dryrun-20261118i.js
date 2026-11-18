#!/usr/bin/env node
/* Dry run of 20261118i (one closing, two cash boxes): migration + checks as Sharose and as the director,
   in ONE request ending in RAISE, so every test write rolls back. Uses the open 18-Nov day (DC-009). */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118i_nf_one_closing_two_cash_boxes.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; day uuid; ho_line uuid; ho_v uuid; sh_line uuid; sh_v uuid;
  r text; j jsonb; out text := ''; ok int := 0; bad int := 0;
  PROCEDURE_X int;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id INTO day FROM nf_days WHERE company_id = co AND business_date = '2026-11-18' AND status = 'OPEN';

  -- context
  PERFORM pg_temp.as_(sh);
  j := (SELECT m FROM jsonb_array_elements(public.nf_get_context()->'memberships') m LIMIT 1);
  IF j->>'role' = 'accountant' AND j->>'cash_via' = 'Petty' THEN ok := ok + 1; out := out || E'\n01 PASS Sharose: accountant on the site cash box';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || j::text; END IF;

  -- head office enters a line (director, HO cash)
  PERFORM pg_temp.as_(rashid);
  PERFORM public.nf_save_line(day, NULL, 'OUT', 'CPV-9901', 'dry-run HO line', '60400', 'P-W', 'Cash', 100, NULL, NULL);
  SELECT v.id, l.id INTO ho_v, ho_line FROM nf_vouchers v JOIN nf_voucher_legs l ON l.voucher_id = v.id AND l.line_no = 1 WHERE v.day_id = day AND v.manual_no = 'CPV-9901';

  PERFORM pg_temp.as_(sh);
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, NULL, 'OUT', 'S-CPV-9901', 'dry-run site line', '60400', 'P-W', 'Petty', 50, NULL, NULL)$s$, day));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n02 PASS Sharose saves a Site Cash line'; ELSE bad := bad + 1; out := out || E'\n02 FAIL ' || r; END IF;
  SELECT v.id, l.id INTO sh_v, sh_line FROM nf_vouchers v JOIN nf_voucher_legs l ON l.voucher_id = v.id AND l.line_no = 1 WHERE v.day_id = day AND v.manual_no = 'S-CPV-9901';
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, NULL, 'OUT', 'S-CPV-9902', 'x', '60400', 'P-W', 'Cash', 50, NULL, NULL)$s$, day));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n03 PASS Sharose cannot use Head Office Cash'; ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, NULL, 'IN', 'S-BRV-9901', 'x', '21100', 'GF', 'Bank', 50, NULL, 'Dry Run Party')$s$, day));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n04 PASS Sharose can enter a bank line'; ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, %L, 'OUT', 'CPV-9901', 'changed', '60400', 'P-W', 'Petty', 100, %s, NULL)$s$, day, ho_line, (SELECT version FROM nf_vouchers WHERE id = ho_v)));
  IF r LIKE 'NF:NOT_YOUR_ENTRY%' THEN ok := ok + 1; out := out || E'\n05 PASS Sharose cannot edit a head office line'; ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_delete_line(%L, %s)$s$, ho_line, (SELECT version FROM nf_vouchers WHERE id = ho_v)));
  IF r LIKE 'NF:NOT_YOUR_ENTRY%' THEN ok := ok + 1; out := out || E'\n06 PASS Sharose cannot delete a head office line'; ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_set_manual_no(%L, 'CPV-9999', %s)$s$, ho_v, (SELECT version FROM nf_vouchers WHERE id = ho_v)));
  IF r LIKE 'NF:NOT_YOUR_ENTRY%' THEN ok := ok + 1; out := out || E'\n07 PASS Sharose cannot renumber a head office voucher'; ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, %L, 'OUT', 'S-CPV-9901', 'dry-run site line, edited', '60400', 'P-W', 'Petty', 60, %s, NULL)$s$, day, sh_line, (SELECT version FROM nf_vouchers WHERE id = sh_v)));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n08 PASS Sharose edits his own line'; ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, %L, 'OUT', 'S-CPV-0058', 'Software — Rahid (site cash, Sharose, 18-Nov)', '16100', 'P-W', 'Petty', 10000, %s, NULL)$s$, day,
       (SELECT l.id FROM nf_voucher_legs l JOIN nf_vouchers v ON v.id = l.voucher_id WHERE v.manual_no = 'S-CPV-0058' AND l.line_no = 1), (SELECT version FROM nf_vouchers WHERE manual_no = 'S-CPV-0058')));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n09 PASS the Excel entries posted today are his: he can edit S-CPV-0058'; ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_close_day(%L, %s, NULL)$s$, day, (SELECT version FROM nf_days WHERE id = day)));
  IF r LIKE 'NF:HEAD_OFFICE_ONLY%' THEN ok := ok + 1; out := out || E'\n10 PASS Sharose cannot close the day'; ELSE bad := bad + 1; out := out || E'\n10 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_transfer(%L, 'Cash', 'Petty', 10, DATE '2026-11-18', 'dry-run cash from HO')$s$, day));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n11 PASS Sharose records Head Office Cash -> Site Cash'; ELSE bad := bad + 1; out := out || E'\n11 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 10, '1313899999', 'x', DATE '2026-11-18')$s$, day));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n12 PASS Sharose cannot withdraw from the bank into Head Office Cash'; ELSE bad := bad + 1; out := out || E'\n12 FAIL ' || r; END IF;
  r := pg_temp.try($s$SELECT public.nf_jv_save('${CO}', 'JV-9901', DATE '2026-11-18', 'dry-run JV', '[{"account_code":"60400","floor_code":"P-W","debit":5},{"account_code":"70950","floor_code":"P-W","credit":5}]'::jsonb)$s$);
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n13 PASS Sharose can post a JV'; ELSE bad := bad + 1; out := out || E'\n13 FAIL ' || r; END IF;

  j := public.nf_day_json(day);
  r := (SELECT string_agg(DISTINCT (x->>'by_name') || '/' || coalesce(x->>'by_box', '-') || '/' || (x->>'mine'), ', ') FROM jsonb_array_elements(j->'lines') x);
  IF r LIKE '%Rashid/Cash/false%' AND r LIKE '%Sharose/Petty/true%' THEN ok := ok + 1; out := out || E'\n14 PASS each line says who entered it (as Sharose sees it): ' || r;
  ELSE bad := bad + 1; out := out || E'\n14 FAIL ' || coalesce(r, 'null'); END IF;

  PERFORM pg_temp.as_(rashid);
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, %L, 'OUT', 'S-CPV-9901', 'director fixes it', '60400', 'P-W', 'Petty', 70, %s, NULL)$s$, day, sh_line, (SELECT version FROM nf_vouchers WHERE id = sh_v)));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n15 PASS the director can correct Sharose''s line'; ELSE bad := bad + 1; out := out || E'\n15 FAIL ' || r; END IF;

  -- a head office (Cash box) accountant gets the same limits: the inactive import member, switched on here only
  UPDATE nf_members SET role = 'accountant', active = true WHERE company_id = co AND user_id = '50e3d1be-ef2f-421c-a0f9-2fd2296176e4';
  PERFORM pg_temp.as_('50e3d1be-ef2f-421c-a0f9-2fd2296176e4');
  r := pg_temp.try(format($s$SELECT public.nf_save_line(%L, NULL, 'OUT', 'CPV-9902', 'x', '60400', 'P-W', 'Petty', 5, NULL, NULL)$s$, day));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n16 PASS a head office accountant cannot use Site Cash'; ELSE bad := bad + 1; out := out || E'\n16 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_delete_line(%L, %s)$s$, sh_line, (SELECT version FROM nf_vouchers WHERE id = sh_v)));
  IF r LIKE 'NF:NOT_YOUR_ENTRY%' THEN ok := ok + 1; out := out || E'\n17 PASS …nor delete Sharose''s line'; ELSE bad := bad + 1; out := out || E'\n17 FAIL ' || r; END IF;

  r := (SELECT count(*)::text FROM nf_vouchers WHERE company_id = co AND created_by = sh AND manual_no LIKE 'S-C%' AND manual_no NOT LIKE '%99%');
  IF r = '62' THEN ok := ok + 1; out := out || E'\n18 PASS 62 site vouchers now recorded as entered by Sharose'; ELSE bad := bad + 1; out := out || E'\n18 FAIL ' || r; END IF;
  r := has_function_privilege('authenticated', 'public.nf_assert_own_voucher(uuid)', 'EXECUTE')::text;
  IF r = 'false' THEN ok := ok + 1; out := out || E'\n19 PASS the new helpers are not callable from the API'; ELSE bad := bad + 1; out := out || E'\n19 FAIL ' || r; END IF;

  PERFORM pg_temp.as_(sh);
  r := pg_temp.try($s$SELECT public.nf_get_trial_balance('${CO}', DATE '2026-11-18')$s$);
  IF r LIKE 'NF:HEAD_OFFICE_ONLY%' THEN ok := ok + 1; out := out || E'\n20 PASS Sharose cannot open a report (trial balance)'; ELSE bad := bad + 1; out := out || E'\n20 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_get_report_day(%L)$s$, day));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n21 PASS …but can print the day''s closing'; ELSE bad := bad + 1; out := out || E'\n21 FAIL ' || r; END IF;
  PERFORM pg_temp.as_(rashid);
  r := pg_temp.try($s$SELECT public.nf_get_trial_balance('${CO}', DATE '2026-11-18')$s$);
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n22 PASS the director still opens it'; ELSE bad := bad + 1; out := out || E'\n22 FAIL ' || r; END IF;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`.replace('  PROCEDURE_X int;\n', '');
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT[\s\S]*?(?=\nCONTEXT|$)/.exec(msg);
  console.log(m ? m[0] : (res.ok ? 'NO EXCEPTION — check for leftovers' : msg));
  console.log('after rollback:', JSON.stringify(await q(`select m.role, (select count(*) from information_schema.columns where table_name = 'nf_members' and column_name = 'cash_via') has_col from nf_members m join app_users a on a.auth_user_id = m.user_id where a.username = 'sharose' and m.company_id = '${CO}'`)));
})();
