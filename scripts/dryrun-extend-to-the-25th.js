#!/usr/bin/env node
/* Dry run of 20261026b_extend_to_the_25th.sql on the live RMS database,
   against the ZZTEST internal tenant, as the super-admin. Migration + tests go
   up as ONE request ending in RAISE, so everything rolls back.

   Usage: node scripts/dryrun-extend-to-the-25th.js                            */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261026b_extend_to_the_25th.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  sa constant uuid := '98ab301c-e11b-40e4-9c3e-459761b5ae3b';
  co uuid; sub uuid; r jsonb; out text := ''; ok int := 0; bad int := 0; got text;
  c record;
BEGIN
  -- the helper, in Pakistan time
  FOR c IN SELECT * FROM (VALUES
      ('2026-10-25 23:59:59+05', '2026-11-25 23:59'),   -- exactly the cutoff -> next month
      ('2026-10-26 11:00:00+05', '2026-11-25 23:59'),   -- the day after
      ('2026-11-25 10:00:00+05', '2026-11-25 23:59'),   -- the morning of the 25th -> that night
      ('2026-12-31 23:00:00+05', '2027-01-25 23:59'),   -- across the year end
      ('2027-02-20 09:00:00+05', '2027-02-25 23:59')) v(t_in, want) LOOP
    got := to_char(public._billing_next_25th(c.t_in::timestamptz) AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD HH24:MI');
    IF got = c.want THEN ok := ok + 1; out := out || E'\nh  PASS ' || c.t_in || ' -> ' || got;
    ELSE bad := bad + 1; out := out || E'\nh  FAIL ' || c.t_in || ' -> ' || got || ' (want ' || c.want || ')'; END IF;
  END LOOP;

  SELECT cc.id, s.id INTO co, sub FROM companies cc JOIN subscriptions s ON s.company_id = cc.id
   WHERE cc.company_name ILIKE 'ZZTEST%' ORDER BY s.created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);

  FOR c IN SELECT * FROM (VALUES
      ('lapsed yesterday (ended 25-Oct)',    '2026-10-25 23:59:59+05', 'month', '2026-11-25 23:59'),
      ('paid early (ends 25-Nov)',           '2026-11-25 23:59:59+05', 'month', '2026-12-25 23:59'),
      ('lapsed for months (ended 25-Jul)',   '2026-07-25 23:59:59+05', 'month', '2026-11-25 23:59'),
      ('yearly, lapsed yesterday',           '2026-10-25 23:59:59+05', 'year',  '2027-10-25 23:59')) v(label, old_end, cyc, want) LOOP
    UPDATE subscriptions SET current_period_end = c.old_end::timestamptz, status = 'pending_payment' WHERE id = sub;
    r := admin_extend_subscription(co, c.cyc, 10000, 'bank_transfer', 'DRY', NULL);
    got := to_char((r->>'new_period_end')::timestamptz AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD HH24:MI');
    IF r->>'success' = 'true' AND got = c.want AND (SELECT status FROM subscriptions WHERE id = sub) = 'active'
    THEN ok := ok + 1; out := out || E'\nb  PASS ' || c.label || ': ' || c.cyc || ' -> ends ' || got || ' PKT, active';
    ELSE bad := bad + 1; out := out || E'\nb  FAIL ' || c.label || ': got ' || coalesce(got, '-') || ' want ' || c.want || ' ' || left(r::text, 150); END IF;
  END LOOP;

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
  const left = await q(`select count(*) helper_live from pg_proc where proname = '_billing_next_25th'`);
  console.log('after rollback:', JSON.stringify(left));
})();
