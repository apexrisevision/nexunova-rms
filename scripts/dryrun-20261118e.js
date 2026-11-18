#!/usr/bin/env node
/* Dry run of 20261118e_report_rpcs_reports_gate.sql: migration + checks in ONE request ending in
   RAISE, so everything (including the temporary role edits on Sharose below) rolls back.
   Calls the two report functions as real logins' identities (claims only, no password). */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261118e_report_rpcs_reports_gate.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const BODY = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.try(uid uuid) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE co constant uuid := '${CO}'; a text; b text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  BEGIN a := 'rows ' || jsonb_array_length(public.list_sales_for_report(co, '{}'::jsonb)); EXCEPTION WHEN insufficient_privilege THEN a := 'refused'; END;
  BEGIN b := 'rows ' || jsonb_array_length(public.get_portfolio_summary(co)->'rows'); EXCEPTION WHEN insufficient_privilege THEN b := 'refused'; END;
  RETURN a || ' / ' || b;
END $f$;
DO $t$
DECLARE co constant uuid := '${CO}';
  owner_uid uuid; naseer_uid uuid; sh_uid uuid; sh uuid; other_uid uuid; r text; out text := ''; ok int := 0; bad int := 0;
BEGIN
  SELECT auth_user_id INTO owner_uid FROM app_users WHERE company_id = co AND username = 'awami';
  SELECT auth_user_id INTO naseer_uid FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT auth_user_id, id INTO sh_uid, sh FROM app_users WHERE company_id = co AND username = 'sharose';
  SELECT auth_user_id INTO other_uid FROM app_users WHERE company_id <> co AND status = 'active' AND role IN ('owner','admin')
    AND NOT COALESCE(is_super_admin, false) AND auth_user_id IS NOT NULL LIMIT 1;

  r := pg_temp.try(owner_uid);  IF r NOT LIKE '%refused%' THEN ok:=ok+1; out:=out||E'\n1 PASS owner awami gets data: '||r; ELSE bad:=bad+1; out:=out||E'\n1 FAIL '||r; END IF;
  r := pg_temp.try(naseer_uid); IF r NOT LIKE '%refused%' THEN ok:=ok+1; out:=out||E'\n2 PASS admin naseer gets data: '||r; ELSE bad:=bad+1; out:=out||E'\n2 FAIL '||r; END IF;
  r := pg_temp.try(sh_uid);     IF r = 'refused / refused' THEN ok:=ok+1; out:=out||E'\n3 PASS Sharose (staff, no modules) refused: '||r; ELSE bad:=bad+1; out:=out||E'\n3 FAIL '||r; END IF;
  r := pg_temp.try(other_uid);  IF r = 'refused / refused' THEN ok:=ok+1; out:=out||E'\n4 PASS admin of ANOTHER company asking for Awami refused: '||r; ELSE bad:=bad+1; out:=out||E'\n4 FAIL '||r; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE app_users SET module_permissions = '{"reports":true}' WHERE id = sh;
  SET LOCAL session_replication_role = origin;
  r := pg_temp.try(sh_uid); IF r NOT LIKE '%refused%' THEN ok:=ok+1; out:=out||E'\n5 PASS staff WITH Reports ticked gets data: '||r; ELSE bad:=bad+1; out:=out||E'\n5 FAIL '||r; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE app_users SET role = 'accounts', module_permissions = '{}' WHERE id = sh;
  SET LOCAL session_replication_role = origin;
  r := pg_temp.try(sh_uid); IF r NOT LIKE '%refused%' THEN ok:=ok+1; out:=out||E'\n6 PASS accounts with no ticks (role default) gets data: '||r; ELSE bad:=bad+1; out:=out||E'\n6 FAIL '||r; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE app_users SET role = 'recovery', module_permissions = '{"reports":false,"recovery":true}' WHERE id = sh;
  SET LOCAL session_replication_role = origin;
  r := pg_temp.try(sh_uid); IF r = 'refused / refused' THEN ok:=ok+1; out:=out||E'\n7 PASS recovery with Reports unticked refused: '||r; ELSE bad:=bad+1; out:=out||E'\n7 FAIL '||r; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE app_users SET role = 'staff', module_permissions = '{"reports":true}', status = 'inactive' WHERE id = sh;
  SET LOCAL session_replication_role = origin;
  r := pg_temp.try(sh_uid); IF r = 'refused / refused' THEN ok:=ok+1; out:=out||E'\n8 PASS an INACTIVE login refused even with Reports ticked: '||r; ELSE bad:=bad+1; out:=out||E'\n8 FAIL '||r; END IF;

  r := has_function_privilege('anon', 'public._rms_can_read_reports(uuid)', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public._rms_can_read_reports(uuid)', 'EXECUTE')::text;
  IF r = 'false/false' THEN ok:=ok+1; out:=out||E'\n9 PASS the helper itself cannot be called from the API'; ELSE bad:=bad+1; out:=out||E'\n9 FAIL '||r; END IF;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END $t$;`;
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + BODY }) });
  const msg = res.ok ? 'NO EXCEPTION — check for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"') : msg);
  console.log('after rollback:', JSON.stringify(await q(`select role, status, module_permissions from app_users where username = 'sharose' and company_id = '${CO}'`)),
    JSON.stringify(await q(`select position('20261118e' in pg_get_functiondef('public.list_sales_for_report(uuid,jsonb)'::regprocedure)) > 0 live_patched`)));
})();
