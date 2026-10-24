#!/usr/bin/env node
/* Dry run of 20261024a_saf_nominee_address.sql on the live RMS database.
   Migration + tests go up as ONE request ending in RAISE, so everything rolls
   back (the column, the functions, the test sale and client).

   Usage: node scripts/dryrun-saf-nominee-address.js                          */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261024a_saf_nominee_address.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  naseer uuid; fid uuid; cid uuid; res jsonb; p jsonb; out text := ''; ok int := 0; bad int := 0; v text;
BEGIN
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);

  -- 1-3. the submit check
  p := _saf_problems('{"nominee":{"name":"Ali"},"nominee_photo_url":"x"}'::jsonb);
  IF p ? 'Add the nominee''s address, or leave the nominee empty.' THEN ok := ok + 1; out := out || E'\n01 PASS nominee without address is refused';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || p::text; END IF;
  p := _saf_problems('{"nominee":{"name":"Ali","address":"House 1, Peshawar"},"nominee_photo_url":"x"}'::jsonb);
  IF NOT p::text ILIKE '%nominee''s address%' THEN ok := ok + 1; out := out || E'\n02 PASS nominee with address passes';
  ELSE bad := bad + 1; out := out || E'\n02 FAIL ' || p::text; END IF;
  p := _saf_problems('{"nominee":{}}'::jsonb);
  IF NOT p::text ILIKE '%nominee%' THEN ok := ok + 1; out := out || E'\n03 PASS no nominee, no address asked';
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || p::text; END IF;

  -- 4. a draft SAF made into a sale: a new client gets the nominee address
  SELECT id INTO fid FROM sale_approval_forms WHERE company_id = co AND status = 'draft' AND sale_id IS NULL
     AND jsonb_array_length(COALESCE(schedule_json, '[]'::jsonb)) > 0 AND agent_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF fid IS NULL THEN bad := bad + 1; out := out || E'\n04 FAIL no draft SAF to test on';
  ELSE
    ALTER TABLE sale_approval_forms DISABLE TRIGGER USER;
    UPDATE sale_approval_forms SET status = 'approved', buyer_cnic = '99999-9999999-1', buyer_phone = COALESCE(NULLIF(buyer_phone, ''), '03001234567'), buyer_father = COALESCE(NULLIF(buyer_father, ''), 'Dry'), buyer_relation = COALESCE(NULLIF(buyer_relation, ''), 'S/O'), receipts = '[]'::jsonb,
      nominee = '{"name":"Dry Nominee","relation":"Brother","cnic":"","phone":"","address":"House 7, Street 3, Peshawar"}'::jsonb
     WHERE id = fid;
    ALTER TABLE sale_approval_forms ENABLE TRIGGER USER;
    res := _saf_make_sale(fid, (SELECT id FROM app_users WHERE auth_user_id = naseer), 'Dry run');
    SELECT next_of_kin_address, id INTO v, cid FROM clients WHERE company_id = co AND cnic = '99999-9999999-1';
    IF res->>'success' = 'true' AND v = 'House 7, Street 3, Peshawar' THEN ok := ok + 1; out := out || E'\n04 PASS sale made, client nominee address = ' || v;
    ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || left(res::text, 300) || ' addr=' || coalesce(v, '-'); END IF;
  END IF;

  -- 5-6. the client form saves and clears it
  IF cid IS NULL THEN SELECT id INTO cid FROM clients WHERE company_id = co LIMIT 1; END IF;
  res := _update_client_core(cid, co, '{"next_of_kin_address":"Flat 2, Hayatabad"}'::jsonb);
  SELECT next_of_kin_address INTO v FROM clients WHERE id = cid;
  IF res->>'success' = 'true' AND v = 'Flat 2, Hayatabad' THEN ok := ok + 1; out := out || E'\n05 PASS client edit saves the address';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || res::text; END IF;
  res := _update_client_core(cid, co, '{"full_name":"Same"}'::jsonb);
  SELECT next_of_kin_address INTO v FROM clients WHERE id = cid;
  IF v = 'Flat 2, Hayatabad' THEN ok := ok + 1; out := out || E'\n06 PASS an edit without the key keeps it';
  ELSE bad := bad + 1; out := out || E'\n06 FAIL addr=' || coalesce(v, '-'); END IF;

  -- 7. get_clients_all shows it
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(get_clients_all(co)) e WHERE e->>'next_of_kin_address' = 'Flat 2, Hayatabad')
  THEN ok := ok + 1; out := out || E'\n07 PASS clients list carries next_of_kin_address';
  ELSE bad := bad + 1; out := out || E'\n07 FAIL not in get_clients_all'; END IF;

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
  console.log(m ? m[0].replace(/\n/g, '\n').replace(/\\"/g, '"') : msg);
  const left = await q(`select count(*) column_live from information_schema.columns
      where table_name = 'clients' and column_name = 'next_of_kin_address'`);
  console.log('after rollback:', JSON.stringify(left));
})();
