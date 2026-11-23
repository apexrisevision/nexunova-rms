#!/usr/bin/env node
/* Dry run of 20261123b (Sharose: full reservation desk, like Iqra) — one request ending in RAISE, nothing kept.
   Test sessions are made inside the rolled-back transaction; no PIN is used or seen. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261123b_sharose_reservation_desk.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const P = { sharose: 'fac8551d-8d14-4123-8225-ceead000256c', iqra: '7a89dec1-af53-40a6-817f-e2a6d2db23b6', rep: '932ed82e-80a3-45ec-8c75-e456cae784cf', rashid: '015effd0-7ac7-4939-a1b3-dd2826ab8fba' };
const probe = tag => `INSERT INTO _r SELECT '${tag}', jsonb_object_agg(who, jsonb_build_object(
    'may_sell', public._sales_may_sell(tok), 'authorize', public.can_authorize_reservation(tok),
    'decide', public.can_decide_reservation_requests(tok),
    'desk', COALESCE(public.get_reserve_desk(tok)->>'error', 'opens')))
  FROM _tok;`;
(async () => {
  const sql = `BEGIN;
CREATE TEMP TABLE _r (k text, v jsonb);
CREATE TEMP TABLE _tok (who text, tok text);
${Object.entries(P).map(([w, id]) => `INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
  VALUES ('${CO}', '${id}', 'dryrun-23b-${w}', now() + interval '10 minutes');
INSERT INTO _tok VALUES ('${w}', 'dryrun-23b-${w}');`).join('\n')}
${probe('1_before')}
${MIG}
${probe('2_after')}
INSERT INTO _r VALUES ('3_roles', (SELECT jsonb_object_agg(full_name, role) FROM sales_users WHERE id IN ('${P.sharose}', '${P.iqra}', '${P.rep}')));
DO $t$ BEGIN RAISE EXCEPTION 'DRYRUN_RESULT %', (SELECT jsonb_object_agg(k, v) FROM _r)::text; END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(msg.slice(0, 2000)); process.exit(1); }
  const j = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, ''));
  for (const k of Object.keys(j).sort()) console.log(k, JSON.stringify(j[k]));
  console.log('test sessions left behind:', JSON.stringify(await q(`select count(*) from sales_sessions where session_token like 'dryrun-23b-%'`)));
})();
