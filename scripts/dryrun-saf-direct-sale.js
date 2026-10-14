#!/usr/bin/env node
/* Dry run of 20261014b_saf_naseer_direct_sale_photos.sql on the live RMS
   database, as the real Awami logins. Migration + tests go up as ONE request
   ending in RAISE, so everything rolls back (the migration, the GF-253
   payments, the throw-away link, room password and approval passwords, the
   forms, sales and payments).

   Usage: node scripts/dryrun-saf-direct-sale.js                               */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261014b_saf_naseer_direct_sale_photos.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  yousaf constant uuid := '908fe0b1-4270-4982-bae0-ec41f4281f3a';
  naeem  constant uuid := '67f8f136-802a-4235-8785-c9151f666644';
  gf_sale constant uuid := 'ca07d728-f700-42f8-9a90-8c7e3a6ad528';
  PH text := 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/' || '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' || '/clients/photos/dry_buyer.jpg';
  PN text := 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/' || '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' || '/clients/photos/dry_nominee.jpg';
  amar uuid; naseer uuid; naseer_id uuid; pr uuid;
  L text := 'dry-ds-link'; P text := 'dry-ds-pw';
  us uuid[]; f1 uuid; f2 uuid; f3 uuid; res jsonb; me jsonb; s1 jsonb; out text := ''; ok int := 0; bad int := 0; n int;
  v_sale uuid; v_paid numeric; v_recv numeric; v_inst numeric; v_cl record;
  buyer jsonb := '{"buyer_relation":"S/O","buyer_father":"Dry Father","buyer_cnic":"17301-1234567-1","buyer_phone":"03001234567","buyer_address":"Dry Peshawar"}';
