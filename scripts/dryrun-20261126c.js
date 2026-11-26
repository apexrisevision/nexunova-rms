#!/usr/bin/env node
/* Dry run of 20261126c: runs the migration and the checks in ONE request that ends in RAISE EXCEPTION, so nothing stays. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('./_sbq');
const body = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126c_gf249_reserved_fayaz.sql'), 'utf8');
const co = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const before = `SELECT jsonb_build_object(
  'unit', (SELECT c.status_name FROM public.units u JOIN public.category_unit_statuses c ON c.id = u.status_id WHERE u.id = 'aae71dab-2665-47d0-b1bc-7dffb597173a'),
  'hold', (SELECT jsonb_agg(jsonb_build_object('who', r.requested_by_name, 'tag', c.status_name, 'expiry', r.expiry_date, 'by', r.reserved_by, 'note', r.note)) FROM public.reservations r JOIN public.category_unit_statuses c ON c.id = r.unit_status_id WHERE r.unit_id = 'aae71dab-2665-47d0-b1bc-7dffb597173a' AND r.status = 'active'),
  'active_holds', (SELECT count(*) FROM public.reservations WHERE company_id = '${co}' AND status = 'active'))`;
const sql = `DO $d$ DECLARE b jsonb; a jsonb; BEGIN
  b := (${before});
  ${body.replace(/^--.*$/mg, '')}
  a := (${before});
  RAISE EXCEPTION 'DRYRUN_RESULT %', jsonb_build_object('before', b, 'after', a);
END $d$;`.replace('DO $m$', '').replace('END $m$;', 'END;');
(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await res.text();
  const m = t.match(/DRYRUN_RESULT (\{.*?\})(\\n|")/);
  console.log(m ? JSON.stringify(JSON.parse(m[1].replace(/\\"/g, '"')), null, 1) : t.slice(0, 1500));
})();
