#!/usr/bin/env node
/* Dry run of 20261111a_current_address.sql on the live RMS database.
   Migration + tests go up as ONE request ending in RAISE, so everything rolls
   back. Makes its own SAF on a free held Awami unit inside the transaction.

   Usage: node scripts/dryrun-current-address.js                              */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261111a_current_address.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  naseer uuid; ag uuid; u1 uuid; f1 uuid; cid uuid; r jsonb; out text := ''; ok int := 0; bad int := 0; v text; v2 text;
BEGIN
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT id INTO ag FROM agents WHERE company_id = co AND status = 'active' ORDER BY agent_code LIMIT 1;
  SELECT r0.unit_id INTO u1 FROM reservations r0
   WHERE r0.company_id = co AND r0.status = 'active' AND COALESCE(r0.token_amount, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = r0.unit_id AND s.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = r0.unit_id AND f.status IN ('draft','submitted','verified','approved'))
   LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  r := saf_new(u1); f1 := (r#>>'{saf,id}')::uuid;

  -- 1. saf_save keeps both addresses
  r := saf_save(f1, jsonb_build_object('buyer_address', 'Permanent: Village Kaki Khel, Jamrud', 'buyer_current_address', 'Current: House 5, Hayatabad, Peshawar'), true);
  SELECT buyer_address, buyer_current_address INTO v, v2 FROM sale_approval_forms WHERE id = f1;
  IF r->>'success' = 'true' AND v LIKE 'Permanent:%' AND v2 LIKE 'Current:%' THEN ok := ok + 1; out := out || E'\n1 PASS SAF saves permanent + current address';
  ELSE bad := bad + 1; out := out || E'\n1 FAIL ' || left(r::text, 200); END IF;
  IF (saf_get(f1)->'saf'->>'buyer_current_address') LIKE 'Current:%' THEN ok := ok + 1; out := out || E'\n2 PASS saf_get returns the current address (screen + PDF)';
  ELSE bad := bad + 1; out := out || E'\n2 FAIL saf_get'; END IF;

  -- 3. the sale copies it onto a NEW client
  UPDATE sale_approval_forms SET buyer_name = 'Dry Buyer', buyer_relation = 'S/O', buyer_father = 'Dry Father', buyer_cnic = '99999-0000011-1',
         buyer_phone = '03001112223', buyer_photo_url = 'dry', buyer_name_reason = 'dry run', nominee = NULL, agent_id = ag,
         commission_pct = commission_standard_pct, discount_amount = 0 WHERE id = f1;
  r := saf_submit(f1);
  SELECT c.id, c.address, c.current_address INTO cid, v, v2 FROM sales s JOIN clients c ON c.id = s.client_id WHERE s.unit_id = u1 AND s.status = 'active';
  IF r->>'success' = 'true' AND v LIKE 'Permanent:%' AND v2 LIKE 'Current:%' THEN ok := ok + 1; out := out || E'\n3 PASS sale made; the client has both addresses';
  ELSE bad := bad + 1; out := out || E'\n3 FAIL ' || left(r::text, 300) || ' addr=' || coalesce(v,'-') || ' cur=' || coalesce(v2,'-'); END IF;

  -- 4-5. the client form saves it, and keeps it when the key is not sent
  r := _update_client_core(cid, co, '{"current_address":"Flat 9, University Town"}'::jsonb);
  IF r->>'success' = 'true' AND (SELECT current_address FROM clients WHERE id = cid) = 'Flat 9, University Town'
  THEN ok := ok + 1; out := out || E'\n4 PASS client edit saves the current address';
  ELSE bad := bad + 1; out := out || E'\n4 FAIL ' || r::text; END IF;
  r := _update_client_core(cid, co, '{"full_name":"Dry Buyer"}'::jsonb);
  IF (SELECT current_address FROM clients WHERE id = cid) = 'Flat 9, University Town' THEN ok := ok + 1; out := out || E'\n5 PASS an edit without it keeps it';
  ELSE bad := bad + 1; out := out || E'\n5 FAIL'; END IF;

  -- 6. get_clients_all carries it (Clients page, Application Form via get_client_by_id)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(get_clients_all(co)) e WHERE e->>'current_address' = 'Flat 9, University Town')
     AND (get_client_by_id(cid, co)->>'current_address') = 'Flat 9, University Town'
  THEN ok := ok + 1; out := out || E'\n6 PASS get_clients_all and get_client_by_id return it';
  ELSE bad := bad + 1; out := out || E'\n6 FAIL'; END IF;

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
  const left = await q(`select count(*) column_live from information_schema.columns where table_name = 'clients' and column_name = 'current_address'`);
  console.log('after rollback:', JSON.stringify(left));
})();
