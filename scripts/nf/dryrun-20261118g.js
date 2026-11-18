#!/usr/bin/env node
/* Dry run of 20261118g: DC-007's position (as the director) before and after, rolled back. */
const fs = require('fs'), path = require('path');
const { REF, TOKEN } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261118g_nf_awami_two_vouchers_back_to_sheet_date.sql'), 'utf8');
const POS = `(SELECT row_to_json(r)::text FROM nf_days d, public.nf_position_row(d.id) r WHERE d.company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND d.business_date = '2026-10-05')`;
const AS = `SELECT set_config('request.jwt.claims', json_build_object('sub','315f2852-852f-4653-9253-a5a27a7828c8','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub','315f2852-852f-4653-9253-a5a27a7828c8', true);`;
(async () => {
  const query = `BEGIN;\n${AS}\nSELECT set_config('dry.before', ${POS}, true);\n${MIG}\nDO $t$ BEGIN RAISE EXCEPTION 'DRYRUN_RESULT before % || after % || ledger_cash %', current_setting('dry.before'), ${POS},
    (SELECT sum(debit - credit) FROM nf_voucher_legs WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND account_code = '10100'); END $t$;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const t = await r.text(); const m = /DRYRUN_RESULT[^"]*/.exec(t.replace(/\\"/g, "'")); console.log(m ? m[0] : t);
})();
