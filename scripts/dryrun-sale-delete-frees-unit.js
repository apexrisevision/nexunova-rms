#!/usr/bin/env node
/* Dry run of 20261020a_sale_delete_frees_unit.sql on the live RMS database, as
   the real Awami login (naseer). Migration + tests go up as ONE request ending
   in RAISE, so everything rolls back (the migration, forms, sales, payments).

   Replays GF-253: SAF makes a sale, the sale is deleted by hand, and the unit
   must come back to the SAF picker with its hold.

   Usage: node scripts/dryrun-sale-delete-frees-unit.js                        */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261020a_sale_delete_frees_unit.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  PH text := 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/' || '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' || '/clients/photos/dry_buyer.jpg';
  naseer uuid; us uuid[]; f1 uuid; res jsonb; out text := ''; ok int := 0; bad int := 0;
  v_sale uuid; v_code text; v_hold text; v_saf text; v_sid uuid; v_in boolean; v_err text;
  buyer jsonb := '{"buyer_relation":"S/O","buyer_father":"Dry Father","buyer_cnic":"17301-1234567-1","buyer_phone":"03001234567","buyer_address":"Dry Peshawar"}';
BEGIN
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT array_agg(id) INTO us FROM (
    SELECT u.id FROM units u
     WHERE u.company_id = co
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active'
                     AND btrim(coalesce(r.client_name,'')) <> '' AND r.requested_by_agent_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = u.id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = u.id)
       AND coalesce(u.base_price, 0) > 0
       AND (_saf_money(co, u.unit_no)->>'total')::numeric > 0
     ORDER BY u.unit_no LIMIT 2) x;
  IF coalesce(array_length(us, 1), 0) < 2 THEN RAISE EXCEPTION 'DRYRUN_RESULT not enough units: %', us; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);

  -- the sale, made the normal way
  res := saf_new(us[1]); f1 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(f1, buyer || jsonb_build_object('buyer_photo_url', PH));
  res := saf_submit(f1);
  SELECT id INTO v_sale FROM sales WHERE saf_id = f1;
  SELECT cs.status_code INTO v_code FROM units u JOIN category_unit_statuses cs ON cs.id = u.status_id WHERE u.id = us[1];
  IF v_sale IS NOT NULL AND v_code = 'SOLD' THEN ok := ok + 1; out := out || E'\n01 PASS sale made, unit SOLD';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL sale=' || coalesce(v_sale::text,'none') || ' unit=' || coalesce(v_code,'-') || ' ' || left(res::text, 400); END IF;

  -- the lock still refuses any other change to an approved form
  BEGIN
    UPDATE sale_approval_forms SET status = 'cancelled', sale_id = NULL WHERE id = f1;
    bad := bad + 1; out := out || E'\n02 FAIL approved form was cancelled without a sale delete';
  EXCEPTION WHEN OTHERS THEN ok := ok + 1; out := out || E'\n02 PASS lock holds outside a sale delete: ' || SQLERRM; END;

  -- the hand delete that broke GF-253
  DELETE FROM payments WHERE sale_id = v_sale OR installment_id IN (SELECT id FROM installments WHERE sale_id = v_sale);
  DELETE FROM sales WHERE id = v_sale;
  SELECT cs.status_code INTO v_code FROM units u JOIN category_unit_statuses cs ON cs.id = u.status_id WHERE u.id = us[1];
  SELECT r.status || '/' || cs.status_code INTO v_hold FROM reservations r JOIN category_unit_statuses cs ON cs.id = r.unit_status_id
   WHERE r.unit_id = us[1] ORDER BY r.created_at DESC LIMIT 1;
  SELECT status, sale_id INTO v_saf, v_sid FROM sale_approval_forms WHERE id = f1;
  IF v_code = 'RESERVED' THEN ok := ok + 1; out := out || E'\n03 PASS unit back to RESERVED';
  ELSE bad := bad + 1; out := out || E'\n03 FAIL unit=' || coalesce(v_code,'-'); END IF;
  IF v_hold = 'active/RESERVED' THEN ok := ok + 1; out := out || E'\n04 PASS hold active again, tag RESERVED';
  ELSE bad := bad + 1; out := out || E'\n04 FAIL hold=' || coalesce(v_hold,'-'); END IF;
  IF v_saf = 'cancelled' AND v_sid IS NULL THEN ok := ok + 1; out := out || E'\n05 PASS SAF cancelled, unlinked';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL saf=' || coalesce(v_saf,'-'); END IF;

  -- it is back in the SAF picker, and a new SAF can be started
  res := saf_list();
  v_in := EXISTS (SELECT 1 FROM jsonb_array_elements(res->'units') e WHERE (e->>'id')::uuid = us[1]);
  res := saf_new(us[1]);
  IF v_in AND res->>'success' = 'true' AND res->'saf'->>'status' = 'draft' THEN ok := ok + 1; out := out || E'\n06 PASS in the picker; new draft ' || (res->'saf'->>'saf_no');
  ELSE bad := bad + 1; out := out || E'\n06 FAIL picker=' || v_in || ' ' || left(res::text, 300); END IF;

  -- a hold tagged Sold before its sale shows in the picker too
  UPDATE units SET status_id = (SELECT id FROM category_unit_statuses WHERE project_id = units.project_id AND status_code = 'SOLD' LIMIT 1) WHERE id = us[2];
  res := saf_list();
  v_in := EXISTS (SELECT 1 FROM jsonb_array_elements(res->'units') e WHERE (e->>'id')::uuid = us[2]);
  IF v_in THEN ok := ok + 1; out := out || E'\n07 PASS Sold-tagged hold with no sale is in the picker';
  ELSE bad := bad + 1; out := out || E'\n07 FAIL Sold-tagged hold missing from picker'; END IF;

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
      (select count(*) from pg_trigger where tgname = 'trg_sale_delete_frees_unit') trigger_live`);
  console.log('after rollback:', JSON.stringify(left));
})();