BEGIN
  SELECT auth_user_id, id INTO naseer, naseer_id FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT auth_user_id INTO amar FROM app_users WHERE company_id = co AND username = 'amar';

  -- 0. GF-253 backfill
  SELECT sum(amount), count(*) INTO v_paid, n FROM payments WHERE sale_id = gf_sale;
  SELECT amount_paid INTO v_inst FROM installments WHERE sale_id = gf_sale AND installment_type = 'down_payment';
  IF v_paid = 3300000 AND n = 3 AND v_inst = 3300000 THEN ok := ok + 1; out := out || E'\n00 PASS GF-253: 3 payments = 3,300,000 received; down payment shows 3,300,000 of 3,474,000 paid';
  ELSE bad := bad + 1; out := out || E'\n00 FAIL GF-253 paid=' || v_paid || ' n=' || n || ' dp_paid=' || v_inst; END IF;
  out := out || E'\n   GF-253 payments: ' || (SELECT string_agg(payment_method || ' ' || amount || ' ' || coalesce(reference_no, '-') || ' ' || payment_date, ' | ' ORDER BY payment_date, amount) FROM payments WHERE sale_id = gf_sale);

  -- units: held, buyer named, no sale, no SAF, some money in NexuFinance
  SELECT array_agg(id) INTO us FROM (
    SELECT u.id FROM units u
     WHERE u.company_id = co
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active' AND btrim(coalesce(r.client_name,'')) <> '')
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = u.id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = u.id)
       AND coalesce(u.base_price, 0) > 0
       AND (_saf_money(co, u.unit_no)->>'total')::numeric > 0
     ORDER BY u.unit_no LIMIT 3) x;
  IF coalesce(array_length(us, 1), 0) < 3 THEN RAISE EXCEPTION 'DRYRUN_RESULT not enough units: %', us; END IF;
  SELECT project_id INTO pr FROM units WHERE id = us[1];
  INSERT INTO availability_links (company_id, project_id, label, token_hash) VALUES (co, pr, 'dry', _availability_token_hash(L));
  UPDATE projects SET report_password_hash = _availability_secret_hash(pr, P) WHERE id = pr;
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
    (co, yousaf, 'dry-ds-yousaf', now() + interval '1 hour'), (co, naeem, 'dry-ds-naeem', now() + interval '1 hour');
  PERFORM saf_room_set_password(L, P, 'dry-ds-naeem',  'naeem-sign-1');
  PERFORM saf_room_set_password(L, P, 'dry-ds-yousaf', 'yousaf-sign-1');

  -- 1. roles
  PERFORM set_config('request.jwt.claims', json_build_object('sub', amar, 'role', 'authenticated')::text, true);
  me := _saf_me(); res := saf_new(us[1]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  s1 := _saf_me();
  IF (s1->>'prepare')::boolean AND (s1->>'filing')::boolean AND NOT (me->>'prepare')::boolean AND NOT (me->>'filing')::boolean AND res->>'error' = 'forbidden'
  THEN ok := ok + 1; out := out || E'\n01 PASS naseer makes and files; amar cannot make a SAF (read-only view: approve=' || (me->>'approve') || ')';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL naseer ' || s1::text || ' amar ' || me::text || ' ' || res::text; END IF;

  -- 2. full price: photo required; a foreign link is not stored; then Submit makes the sale with the money
  res := saf_new(us[1]); f1 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f1, buyer || '{"co_buyer":{"name":"Dry Co"}}');
  s1 := saf_submit(f1);
  PERFORM saf_save(f1, '{"buyer_photo_url":"https://evil.example.com/x.jpg"}');
  n := (SELECT count(*) FROM sale_approval_forms WHERE id = f1 AND buyer_photo_url IS NULL AND co_buyer IS NULL);
  IF s1->>'message' LIKE '%buyer''s photo%' AND n = 1 THEN ok := ok + 1; out := out || E'\n02 PASS no photo: "' || (s1->>'message') || '"; a link from outside is not kept; co-buyer is not taken';
  ELSE bad := bad + 1; out := out || E'\n02 FAIL n=' || n || ' ' || s1::text; END IF;

  PERFORM saf_save(f1, jsonb_build_object('buyer_photo_url', PH));
  res := saf_submit(f1);
  SELECT id INTO v_sale FROM sales WHERE saf_id = f1;
  SELECT total_received INTO v_recv FROM sale_approval_forms WHERE id = f1;
  SELECT coalesce(sum(amount), 0), count(*) INTO v_paid, n FROM payments WHERE sale_id = v_sale;
  SELECT coalesce(sum(amount_paid), 0) INTO v_inst FROM installments WHERE sale_id = v_sale;
  SELECT c.client_photo_url, (SELECT s.status_name FROM units u JOIN category_unit_statuses s ON s.id = u.status_id WHERE u.id = us[1]) st INTO v_cl
    FROM sales x JOIN clients c ON c.id = x.client_id WHERE x.id = v_sale;
  IF res->'saf'->>'status' = 'approved' AND res->'saf'->>'sale_number' IS NOT NULL AND v_paid = v_recv AND v_inst = v_recv AND v_cl.client_photo_url = PH
  THEN ok := ok + 1; out := out || E'\n03 PASS ' || (res->'saf'->>'saf_no') || ' ' || (res->'saf'->>'unit_code') || ' full price: Submit made ' || (res->'saf'->>'sale_number')
         || ' at once; ' || n || ' NexuFinance receipts = ' || v_paid || ' recorded and on the schedule; client photo set; unit ' || v_cl.st;
  ELSE bad := bad + 1; out := out || E'\n03 FAIL paid=' || v_paid || ' recv=' || v_recv || ' inst=' || v_inst || ' ' || coalesce(v_cl.client_photo_url,'no photo') || ' ' || res::text; END IF;
  out := out || E'\n   payments: ' || coalesce((SELECT string_agg(payment_method || ' ' || amount || ' ' || coalesce(reference_no, '-') || ' ' || payment_date, ' | ' ORDER BY payment_date) FROM payments WHERE sale_id = v_sale), 'none');

  -- 3. discount, with a nominee: nominee photo needed; then the room's Approve makes the sale
  res := saf_new(us[2]); f2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f2, buyer || jsonb_build_object('buyer_cnic','17301-1234567-2','buyer_photo_url', PH, 'discount_amount', 50000, 'discount_reason', 'Dry',
                                                   'nominee', jsonb_build_object('name','Dry Nominee','relation','Brother','cnic','17301-7654321-1','phone','03009999999')));
  s1 := saf_submit(f2);
  PERFORM saf_save(f2, jsonb_build_object('nominee_photo_url', PN));
  res := saf_submit(f2);
  IF s1->>'message' LIKE '%nominee''s photo%' AND res->'saf'->>'status' = 'submitted' AND NOT EXISTS (SELECT 1 FROM sales WHERE saf_id = f2)
  THEN ok := ok + 1; out := out || E'\n04 PASS nominee named without a photo is stopped; with it, 50,000 off goes to the directors (no sale yet)';
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || s1::text || ' / ' || res::text; END IF;

  res := saf_room_approve(L, P, f2, 'naeem-sign-1');
  SELECT id INTO v_sale FROM sales WHERE saf_id = f2;
  SELECT total_received INTO v_recv FROM sale_approval_forms WHERE id = f2;
  SELECT coalesce(sum(amount), 0) INTO v_paid FROM payments WHERE sale_id = v_sale;
  SELECT c.client_photo_url, c.next_of_kin_photo_url, c.next_of_kin_name, x.created_by INTO v_cl FROM sales x JOIN clients c ON c.id = x.client_id WHERE x.id = v_sale;
  IF res->>'success' = 'true' AND res->>'sale_number' IS NOT NULL AND v_paid = v_recv AND v_cl.next_of_kin_photo_url = PN AND v_cl.created_by = naseer_id
  THEN ok := ok + 1; out := out || E'\n05 PASS Naeem approved in the room and ' || (res->>'sale_number') || ' was made at once, in Naseer''s name; received ' || v_paid || '; nominee ' || v_cl.next_of_kin_name || ' with photo';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL paid=' || v_paid || ' recv=' || v_recv || ' ' || coalesce(v_cl.next_of_kin_photo_url,'-') || ' by ' || coalesce(v_cl.created_by::text,'-') || ' ' || res::text; END IF;

  -- 4. decline: back to Naseer with the reason, no sale
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  res := saf_new(us[3]); f3 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f3, buyer || jsonb_build_object('buyer_cnic','17301-1234567-3','buyer_photo_url', PH, 'discount_amount', 300000, 'discount_reason', 'Dry'));
  PERFORM saf_submit(f3);
  res := saf_room_reject(L, P, f3, 'Dry: too much', 'yousaf-sign-1');
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE (e->>'id')::uuid = f3 AND e->>'status' = 'rejected';
  IF n = 1 AND NOT EXISTS (SELECT 1 FROM sales WHERE saf_id = f3) THEN ok := ok + 1; out := out || E'\n06 PASS declined by ' || (res->'saf'->>'rejected_by_name') || '; back with Naseer with the reason; no sale';
  ELSE bad := bad + 1; out := out || E'\n06 FAIL n=' || n || ' ' || res::text; END IF;

  out := out || E'\nSEC anon _saf_make_sale: ' || has_function_privilege('anon', 'public._saf_make_sale(uuid,uuid,text)', 'EXECUTE')::text
             || ', authenticated: ' || has_function_privilege('authenticated', 'public._saf_make_sale(uuid,uuid,text)', 'EXECUTE')::text;
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
  const left = await q(`select (select count(*) from sale_approval_forms) safs,
      (select count(*) from payments where sale_id='ca07d728-f700-42f8-9a90-8c7e3a6ad528') gf253_payments,
      (select count(*) from information_schema.columns where table_name='sale_approval_forms' and column_name='buyer_photo_url') photo_col,
      (select count(*) from availability_links where label = 'dry') test_links`);
  console.log('after rollback:', JSON.stringify(left));
})();
