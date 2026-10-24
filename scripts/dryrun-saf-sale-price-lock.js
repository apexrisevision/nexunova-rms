#!/usr/bin/env node
/* Dry run of 20261024c_saf_sale_price_lock.sql on the live RMS database.
   Migration + tests go up as ONE request ending in RAISE, so everything rolls
   back. The test makes its own SAFs and sales on two held units inside the
   transaction; no existing sale is edited (SAL-2026-0005 / -0007 untouched).
   The Directors' Room part uses a throw-away link, room password and approval
   password for Naeem Hussain, all inside the same rolled-back transaction.

   Usage: node scripts/dryrun-saf-sale-price-lock.js                          */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261024c_saf_sale_price_lock.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  naseer uuid; nid uuid; awami uuid; ag uuid; ag2 uuid; u1 uuid; u2 uuid; f1 uuid; f2 uuid; sid uuid; other uuid;
  r jsonb; sch jsonb; out text := ''; ok int := 0; bad int := 0; v numeric; v2 numeric; t text; n int;
  v_proj uuid; naeem_su uuid;
BEGIN
  SELECT auth_user_id, id INTO naseer, nid FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT auth_user_id INTO awami FROM app_users WHERE company_id = co AND username = 'awami';
  SELECT id INTO ag  FROM agents WHERE company_id = co AND status = 'active' ORDER BY agent_code LIMIT 1;
  SELECT id INTO ag2 FROM agents WHERE company_id = co AND status = 'active' ORDER BY agent_code DESC LIMIT 1;
  -- two held units with no sale and no open form
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
  -- fill both forms the way Accounts would (photos as plain text: submit only checks they are set)
  UPDATE sale_approval_forms SET buyer_name = 'Dry Buyer ' || saf_no, buyer_relation = 'S/O', buyer_father = 'Dry Father',
         buyer_cnic = CASE WHEN id = f1 THEN '99999-0000001-1' ELSE '99999-0000002-2' END, buyer_phone = '03001112223',
         buyer_address = 'Dry address', buyer_photo_url = 'dry', buyer_name_reason = 'dry run', nominee = NULL,
         agent_id = ag, commission_pct = commission_standard_pct, plan_type = 'standard', sale_date = CURRENT_DATE,
         discount_amount = CASE WHEN id = f1 THEN 100000 ELSE 0 END, discount_reason = 'dry run discount'
   WHERE id IN (f1, f2);

  -- (d) a new SAF with a discount goes to the Room, no sale
  r := saf_submit(f1);
  SELECT count(*) INTO n FROM sales WHERE unit_id = u1 AND status = 'active';
  IF r->>'success' = 'true' AND r#>>'{saf,status}' = 'submitted' AND r#>>'{saf,approval_route}' = 'director' AND n = 0
  THEN ok := ok + 1; out := out || E'\nd  PASS discount 100,000 -> status submitted, route director, no sale (' || (r#>>'{saf,saf_no}') || ')';
  ELSE bad := bad + 1; out := out || E'\nd  FAIL ' || left(r::text, 400) || ' sales=' || n; END IF;

  -- (e) a new SAF at list price is approved and the sale is made
  r := saf_submit(f2);
  SELECT id INTO sid FROM sales WHERE unit_id = u2 AND status = 'active';
  IF r->>'success' = 'true' AND r#>>'{saf,status}' = 'approved' AND sid IS NOT NULL
  THEN ok := ok + 1; out := out || E'\ne  PASS list price -> approved, sale ' || (SELECT sale_number FROM sales WHERE id = sid) || ' made';
  ELSE bad := bad + 1; out := out || E'\ne  FAIL ' || left(r::text, 400); END IF;
  IF sid IS NULL THEN RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out; END IF;
  SELECT discount, down_payment INTO v, v2 FROM sales WHERE id = sid;

  -- (a) owner and admin cannot change discount / rate / area / down payment on a SAF sale
  r := edit_sale(sid, co, jsonb_build_object('discount', 50000), 'Dry run: admin discount');
  t := r->>'message';
  IF r->>'error' = 'saf_price_locked' THEN ok := ok + 1; out := out || E'\na1 PASS admin (naseer) discount refused: ' || t;
  ELSE bad := bad + 1; out := out || E'\na1 FAIL ' || r::text; END IF;
  r := edit_sale(sid, co, jsonb_build_object('down_payment', v2 - 1000), 'Dry run: admin down payment');
  IF r->>'error' = 'saf_price_locked' AND r->>'field' = 'down_payment' THEN ok := ok + 1; out := out || E'\na2 PASS admin down payment refused';
  ELSE bad := bad + 1; out := out || E'\na2 FAIL ' || r::text; END IF;
  r := edit_sale(sid, co, jsonb_build_object('price_per_sqft', 1), 'Dry run: admin rate change');
  IF r->>'error' = 'saf_price_locked' THEN ok := ok + 1; out := out || E'\na3 PASS admin rate refused';
  ELSE bad := bad + 1; out := out || E'\na3 FAIL ' || r::text; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', awami, 'role', 'authenticated')::text, true);
  r := edit_sale(sid, co, jsonb_build_object('discount', 50000), 'Dry run: owner discount');
  IF r->>'error' = 'saf_price_locked' THEN ok := ok + 1; out := out || E'\na4 PASS owner (awami) discount refused';
  ELSE bad := bad + 1; out := out || E'\na4 FAIL ' || r::text; END IF;
  r := _edit_sale_core(sid, co, jsonb_build_object('area_sqft', 1));
  IF r->>'error' = 'saf_price_locked' THEN ok := ok + 1; out := out || E'\na5 PASS _edit_sale_core (approval engine path) refused too';
  ELSE bad := bad + 1; out := out || E'\na5 FAIL ' || r::text; END IF;
  IF (SELECT discount FROM sales WHERE id = sid) = v AND (SELECT down_payment FROM sales WHERE id = sid) = v2
  THEN ok := ok + 1; out := out || E'\na6 PASS sale unchanged after the refusals';
  ELSE bad := bad + 1; out := out || E'\na6 FAIL sale changed'; END IF;

  -- (b) other fields still edit; the screen sends the unchanged price fields along
  r := edit_sale(sid, co, jsonb_build_object('notes', 'Dry run note', 'agent_id', ag2, 'discount', v, 'down_payment', v2,
                                             'price_per_sqft', (SELECT price_per_sqft FROM sales WHERE id = sid)), NULL);
  IF r->>'success' = 'true' AND (SELECT notes FROM sales WHERE id = sid) = 'Dry run note' AND (SELECT agent_id FROM sales WHERE id = sid) = ag2
  THEN ok := ok + 1; out := out || E'\nb  PASS notes + agent saved (price fields sent unchanged)';
  ELSE bad := bad + 1; out := out || E'\nb  FAIL ' || r::text; END IF;

  -- (c) schedule total must equal net on a SAF sale
  SELECT jsonb_agg(i || '{"_new":false,"_deleted":false}') INTO sch FROM jsonb_array_elements(get_sale_for_edit(sid, co)->'installments') i;
  sch := jsonb_set(sch, '{1,amount_due}', to_jsonb((sch#>>'{1,amount_due}')::numeric + 1000));
  r := edit_installment_schedule(sid, co, sch, 'Dry run: schedule off by 1000');
  IF r->>'error' = 'saf_schedule_total' THEN ok := ok + 1; out := out || E'\nc1 PASS schedule +1,000 refused: ' || (r->>'message');
  ELSE bad := bad + 1; out := out || E'\nc1 FAIL ' || left(r::text, 300); END IF;
  sch := sch || jsonb_build_array(jsonb_build_object('_new', true, 'installment_number', 99, 'installment_type', 'installment',
                                                    'due_date', '2031-01-01', 'amount_due', 5000));
  sch := jsonb_set(sch, '{1,amount_due}', to_jsonb((sch#>>'{1,amount_due}')::numeric - 1000));
  r := edit_installment_schedule(sid, co, sch, 'Dry run: extra row');
  IF r->>'error' = 'saf_schedule_total' THEN ok := ok + 1; out := out || E'\nc2 PASS an added row of 5,000 refused';
  ELSE bad := bad + 1; out := out || E'\nc2 FAIL ' || left(r::text, 300); END IF;
  sch := sch - (jsonb_array_length(sch) - 1);
  sch := jsonb_set(sch, '{1,amount_due}', to_jsonb((sch#>>'{1,amount_due}')::numeric + 700));
  sch := jsonb_set(sch, '{2,amount_due}', to_jsonb((sch#>>'{2,amount_due}')::numeric - 700));
  r := edit_installment_schedule(sid, co, sch, 'Dry run: moved 700, same total');
  IF r->>'success' = 'true' THEN ok := ok + 1; out := out || E'\nc3 PASS reshaped schedule with the same total saved';
  ELSE bad := bad + 1; out := out || E'\nc3 FAIL ' || left(r::text, 300); END IF;

  -- the Edit Sale screen learns the sale is a SAF sale
  r := get_sale_for_edit(sid, co);
  IF r#>>'{sale,saf_no}' = (SELECT saf_no FROM sale_approval_forms WHERE id = f2)
  THEN ok := ok + 1; out := out || E'\nx1 PASS get_sale_for_edit returns saf_no ' || (r#>>'{sale,saf_no}');
  ELSE bad := bad + 1; out := out || E'\nx1 FAIL ' || left(r::text, 200); END IF;
  -- a sale NOT from a SAF is not locked
  SELECT id INTO other FROM sales WHERE saf_id IS NULL AND status = 'active' LIMIT 1;
  IF other IS NULL OR _saf_sale_price_block(other, '{"discount": 1}'::jsonb) IS NULL
  THEN ok := ok + 1; out := out || E'\nx2 PASS a non-SAF sale is not locked';
  ELSE bad := bad + 1; out := out || E'\nx2 FAIL'; END IF;

  -- Directors' Room: never the person who submitted it; another director can
  SELECT a.sales_user_id INTO naeem_su FROM saf_approvers a WHERE a.company_id = co AND a.display_name = 'Naeem Hussain';
  SELECT project_id INTO v_proj FROM sale_approval_forms WHERE id = f1;
  INSERT INTO availability_links (token_hash, company_id, project_id, label)
  VALUES (_availability_token_hash('dry_room_probe'), co, v_proj, 'DRY RUN - rolled back');
  UPDATE projects SET report_password_hash = _availability_secret_hash(v_proj, 'dry-room') WHERE id = v_proj;
  UPDATE saf_approvers SET password_hash = extensions.crypt('dry-sign-naeem', extensions.gen_salt('bf')) WHERE sales_user_id = naeem_su AND company_id = co;
  UPDATE sales_users SET app_user_id = nid WHERE id = naeem_su;   -- pretend Naeem's sales login is naseer's RMS login
  r := saf_room_approve('dry_room_probe', 'dry-room', f1, 'dry-sign-naeem');
  IF r->>'error' = 'own_form' THEN ok := ok + 1; out := out || E'\nr1 PASS submitter cannot approve own form: ' || (r->>'message');
  ELSE bad := bad + 1; out := out || E'\nr1 FAIL ' || left(r::text, 300); END IF;
  UPDATE sales_users SET app_user_id = NULL WHERE id = naeem_su;
  r := saf_room_approve('dry_room_probe', 'dry-room', f1, 'dry-sign-naeem');
  SELECT count(*) INTO n FROM sales WHERE unit_id = u1 AND status = 'active';
  IF r->>'success' = 'true' AND n = 1 THEN ok := ok + 1; out := out || E'\nr2 PASS another director approves -> sale ' || (r->>'sale_number') || ' made, approved by ' || (r#>>'{saf,approved_by_name}');
  ELSE bad := bad + 1; out := out || E'\nr2 FAIL ' || left(r::text, 300) || ' sales=' || n; END IF;

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
  const left = await q(`select (select count(*) from pg_proc where proname = '_saf_sale_price_block') helper_live,
      (select count(*) from sale_approval_forms where buyer_name like 'Dry Buyer%') dry_forms,
      (select count(*) from availability_links where label = 'DRY RUN - rolled back') dry_links,
      (select password_hash is null from saf_approvers where display_name = 'Naeem Hussain') naeem_still_no_password,
      (select discount from sales where sale_number = 'SAL-2026-0007' and company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce') sal7_discount,
      (select discount from sales where sale_number = 'SAL-2026-0005' and company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce') sal5_discount`);
  console.log('after rollback:', JSON.stringify(left));
})();
