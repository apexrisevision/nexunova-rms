#!/usr/bin/env node
/* Dry run of 20261022a_sale_currency_note_unique.sql on the live RMS database,
   as the real Awami login (naseer). Migration + tests go up as ONE request
   ending in RAISE, so everything rolls back (the column, index, function).

   Usage: node scripts/dryrun-sale-currency-note.js                            */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261022a_sale_currency_note_unique.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  naseer uuid; co uuid; ss uuid[]; res jsonb; out text := ''; ok int := 0; bad int := 0; v text;
BEGIN
  -- any company with two sales; act as one of its admins
  SELECT s.company_id INTO co FROM sales s GROUP BY 1 HAVING count(*) >= 2
   ORDER BY (s.company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce') DESC LIMIT 1;
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND role IN ('admin','owner') AND status = 'active' LIMIT 1;
  SELECT array_agg(id) INTO ss FROM (SELECT id FROM sales WHERE company_id = co ORDER BY created_at LIMIT 2) x;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);

  res := sale_currency_note(ss[1], co);
  IF res->>'success' = 'true' AND res->'note' = 'null'::jsonb THEN ok := ok + 1; out := out || E'\n01 PASS read: no note yet';
  ELSE bad := bad + 1; out := out || E'\n01 FAIL ' || res::text; END IF;

  res := sale_currency_note(ss[1], co, '  BT   4471923 ');
  IF res->>'note' = 'BT 4471923' THEN ok := ok + 1; out := out || E'\n02 PASS saved, tidied: ' || (res->>'note');
  ELSE bad := bad + 1; out := out || E'\n02 FAIL ' || res::text; END IF;

  res := sale_currency_note(ss[1], co, 'BT 4471923');
  IF res->>'success' = 'true' THEN ok := ok + 1; out := out || E'\n03 PASS reprint of the same sale, same note: allowed';
  ELSE bad := bad + 1; out := out || E'\n03 FAIL ' || res::text; END IF;

  res := sale_currency_note(ss[2], co, 'bt-4471923');
  IF res->>'error' = 'duplicate_note' THEN ok := ok + 1; out := out || E'\n04 PASS other sale refused: ' || (res->>'message');
  ELSE bad := bad + 1; out := out || E'\n04 FAIL ' || res::text; END IF;

  res := sale_currency_note(ss[2], co, '   ');
  IF res->>'error' = 'note_required' THEN ok := ok + 1; out := out || E'\n05 PASS empty refused';
  ELSE bad := bad + 1; out := out || E'\n05 FAIL ' || res::text; END IF;

  BEGIN
    UPDATE sales SET currency_note_no = 'BT4471923' WHERE id = ss[2];
    bad := bad + 1; out := out || E'\n06 FAIL direct duplicate write got through';
  EXCEPTION WHEN unique_violation THEN ok := ok + 1; out := out || E'\n06 PASS unique index stops a direct duplicate too'; END;

  res := sale_currency_note(ss[1], co, 'BT 4471924');
  SELECT currency_note_no INTO v FROM sales WHERE id = ss[1];
  IF v = 'BT 4471924' THEN ok := ok + 1; out := out || E'\n07 PASS a sale can correct its own note';
  ELSE bad := bad + 1; out := out || E'\n07 FAIL ' || coalesce(v,'-'); END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  res := sale_currency_note(ss[1], co, 'X1');
  IF res->>'error' = 'auth_required' THEN ok := ok + 1; out := out || E'\n08 PASS unknown login refused';
  ELSE bad := bad + 1; out := out || E'\n08 FAIL ' || res::text; END IF;

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
  const left = await q(`select count(*) column_live from information_schema.columns
      where table_name = 'sales' and column_name = 'currency_note_no'`);
  console.log('after rollback:', JSON.stringify(left));
})();
