#!/usr/bin/env node
/* Dry run of 20261024e_revert_saf_sale_price_lock.sql on the live RMS database.
   Migration + tests go up as ONE request ending in RAISE, so everything rolls
   back. The test makes its own SAFs and sales on two held units inside the
   transaction; no existing sale is edited.

   Usage: node scripts/dryrun-revert-saf-price-lock.js                        */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261024e_revert_saf_sale_price_lock.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  naseer uuid; awami uuid; ag uuid; u1 uuid; u2 uuid; f1 uuid; f2 uuid; sid uuid; sid1 uuid;
  r jsonb; sch jsonb; out text := ''; ok int := 0; bad int := 0; n int;
BEGIN
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT auth_user_id INTO awami FROM app_users WHERE company_id = co AND username = 'awami';
  SELECT id INTO ag FROM agents WHERE company_id = co AND status = 'active' ORDER BY agent_code LIMIT 1;
  SELECT jsonb_agg(x.unit_id) INTO sch FROM (SELECT to_jsonb(r0.unit_id) unit_id FROM reservations r0
     WHERE r0.company_id = co AND r0.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = r0.unit_id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms f WHERE f.unit_id = r0.unit_id AND f.status IN ('draft','submitted','verified','approved'))
     GROUP BY r0.unit_id LIMIT 2) x;
  u1 := (sch->>0)::uuid; u2 := (sch->>1)::uuid;
  IF u2 IS NULL THEN RAISE EXCEPTION 'DRYRUN_RESULT no two free held units to test on'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  r := saf_new(u1); f1 := (r#>>'{saf,id}')::uuid;
  r := saf_new(u2); f2 := (r#>>'{saf,id}')::uuid;
  UPDATE sale_approval_forms SET buyer_name = 'Dry Buyer ' || saf_no, buyer_relation = 'S/O', buyer_father = 'Dry Father',
         buyer_cnic = CASE WHEN id = f1 THEN '99999-0000001-1' ELSE '99999-0000002-2' END, buyer_phone = '03001112223',
         buyer_address = 'Dry address', buyer_photo_url = 'dry', buyer_name_reason = 'dry run', nominee = NULL,
         agent_id = ag, commission_pct = commission_standard_pct, plan_type = 'standard', sale_date = CURRENT_DATE,
         discount_amount = CASE WHEN id = f1 THEN 100000 ELSE 0 END, discount_reason = 'dry run discount'
   WHERE id IN (f1, f2);

  -- 1. a discounted SAF is approved on submit and the sale is made, like before
  r := saf_submit(f1);
  SELECT id INTO sid1 FROM sales WHERE unit_id = u1 AND status = 'active';
  IF r->>'success' = 'true' AND r#>>'{saf,status}' = 'approved' AND r#>>'{saf,approval_route}' = 'plan' AND sid1 IS NOT NULL
  THEN ok := ok + 1; out := out || E'\n1 PASS discounted SAF (100,000) approved on submit, route plan, sale ' || (SELECT sale_number FROM sales WHERE id = sid1) || ' made';
  ELSE bad := bad + 1; out := out || E'\n1 FAIL ' || left(r::text, 400); END IF;

  -- 2. a list-price SAF is approved on submit too
  r := saf_submit(f2);
  SELECT id INTO sid FROM sales WHERE unit_id = u2 AND status = 'active';
  IF r->>'success' = 'true' AND r#>>'{saf,status}' = 'approved' AND sid IS NOT NULL
  THEN ok := ok + 1; out := out || E'\n2 PASS list-price SAF approved, sale ' || (SELECT sale_number FROM sales WHERE id = sid) || ' made';
  ELSE bad := bad + 1; out := out || E'\n2 FAIL ' || left(r::text, 400); END IF;

  -- 3. admin (naseer) edits the discount and down payment on a SAF sale again
  r := edit_sale(sid, co, jsonb_build_object('discount', 50000, 'down_payment', (SELECT down_payment - 1000 FROM sales WHERE id = sid)),
                 'Dry run: admin discount after the sale');
  IF r->>'success' = 'true' AND (SELECT discount FROM sales WHERE id = sid) = 50000
  THEN ok := ok + 1; out := out || E'\n3 PASS admin (naseer) discount 0 -> 50,000 and down payment saved on a SAF sale';
  ELSE bad := bad + 1; out := out || E'\n3 FAIL ' || r::text; END IF;

  -- 4. owner (awami) too
  PERFORM set_config('request.jwt.claims', json_build_object('sub', awami, 'role', 'authenticated')::text, true);
  r := edit_sale(sid, co, jsonb_build_object('discount', 75000), 'Dry run: owner discount after the sale');
  IF r->>'success' = 'true' AND (SELECT discount FROM sales WHERE id = sid) = 75000
  THEN ok := ok + 1; out := out || E'\n4 PASS owner (awami) discount -> 75,000 saved';
  ELSE bad := bad + 1; out := out || E'\n4 FAIL ' || r::text; END IF;

  -- 5. the schedule saves without the SAF total check
  SELECT jsonb_agg(i || '{"_new":false,"_deleted":false}') INTO sch FROM jsonb_array_elements(get_sale_for_edit(sid, co)->'installments') i;
  sch := jsonb_set(sch, '{1,amount_due}', to_jsonb((sch#>>'{1,amount_due}')::numeric - 75000));
  r := edit_installment_schedule(sid, co, sch, 'Dry run: schedule');
  IF r->>'success' = 'true' THEN ok := ok + 1; out := out || E'\n5 PASS schedule saved (no SAF total check)';
  ELSE bad := bad + 1; out := out || E'\n5 FAIL ' || left(r::text, 300); END IF;

  -- 6. the 20261024c pieces are gone; 20261024b stays
  IF to_regprocedure('public._saf_sale_price_block(uuid,jsonb)') IS NULL AND to_regprocedure('public._saf_sale_schedule_block(uuid,jsonb)') IS NULL
     AND NOT (get_sale_for_edit(sid, co)->'sale') ? 'saf_no'
     AND pg_get_functiondef('public._saf_make_sale(uuid,uuid,text)'::regprocedure) LIKE '%v_left := v_left - v_amt%'
  THEN ok := ok + 1; out := out || E'\n6 PASS helpers dropped, get_sale_for_edit back, _saf_make_sale keeps the refund netting (20261024b)';
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
  const left = await q(`select (select count(*) from pg_proc where proname = '_saf_sale_price_block') lock_still_live,
      (select count(*) from sale_approval_forms where buyer_name like 'Dry Buyer%') dry_forms`);
  console.log('after rollback:', JSON.stringify(left));
})();
