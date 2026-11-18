#!/usr/bin/env node
/* Dry run of 20261119b (duplicate guard + RMS token sync + backfill): migration + checks in ONE request ending in
   RAISE — everything rolls back, the RMS holds included. Runs as Sharose and as the director. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119b_nf_dup_guard_rms_token_sync.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM || ' ' || COALESCE((SELECT NULL), ''); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.trydetail(sql text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE d text; BEGIN
  EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL; RETURN SQLERRM || ' | ' || COALESCE(d, ''); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.tok(u text) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT r.token_amount::text || '/' || COALESCE(r.client_name, '-') FROM reservations r JOIN units un ON un.id = r.unit_id JOIN projects p ON p.id = un.project_id
   WHERE p.company_id = '${CO}' AND upper(un.unit_code) = u AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1), 'no hold') $f$;
DO $t$
DECLARE co constant uuid := '${CO}'; rashid constant uuid := '${RASHID}'; sh uuid; day uuid; r text; j jsonb; out text := ''; ok int := 0; bad int := 0; lid uuid; vid uuid; ver int;
BEGIN
  SELECT auth_user_id INTO sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT id INTO day FROM nf_days WHERE company_id = co AND business_date = '2026-11-18' AND status = 'OPEN';

  -- unit codes read from a description
  r := (SELECT string_agg(x, ' ; ') FROM (VALUES
         (array_to_string(public._nf_units_in('Token #317 — Riaz Ahmad, Unit SF-208 (site cash, Sharose, 18-Nov)'), ',')),
         (array_to_string(public._nf_units_in('Token #210 — Ali Haider, Unit GF-250-251 (site cash, Sharose, 18-Nov)'), ',')),
         (array_to_string(public._nf_units_in('Token #137 — Kamran, Units FF 33, FF 34, FF 35 and FF 36 (25,000 each)'), ',')),
         (array_to_string(public._nf_units_in('Token #122 — Misri Jan, Unit FF 108/184, through Waqar'), ',')),
         (array_to_string(public._nf_units_in('Token #205 — Muhammad Tahir (site cash, Sharose, 11-Nov)'), ','))) t(x));
  IF r = 'SF-208 ; GF-250,GF-251 ; FF-33,FF-34,FF-35,FF-36 ; FF-108,FF-184 ; ' THEN ok := ok + 1; out := out || E'\n01 PASS units read: ' || r;
  ELSE bad := bad + 1; out := out || E'\n01 FAIL units read: ' || coalesce(r, 'null'); END IF;

  -- the owner's three cases, as the site login
  PERFORM pg_temp.as_(sh);
  j := public.nf_dup_check(co, 'IN', 'Bank', '21100', 20000, 'Token #208 — Irfan Ullah, Unit 5F-501, Raast ref 631813527836', 'Irfan Ullah', DATE '2026-11-14', NULL);
  IF jsonb_array_length(j->'block') > 0 AND j->'block'->0->>'voucher' = 'BRV-0079' THEN ok := ok + 1; out := out || E'\n02 PASS BRV-0079 (#208, 20,000) entered again by the site: BLOCKED — ' || (j->'block'->0)::text;
  ELSE bad := bad + 1; out := out || E'\n02 FAIL ' || j::text; END IF;
  r := pg_temp.trydetail(format($s$SELECT public.nf_save_line(%L, NULL, 'OUT', 'S-BPV-9901', 'Cement — Khyber Traders, chq 6268', '52200', 'P-W', 'Bank', 200000, NULL, 'Khyber Traders')$s$, day));
  IF r LIKE 'NF:DUPLICATE_ENTRY%BPV-0045%' THEN ok := ok + 1; out := out || E'\n03 PASS BPV-0045 (chq 6268, 2,00,000) entered again by the site: REFUSED on save — ' || r;
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || r; END IF;
  j := public.nf_dup_check(co, 'OUT', 'Petty', '53300', 50000, 'Speed money — Zia ul Haq', 'Zia Ul Haq', DATE '2026-11-16', NULL);
  IF jsonb_array_length(j->'block') = 0 AND jsonb_array_length(j->'warn') > 0 AND j->'warn'->0->>'voucher' = 'CPV-0172' THEN ok := ok + 1; out := out || E'\n04 PASS CPV-0172 (Zia ul Haq 50,000) entered again by the site: WARNING (not a block) — ' || (j->'warn'->0)::text;
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || j::text; END IF;

  -- no false block: a small site payment that names the cheque its cash came from
  j := public.nf_dup_check(co, 'OUT', 'Petty', '70500', 400, 'Card holder + stamp pad, from chq #1313826265 petty cash', NULL, DATE '2026-11-16', NULL);
  IF jsonb_array_length(j->'block') = 0 THEN ok := ok + 1; out := out || E'\n05 PASS a cash line naming the funding cheque is not blocked';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || j::text; END IF;
  r := pg_temp.trydetail(format($s$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Petty', 300000, '1313826265', 'Cash for the site', DATE '2026-11-16')$s$, day));
  IF r LIKE 'NF:DUPLICATE_ENTRY%BPV-0046%' OR r LIKE 'NF:DUPLICATE_CHEQUE%' THEN ok := ok + 1; out := out || E'\n06 PASS cheque 6265 withdrawn again by the site: REFUSED — ' || r;
  ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || r; END IF;

  -- the other way round: head office books a token the site already booked
  PERFORM pg_temp.as_(rashid);
  j := public.nf_dup_check(co, 'IN', 'Cash', '21100', 100000, 'Token #317 — Riaz Ahmad, SF-208', 'Riaz Ahmad', DATE '2026-11-18', NULL);
  IF jsonb_array_length(j->'block') > 0 AND j->'block'->0->>'voucher' = 'S-CRV-0003' THEN ok := ok + 1; out := out || E'\n07 PASS head office books #317 again: BLOCKED, entered by ' || (j->'block'->0->>'by');
  ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || j::text; END IF;
  j := public.nf_dup_check(co, 'IN', 'Cash', '21100', 100000, 'Token #317 — Riaz Ahmad, SF-208', 'Riaz Ahmad', DATE '2026-11-25', NULL);
  IF jsonb_array_length(j->'block') = 0 THEN ok := ok + 1; out := out || E'\n08 PASS outside ±3 days nothing is blocked';
  ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || j::text; END IF;

  -- backfill (ran in the migration) — read back
  r := pg_temp.tok('SF-208') || ' ; ' || pg_temp.tok('GF-250') || ' ; ' || pg_temp.tok('GF-251');
  IF r LIKE '100000.00/Riaz Ahmad ; no hold ; no hold' THEN ok := ok + 1; out := out || E'\n09 PASS backfill: SF-208 hold token 0 -> 1,00,000 (Riaz Ahmad); GF-250 / GF-251 have no hold: ' || r;
  ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || r; END IF;
  j := public.nf_token_sync_list(co);
  out := out || E'\n10 INFO not synced: ' || (SELECT string_agg((x->>'voucher') || ' ' || (x->>'units'), ' | ') FROM jsonb_array_elements(j) x);
  IF jsonb_array_length(j) = 2 THEN ok := ok + 1; ELSE bad := bad + 1; out := out || ' FAIL count ' || jsonb_array_length(j); END IF;

  -- a new token line, its edit and its delete move the hold, as the site login
  PERFORM pg_temp.as_(sh);
  PERFORM public.nf_save_line(day, NULL, 'IN', 'S-CRV-9901', 'Token #999 — Dry Run Buyer, Unit SF-208', '21100', 'SF', 'Petty', 10000, NULL, 'Dry Run Buyer');
  r := pg_temp.tok('SF-208');
  SELECT v.id, l.id, v.version INTO vid, lid, ver FROM nf_vouchers v JOIN nf_voucher_legs l ON l.voucher_id = v.id AND l.line_no = 1 WHERE v.manual_no = 'S-CRV-9901';
  PERFORM public.nf_save_line(day, lid, 'IN', 'S-CRV-9901', 'Token #999 — Dry Run Buyer, Unit SF-208', '21100', 'SF', 'Petty', 15000, ver, 'Dry Run Buyer');
  r := r || ' -> ' || pg_temp.tok('SF-208');
  SELECT version INTO ver FROM nf_vouchers WHERE id = vid;
  PERFORM public.nf_delete_line(lid, ver);
  r := r || ' -> ' || pg_temp.tok('SF-208');
  IF r LIKE '110000.00/%-> 115000.00/%-> 100000.00/%' THEN ok := ok + 1; out := out || E'\n11 PASS new token line +10,000, edited to 15,000, deleted: SF-208 ' || r;
  ELSE bad := bad + 1; out := out || E'\n11 FAIL ' || r; END IF;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT[\s\S]*?(?=\nCONTEXT|$)/.exec(msg);
  console.log(m ? m[0] : (res.ok ? 'NO EXCEPTION — check for leftovers' : msg));
  console.log('after rollback: SF-208 hold', JSON.stringify(await q(`select r.token_amount, r.client_name from reservations r join units u on u.id = r.unit_id join projects p on p.id = u.project_id where p.company_id = '${CO}' and upper(u.unit_code) = 'SF-208' and r.status = 'active'`)),
    '| nf_dup_check exists:', JSON.stringify(await q(`select count(*) n from pg_proc where proname = 'nf_dup_check'`)));
})();
