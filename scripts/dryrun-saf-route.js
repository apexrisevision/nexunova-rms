#!/usr/bin/env node
/* Dry run of 20261013c_saf_route_and_room.sql on the live RMS database.

   Migration + tests go up as ONE request ending in RAISE, so everything (the
   migration, throw-away users, sessions, a throw-away link and room password,
   approval passwords, forms and sales) rolls back.

   Usage: node scripts/dryrun-saf-route.js                                     */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261013c_saf_route_and_room.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  yousaf constant uuid := '908fe0b1-4270-4982-bae0-ec41f4281f3a';
  naeem  constant uuid := '67f8f136-802a-4235-8785-c9151f666644';
  agent_su uuid; pr uuid; acc_uid uuid; fil_uid uuid;
  L text := 'dry-room-link'; P text := 'dry-room-pw';
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; f1 uuid; f2 uuid; f3 uuid; f4 uuid; res jsonb; out text := ''; ok int := 0; bad int := 0; n int; i int;
BEGIN
  SELECT project_id INTO pr FROM units WHERE company_id = co AND unit_no = 'LG-01';
  INSERT INTO app_users (company_id, full_name, username, email, role, auth_user_id)
       VALUES (co, 'Dry Accounts', 'dry.accounts', 'dry.accounts@saf.test', 'accounts', gen_random_uuid()) RETURNING auth_user_id INTO acc_uid;
  INSERT INTO app_users (company_id, full_name, username, email, role, module_permissions, auth_user_id)
       VALUES (co, 'Dry Filing', 'dry.filing', 'dry.filing@saf.test', 'staff', '{"saf_filing":true}', gen_random_uuid()) RETURNING auth_user_id INTO fil_uid;
  SELECT id INTO agent_su FROM sales_users WHERE company_id = co AND role <> 'director' LIMIT 1;
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
    (co, yousaf, 'dry-s-yousaf', now() + interval '1 hour'), (co, naeem, 'dry-s-naeem', now() + interval '1 hour'),
    (co, agent_su, 'dry-s-agent', now() + interval '1 hour');
  INSERT INTO availability_links (company_id, project_id, label, token_hash) VALUES (co, pr, 'dry', _availability_token_hash(L));
  UPDATE projects SET report_password_hash = _availability_secret_hash(pr, P) WHERE id = pr;
  SELECT id INTO u1 FROM units WHERE company_id = co AND unit_no = 'LG-01';
  SELECT id INTO u2 FROM units WHERE company_id = co AND unit_no = 'LG-02';
  SELECT id INTO u3 FROM units WHERE company_id = co AND unit_no = 'LG-03';
  SELECT id INTO u4 FROM units WHERE company_id = co AND unit_no = 'LG-04';

  -- 0. the three directors are on the list
  SELECT count(*) INTO n FROM saf_approvers WHERE company_id = co AND active;
  IF n = 3 AND (SELECT string_agg(display_name, ', ' ORDER BY display_name) FROM saf_approvers WHERE company_id = co) = 'Naeem Hussain, Rashid Manzoor, Syed Yousaf Shah'
  THEN ok := ok + 1; out := out || E'\nA PASS approvers: Naeem Hussain, Rashid Manzoor, Syed Yousaf Shah';
  ELSE bad := bad + 1; out := out || E'\nA FAIL ' || n; END IF;

  -- 1. setting approval passwords: own sign-in only; no sharing
  res := saf_room_set_password(L, P, 'dry-s-agent', 'agentpass1');
  IF res->>'error' = 'not_a_director' THEN ok := ok + 1; out := out || E'\nB PASS a non-director cannot set an approval password';
  ELSE bad := bad + 1; out := out || E'\nB FAIL ' || res::text; END IF;
  PERFORM saf_room_set_password(L, P, 'dry-s-yousaf', 'yousaf-sign-1');
  res := saf_room_set_password(L, P, 'dry-s-naeem', 'yousaf-sign-1');
  IF res->>'error' = 'taken' THEN ok := ok + 1; out := out || E'\nC PASS two directors cannot share a password';
  ELSE bad := bad + 1; out := out || E'\nC FAIL ' || res::text; END IF;
  PERFORM saf_room_set_password(L, P, 'dry-s-naeem', 'naeem-sign-1');
  IF (SELECT password_hash FROM saf_approvers WHERE sales_user_id = yousaf) LIKE '$2%' THEN ok := ok + 1; out := out || E'\nD PASS stored as a bcrypt hash, never the password';
  ELSE bad := bad + 1; out := out || E'\nD FAIL hash'; END IF;

  -- 2. Accounts: full price straight to Filing; any discount to the directors
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u1); f1 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f1, jsonb_build_object('buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-1','buyer_phone','03001234567','buyer_address','Dry'));
  res := saf_submit(f1);
  IF res->'saf'->>'status' = 'approved' AND res->'saf'->>'approval_route' = 'plan'
  THEN ok := ok + 1; out := out || E'\nE PASS full price: straight to Filing';
  ELSE bad := bad + 1; out := out || E'\nE FAIL ' || res::text; END IF;

  res := saf_new(u2); f2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f2, jsonb_build_object('plan_type','full_100','buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-2','buyer_phone','03001234568','buyer_address','Dry'));
  res := saf_submit(f2);
  IF res->'saf'->>'status' = 'submitted' AND res->'saf'->>'approval_route' = 'director'
  THEN ok := ok + 1; out := out || E'\nF PASS 100% plan with its 10% off: a discount, so to the directors';
  ELSE bad := bad + 1; out := out || E'\nF FAIL ' || res::text; END IF;

  res := saf_new(u3); f3 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f3, jsonb_build_object('discount_amount', 100000, 'discount_reason', 'Dry: loyal buyer',
     'buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-3','buyer_phone','03001234569','buyer_address','Dry'));
  res := saf_submit(f3);
  IF res->'saf'->>'status' = 'submitted' THEN ok := ok + 1; out := out || E'\nG PASS 100,000 off: to the directors';
  ELSE bad := bad + 1; out := out || E'\nG FAIL ' || res::text; END IF;

  -- 3. the room lists the two waiting; the full-price one is not there
  res := saf_room_list(L, P);
  IF (res->>'waiting')::int = 2 AND jsonb_array_length(res->'rows') = 2
  THEN ok := ok + 1; out := out || E'\nH PASS room shows 2 waiting; approvers ' || (res->'approvers')::text;
  ELSE bad := bad + 1; out := out || E'\nH FAIL ' || res::text; END IF;

  -- 4. approve: the password says who it is
  res := saf_room_approve(L, P, f2, 'not-a-password');
  IF res->>'error' = 'wrong_password' THEN ok := ok + 1; out := out || E'\nI PASS wrong approval password refused';
  ELSE bad := bad + 1; out := out || E'\nI FAIL ' || res::text; END IF;
  res := saf_room_approve(L, P, f2, 'naeem-sign-1');
  IF res->>'success' = 'true' AND res->'saf'->>'approved_by_name' = 'Naeem Hussain' AND (res->'saf'->>'approved_by_sales_user')::uuid = naeem
  THEN ok := ok + 1; out := out || E'\nJ PASS approved; the system knew it was Naeem Hussain';
  ELSE bad := bad + 1; out := out || E'\nJ FAIL ' || res::text; END IF;

  -- 5. decline: reason required, back to Accounts with it
  res := saf_room_reject(L, P, f3, '', 'yousaf-sign-1');
  IF res->>'error' = 'reason_required' THEN ok := ok + 1; out := out || E'\nK PASS decline needs a reason';
  ELSE bad := bad + 1; out := out || E'\nK FAIL ' || res::text; END IF;
  res := saf_room_reject(L, P, f3, 'Dry: discount too high', 'yousaf-sign-1');
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE e->>'status' = 'rejected' AND e->>'id' = f3::text;
  IF res->'saf'->>'rejected_by_name' = 'Syed Yousaf Shah' AND res->'saf'->>'reject_reason' = 'Dry: discount too high' AND n = 1
  THEN ok := ok + 1; out := out || E'\nL PASS declined by Syed Yousaf Shah with the reason; Accounts sees it';
  ELSE bad := bad + 1; out := out || E'\nL FAIL n=' || n || ' ' || res::text; END IF;

  -- 6. Filing gets both approved forms, at the approved price
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fil_uid, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE e->>'status' = 'approved';
  PERFORM saf_mark_filed(f2);
  res := saf_create_sale(f2);
  IF n = 2 AND res->>'success' = 'true'
     AND (SELECT notes FROM sales WHERE id = (res->>'sale_id')::uuid) LIKE '%approved by Naeem Hussain%'
     AND abs((SELECT net_amount FROM sales WHERE id = (res->>'sale_id')::uuid) - (SELECT net_price FROM sale_approval_forms WHERE id = f2)) <= 1
  THEN ok := ok + 1; out := out || E'\nM PASS Filing made ' || (res->>'sale_number') || ' at the approved price';
  ELSE bad := bad + 1; out := out || E'\nM FAIL n=' || n || ' ' || res::text; END IF;

  -- 7. guessing is stopped: 5 wrong tries close signing for 15 minutes
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u4); f4 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f4, jsonb_build_object('discount_amount', 5000, 'discount_reason', 'Dry', 'buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-4','buyer_phone','03001234560','buyer_address','Dry'));
  PERFORM saf_submit(f4);
  FOR i IN 1..5 LOOP PERFORM saf_room_approve(L, P, f4, 'guess' || i); END LOOP;
  res := saf_room_approve(L, P, f4, 'naeem-sign-1');
  IF res->>'error' = 'too_many' THEN ok := ok + 1; out := out || E'\nN PASS after 5 wrong tries even the right password waits 15 minutes';
  ELSE bad := bad + 1; out := out || E'\nN FAIL ' || res::text; END IF;

  out := out || E'\nSEC anon saf_room_approve: ' || has_function_privilege('anon', 'public.saf_room_approve(text,text,uuid,text)', 'EXECUTE')::text
             || ', anon _saf_signer: ' || has_function_privilege('anon', 'public._saf_signer(uuid,text)', 'EXECUTE')::text
             || ', anon read saf_approvers: ' || has_table_privilege('anon', 'public.saf_approvers', 'SELECT')::text
             || ', desk doors left: ' || (to_regprocedure('public.saf_desk_approve(text,uuid)') IS NOT NULL)::text;
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
  const left = await q(`select to_regclass('public.saf_approvers') is not null approvers_table,
      to_regprocedure('public.saf_desk_list(text)') is not null desk_doors_still_live,
      (select count(*) from app_users where username like 'dry.%') test_users,
      (select count(*) from sales_sessions where session_token like 'dry-%') test_sessions,
      (select count(*) from availability_links where label = 'dry') test_links,
      (select count(*) from sale_approval_forms) safs`);
  console.log('after rollback:', JSON.stringify(left));
})();
