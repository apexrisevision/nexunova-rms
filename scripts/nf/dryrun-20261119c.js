#!/usr/bin/env node
/* Dry run of 20261119c (nf_day_book): migration + calls as the director and as the site login, rolled back.
   The director's book is then turned into the Excel tab by js/nf/nf-day-excel.js (the screen's own code).
   Usage: node scripts/nf/dryrun-20261119c.js <date> <out.xlsx> */
const fs = require('fs'), path = require('path');
const X = require('xlsx');
const { REF, TOKEN, q } = require('../_sbq');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119c_nf_day_book_excel.sql'), 'utf8');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', RASHID = '315f2852-852f-4653-9253-a5a27a7828c8';
const [DATE, OUT] = process.argv.slice(2);
require(path.join(__dirname, '..', '..', 'js', 'nf', 'nf-day-excel.js'));
(async () => {
  const sh = (await q(`select auth_user_id from app_users where company_id = '${CO}' and username = 'sharose'`))[0].auth_user_id;
  const as = id => `PERFORM set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', '${id}', true);`;
  const body = `DO $t$ DECLARE j jsonb; site text; BEGIN
    ${as(sh)} BEGIN PERFORM public.nf_day_book('${CO}', DATE '${DATE}'); site := 'OPENED'; EXCEPTION WHEN OTHERS THEN site := SQLERRM; END;
    ${as(RASHID)} j := public.nf_day_book('${CO}', DATE '${DATE}');
    RAISE EXCEPTION 'DRYRUN_RESULT %', jsonb_build_object('site', site, 'book', j)::text; END $t$;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BEGIN;\n' + MIG + '\n' + body }) });
  const msg = JSON.parse(await r.text()).message;
  const m = /DRYRUN_RESULT (\{[\s\S]*\})/.exec(msg); if (!m) { console.log(msg); process.exit(1); }
  const res = JSON.parse(m[1].replace(/\nCONTEXT[\s\S]*$/, ''));
  const w = globalThis.NfDayExcel.workbook(X, res.book);
  X.writeFile(w.wb, OUT);
  console.log(JSON.stringify({ site_login: res.site, title: res.book.title, summary: globalThis.NfDayExcel.rows(res.book).summary }));
  console.log('after rollback: book_title column exists:', JSON.stringify(await q(`select count(*) n from information_schema.columns where table_name = 'nf_settings' and column_name = 'book_title'`)));
})();
