#!/usr/bin/env node
/* Dry run of 20261113a_recovery_list.sql on the live RMS database.
   Migration + tests go up as ONE request ending in RAISE, so everything rolls
   back. Uses a throw-away link on Awami Market made inside the transaction.

   Usage: node scripts/dryrun-recovery-list.js                                */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261113a_recovery_list.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  pr constant uuid := '59ded55b-9bc2-45b2-a372-49fc31807fa9';
  tk constant text := 'dryrun-recovery-link-token';
  r jsonb; out text := ''; ok int := 0; bad int := 0; n int; m int; i int;
BEGIN
  INSERT INTO availability_links (company_id, project_id, label, token_hash)
  VALUES (co, pr, 'dry run', _availability_token_hash(tk));

  -- 1. no password: says the list exists, is not a try
  r := get_recovery_list(tk, NULL);
  IF r->>'success' = 'false' AND r->>'enabled' = 'true'
     AND NOT EXISTS (SELECT 1 FROM recovery_list_attempts) THEN ok := ok + 1; out := out || E'\n1 PASS no password: enabled=true, nothing counted';
  ELSE bad := bad + 1; out := out || E'\n1 FAIL ' || r::text; END IF;

  -- 2. wrong password, and the Directors' Room password, are refused
  r := get_recovery_list(tk, 'wrong');
  IF r->>'success' = 'false' THEN ok := ok + 1; out := out || E'\n2 PASS wrong password refused';
  ELSE bad := bad + 1; out := out || E'\n2 FAIL ' || left(r::text, 200); END IF;

  -- 3. the right password opens it
  r := get_recovery_list(tk, 'Awami123');
  n := jsonb_array_length(r->'rows');
  IF r->>'success' = 'true' AND n > 0 THEN ok := ok + 1; out := out || E'\n3 PASS Awami123 opens it, rows=' || n;
  ELSE bad := bad + 1; out := out || E'\n3 FAIL ' || left(r::text, 200); END IF;

  -- 4. every active sale is on it, marked as an RMS file
  SELECT count(*) INTO m FROM jsonb_array_elements(r->'rows') e WHERE (e->>'rms')::boolean;
  SELECT count(*) INTO i FROM sales s JOIN units u ON u.id = s.unit_id WHERE u.project_id = pr AND s.status = 'active';
  IF m = i THEN ok := ok + 1; out := out || E'\n4 PASS RMS files on the list = active sales = ' || m;
  ELSE bad := bad + 1; out := out || E'\n4 FAIL rms rows ' || m || ' vs sales ' || i; END IF;

  -- 5. every received token without a sale is on it
  SELECT count(*) INTO m FROM jsonb_array_elements(r->'rows') e WHERE NOT (e->>'rms')::boolean;
  SELECT count(*) INTO i FROM reservations x JOIN units u ON u.id = x.unit_id
   WHERE u.project_id = pr AND x.status = 'active' AND x.token_received AND COALESCE(x.token_amount,0) > 0
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = x.unit_id AND s.status = 'active');
  IF m = i THEN ok := ok + 1; out := out || E'\n5 PASS token-only units on the list = ' || m;
  ELSE bad := bad + 1; out := out || E'\n5 FAIL token rows ' || m || ' vs ' || i; END IF;

  -- 6. figures for one sale (GF-254) match the sale itself
  SELECT count(*) INTO m FROM jsonb_array_elements(r->'rows') e, sales s JOIN units u ON u.id = s.unit_id
   WHERE e->>'unit' = 'GF-254' AND u.unit_no = 'GF-254' AND u.project_id = pr AND s.status = 'active'
     AND (e->>'basic')::numeric = s.total_amount AND (e->>'discount')::numeric = s.discount
     AND (e->>'final')::numeric = s.net_amount AND (e->>'dp')::numeric = s.down_payment;
  IF m = 1 THEN ok := ok + 1; out := out || E'\n6 PASS GF-254 basic/discount/final/DP = the sale';
  ELSE bad := bad + 1; out := out || E'\n6 FAIL GF-254'; END IF;

  -- 7. DP remaining is never negative, and = dp - received for token rows
  SELECT count(*) INTO m FROM jsonb_array_elements(r->'rows') e
   WHERE (e->>'dp_left')::numeric < 0
      OR (NOT (e->>'rms')::boolean AND (e->>'dp_left')::numeric <> GREATEST((e->>'dp')::numeric - (e->>'received')::numeric, 0));
  IF m = 0 THEN ok := ok + 1; out := out || E'\n7 PASS DP remaining never negative, token rows add up';
  ELSE bad := bad + 1; out := out || E'\n7 FAIL ' || m || ' rows'; END IF;

  -- 8. the room password / a room key does not open the list
  r := get_recovery_list(tk, 'k.not-a-real-key');
  IF r->>'success' = 'false' THEN ok := ok + 1; out := out || E'\n8 PASS a room key does not open it';
  ELSE bad := bad + 1; out := out || E'\n8 FAIL'; END IF;

  -- 9. ten wrong tries lock the list, and the Directors' Room is not touched
  FOR i IN 1..10 LOOP PERFORM get_recovery_list(tk, 'wrong' || i); END LOOP;
  r := get_recovery_list(tk, 'Awami123');
  SELECT count(*) INTO m FROM availability_report_attempts a JOIN availability_links l ON l.id = a.link_id WHERE l.label = 'dry run';
  IF r->>'error' = 'too_many' AND m = 0 THEN ok := ok + 1; out := out || E'\n9 PASS locks after 10 wrong tries; room attempts untouched';
  ELSE bad := bad + 1; out := out || E'\n9 FAIL ' || r::text || ' room attempts ' || m; END IF;

  -- 10. anon cannot read the attempts table
  IF NOT has_table_privilege('anon', 'public.recovery_list_attempts', 'SELECT')
     AND has_function_privilege('anon', 'public.get_recovery_list(text,text)', 'EXECUTE')
  THEN ok := ok + 1; out := out || E'\n10 PASS attempts table closed to anon; function open to anon';
  ELSE bad := bad + 1; out := out || E'\n10 FAIL grants'; END IF;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END
$t$;
`;

(async () => {
  console.log('project', REF);
  const sql = 'BEGIN;\n' + fs.readFileSync(MIG, 'utf8') + '\n' + TESTS;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const msg = res.ok ? 'NO EXCEPTION — check the database for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"') : msg);
  const left = await q(`select count(*) fn_live from pg_proc where proname = 'get_recovery_list'`);
  console.log('after rollback:', JSON.stringify(left));
})();
