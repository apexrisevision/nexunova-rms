#!/usr/bin/env node
/* Dry run of 20261119h (cash moved between Head Office Cash and Site Cash): migration + checks as the director and
   Sharose, in ONE request ending in RAISE — rolled back. Uses the open day, or opens the next one inside the
   transaction. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119h_nf_cash_box_transfer.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE d text; BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL; RETURN SQLERRM || ' ' || COALESCE(d, ''); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.bal(co uuid, code text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(debit - credit), 0) FROM nf_voucher_legs WHERE company_id = co AND account_code = code $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; day uuid; bd date; j jsonb; r text; out text := '';
  ok int := 0; bad int := 0; h0 numeric; s0 numeric; n0 bigint; t jsonb; rep jsonb;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id, business_date INTO day, bd FROM nf_days WHERE company_id = co AND status = 'OPEN' ORDER BY business_date DESC LIMIT 1;
  IF day IS NULL THEN
    PERFORM pg_temp.as_(sh);
    PERFORM public.nf_start_next_day(co, (now() AT TIME ZONE 'Asia/Karachi')::date);
    SELECT id, business_date INTO day, bd FROM nf_days WHERE company_id = co AND status = 'OPEN';
    out := out || E'\n-- no day was open: opened ' || bd || ' as Sharose (rolled back)';
  ELSE out := out || E'\n-- open day ' || bd || ' (' || (SELECT closing_no FROM nf_days WHERE id = day) || ')'; END IF;
  h0 := pg_temp.bal(co, '10100'); s0 := pg_temp.bal(co, '10200');
  SELECT count(*) INTO n0 FROM nf_lines WHERE company_id = co;

  -- 1. head office gives Site Cash 50,000 (Cash payment popup, "Cash given to Site Cash")
  PERFORM pg_temp.as_(rashid);
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CPV', '9901', 'Cash', 'Petty', 50000, NULL, %L)$s$, day, bd));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n01 PASS director: Cash given to Site Cash 50,000 (CPV, paper no. 9901)'; ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || r; END IF;
  IF pg_temp.bal(co, '10100') = h0 - 50000 AND pg_temp.bal(co, '10200') = s0 + 50000 AND (SELECT count(*) FROM nf_lines WHERE company_id = co) = n0 THEN
    ok := ok + 1; out := out || E'\n02 PASS Head Office Cash −50,000, Site Cash +50,000; not money received or paid';
  ELSE bad := bad + 1; out := out || E'\n02 FAIL balances / lines'; END IF;
  j := public.nf_get_day(co, bd);
  t := (SELECT x FROM jsonb_array_elements(j->'transfers') x WHERE x->>'manual_no' = '9901');
  IF t IS NOT NULL AND t->>'from' ILIKE 'Head Office%' AND t->>'to' ILIKE 'Site%' THEN
    ok := ok + 1; out := out || E'\n03 PASS on the director''s sheet under Transfers: ' || (t->>'from') || ' → ' || (t->>'to') || ' · ' || (t->>'narration');
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || COALESCE((j->'transfers')::text, 'null'); END IF;

  -- 2. Sharose: he sees it (as from Head Office), and cannot book the same cash again from his side
  PERFORM pg_temp.as_(sh);
  j := public.nf_get_day(co, bd);
  IF (j->'site'->'transfers')::text LIKE '%50000%' THEN ok := ok + 1; out := out || E'\n04 PASS Sharose''s sheet shows it under "From Head Office": ' || (j->'site'->'transfers')::text;
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || COALESCE((j->'site')::text, 'null'); END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CRV', 'S-CRV-9902', 'Cash', 'Petty', 50000, NULL, %L)$s$, day, bd));
  IF r LIKE 'NF:DUPLICATE_ENTRY%Head Office%hidden%' THEN ok := ok + 1; out := out || E'\n05 PASS Sharose books "Cash received from Head Office" 50,000 again: refused, told only Head Office has it';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || r; END IF;
  -- 3. Sharose returns 10,000 to head office (his Cash payment popup)
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CPV', 'S-CPV-9903', 'Petty', 'Cash', 10000, NULL, %L)$s$, day, bd));
  IF r = 'ok' AND pg_temp.bal(co, '10200') = s0 + 40000 AND pg_temp.bal(co, '10100') = h0 - 40000 THEN
    ok := ok + 1; out := out || E'\n06 PASS Sharose: Cash given to Head Office Cash 10,000 — Site Cash now +40,000, Head Office Cash −40,000';
  ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || r; END IF;
  j := public.nf_get_day(co, bd);
  IF (SELECT count(*) FROM jsonb_array_elements(j->'transfers') x WHERE x->>'manual_no' = 'S-CPV-9903' AND (x->>'mine')::boolean) = 1
     AND j::text NOT LIKE '%9901%' AND jsonb_array_length(j->'position'->'rows') = 1 THEN
    ok := ok + 1; out := out || E'\n07 PASS his Transfers list has his own only; position Site Cash only';
  ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || (j->'transfers')::text; END IF;
  -- 4. his own side only
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CPV', NULL, 'Cash', 'Petty', 10, NULL, %L)$s$, day, bd));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n08 PASS he cannot give out Head Office Cash'; ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CRV', NULL, 'Petty', 'Cash', 10, NULL, %L)$s$, day, bd));
  IF r LIKE 'NF:NOT_YOUR_CASH_BOX%' THEN ok := ok + 1; out := out || E'\n09 PASS he cannot book cash received into Head Office Cash'; ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || r; END IF;
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CPV', NULL, 'Petty', 'Bank', 10, NULL, %L)$s$, day, bd));
  IF r LIKE 'NF:TRANSFER_CASH_AND_SITE_BOX_ONLY%' THEN ok := ok + 1; out := out || E'\n10 PASS only between the two cash boxes (the bank has its own deposit / withdrawal)'; ELSE bad := bad + 1; out := out || E'\n10 FAIL ' || r; END IF;

  -- 5. head office books his 10,000 again from its side: refused, names Sharose
  PERFORM pg_temp.as_(rashid);
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CRV', NULL, 'Petty', 'Cash', 10000, NULL, %L)$s$, day, bd));
  IF r LIKE 'NF:DUPLICATE_ENTRY%Sharose%' THEN ok := ok + 1; out := out || E'\n11 PASS head office books the 10,000 again: refused, names Sharose';
  ELSE bad := bad + 1; out := out || E'\n11 FAIL ' || r; END IF;
  -- a different amount is a different transfer
  r := pg_temp.try(format($s$SELECT public.nf_save_cash_transfer(%L, 'CRV', NULL, 'Petty', 'Cash', 7000, NULL, %L)$s$, day, bd));
  IF r = 'ok' THEN ok := ok + 1; out := out || E'\n12 PASS a different amount (7,000) is saved'; ELSE bad := bad + 1; out := out || E'\n12 FAIL ' || r; END IF;
  -- the paper number is needed before Close day
  j := public.nf_get_day(co, bd);
  IF (SELECT bool_or((x->>'number_pending')::boolean) FROM jsonb_array_elements(j->'transfers') x WHERE x->>'manual_no' IS NULL) THEN
    ok := ok + 1; out := out || E'\n13 PASS the one without a paper number shows "manual no. pending"';
  ELSE bad := bad + 1; out := out || E'\n13 FAIL ' || (j->'transfers')::text; END IF;
  -- the WhatsApp brief lists them under Cheques & transfers, not as money in / out
  rep := public.nf_day_report(co, bd, 'combined');
  IF (SELECT count(*) FROM jsonb_array_elements(rep->'transfers') x WHERE (x->>'amount')::numeric IN (50000, 10000, 7000)) = 3
     AND (rep::text NOT LIKE '%Cash given to%' OR (SELECT count(*) FROM jsonb_array_elements(rep->'paid') x WHERE x->>'for' ILIKE '%Cash given%') = 0) THEN
    ok := ok + 1; out := out || E'\n14 PASS Combined brief: all three under Cheques & transfers, none in money paid';
  ELSE bad := bad + 1; out := out || E'\n14 FAIL ' || (rep->'transfers')::text; END IF;
  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT[\s\S]*?(?=\nCONTEXT|$)/.exec(msg);
  console.log(m ? m[0] : (res.ok ? 'NO EXCEPTION' : msg));
  console.log('after rollback: nf_save_cash_transfer exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = 'nf_save_cash_transfer'`)),
    '| open days:', JSON.stringify(await q(`select business_date, status from nf_days where company_id = '${CO}' and status <> 'CLOSED'`)));
})();
