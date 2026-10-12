#!/usr/bin/env node
/* Dry run of 20261013d_desk_whatsapp_required.sql on the live RMS database.
   Migration + tests as ONE request ending in RAISE: nothing is booked, no
   session or contact is kept.   Usage: node scripts/dryrun-desk-whatsapp.js */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261013d_desk_whatsapp_required.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  rashid constant uuid := '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
  naeem constant uuid := '67f8f136-802a-4235-8785-c9151f666644';
  tk text := 'dry-wa-rashid'; tk2 text := 'dry-wa-naeem';
  ag_ok uuid; ag_ok_name text; ag_bad uuid; ag_bad_name text; pr uuid;
  u uuid[]; res jsonb; out text := ''; ok int := 0; bad int := 0;
BEGIN
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token, expires_at) VALUES
    (co, rashid, tk, now() + interval '10 minutes'), (co, naeem, tk2, now() + interval '10 minutes');
  SELECT id, full_name INTO ag_ok, ag_ok_name FROM agents WHERE company_id = co AND _normalize_pk_mobile(phone) IS NOT NULL LIMIT 1;
  SELECT id, full_name INTO ag_bad, ag_bad_name FROM agents a WHERE company_id = co AND _normalize_pk_mobile(phone) IS NULL
     AND NOT EXISTS (SELECT 1 FROM availability_hold_contacts hc WHERE hc.name_key = _hold_name_key(a.full_name)) LIMIT 1;
  SELECT array_agg(id) INTO u FROM (SELECT un.id FROM units un JOIN category_unit_statuses s ON s.id = un.status_id
     WHERE un.company_id = co AND s.is_available AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = un.id AND r.status = 'active')
     ORDER BY un.unit_no LIMIT 5) x;
  SELECT project_id INTO pr FROM units WHERE id = u[1];

  res := reserve_unit_desk(tk, u[1], ag_ok, NULL, NULL, NULL, NULL, 7);
  IF res->>'success' = 'true' THEN ok := ok + 1; out := out || E'\nA PASS agent with a number on record (' || ag_ok_name || '): booked';
  ELSE bad := bad + 1; out := out || E'\nA FAIL ' || res::text; END IF;

  IF ag_bad IS NOT NULL THEN
    res := reserve_unit_desk(tk, u[2], ag_bad, NULL, NULL, NULL, NULL, 7);
    IF res->>'error' = 'whatsapp_required' THEN ok := ok + 1; out := out || E'\nB PASS agent with no number (' || ag_bad_name || '): refused - ' || (res->>'message');
    ELSE bad := bad + 1; out := out || E'\nB FAIL ' || res::text; END IF;
  END IF;

  res := reserve_unit_desk(tk, u[3], NULL, NULL, 'Dry Walkin', NULL, NULL, 7);
  IF res->>'error' = 'whatsapp_required' THEN ok := ok + 1; out := out || E'\nC PASS a typed name with no number: refused';
  ELSE bad := bad + 1; out := out || E'\nC FAIL ' || res::text; END IF;

  res := reserve_units_desk(tk, ARRAY[u[3], u[4]], NULL, NULL, 'Dry Walkin', NULL, NULL, 7);
  IF NOT EXISTS (SELECT 1 FROM reservations WHERE unit_id IN (u[3], u[4]) AND status = 'active')
  THEN ok := ok + 1; out := out || E'\nD PASS several units for a typed name with no number: none booked';
  ELSE bad := bad + 1; out := out || E'\nD FAIL ' || res::text; END IF;

  res := set_hold_contact_desk(tk2, pr, 'Dry Walkin', '03001234567');
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nE PASS another director cannot save a number from the desk';
  ELSE bad := bad + 1; out := out || E'\nE FAIL ' || res::text; END IF;
  res := set_hold_contact_desk(tk, pr, 'Dry Walkin', '0300-12');
  IF res->>'error' = 'phone' THEN ok := ok + 1; out := out || E'\nF PASS a short number is refused';
  ELSE bad := bad + 1; out := out || E'\nF FAIL ' || res::text; END IF;

  res := set_hold_contact_desk(tk, pr, 'Dry Walkin', '0300-1234567');
  res := reserve_unit_desk(tk, u[3], NULL, NULL, 'Dry Walkin', NULL, NULL, 7);
  IF res->>'success' = 'true' THEN ok := ok + 1; out := out || E'\nG PASS number saved for the typed name, then booked';
  ELSE bad := bad + 1; out := out || E'\nG FAIL ' || res::text; END IF;

  res := submit_availability_request((SELECT 'x'), 'LG-01', 7, 'Dry Dealer', NULL, '');
  out := out || E'\nH link request with no phone answers: ' || COALESCE(res->>'error', res::text);
  out := out || E'\nSEC anon set_hold_contact_desk: ' || has_function_privilege('anon', 'public.set_hold_contact_desk(text,uuid,text,text)', 'EXECUTE')::text;
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
  const left = await q(`select (select count(*) from sales_sessions where session_token like 'dry-wa-%') sessions,
      (select count(*) from availability_hold_contacts where name = 'Dry Walkin') contacts,
      position('20261013d' in pg_get_functiondef('public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text,uuid)'::regprocedure)) > 0 as patched_live`);
  console.log('after rollback:', JSON.stringify(left));
})();
