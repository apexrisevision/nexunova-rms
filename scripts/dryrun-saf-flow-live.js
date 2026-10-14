#!/usr/bin/env node
/* The whole Sale Approval flow, end to end, as the REAL Awami logins:
   amar@awami (Accounts) -> Directors' Room (Naeem / Yousaf, own approval
   password) -> naseer@awami (Filing) -> the sale.

   Everything runs in ONE request ending in RAISE, so it all rolls back: the
   throw-away link and room password, the directors' throw-away approval
   passwords and sessions, the forms, the SAF numbers and the sales.
   Units are picked live: held (active reservation with a buyer name), no
   active sale, no SAF.

   Usage: node scripts/dryrun-saf-flow-live.js                                 */
const { REF, TOKEN, q } = require('./_sbq');

const TESTS = String.raw`
BEGIN;
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  yousaf constant uuid := '908fe0b1-4270-4982-bae0-ec41f4281f3a';
  naeem  constant uuid := '67f8f136-802a-4235-8785-c9151f666644';
  amar uuid; naseer uuid; owner uuid; pr uuid;
  L text := 'dry-flow-link'; P text := 'dry-flow-pw';
  us uuid[]; f1 uuid; f2 uuid; f3 uuid; f3b uuid; res jsonb; me jsonb; s1 jsonb; out text := ''; ok int := 0; bad int := 0; n int;
  nm text;
BEGIN
  SELECT auth_user_id INTO amar   FROM app_users WHERE company_id = co AND username = 'amar';
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT auth_user_id INTO owner  FROM app_users WHERE company_id = co AND username = 'awami';

  SELECT array_agg(id) INTO us FROM (
    SELECT u.id FROM units u
     WHERE u.company_id = co
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active' AND btrim(coalesce(r.client_name,'')) <> '')
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = u.id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = u.id)
       AND coalesce(u.base_price, 0) > 0
     ORDER BY u.unit_no LIMIT 3) x;
  IF coalesce(array_length(us, 1), 0) < 3 THEN RAISE EXCEPTION 'DRYRUN_RESULT not enough held units to test: %', us; END IF;
  SELECT project_id INTO pr FROM units WHERE id = us[1];
  out := out || E'\nunits: ' || (SELECT string_agg(u.unit_no || ' (' || s.status_name || ')', ', ') FROM units u LEFT JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.id = ANY(us));

  -- the room: a throw-away link + room password; the two directors' own approval passwords
  INSERT INTO availability_links (company_id, project_id, label, token_hash) VALUES (co, pr, 'dry', _availability_token_hash(L));
  UPDATE projects SET report_password_hash = _availability_secret_hash(pr, P) WHERE id = pr;
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
    (co, yousaf, 'dry-f-yousaf', now() + interval '1 hour'), (co, naeem, 'dry-f-naeem', now() + interval '1 hour');
  PERFORM saf_room_set_password(L, P, 'dry-f-naeem',  'naeem-sign-1');
  PERFORM saf_room_set_password(L, P, 'dry-f-yousaf', 'yousaf-sign-1');

  -- 1. who is who, by name
  PERFORM set_config('request.jwt.claims', json_build_object('sub', amar, 'role', 'authenticated')::text, true);
  me := _saf_me();
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  res := _saf_me();
  IF (me->>'prepare')::boolean AND NOT (me->>'filing')::boolean AND NOT (me->>'approve')::boolean
     AND (res->>'filing')::boolean AND NOT (res->>'prepare')::boolean AND NOT (res->>'approve')::boolean
  THEN ok := ok + 1; out := out || E'\n01 PASS amar = Accounts, naseer = Filing';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL amar ' || me::text || ' naseer ' || res::text; END IF;

  -- 2. Naseer cannot prepare a form
  res := saf_new(us[1]);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\n02 PASS naseer cannot make a SAF';
  ELSE bad := bad + 1; out := out || E'\n02 FAIL ' || res::text; END IF;

  -- 3. Amar: full price -> straight to Filing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', amar, 'role', 'authenticated')::text, true);
  res := saf_new(us[1]); f1 := (res->'saf'->>'id')::uuid; nm := res->'saf'->>'saf_no';
  s1 := saf_submit(f1);
  out := out || E'\n   ' || nm || ' empty submit says: ' || coalesce(s1->>'message', s1->>'error', s1::text);
  PERFORM saf_save(f1, jsonb_build_object('buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-1','buyer_phone','03001234567','buyer_address','Dry Peshawar'));
  res := saf_submit(f1);
  IF coalesce(s1->>'success','false') <> 'true' AND res->'saf'->>'status' = 'approved' AND res->'saf'->>'approval_route' = 'plan'
  THEN ok := ok + 1; out := out || E'\n03 PASS ' || nm || ' ' || (res->'saf'->>'unit_code') || ' full price ' || (res->'saf'->>'net_price') || ': incomplete refused, then straight to Filing (no director)';
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || res::text; END IF;

  -- 4. Amar: a discount -> the Directors' Room
  res := saf_new(us[2]); f2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f2, jsonb_build_object('discount_amount', 50000, 'discount_reason', 'Dry: early payment',
     'buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-2','buyer_phone','03001234568','buyer_address','Dry Peshawar'));
  res := saf_submit(f2);
  IF res->'saf'->>'status' = 'submitted' AND res->'saf'->>'approval_route' = 'director'
  THEN ok := ok + 1; out := out || E'\n04 PASS ' || (res->'saf'->>'saf_no') || ' ' || (res->'saf'->>'unit_code') || ' 50,000 off: waiting for a director';
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || res::text; END IF;

  res := saf_new(us[3]); f3 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f3, jsonb_build_object('discount_amount', 200000, 'discount_reason', 'Dry: big discount',
     'buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-3','buyer_phone','03001234569','buyer_address','Dry Peshawar'));
  PERFORM saf_submit(f3);

  -- 5. Naseer does not see the waiting ones; Amar cannot file
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE (e->>'id')::uuid IN (f2, f3);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', amar, 'role', 'authenticated')::text, true);
  res := saf_mark_filed(f1);
  IF n = 0 AND coalesce(res->>'success','false') <> 'true'
  THEN ok := ok + 1; out := out || E'\n05 PASS Filing does not see forms waiting for a director; Accounts cannot file (' || coalesce(res->>'error','') || ')';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL n=' || n || ' ' || res::text; END IF;

  -- 6. the room lists the two waiting
  res := saf_room_list(L, P);
  SELECT count(*) INTO n FROM jsonb_array_elements(res->'rows') e WHERE (e->>'id')::uuid IN (f2, f3);
  IF n = 2 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') e WHERE (e->>'id')::uuid = f1)
  THEN ok := ok + 1; out := out || E'\n06 PASS Directors'' Room shows both discount forms, not the full-price one';
  ELSE bad := bad + 1; out := out || E'\n06 FAIL ' || res::text; END IF;

  -- 7. approve with own password: the system knows who
  res := saf_room_approve(L, P, f2, 'wrong-password');
  s1  := saf_room_approve(L, P, f2, 'naeem-sign-1');
  IF res->>'error' = 'wrong_password' AND s1->'saf'->>'status' = 'approved' AND s1->'saf'->>'approved_by_name' = 'Naeem Hussain'
  THEN ok := ok + 1; out := out || E'\n07 PASS wrong password refused; approved and recorded as Naeem Hussain';
  ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || res::text || ' / ' || s1::text; END IF;

  -- 8. decline: reason required, back to Accounts with it
  res := saf_room_reject(L, P, f3, '', 'yousaf-sign-1');
  s1  := saf_room_reject(L, P, f3, 'Dry: discount too high, give 100,000 at most', 'yousaf-sign-1');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', amar, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE (e->>'id')::uuid = f3 AND e->>'status' = 'rejected';
  IF res->>'error' = 'reason_required' AND s1->'saf'->>'rejected_by_name' = 'Syed Yousaf Shah' AND n = 1
  THEN ok := ok + 1; out := out || E'\n08 PASS decline needs a reason; declined by Syed Yousaf Shah, Amar sees it with: ' || (s1->'saf'->>'reject_reason');
  ELSE bad := bad + 1; out := out || E'\n08 FAIL n=' || n || ' ' || res::text || ' / ' || s1::text; END IF;

  -- 9. Amar redoes the declined form with a smaller discount; it goes back to the room
  res := saf_supersede(f3); f3b := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f3b, jsonb_build_object('discount_amount', 100000, 'discount_reason', 'Dry: as the director said'));
  res := saf_submit(f3b);
  s1  := saf_room_approve(L, P, f3b, 'yousaf-sign-1');
  IF f3b IS NOT NULL AND res->'saf'->>'status' = 'submitted' AND s1->'saf'->>'status' = 'approved' AND s1->'saf'->>'approved_by_name' = 'Syed Yousaf Shah'
  THEN ok := ok + 1; out := out || E'\n09 PASS redone as ' || (s1->'saf'->>'saf_no') || ' with 100,000 off, back to the room, approved by Syed Yousaf Shah';
  ELSE bad := bad + 1; out := out || E'\n09 FAIL ' || res::text || ' / ' || coalesce(s1::text,''); END IF;

  -- 10. Naseer: three approved forms, files them and makes the sales at the approved price
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE (e->>'id')::uuid IN (f1, f2, f3b) AND e->>'status' = 'approved';
  IF n = 3 THEN ok := ok + 1; out := out || E'\n10 PASS Naseer sees all 3 approved forms';
  ELSE bad := bad + 1; out := out || E'\n10 FAIL n=' || n; END IF;

  res := saf_create_sale(f1);
  IF coalesce(res->>'success','false') <> 'true' THEN ok := ok + 1; out := out || E'\n11 PASS sale refused before the file is marked made (' || coalesce(res->>'error', res->>'message','') || ')';
  ELSE bad := bad + 1; out := out || E'\n11 NOTE sale allowed before Mark filed: ' || res::text; END IF;

  DECLARE fx uuid; nn int := 0; msg text := '';
  BEGIN
    FOREACH fx IN ARRAY ARRAY[f1, f2, f3b] LOOP
      PERFORM saf_mark_filed(fx);
      res := saf_create_sale(fx);
      IF res->>'success' = 'true'
         AND abs((SELECT net_amount FROM sales WHERE id = (res->>'sale_id')::uuid) - (SELECT net_price FROM sale_approval_forms WHERE id = fx)) <= 1
         AND (SELECT sale_id FROM sale_approval_forms WHERE id = fx) = (res->>'sale_id')::uuid
      THEN nn := nn + 1;
           msg := msg || E'\n     ' || (SELECT saf_no || ' ' || unit_code FROM sale_approval_forms WHERE id = fx) || ' -> ' || (res->>'sale_number')
                  || ' net ' || (SELECT net_amount FROM sales WHERE id = (res->>'sale_id')::uuid)
                  || ', unit now ' || (SELECT s.status_name FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.id = (SELECT unit_id FROM sale_approval_forms WHERE id = fx))
                  || ' | ' || left((SELECT notes FROM sales WHERE id = (res->>'sale_id')::uuid), 90);
      ELSE msg := msg || E'\n     FAIL ' || res::text; END IF;
    END LOOP;
    IF nn = 3 THEN ok := ok + 1; out := out || E'\n12 PASS Naseer filed and made 3 sales at the approved price' || msg;
    ELSE bad := bad + 1; out := out || E'\n12 FAIL ' || nn || msg; END IF;
  END;

  -- 13. a second sale on the same form is refused
  res := saf_create_sale(f1);
  IF coalesce(res->>'success','false') <> 'true' THEN ok := ok + 1; out := out || E'\n13 PASS a form makes one sale only (' || coalesce(res->>'error','') || ')';
  ELSE bad := bad + 1; out := out || E'\n13 FAIL ' || res::text; END IF;

  -- 14. the owner login (Rashid in RMS) sees the forms read-only and cannot approve from RMS
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  me := _saf_me();
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE (e->>'id')::uuid IN (f1, f2, f3b);
  out := out || E'\n14 INFO owner: approve=' || (me->>'approve') || ' prepare=' || (me->>'prepare') || ' filing=' || (me->>'filing') || ', sees ' || n || ' of the 3';

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END
$t$;
`;

(async () => {
  console.log('project', REF);
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: TESTS }) });
  const msg = res.ok ? 'NO EXCEPTION — check the database for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"') : msg);
  const left = await q(`select (select count(*) from sale_approval_forms) safs,
      (select last_no from saf_counters where company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce') saf_counter,
      (select count(*) from availability_links where label = 'dry') test_links,
      (select count(*) from sales_sessions where session_token like 'dry-%') test_sessions,
      (select count(*) from saf_approvers where password_hash is not null) approvers_with_password`);
  console.log('after rollback:', JSON.stringify(left));
})();
