#!/usr/bin/env node
/* Dry run of 20261013e_approve_remembers_request_number.sql on live.
   Approves Waqar Landlord's real pending link request once WITHOUT the fix
   (to show the refusal) and once WITH it, inside one transaction ending in
   RAISE: the request stays pending, nothing is booked, no contact is kept.
   Usage: node scripts/dryrun-approve-number.js                              */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261013e_approve_remembers_request_number.sql');

const BEFORE = String.raw`
DO $b$
DECLARE co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'; rq record; res jsonb;
BEGIN
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at)
  VALUES (co, '015effd0-7ac7-4939-a1b3-dd2826ab8fba', 'dry-ap-rashid', now() + interval '10 minutes');
  SELECT * INTO rq FROM availability_requests WHERE status = 'pending' AND requested_by_name ILIKE '%waqar%' ORDER BY created_at DESC LIMIT 1;
  IF rq.id IS NULL THEN RAISE NOTICE 'no pending Waqar request'; RETURN; END IF;
  res := decide_reservation_request('dry-ap-rashid', rq.id, 'approve');
  CREATE TEMP TABLE dry_before AS SELECT rq.id AS req_id, rq.unit_no, rq.requested_by_phone AS phone, res;
  DELETE FROM reservations WHERE id = (res->>'reservation_id')::uuid;   -- in case it did book
END $b$;
`;

const AFTER = String.raw`
DO $t$
DECLARE b record; res jsonb; out text; c record;
BEGIN
  SELECT * INTO b FROM dry_before;
  IF b.req_id IS NULL THEN RAISE EXCEPTION 'DRYRUN_RESULT no pending Waqar request to test with'; END IF;
  -- the same request, approved again with the fix in place
  UPDATE availability_requests SET status = 'pending', decided_by = NULL, decided_at = NULL, reservation_id = NULL WHERE id = b.req_id;
  res := decide_reservation_request('dry-ap-rashid', b.req_id, 'approve');
  SELECT name, phone INTO c FROM availability_hold_contacts WHERE name_key = _hold_name_key('Waqar Landlord');
  out := E'\nrequest ' || b.unit_no || ' (number on it ' || b.phone || ')' ||
         E'\nBEFORE the fix: ' || COALESCE(b.res->>'error', 'success') || ' ' || COALESCE(b.res->>'message', '') ||
         E'\nAFTER the fix:  ' || CASE WHEN res->>'success' = 'true' THEN 'APPROVED and booked' ELSE res::text END ||
         E'\nremembered: ' || COALESCE(c.name || ' ' || c.phone, 'nothing');
  RAISE EXCEPTION 'DRYRUN_RESULT %', out;
END $t$;
`;

(async () => {
  console.log('project', REF);
  const sql = 'BEGIN;\n' + BEFORE + '\n' + fs.readFileSync(MIG, 'utf8') + '\n' + AFTER;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const msg = res.ok ? 'NO EXCEPTION — check the database for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"') : msg);
  const left = await q(`select (select count(*) from sales_sessions where session_token like 'dry-ap-%') sessions,
      (select count(*) from availability_hold_contacts where name_key = _hold_name_key('Waqar Landlord')) waqar_contacts,
      (select string_agg(unit_no || ' ' || status, ', ') from availability_requests where requested_by_name ilike '%waqar%' and created_at > now() - interval '3 days') waqar_requests,
      position('20261013e' in pg_get_functiondef('public.decide_reservation_request(text,uuid,text,uuid,uuid,uuid)'::regprocedure)) > 0 as patched_live`);
  console.log('after rollback:', JSON.stringify(left));
})();
