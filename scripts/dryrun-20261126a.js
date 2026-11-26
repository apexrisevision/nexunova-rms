#!/usr/bin/env node
/* Dry run of 20261126a: runs the migration and the checks in ONE request that ends in RAISE EXCEPTION, so nothing stays. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('./_sbq');
const body = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126a_expo_holds_cleanup.sql'), 'utf8');
const co = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const before = `SELECT jsonb_build_object(
  'by_status', (SELECT jsonb_object_agg(k, n) FROM (SELECT cus.status_code k, count(*) n FROM public.units u
      JOIN public.projects p ON p.id = u.project_id JOIN public.category_unit_statuses cus ON cus.id = u.status_id
     WHERE p.company_id = '${co}' GROUP BY 1) t),
  'active_holds', (SELECT count(*) FROM public.reservations WHERE company_id = '${co}' AND status = 'active'),
  'tokens_on_holds', (SELECT COALESCE(sum(token_amount),0) FROM public.reservations WHERE company_id = '${co}' AND status = 'active' AND token_received),
  'sold_holds_with_expiry', (SELECT count(*) FROM public.reservations r JOIN public.category_unit_statuses c ON c.id = r.unit_status_id
     WHERE r.company_id = '${co}' AND r.status = 'active' AND c.status_code = 'SOLD_ENTRY_PENDING' AND r.expiry_date IS NOT NULL),
  'opened_notes', (SELECT count(*) FROM public.reservations WHERE company_id = '${co}' AND note LIKE '%[Opened 26-Nov-2026 before the expo, no token]%'),
  'waqar_active', (SELECT count(*) FROM public.reservations r JOIN public.agents a ON a.id = r.requested_by_agent_id
     WHERE r.company_id = '${co}' AND r.status = 'active' AND a.agent_code = 'AGT-2026-0019'),
  'protected', (SELECT jsonb_object_agg(u.unit_no, c.status_code) FROM public.units u JOIN public.projects p ON p.id = u.project_id
     JOIN public.category_unit_statuses c ON c.id = u.status_id
     WHERE p.company_id = '${co}' AND u.unit_no IN ('GF-185','GF-187','GF-127','GF-191','LG-125')))`;
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
