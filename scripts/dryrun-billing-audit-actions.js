#!/usr/bin/env node
/* Dry run of 20261026a_billing_audit_actions.sql on the live RMS database,
   against the ZZTEST internal tenant, as the super-admin. Migration + tests go
   up as ONE request ending in RAISE, so everything rolls back.

   Usage: node scripts/dryrun-billing-audit-actions.js                         */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261026a_billing_audit_actions.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  sa constant uuid := '98ab301c-e11b-40e4-9c3e-459761b5ae3b';
  co uuid; r jsonb; out text := ''; ok int := 0; bad int := 0; v text; n int;
BEGIN
  SELECT c.id INTO co FROM companies c WHERE c.company_name ILIKE 'ZZTEST%' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id) LIMIT 1;
  IF co IS NULL THEN RAISE EXCEPTION 'DRYRUN_RESULT no ZZTEST tenant'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);

  -- 1. Record Payment & Extend, with no reference typed
  r := admin_extend_subscription(co, 'month', 10000, 'bank_transfer', NULL, 'dry run');
  -- ZZTEST already has an open 25,000 invoice, so 10,000 marks it partial
  IF r->>'success' = 'true' AND r->>'invoice_status' IN ('paid','partial') AND r->>'status' = 'active'
  THEN ok := ok + 1; out := out || E'\n1 PASS Record Payment & Extend saved: invoice ' || (r->>'invoice_status') || ' (received ' || (r->>'received') || '), sub active';
  ELSE bad := bad + 1; out := out || E'\n1 FAIL ' || left(r::text, 300); END IF;
  SELECT reference_number INTO v FROM payment_proofs WHERE invoice_id = (r->>'invoice_id')::uuid ORDER BY created_at DESC LIMIT 1;
  IF v = 'Manual entry' THEN ok := ok + 1; out := out || E'\n2 PASS no reference -> saved as "Manual entry"';
  ELSE bad := bad + 1; out := out || E'\n2 FAIL ref=' || coalesce(v, 'null'); END IF;
  SELECT count(*) INTO n FROM platform_audit_log WHERE organization_id = co AND action = 'payment_recorded' AND created_at > now() - interval '1 minute';
  IF n = 1 THEN ok := ok + 1; out := out || E'\n3 PASS audit row payment_recorded written';
  ELSE bad := bad + 1; out := out || E'\n3 FAIL rows=' || n; END IF;

  -- 4. with a reference typed, it is kept
  r := admin_extend_subscription(co, 'month', 10000, 'bank_transfer', 'HBL-12345', NULL);
  -- both payments carry the same now() inside one transaction, so look the reference up directly
  SELECT max(reference_number) FILTER (WHERE reference_number = 'HBL-12345') INTO v FROM payment_proofs WHERE invoice_id = (r->>'invoice_id')::uuid;
  IF r->>'success' = 'true' AND v = 'HBL-12345' THEN ok := ok + 1; out := out || E'\n4 PASS a typed reference is kept (HBL-12345)';
  ELSE bad := bad + 1; out := out || E'\n4 FAIL ' || left(r::text, 200) || ' ref=' || coalesce(v, 'null'); END IF;

  -- 5. the invoice_sent audit row (mark_invoice_sent) is accepted
  INSERT INTO platform_audit_log (organization_id, entity_type, entity_id, action, module, reason, is_sensitive)
  VALUES (co, 'invoice', 'dry', 'invoice_sent', 'billing', 'dry run', false);
  ok := ok + 1; out := out || E'\n5 PASS invoice_sent audit row accepted';

  -- 6. anything else is still refused
  BEGIN
    INSERT INTO audit_logs (company_id, table_name, record_id, action) VALUES (co, 'x', 'x', 'not_an_action');
    bad := bad + 1; out := out || E'\n6 FAIL unknown action accepted';
  EXCEPTION WHEN check_violation THEN ok := ok + 1; out := out || E'\n6 PASS an unknown action is still refused';
  END;

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
  const left = await q(`select pg_get_constraintdef(oid) like '%payment_recorded%' widened_live from pg_constraint where conname = 'audit_logs_action_check'`);
  console.log('after rollback:', JSON.stringify(left));
})();
