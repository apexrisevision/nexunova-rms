#!/usr/bin/env node
/* Dry run of 20261013a_saf_moves_to_rms.sql on the live RMS database.

   The migration and the role tests go up as ONE request and end in RAISE, so
   everything — the migration, two throw-away RMS users (an Accounts user and a
   Filing user), the forms and the sale — rolls back. Then the script checks
   the portal doors still exist (i.e. nothing was applied).

   Usage: node scripts/dryrun-saf-rms.js                                       */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261013a_saf_moves_to_rms.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  owner_uid uuid; acc_uid uuid; fil_uid uuid; acc_id uuid; fil_id uuid;
  u1 uuid; id1 uuid; id2 uuid; res jsonb; out text := ''; ok int := 0; bad int := 0; v_sale uuid; n int;
BEGIN
  SELECT auth_user_id INTO owner_uid FROM app_users WHERE company_id = co AND role = 'owner' LIMIT 1;
  INSERT INTO app_users (company_id, full_name, username, email, role, auth_user_id)
       VALUES (co, 'Dry Accounts', 'dry.accounts', 'dry.accounts@saf.test', 'accounts', gen_random_uuid()) RETURNING id INTO acc_id;
  SELECT auth_user_id INTO acc_uid FROM app_users WHERE id = acc_id;
  INSERT INTO app_users (company_id, full_name, username, email, role, module_permissions, auth_user_id)
       VALUES (co, 'Dry Filing', 'dry.filing', 'dry.filing@saf.test', 'staff', '{"saf_filing":true}', gen_random_uuid()) RETURNING id INTO fil_id;
  SELECT auth_user_id INTO fil_uid FROM app_users WHERE id = fil_id;
  IF acc_uid IS NULL OR fil_uid IS NULL THEN RAISE EXCEPTION 'RESULT: bridge did not give the test users an auth id'; END IF;
  SELECT id INTO u1 FROM units WHERE company_id = co AND unit_no = 'LG-01';

  -- the director and Filing cannot start a form; Accounts can
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nA PASS director cannot prepare'; ELSE bad := bad + 1; out := out || E'\nA FAIL ' || res::text; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fil_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nB PASS filing cannot prepare'; ELSE bad := bad + 1; out := out || E'\nB FAIL ' || res::text; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_new(u1); id1 := (res->'saf'->>'id')::uuid;
  IF res->>'success' = 'true' AND res->'saf'->>'prepared_by_name' = 'Dry Accounts' THEN ok := ok + 1;
     out := out || E'\nC PASS Accounts made ' || (res->'saf'->>'saf_no') || ' for LG-01, received ' || (res->'saf'->>'total_received');
  ELSE bad := bad + 1; out := out || E'\nC FAIL ' || res::text; END IF;

  -- a draft is Accounts' alone
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  SELECT jsonb_array_length(saf_list()->'rows') INTO n;
  res := saf_get(id1);
  IF n = 0 AND res->>'error' = 'not_found' THEN ok := ok + 1; out := out || E'\nD PASS director does not see the draft';
  ELSE bad := bad + 1; out := out || E'\nD FAIL director sees ' || n; END IF;

  -- Accounts fills and submits: straight to the director, Accounts named as verifier
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  PERFORM saf_save(id1, jsonb_build_object('buyer_relation','S/O','buyer_father','Dry Father','buyer_cnic','17301-1234567-1',
                                           'buyer_phone','03001234567','buyer_address','Dry address'));
  res := saf_submit(id1);
  IF res->>'success' = 'true' AND res->'saf'->>'status' = 'submitted' AND res->'saf'->>'accounts_verified_by_name' = 'Dry Accounts'
  THEN ok := ok + 1; out := out || E'\nE PASS submitted, money confirmed by ' || (res->'saf'->>'accounts_verified_by_name');
  ELSE bad := bad + 1; out := out || E'\nE FAIL ' || res::text; END IF;

  -- Filing sees nothing yet; Accounts cannot approve; the director rejects, Accounts redoes, director approves
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fil_uid, 'role', 'authenticated')::text, true);
  SELECT jsonb_array_length(saf_list()->'rows') INTO n;
  IF n = 0 THEN ok := ok + 1; out := out || E'\nF PASS filing does not see a submitted form'; ELSE bad := bad + 1; out := out || E'\nF FAIL filing sees ' || n; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_approve(id1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nG PASS Accounts cannot approve'; ELSE bad := bad + 1; out := out || E'\nG FAIL ' || res::text; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  res := saf_get(id1);
  IF res->>'success' = 'true' AND (res->'me'->>'approve')::boolean THEN ok := ok + 1; out := out || E'\nH PASS director sees the submitted form';
  ELSE bad := bad + 1; out := out || E'\nH FAIL ' || res::text; END IF;
  res := saf_reject(id1, 'Dry: father name spelt wrong');
  IF res->'saf'->>'status' = 'rejected' THEN ok := ok + 1; out := out || E'\nI PASS director rejected with a reason'; ELSE bad := bad + 1; out := out || E'\nI FAIL ' || res::text; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc_uid, 'role', 'authenticated')::text, true);
  res := saf_supersede(id1); id2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(id2, jsonb_build_object('buyer_father','Dry Father (fixed)'));
  res := saf_submit(id2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_uid, 'role', 'authenticated')::text, true);
  res := saf_approve(id2);
  IF res->>'success' = 'true' AND length(res->'saf'->>'snapshot_hash') = 64
     AND (SELECT status FROM sale_approval_forms WHERE id = id1) = 'superseded'
  THEN ok := ok + 1; out := out || E'\nJ PASS ' || (res->'saf'->>'saf_no') || ' approved (signed ' || (res->'saf'->>'approved_by_name') || '), the rejected one SUPERSEDED';
  ELSE bad := bad + 1; out := out || E'\nJ FAIL ' || res::text; END IF;

  -- the director cannot make the sale; Filing sees it, must file first, then makes it
  res := saf_create_sale(id2);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nK PASS director cannot make the sale entry'; ELSE bad := bad + 1; out := out || E'\nK FAIL ' || res::text; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fil_uid, 'role', 'authenticated')::text, true);
  SELECT jsonb_array_length(saf_list()->'rows') INTO n;
  res := saf_create_sale(id2);
  IF n = 2 AND res->>'error' = 'not_filed' THEN ok := ok + 1; out := out || E'\nL PASS filing sees approved + superseded; sale refused before filing';
  ELSE bad := bad + 1; out := out || E'\nL FAIL sees ' || n || ' ' || res::text; END IF;
  res := saf_record_pdf(id2, repeat('a', 64), co::text || '/saf/test.pdf');
  res := saf_mark_filed(id2);
  res := saf_create_sale(id2); v_sale := (res->>'sale_id')::uuid;
  IF res->>'success' = 'true' AND (SELECT saf_id FROM sales WHERE id = v_sale) = id2
     AND (SELECT created_by FROM sales WHERE id = v_sale) = fil_id
     AND (SELECT filed_by_name FROM sale_approval_forms WHERE id = id2) = 'Dry Filing'
     AND (SELECT pdf_path FROM sale_approval_forms WHERE id = id2) LIKE co::text || '/saf/%'
  THEN ok := ok + 1; out := out || E'\nM PASS filed by Dry Filing, PDF kept, sale ' || (res->>'sale_number') || ' made by Filing from ' || (res->>'saf_no');
  ELSE bad := bad + 1; out := out || E'\nM FAIL ' || res::text; END IF;

  -- the approved form is still locked
  BEGIN
    UPDATE sale_approval_forms SET net_price = net_price - 1 WHERE id = id2;
    bad := bad + 1; out := out || E'\nN FAIL approved form edited';
  EXCEPTION WHEN OTHERS THEN ok := ok + 1; out := out || E'\nN PASS approved form locked: ' || SQLERRM; END;

  -- the change log names RMS users
  out := out || E'\nO audit: ' || (SELECT string_agg(DISTINCT changed_by_name, ', ') FROM audit_logs WHERE table_name = 'sale_approval_forms' AND record_id IN (id1::text, id2::text));
  out := out || E'\nSEC anon EXECUTE saf_new: ' || has_function_privilege('anon', 'public.saf_new(uuid)', 'EXECUTE')::text
             || ', authenticated: ' || has_function_privilege('authenticated', 'public.saf_new(uuid)', 'EXECUTE')::text
             || ', portal door left: ' || (to_regprocedure('public.saf_new(text,uuid)') IS NOT NULL)::text;
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
  const left = await q(`select to_regprocedure('public.saf_new(text,uuid)') is not null portal_doors_still_there,
      to_regprocedure('public.saf_new(uuid)') is not null rms_doors,
      (select count(*) from app_users where username like 'dry.%') test_users,
      (select count(*) from sale_approval_forms) safs`);
  console.log('after rollback:', JSON.stringify(left));
})();
