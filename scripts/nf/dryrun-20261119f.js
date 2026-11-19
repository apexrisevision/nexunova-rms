#!/usr/bin/env node
/* Dry run of 20261119f (cash deposited in the bank): migration + checks as Sharose and the director, in ONE request
   ending in RAISE — rolled back. Uses the open day, or opens the next one inside the transaction. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119f_nf_cash_deposit_to_bank.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE d text; BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL; RETURN SQLERRM || ' ' || COALESCE(d, ''); END $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; day uuid; j jsonb; r text; out text := ''; ok int := 0; bad int := 0;
  p0 numeric; b0 numeric; t jsonb;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id INTO day FROM nf_days WHERE company_id = co AND status = 'OPEN' ORDER BY business_date DESC LIMIT 1;
  IF day IS NULL THEN
    PERFORM pg_temp.as_(sh);
    PERFORM public.nf_start_next_day(co, (now() AT TIME ZONE 'Asia/Karachi')::date);
    SELECT id INTO day FROM nf_days WHERE company_id = co AND status = 'OPEN';
    out := out || E'\n-- no day was open: opened ' || (SELECT business_date FROM nf_days WHERE id = day) || ' as Sharose (rolled back)';
  END IF;
  SELECT sum(debit - credit) FILTER (WHERE account_code = '10200'), sum(debit - credit) FILTER (WHERE account_code = '10300') INTO p0, b0
    FROM nf_voucher_legs WHERE company_id = co;

  PERFORM pg_temp.as_(sh);
  r := pg_temp.try(format($s$SELECT public.nf_save_deposit(%L, 'S-CPV-9901', 'Petty', 50000, 'DS-77123', NULL, (SELECT business_date FROM nf_days WHERE id = %L))$s$, day, day));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n01 PASS Sharose deposits 50,000 from Site Cash (slip DS-77123)'; ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || r; END IF;
  IF (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = co AND account_code = '10200') = p0 - 50000
     AND (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = co AND account_code = '10300') = b0 + 50000 THEN
    ok := ok + 1; out := out || E'\n02 PASS Site Cash −50,000, BOP +50,000; no expense';
  ELSE bad := bad + 1; out := out || E'\n02 FAIL balances'; END IF;
  j := public.nf_get_day(co, (SELECT business_date FROM nf_days WHERE id = day));
  t := j->'transfers'->0;
  IF jsonb_array_length(j->'transfers') = 1 AND t->>'from' = 'Site Cash' AND t->>'to' = 'BOP bank' AND (t->>'mine')::boolean AND t->>'manual_no' = 'S-CPV-9901' THEN
    ok := ok + 1; out := out || E'\n03 PASS it shows on his sheet under Transfers: ' || (t->>'from') || ' → ' || (t->>'to') || ' ' || (t->>'amount');
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || COALESCE((j->'transfers')::text, 'null'); END IF;
  IF (SELECT x->>'closing' FROM jsonb_array_elements(j->'position'->'rows') x WHERE x->>'via' = 'Petty')::numeric =
     (SELECT x->>'opening' FROM jsonb_array_elements(j->'position'->'rows') x WHERE x->>'via' = 'Petty')::numeric
     + (SELECT (x->>'received')::numeric - (x->>'paid')::numeric + (x->>'transfers')::numeric FROM jsonb_array_elements(j->'position'->'rows') x WHERE x->>'via' = 'Petty')
     AND jsonb_array_length(j->'position'->'rows') = 1 THEN
    ok := ok + 1; out := out || E'\n04 PASS his position: Site Cash only, transfers ' || (SELECT x->>'transfers' FROM jsonb_array_elements(j->'position'->'rows') x);
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || (j->'position')::text; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_deposit(%L, NULL, 'Cash', 10, 'DS-1', NULL, CURRENT_DATE)$s$, day));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n05 PASS he cannot deposit Head Office Cash'; ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_deposit(%L, NULL, 'Petty', 10, '', NULL, CURRENT_DATE)$s$, day));
  IF r LIKE 'NF:REFERENCE_REQUIRED%' THEN ok := ok + 1; out := out || E'\n06 PASS a deposit needs its slip number'; ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || r; END IF;
  IF (j->'transfers'->0->>'number_pending')::boolean = false THEN ok := ok + 1; out := out || E'\n07 PASS its paper number is kept (S-CPV-9901)'; ELSE bad := bad + 1; out := out || E'\n07 FAIL number'; END IF;

  -- head office books the same slip again
  PERFORM pg_temp.as_(rashid);
  r := pg_temp.try(format($s$SELECT public.nf_save_deposit(%L, NULL, 'Cash', 50000, 'DS-77123', 'Cash deposited in BOP', (SELECT business_date FROM nf_days WHERE id = %L))$s$, day, day));
  IF r LIKE 'NF:DUPLICATE_ENTRY%Sharose%' THEN ok := ok + 1; out := out || E'\n08 PASS head office books the same slip: refused, names Sharose';
  ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || r; END IF;
  j := public.nf_get_day(co, (SELECT business_date FROM nf_days WHERE id = day));
  IF jsonb_array_length(j->'transfers') >= 1 AND jsonb_array_length(j->'position'->'rows') = 3 THEN ok := ok + 1; out := out || E'\n09 PASS the director sees the transfer and all three boxes';
  ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || (j->'transfers')::text; END IF;
  -- a head office transfer on the same day is not in his list
  r := pg_temp.try(format($s$SELECT public.nf_save_deposit(%L, NULL, 'Cash', 1000, 'HO-555', 'HO deposit', (SELECT business_date FROM nf_days WHERE id = %L))$s$, day, day));
  PERFORM pg_temp.as_(sh);
  j := public.nf_get_day(co, (SELECT business_date FROM nf_days WHERE id = day));
  IF r = 'ok' AND jsonb_array_length(j->'transfers') = 1 AND j::text NOT LIKE '%HO-555%' THEN ok := ok + 1; out := out || E'\n10 PASS a head office deposit the same day does not appear on his sheet';
  ELSE bad := bad + 1; out := out || E'\n10 FAIL ' || r || ' ' || (j->'transfers')::text; END IF;
  -- he can take his own deposit back
  r := pg_temp.try(format($s$SELECT public.nf_delete_line(%L, %s)$s$, (j->'transfers'->0->>'line_id'), (j->'transfers'->0->>'version')));
  IF r = 'ok' AND (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = co AND account_code = '10200') = p0 THEN ok := ok + 1; out := out || E'\n11 PASS he deletes his own deposit; Site Cash back as it was';
  ELSE bad := bad + 1; out := out || E'\n11 FAIL ' || r; END IF;
  -- the withdrawal of a cheque head office already cashed: short message
  r := pg_temp.try(format($s$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Petty', 300000, '1313826265', 'Cash for the site', DATE '2026-11-16')$s$, day));
  IF r LIKE 'NF:DUPLICATE_%' AND r NOT LIKE '%BPV%' THEN ok := ok + 1; out := out || E'\n12 PASS re-cashing a Head Office cheque: refused without naming the voucher — ' || r;
  ELSE bad := bad + 1; out := out || E'\n12 FAIL ' || r; END IF;
  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT[\s\S]*?(?=\nCONTEXT|$)/.exec(msg);
  console.log(m ? m[0] : (res.ok ? 'NO EXCEPTION' : msg));
  console.log('after rollback: nf_save_deposit exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = 'nf_save_deposit'`)),
    '| open days:', JSON.stringify(await q(`select business_date, status from nf_days where company_id = '${CO}' and status <> 'CLOSED'`)));
})();
