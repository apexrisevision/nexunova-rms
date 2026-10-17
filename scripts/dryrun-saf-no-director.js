#!/usr/bin/env node
/* Dry run of 20261017a_saf_no_director_step.sql on the live RMS database, as
   the real Awami login (naseer). Migration + tests go up as ONE request ending
   in RAISE, so everything rolls back (the migration, the forms, sales and
   payments).

   Usage: node scripts/dryrun-saf-no-director.js                              */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261017a_saf_no_director_step.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  PH text := 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/' || '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' || '/clients/photos/dry_buyer.jpg';
  naseer uuid; us uuid[]; f1 uuid; f2 uuid; res jsonb; s1 jsonb; out text := ''; ok int := 0; bad int := 0; n int;
  v_sale uuid; v_paid numeric; v_recv numeric; v_note text; v_view jsonb;
  buyer jsonb := '{"buyer_relation":"S/O","buyer_father":"Dry Father","buyer_cnic":"17301-1234567-1","buyer_phone":"03001234567","buyer_address":"Dry Peshawar"}';
BEGIN
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT array_agg(id) INTO us FROM (
    SELECT u.id FROM units u
     WHERE u.company_id = co
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active' AND btrim(coalesce(r.client_name,'')) <> '')
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = u.id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = u.id)
       AND coalesce(u.base_price, 0) > 0
       AND (_saf_money(co, u.unit_no)->>'total')::numeric > 0
     ORDER BY u.unit_no LIMIT 2) x;
  IF coalesce(array_length(us, 1), 0) < 2 THEN RAISE EXCEPTION 'DRYRUN_RESULT not enough units: %', us; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);

  -- 1. a discount beyond the plan still needs a reason before submit
  res := saf_new(us[1]); f1 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f1, buyer || jsonb_build_object('buyer_photo_url', PH, 'discount_amount', 250000));
  s1 := saf_submit(f1);
  IF s1->>'success' = 'false' AND s1->>'message' ILIKE '%reason%' THEN ok := ok + 1; out := out || E'\n01 PASS discount with no reason is stopped: "' || (s1->>'message') || '"';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || s1::text; END IF;

  -- 2. with the reason: Submit approves AND makes the sale at once, no director
  PERFORM saf_save(f1, '{"discount_reason":"Dry: owner allowed"}');
  res := saf_submit(f1);
  SELECT id, notes INTO v_sale, v_note FROM sales WHERE saf_id = f1;
  SELECT total_received INTO v_recv FROM sale_approval_forms WHERE id = f1;
  SELECT coalesce(sum(amount), 0) INTO v_paid FROM payments WHERE sale_id = v_sale;
  IF res->'saf'->>'status' = 'approved' AND res->'saf'->>'approval_route' = 'plan' AND v_sale IS NOT NULL AND v_paid = v_recv
     AND v_note LIKE '%discount 250,000 given, submitted by%'
  THEN ok := ok + 1; out := out || E'\n02 PASS ' || (res->'saf'->>'saf_no') || ' ' || (res->'saf'->>'unit_code') || ' 250,000 off: Submit made ' || (res->'saf'->>'sale_number')
         || ' at once; received ' || v_paid || '; note: ' || v_note;
  ELSE bad := bad + 1; out := out || E'\n02 FAIL sale=' || coalesce(v_sale::text,'none') || ' paid=' || v_paid || ' recv=' || v_recv || ' note=' || coalesce(v_note,'-') || ' ' || left(res::text, 600); END IF;

  -- 3. the view carries the hold
  v_view := _saf_view(f1);
  IF v_view->'hold' IS NOT NULL AND v_view#>>'{hold,requested_by}' IS NOT NULL
  THEN ok := ok + 1; out := out || E'\n03 PASS hold on the view: ' || (v_view->'hold')::text;
  ELSE bad := bad + 1; out := out || E'\n03 FAIL hold=' || coalesce((v_view->'hold')::text, 'null'); END IF;

  -- 4. full price still makes the sale, note says list price
  res := saf_new(us[2]); f2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f2, buyer || jsonb_build_object('buyer_cnic','17301-1234567-2','buyer_photo_url', PH));
  res := saf_submit(f2);
  SELECT notes INTO v_note FROM sales WHERE saf_id = f2;
  IF res->'saf'->>'status' = 'approved' AND v_note LIKE '%at the list price%' THEN ok := ok + 1; out := out || E'\n04 PASS full price: ' || (res->'saf'->>'sale_number') || ' note: ' || v_note;
  ELSE bad := bad + 1; out := out || E'\n04 FAIL note=' || coalesce(v_note,'-') || ' ' || left(res::text, 400); END IF;

  -- 5. nothing waits for a director
  SELECT count(*) INTO n FROM sale_approval_forms WHERE id IN (f1, f2) AND status IN ('submitted','verified');
  IF n = 0 THEN ok := ok + 1; out := out || E'\n05 PASS no form left waiting for a director';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || n || ' waiting'; END IF;

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
      (select count(*) from pg_proc where proname = 'saf_submit' and prosrc like '%20261017a%') patched`);
  console.log('after rollback:', JSON.stringify(left));
})();
