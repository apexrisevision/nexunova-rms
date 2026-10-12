#!/usr/bin/env node
/* Dry run of 20261013b_saf_approval_on_desk.sql on the live RMS database.

   Migration + the full round trip (Accounts in the RMS -> Rashid on the desk ->
   Filing in the RMS) go up as ONE request ending in RAISE, so everything —
   the migration, throw-away users and sessions, forms and the sale — rolls
   back. Then the script checks nothing was left behind.

   Usage: node scripts/dryrun-saf-desk.js                                      */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261013b_saf_approval_on_desk.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  rashid constant uuid := '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
  owner_uid uuid; acc_uid uuid; fil_uid uuid; acc_id uuid; fil_id uuid; other_dir uuid;
  tk_r text := 'dry-desk-rashid'; tk_o text := 'dry-desk-other';
  u1 uuid; id1 uuid; id2 uuid; res jsonb; out text := ''; ok int := 0; bad int := 0; v_sale uuid; n int;
BEGIN
  SELECT auth_user_id INTO owner_uid FROM app_users WHERE company_id = co AND role = 'owner' LIMIT 1;
  INSERT INTO app_users (company_id, full_name, username, email, role, auth_user_id)
       VALUES (co, 'Dry Accounts', 'dry.accounts', 'dry.accounts@saf.test', 'accounts', gen_random_uuid()) RETURNING id, auth_user_id INTO acc_id, acc_uid;
  INSERT INTO app_users (company_id, full_name, username, email, role, module_permissions, auth_user_id)
       VALUES (co, 'Dry Filing', 'dry.filing', 'dry.filing@saf.test', 'staff', '{"saf_filing":true}', gen_random_uuid()) RETURNING id, auth_user_id INTO fil_id, fil_uid;
  SELECT id INTO other_dir FROM sales_users WHERE company_id = co AND role = 'director' AND id <> rashid LIMIT 1;
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
    (co, rashid, tk_r, now() + interval '1 hour'), (co, other_dir, tk_o, now() + interval '1 hour');
  SELECT id INTO u1 FROM units WHERE company_id = co AND unit_no = 'LG-01';

  -- the RMS cannot sign any more
  IF to_regprocedure('public.saf_approve(uuid)') IS NULL AND to_regprocedure('public.saf_reject(uuid,text)') IS NULL
  THEN ok := ok + 1; out := out || E'\nA PASS the RMS approve/reject doors are gone';
  ELSE bad := bad + 1; out := out || E'\nA FAIL RMS doors still there'; END IF;

  -- another director is refused at the desk
  res := saf_desk_list(tk_o);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nB PASS another director refused';
  ELSE bad := bad + 1; out := out || E'\nB FAIL ' || res::text; END IF;

  -- Accounts prepares; Rashid cannot see the draft
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u1); id1 := (res->'saf'->>'id')::uuid;
  res := saf_desk_get(tk_r, id1);
  IF res->>'error' = 'not_found' AND jsonb_array_length(saf_desk_list(tk_r)->'rows') = 0
  THEN ok := ok + 1; out := out || E'\nC PASS Rashid does not see the draft';
  ELSE bad := bad + 1; out := out || E'\nC FAIL ' || res::text; END IF;

  PERFORM saf_save(id1, jsonb_build_object('buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-1',
                                           'buyer_phone','03001234567','buyer_address','Dry address'));
  res := saf_submit(id1);
  res := saf_desk_list(tk_r);
  IF (res->>'waiting')::int = 1 AND res->'rows'->0->>'status' = 'submitted'
  THEN ok := ok + 1; out := out || E'\nD PASS submitted form is waiting on Rashid''s desk (badge ' || (res->>'waiting') || ')';
  ELSE bad := bad + 1; out := out || E'\nD FAIL ' || res::text; END IF;

  -- another director cannot approve; Rashid sends back with a reason
  res := saf_desk_approve(tk_o, id1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nE PASS another director cannot approve';
  ELSE bad := bad + 1; out := out || E'\nE FAIL ' || res::text; END IF;
  res := saf_desk_reject(tk_r, id1, '');
  IF res->>'error' = 'reason_required' THEN ok := ok + 1; out := out || E'\nF PASS sending back needs a reason';
  ELSE bad := bad + 1; out := out || E'\nF FAIL ' || res::text; END IF;
  res := saf_desk_reject(tk_r, id1, 'Dry: father name spelt wrong');
  IF res->'saf'->>'status' = 'rejected' AND res->'saf'->>'rejected_by_name' = 'Rashid Manzoor'
  THEN ok := ok + 1; out := out || E'\nG PASS sent back by Rashid Manzoor';
  ELSE bad := bad + 1; out := out || E'\nG FAIL ' || res::text; END IF;

  -- Accounts sees it back, redoes, resubmits; Rashid approves
  SELECT count(*) INTO n FROM jsonb_array_elements(saf_list()->'rows') e WHERE e->>'status' = 'rejected';
  res := saf_supersede(id1); id2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(id2, jsonb_build_object('buyer_father','Dry Father (fixed)'));
  res := saf_submit(id2);
  res := saf_desk_approve(tk_r, id2);
  IF n = 1 AND res->>'success' = 'true' AND res->'saf'->>'approved_by_name' = 'Rashid Manzoor'
     AND (res->'saf'->>'approved_by_sales_user')::uuid = rashid AND length(res->'saf'->>'snapshot_hash') = 64
     AND (SELECT status FROM sale_approval_forms WHERE id = id1) = 'superseded'
  THEN ok := ok + 1; out := out || E'\nH PASS ' || (res->'saf'->>'saf_no') || ' approved and signed by Rashid Manzoor; the sent-back one superseded';
  ELSE bad := bad + 1; out := out || E'\nH FAIL n=' || n || ' ' || res::text; END IF;

  -- the RMS owner sees it, read-only
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  res := saf_get(id2);
  IF res->>'success' = 'true' THEN ok := ok + 1; out := out || E'\nI PASS the RMS owner can read the approved form';
  ELSE bad := bad + 1; out := out || E'\nI FAIL ' || res::text; END IF;

  -- Filing files and makes the sale
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fil_uid, 'role', 'authenticated')::text, true);
  res := saf_record_pdf(id2, repeat('b', 64), co::text || '/saf/test.pdf');
  res := saf_mark_filed(id2);
  res := saf_create_sale(id2); v_sale := (res->>'sale_id')::uuid;
  IF res->>'success' = 'true' AND (SELECT saf_id FROM sales WHERE id = v_sale) = id2
     AND (SELECT notes FROM sales WHERE id = v_sale) LIKE '%approved by Rashid Manzoor%'
  THEN ok := ok + 1; out := out || E'\nJ PASS Filing made ' || (res->>'sale_number') || ' from ' || (res->>'saf_no');
  ELSE bad := bad + 1; out := out || E'\nJ FAIL ' || res::text; END IF;

  -- the signature is locked
  BEGIN
    UPDATE sale_approval_forms SET approved_by_sales_user = other_dir WHERE id = id2;
    bad := bad + 1; out := out || E'\nK FAIL signer changed';
  EXCEPTION WHEN OTHERS THEN ok := ok + 1; out := out || E'\nK PASS signer locked: ' || SQLERRM; END;

  out := out || E'\nSEC anon saf_desk_list: ' || has_function_privilege('anon', 'public.saf_desk_list(text)', 'EXECUTE')::text
             || ', anon _saf_desk: ' || has_function_privilege('anon', 'public._saf_desk(text)', 'EXECUTE')::text
             || ', anon saf_new: ' || has_function_privilege('anon', 'public.saf_new(uuid)', 'EXECUTE')::text;
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
  const left = await q(`select to_regprocedure('public.saf_approve(uuid)') is not null rms_approve_still_there,
      to_regprocedure('public.saf_desk_list(text)') is not null desk_doors,
      (select count(*) from app_users where username like 'dry.%') test_users,
      (select count(*) from sales_sessions where session_token like 'dry-desk-%') test_sessions,
      (select count(*) from sale_approval_forms) safs`);
  console.log('after rollback:', JSON.stringify(left));
})();
