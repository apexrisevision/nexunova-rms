#!/usr/bin/env node
/* Writes supabase/migrations/20261119g_nf_day_report_heads.sql (brief of 19-Nov: the one-page WhatsApp report
   summarises money in / out BY HEAD and shows token units in short). nf_day_report's received / paid rows gain
   'head' (the account's plain name), 'token' (a Token Money line) and 'units' (the unit codes a token names). Head
   Office's lines as the site box sees them get the head "Head Office". Nothing else changes.
   Patched from the LIVE definition with asserted insertions. Usage: node <this> */
const fs = require('fs'), path = require('path');
const { q } = require('../_sbq');
(async () => {
  let d = (await q(`select pg_get_functiondef('public.nf_day_report'::regproc) d`))[0].d;
  const once = (find, repl, what) => { const p = d.split(find); if (p.length !== 2) throw new Error(what + ': ' + (p.length - 1)); d = p.join(repl); };
  const extra = "'head', h.name, 'token', h.account_code = '21100', 'units', CASE WHEN h.account_code = '21100' THEN to_jsonb(public._nf_units_in(v.narration)) ELSE '[]'::jsonb END, ";
  once("v_rec := v_rec || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, ",
       "v_rec := v_rec || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, " + extra, 'rec');
  once("v_pay := v_pay || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, ",
       "v_pay := v_pay || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, " + extra, 'pay');
  once("'for', 'Received by Head Office into Site Cash', 'amount', e->'amount'",
       "'for', 'Received by Head Office into Site Cash', 'head', 'Head Office', 'token', false, 'units', '[]'::jsonb, 'amount', e->'amount'", 'site rec');
  once("'for', 'Paid by Head Office from Site Cash', 'amount', e->'amount'",
       "'for', 'Paid by Head Office from Site Cash', 'head', 'Head Office', 'token', false, 'units', '[]'::jsonb, 'amount', e->'amount'", 'site pay');
  const sql = `-- ══ NexuFinance: the day report's lines carry their head and token units (20261119g) ══
-- NOT APPLIED until the owner says yes.
--
-- Brief of 19-Nov (the one-page WhatsApp report): money in / out is summarised BY HEAD, and token money shows its
-- units in short ("Token money · GF-250/251, SF-208"). nf_day_report's received / paid rows gain 'head' (the
-- account's plain name), 'token' and 'units'. As the site box sees Head Office's lines: head "Head Office".
-- Nothing else changes.

${d.trim()};
`;
  const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261119g_nf_day_report_heads.sql');
  fs.writeFileSync(f, sql);
  console.log('written', f);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
