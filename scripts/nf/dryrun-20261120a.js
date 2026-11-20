#!/usr/bin/env node
/* Dry run of 20261120a (NexuFinance → RMS token sync for units with no active hold): the migration (with its
   backfill) and the checks in ONE request ending in RAISE — rolled back. Saves are made through nf_save_line as
   Sharose (site box) and as the owner (Head Office) on the open day. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261120a_nf_token_sync_gap.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('nf.token_sync_last', '', true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE d text; BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL; RETURN SQLERRM || ' ' || COALESCE(d, ''); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.hold(co uuid, code text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('unit', u.unit_code, 'status', s.status_name,
    'res', (SELECT jsonb_build_object('client', r.client_name, 'token', r.token_amount, 'received', r.token_received,
              'days', round(extract(epoch FROM r.expiry_date - r.created_at) / 86400), 'by', r.requested_by_name, 'note', r.note)
              FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1))
  FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.company_id = co AND u.unit_code = code $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; day uuid; bd date; fl text;
  j jsonb; r text; out text := ''; ok int := 0; bad int := 0; h jsonb; lst jsonb; ua text; ub text; up text; us text; vid uuid; lid uuid; lver int;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id, business_date INTO day, bd FROM nf_days WHERE company_id = co AND status = 'OPEN';
  SELECT code INTO fl FROM nf_floors WHERE company_id = co ORDER BY (code = 'P-W') DESC, sort LIMIT 1;
  out := out || E'\n-- open day ' || bd;

  -- 1. the backfill (in the migration, as the owner)
  h := pg_temp.hold(co, 'GF-250');
  IF h->'res'->>'client' = 'Ali Haider' AND (h->'res'->>'token')::numeric = 1676250 AND h->>'status' = 'V.Hold' THEN ok := ok + 1; out := out || E'\n01 PASS backfill GF-250: ' || h::text;
  ELSE bad := bad + 1; out := out || E'\n01 FAIL GF-250 ' || COALESCE(h::text, 'null'); END IF;
  h := pg_temp.hold(co, 'GF-251');
  IF h->'res'->>'client' = 'Ali Haider' AND (h->'res'->>'token')::numeric = 1676250 AND h->>'status' = 'V.Hold' THEN ok := ok + 1; out := out || E'\n02 PASS backfill GF-251: ' || h::text;
  ELSE bad := bad + 1; out := out || E'\n02 FAIL GF-251 ' || COALESCE(h::text, 'null'); END IF;
  h := pg_temp.hold(co, 'GF-256');
  IF h->'res'->>'client' = 'Uzair Ahmad' AND (h->'res'->>'token')::numeric = 50000 AND h->>'status' = 'V.Hold' AND (h->'res'->>'days')::int = 30 THEN ok := ok + 1; out := out || E'\n03 PASS backfill GF-256 (was Available): ' || h::text;
  ELSE bad := bad + 1; out := out || E'\n03 FAIL GF-256 ' || COALESCE(h::text, 'null'); END IF;
  PERFORM pg_temp.as_(rashid);
  lst := public.nf_token_sync_list(co);
  IF NOT lst::text ~ 'GF-25[016]' THEN ok := ok + 1; out := out || E'\n04 PASS "Not in RMS" list after the backfill: ' || (SELECT string_agg((x->>'voucher') || ' ' || COALESCE((x->'units'->0->>'result'), ''), '; ') FROM jsonb_array_elements(lst) x);
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || lst::text; END IF;

  -- units to try: two Available with no reservation, one Pagri, one sold with a sale file
  SELECT u.unit_code INTO ua FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.company_id = co AND s.is_available
     AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = u.id) AND u.unit_code ~ '^GF-' ORDER BY u.unit_code LIMIT 1;
  SELECT u.unit_code INTO ub FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.company_id = co AND s.is_available
     AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = u.id) AND u.unit_code ~ '^FF-' ORDER BY u.unit_code LIMIT 1;
  SELECT u.unit_code INTO up FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.company_id = co AND s.status_code = 'PAGRI'
     AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = u.id AND x.status = 'active') ORDER BY u.unit_code LIMIT 1;
  SELECT u.unit_code INTO us FROM units u WHERE u.company_id = co AND EXISTS (SELECT 1 FROM sales x WHERE x.unit_id = u.id AND x.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = u.id AND x.status = 'active') ORDER BY u.unit_code LIMIT 1;
  out := out || E'\n-- trying: Available ' || ua || ', ' || ub || '; Pagri ' || up || '; sold ' || COALESCE(us, '(none without a hold)');

  -- 2. Sharose saves a token for an Available unit: NF yes, RMS no, told on screen
  PERFORM pg_temp.as_(sh);
  j := public.nf_save_line(day, NULL, 'IN', 'S-CRV-9911', 'Token #9911 — Test Buyer, Unit ' || ua, '21100', fl, 'Petty', 25000, NULL, 'Test Buyer');
  IF j->'token_sync'->'units'->0->>'result' LIKE 'no hold in RMS — Head Office%' AND pg_temp.hold(co, ua)->>'res' IS NULL THEN
    ok := ok + 1; out := out || E'\n05 PASS site login saves a token for ' || ua || ': saved in NF, NOT in RMS; the screen gets "' || (j->'token_sync'->'units'->0->>'result') || '"';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || COALESCE((j->'token_sync')::text, 'no token_sync') || ' ' || COALESCE(pg_temp.hold(co, ua)::text, ''); END IF;
  r := pg_temp.try(format('SELECT public.nf_token_sync_list(%L)', co));
  IF r LIKE 'NF:HEAD_OFFICE_ONLY%' THEN ok := ok + 1; out := out || E'\n06 PASS site login cannot open the Not-in-RMS list'; ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || r; END IF;
  SELECT id INTO vid FROM nf_vouchers WHERE company_id = co AND manual_no = 'S-CRV-9911';
  r := pg_temp.try(format('SELECT public.nf_token_sync_retry(%L, %L)', co, vid));
  IF r LIKE 'NF:HEAD_OFFICE_ONLY%' THEN ok := ok + 1; out := out || E'\n07 PASS site login cannot Retry'; ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || r; END IF;

  -- 3. Head Office sees it and presses Retry: the hold is made, the token goes in
  PERFORM pg_temp.as_(rashid);
  lst := public.nf_token_sync_list(co);
  IF lst::text LIKE '%S-CRV-9911%' THEN ok := ok + 1; out := out || E'\n08 PASS Head Office list shows S-CRV-9911 (' || ua || ')'; ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || lst::text; END IF;
  lst := public.nf_token_sync_retry(co, vid);
  h := pg_temp.hold(co, ua);
  IF h->'res'->>'client' = 'Test Buyer' AND (h->'res'->>'token')::numeric = 25000 AND h->>'status' = 'V.Hold' AND lst::text NOT LIKE '%S-CRV-9911%' THEN
    ok := ok + 1; out := out || E'\n09 PASS Retry: ' || h::text || '; gone from the list';
  ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || COALESCE(h::text, '') || ' ' || lst::text; END IF;

  -- 4. Head Office saves a token for another Available unit: the hold is made at once
  j := public.nf_save_line(day, NULL, 'IN', '9912', 'Token #9912 — Second Buyer, Unit ' || ub, '21100', fl, 'Cash', 40000, NULL, 'Second Buyer');
  h := pg_temp.hold(co, ub);
  IF j->'token_sync'->'units'->0->>'result' = 'synced' AND j->'token_sync'->'units'->0->>'hold' = 'V.Hold, 30 days' AND (h->'res'->>'token')::numeric = 40000 AND h->'res'->>'client' = 'Second Buyer' THEN
    ok := ok + 1; out := out || E'\n10 PASS Head Office saves a token for ' || ub || ': V.Hold made, token 40,000, client Second Buyer';
  ELSE bad := bad + 1; out := out || E'\n10 FAIL ' || COALESCE((j->'token_sync')::text, '') || ' ' || COALESCE(h::text, ''); END IF;
  -- deleting it takes the token back off (the hold stays — only the owner releases)
  SELECT g.id, v.version INTO lid, lver FROM nf_voucher_legs g JOIN nf_vouchers v ON v.id = g.voucher_id WHERE v.company_id = co AND v.manual_no = '9912' AND g.line_no = 1;
  PERFORM public.nf_delete_line(lid, lver);
  h := pg_temp.hold(co, ub);
  IF (h->'res'->>'token')::numeric = 0 THEN ok := ok + 1; out := out || E'\n11 PASS deleting it: token back to 0, hold kept'; ELSE bad := bad + 1; out := out || E'\n11 FAIL ' || h::text; END IF;

  -- 5. Pagri and sold: RMS not changed, the reason given
  j := public.nf_save_line(day, NULL, 'IN', '9913', 'Token #9913 — Third Buyer, Unit ' || up, '21100', fl, 'Cash', 10000, NULL, 'Third Buyer');
  IF j->'token_sync'->'units'->0->>'result' = 'Pagri — not synced' AND pg_temp.hold(co, up)->>'res' IS NULL AND pg_temp.hold(co, up)->>'status' = 'Pagri' THEN
    ok := ok + 1; out := out || E'\n12 PASS Pagri ' || up || ': not changed in RMS — "Pagri — not synced"';
  ELSE bad := bad + 1; out := out || E'\n12 FAIL ' || COALESCE((j->'token_sync')::text, '') || ' ' || pg_temp.hold(co, up)::text; END IF;
  IF us IS NOT NULL THEN
    j := public.nf_save_line(day, NULL, 'IN', '9914', 'Token #9914 — Fourth Buyer, Unit ' || us, '21100', fl, 'Cash', 10000, NULL, 'Fourth Buyer');
    IF j->'token_sync'->'units'->0->>'result' LIKE 'sold — a sale file%' AND pg_temp.hold(co, us)->>'res' IS NULL THEN
      ok := ok + 1; out := out || E'\n13 PASS sold ' || us || ': not changed in RMS — "' || (j->'token_sync'->'units'->0->>'result') || '"';
    ELSE bad := bad + 1; out := out || E'\n13 FAIL ' || COALESCE((j->'token_sync')::text, ''); END IF;
  ELSE ok := ok + 1; out := out || E'\n13 SKIP every sold unit has a hold'; END IF;
  -- a plain receipt (not a token) leaves no token_sync
  PERFORM set_config('nf.token_sync_last', '', true);   -- each save is its own request on the screen
  j := public.nf_save_line(day, NULL, 'IN', '9915', 'Misc receipt', (SELECT g.account_code FROM nf_voucher_legs g JOIN nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.company_id = co AND a.via IS NULL AND g.credit > 0 AND g.account_code <> '21100' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1), fl, 'Cash', 100, NULL, NULL);
  IF j->'token_sync' IS NULL THEN ok := ok + 1; out := out || E'\n14 PASS a non-token line carries no RMS message'; ELSE bad := bad + 1; out := out || E'\n14 FAIL ' || (j->'token_sync')::text; END IF;
  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT[\s\S]*?(?=\nCONTEXT|$)/.exec(msg);
  console.log(m ? m[0] : (res.ok ? 'NO EXCEPTION' : msg));
  console.log('after rollback: nf_token_sync_retry exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = 'nf_token_sync_retry'`)),
    '| GF-256 active holds:', JSON.stringify(await q(`select count(*) n from reservations r join units u on u.id = r.unit_id where u.company_id = '${CO}' and u.unit_code = 'GF-256' and r.status = 'active'`)));
})();
