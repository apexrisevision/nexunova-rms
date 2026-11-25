#!/usr/bin/env node
/* Dry run of 20261125a (a sale keeps its own nominee; Zarafat Sair) — one request ending in RAISE. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN, q } = require('./_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261125a_sale_own_nominee.sql'), 'utf8');
const AUTH = '315f2852-852f-4653-9253-a5a27a7828c8', CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const SNAP = `jsonb_build_object(
  'GF-250', (SELECT jsonb_build_object('nominee', s.nominee_name, 'cnic', s.nominee_cnic, 'rel', s.nominee_relation) FROM sales s WHERE s.id = 'aeee051d-bc40-4fc7-96b2-f4c3470268e9'),
  'GF-251', (SELECT jsonb_build_object('nominee', s.nominee_name, 'cnic', s.nominee_cnic, 'rel', s.nominee_relation) FROM sales s WHERE s.id = '46fbe4e0-d551-4dfb-9849-2573ff243c21'),
  'client', (SELECT jsonb_build_object('father', father_name, 'notes', notes, 'nok', next_of_kin_name, 'nok_photo_ok', next_of_kin_photo_url = (SELECT nominee_photo_url FROM sale_approval_forms WHERE saf_no = 'SAF-0025' AND company_id = '${CO}')) FROM clients WHERE id = '10363ec2-fd80-42a0-b312-766cc2835a2c'),
  'saf_sales_without_nominee', (SELECT count(*) FROM sales s JOIN sale_approval_forms f ON f.id = s.saf_id WHERE s.nominee_name IS NULL),
  'sales_total', (SELECT count(*) FROM sales), 'payments_total', (SELECT count(*) FROM payments))`;
(async () => {
  const sql = `BEGIN;
CREATE TEMP TABLE _r (k text, v jsonb);
INSERT INTO _r VALUES ('1_before', ${SNAP});
${MIG}
INSERT INTO _r VALUES ('2_after', ${SNAP});
DO $t$ DECLARE a jsonb; b jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${AUTH}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${AUTH}', true);
  a := public.get_sale_detail('aeee051d-bc40-4fc7-96b2-f4c3470268e9', '${CO}');
  b := public.get_sale_detail('46fbe4e0-d551-4dfb-9849-2573ff243c21', '${CO}');
  INSERT INTO _r VALUES ('3_sale_detail', jsonb_build_object(
    'GF-250', jsonb_build_object('nominee', COALESCE(a->'sale'->>'nominee_name', a->>'nominee_name'), 'photo', right(COALESCE(a->'sale'->>'nominee_photo_url', a->>'nominee_photo_url', ''), 14)),
    'GF-251', jsonb_build_object('nominee', COALESCE(b->'sale'->>'nominee_name', b->>'nominee_name'), 'photo', right(COALESCE(b->'sale'->>'nominee_photo_url', b->>'nominee_photo_url', ''), 14))));
END $t$;
DO $t$ BEGIN RAISE EXCEPTION 'DRYRUN_RESULT %', (SELECT jsonb_object_agg(k, v) FROM _r)::text; END $t$;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text(); let msg; try { msg = JSON.parse(t).message || t; } catch { msg = t; }
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg);
  if (!m) { console.log(msg.slice(0, 2000)); process.exit(1); }
  const j = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, '')); for (const k of Object.keys(j).sort()) console.log(k, JSON.stringify(j[k]));
})();
