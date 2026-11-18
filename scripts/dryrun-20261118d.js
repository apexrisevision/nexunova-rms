#!/usr/bin/env node
/* Dry run of 20261118d_owner_can_deactivate_admin.sql: migration + checks in ONE request ending in
   RAISE, so everything rolls back. Calls update_app_user as Awami's real owner / admin identities
   (claims only, no password). Nothing is kept. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261118d_owner_can_deactivate_admin.sql'), 'utf8');
const T = String.raw`
DO $t$
DECLARE co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  owner_uid uuid; naseer_uid uuid; amar uuid; naseer uuid; owner_id uuid; r jsonb; out text := ''; ok int := 0; bad int := 0;
  PROCEDURE_UNUSED int;
BEGIN
  SELECT auth_user_id, id INTO owner_uid, owner_id FROM app_users WHERE company_id = co AND username = 'awami';
  SELECT auth_user_id, id INTO naseer_uid, naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT id INTO amar FROM app_users WHERE company_id = co AND username = 'amar';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer_uid, 'role', 'authenticated')::text, true);
  r := update_app_user(amar, co, NULL, NULL, NULL, NULL, 'inactive', NULL, NULL, NULL);
  IF r->>'error' = 'forbidden_target' THEN ok := ok + 1; out := out || E'\n1 PASS an admin still cannot deactivate another admin';
  ELSE bad := bad + 1; out := out || E'\n1 FAIL ' || r::text; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  r := update_app_user(amar, co, NULL, 'staff', NULL, NULL, NULL, NULL, NULL, NULL);
  IF r->>'error' = 'forbidden_target' THEN ok := ok + 1; out := out || E'\n2 PASS the owner still cannot change an admin''s role';
  ELSE bad := bad + 1; out := out || E'\n2 FAIL ' || r::text; END IF;
  r := update_app_user(amar, co, NULL, NULL, NULL, NULL, 'inactive', 'x12345678', NULL, NULL);
  IF r->>'error' = 'forbidden_target' THEN ok := ok + 1; out := out || E'\n3 PASS …nor set an admin''s password (even with a status change)';
  ELSE bad := bad + 1; out := out || E'\n3 FAIL ' || r::text; END IF;
  r := update_app_user(owner_id, co, NULL, NULL, NULL, NULL, 'inactive', NULL, NULL, NULL);
  IF r->>'error' = 'forbidden_target' THEN ok := ok + 1; out := out || E'\n4 PASS the owner cannot deactivate an owner (themself)';
  ELSE bad := bad + 1; out := out || E'\n4 FAIL ' || r::text; END IF;

  r := update_app_user(amar, co, NULL, NULL, NULL, NULL, 'inactive', NULL, NULL, NULL);
  IF r->>'success' = 'true' AND (SELECT status FROM app_users WHERE id = amar) = 'inactive' THEN ok := ok + 1; out := out || E'\n5 PASS the owner deactivates amar (10-arg, the screen''s call)';
  ELSE bad := bad + 1; out := out || E'\n5 FAIL ' || r::text; END IF;
  r := update_app_user(amar, co, NULL, NULL, NULL, NULL, 'active', NULL, NULL, NULL);
  IF r->>'success' = 'true' AND (SELECT status FROM app_users WHERE id = amar) = 'active' THEN ok := ok + 1; out := out || E'\n6 PASS …and can switch him back on';
  ELSE bad := bad + 1; out := out || E'\n6 FAIL ' || r::text; END IF;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`.replace('  PROCEDURE_UNUSED int;\n', '');
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + T }) });
  const msg = res.ok ? 'NO EXCEPTION — check for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\n/g, '\n').replace(/\\"/g, '"') : msg);
  console.log('after rollback:', JSON.stringify(await q(`select username, status from app_users where company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' order by username`)));
})();
