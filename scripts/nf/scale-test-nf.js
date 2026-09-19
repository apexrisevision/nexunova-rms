#!/usr/bin/env node
//   node scripts/nf/scale-test-nf.js > "$SCRATCH/nf-scale.log" 2>&1
//
// HOLDS A SHARE ROW EXCLUSIVE LOCK on nf_vouchers/nf_voucher_legs for its
// ~1-2 minute window (DISABLE TRIGGER USER) — a live save would wait. Run it
// when nobody is entering (owner authorised the first run 2026-09-19).
//
// Blueprint Part I: "design for 100,000+ ledger lines with no report
// degradation". Nobody had measured it. One BEGIN...ROLLBACK, one HTTP
// request: a scratch company seeded with the real chart, ~50,000 synthetic
// vouchers / 100,000+ legs bulk-loaded with the row triggers disabled
// (load speed only — the guards are proven elsewhere; this measures READS),
// then every report RPC timed with clock_timestamp() as a real member.
'use strict';
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const { q } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));

const C = crypto.randomUUID();
const DIRECTOR = '315f2852-852f-4653-9253-a5a27a7828c8';
const built = buildSeed();
if (built.failures.length) { console.log('seed assertions failed'); process.exit(2); }

const sql = `
BEGIN;
INSERT INTO companies (id, company_code, company_name) VALUES ('${C}', 'ZZSCL', 'ZZTEST-NF-scale');
${seedSql(C, built.seed)}
INSERT INTO nf_members (company_id, user_id, role, display_name, active) VALUES ('${C}', '${DIRECTOR}', 'director', 'Scale Director', true);
SELECT set_config('request.jwt.claim.sub', '${DIRECTOR}', true);
SELECT set_config('statement_timeout', '600000', true);

CREATE TEMP TABLE t (step text, ms numeric, detail text);

ALTER TABLE public.nf_vouchers DISABLE TRIGGER USER;
ALTER TABLE public.nf_voucher_legs DISABLE TRIGGER USER;

DO $$
DECLARE t0 timestamptz := clock_timestamp(); n int;
BEGIN
  -- 52,000 vouchers over ~5 years (2026-02-06 .. 2031-02), 2 legs each: an expense/asset head
  -- against Cash/Bank/FMH/KBH, plus a party on 1 in 4 legs.
  INSERT INTO public.nf_parties (id, company_id, name, kind, is_active, created_by)
    SELECT gen_random_uuid(), '${C}', 'Scale Party ' || g, 'customer', true, '${DIRECTOR}' FROM generate_series(1, 200) g;
  INSERT INTO public.nf_vouchers (id, company_id, voucher_no, voucher_date, narration, status, sort, created_by, posted_by, posted_at, version, iif_exportable)
    SELECT gen_random_uuid(), '${C}', 'SV-' || g, DATE '2026-02-06' + (g / 29), 'scale voucher ' || g, 'POSTED', g, '${DIRECTOR}', '${DIRECTOR}', now(), 0, true
      FROM generate_series(1, 52000) g;
  INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, party_id, floor_code, debit, credit, memo, created_by)
    SELECT gen_random_uuid(), '${C}', v.id, 1,
           (ARRAY['15300','16100','70100','81300','15300','16100','70100','81300','21100','81300'])[1 + (v.sort % 10)],
           CASE WHEN v.sort % 4 = 0 THEN (SELECT id FROM public.nf_parties p WHERE p.company_id='${C}' AND p.name = 'Scale Party ' || (1 + v.sort % 200)) END,
           (ARRAY['LG','GF','FF','SF','TF','4F','5F','CB','P-W'])[1 + (v.sort % 9)],
           1000 + (v.sort % 500) * 100, 0, 'scale memo ' || v.sort, '${DIRECTOR}'
      FROM public.nf_vouchers v WHERE v.company_id='${C}';
  INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, party_id, floor_code, debit, credit, memo, created_by)
    SELECT gen_random_uuid(), '${C}', v.id, 2,
           (ARRAY['10100','10300','22100','22200'])[1 + (v.sort % 4)], NULL,
           (ARRAY['LG','GF','FF','SF','TF','4F','5F','CB','P-W'])[1 + (v.sort % 9)],
           0, 1000 + (v.sort % 500) * 100, 'scale memo ' || v.sort, '${DIRECTOR}'
      FROM public.nf_vouchers v WHERE v.company_id='${C}';
  SELECT count(*) INTO n FROM public.nf_voucher_legs WHERE company_id='${C}';
  INSERT INTO t VALUES ('00 load', extract(epoch from clock_timestamp()-t0)*1000, n || ' legs');
END $$;

ALTER TABLE public.nf_vouchers ENABLE TRIGGER USER;
ALTER TABLE public.nf_voucher_legs ENABLE TRIGGER USER;
ANALYZE public.nf_vouchers; ANALYZE public.nf_voucher_legs;

DO $$
DECLARE t0 timestamptz; r jsonb; p uuid; missing int;
BEGIN
  SELECT count(*) INTO missing FROM public.nf_voucher_legs l WHERE l.company_id='${C}'
     AND NOT EXISTS (SELECT 1 FROM public.nf_accounts a WHERE a.company_id=l.company_id AND a.code=l.account_code);
  INSERT INTO t VALUES ('01 chart check', 0, missing || ' legs on codes missing from the chart (must be 0)');

  t0 := clock_timestamp(); r := public.nf_get_trial_balance('${C}', NULL);
  INSERT INTO t VALUES ('trial balance (all time)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'rows') || ' rows');
  t0 := clock_timestamp(); r := public.nf_get_balance_sheet('${C}', DATE '2029-12-31');
  INSERT INTO t VALUES ('balance sheet (as of)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_pl('${C}', DATE '2029-01-01', DATE '2029-12-31');
  INSERT INTO t VALUES ('P&L (one year)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_journal('${C}', DATE '2029-03-01', DATE '2029-03-31');
  INSERT INTO t VALUES ('journal (one month)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'vouchers') || ' vouchers');
  t0 := clock_timestamp(); r := public.nf_get_journal('${C}', NULL, NULL);
  INSERT INTO t VALUES ('journal (ALL TIME — the thing §28 stopped defaulting to)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'vouchers') || ' vouchers, ' || pg_size_pretty(octet_length(r::text)::bigint) || ' JSON');
  t0 := clock_timestamp(); r := public.nf_get_ledger('${C}', '10100', DATE '2029-01-01', DATE '2029-12-31');
  INSERT INTO t VALUES ('ledger 10100 (one year)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'entries') || ' entries');
  SELECT id INTO p FROM public.nf_parties WHERE company_id='${C}' AND name='Scale Party 9';
  t0 := clock_timestamp(); r := public.nf_get_party_statement('${C}', p, NULL, NULL);
  INSERT INTO t VALUES ('party statement (all time, no party index)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'entries') || ' entries');
  EXECUTE 'CREATE INDEX IF NOT EXISTS nf_voucher_legs_party_idx_zz ON public.nf_voucher_legs (company_id, party_id) WHERE party_id IS NOT NULL';
  t0 := clock_timestamp(); r := public.nf_get_party_statement('${C}', p, NULL, NULL);
  INSERT INTO t VALUES ('party statement (all time, WITH party index)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'entries') || ' entries');
  t0 := clock_timestamp(); r := public.nf_get_ledger('${C}', '10100', NULL, NULL);
  INSERT INTO t VALUES ('ledger 10100 (ALL TIME)', extract(epoch from clock_timestamp()-t0)*1000, jsonb_array_length(r->'entries') || ' entries');
  t0 := clock_timestamp(); r := public.nf_get_token_register('${C}', NULL, NULL);
  INSERT INTO t VALUES ('token register (all time)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_cash_bank_movement('${C}', DATE '2029-01-01', DATE '2029-12-31');
  INSERT INTO t VALUES ('cash & bank movement (one year)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_floor_summary('${C}', NULL, NULL);
  INSERT INTO t VALUES ('floor summary (all time)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_project_cost_summary('${C}', NULL, NULL);
  INSERT INTO t VALUES ('project cost summary (all time)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_get_monthly_trend('${C}', DATE '2026-02-01', DATE '2031-01-31');
  INSERT INTO t VALUES ('monthly trend (5 years)', extract(epoch from clock_timestamp()-t0)*1000, '');
  t0 := clock_timestamp(); r := public.nf_list_all_parties('${C}');
  INSERT INTO t VALUES ('list parties (200)', extract(epoch from clock_timestamp()-t0)*1000, '');
END $$;

-- the query plan behind the party statement, for the index question
CREATE TEMP TABLE plan_out (line text);
DO $$ DECLARE l text; p uuid; BEGIN
  SELECT id INTO p FROM public.nf_parties WHERE company_id='${C}' AND name='Scale Party 9';
  FOR l IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id=l.voucher_id WHERE l.company_id=''${C}'' AND l.party_id=''' || p || ''' AND v.status=''POSTED''' LOOP
    INSERT INTO plan_out VALUES (l);
  END LOOP;
END $$;
INSERT INTO t SELECT '99 plan: ' || line, 0, '' FROM plan_out;

SELECT step, round(ms) AS ms, detail FROM t ORDER BY step;
ROLLBACK;
`;

(async () => {
  try {
    const rows = await q(sql, 1);
    console.log('SCALE TEST (rolled back) — 100k+ legs:');
    for (const r of rows) console.log(`  ${String(r.ms).padStart(7)} ms  ${r.step}  ${r.detail || ''}`);
  } catch (e) { console.log('SCALE TEST FAILED:', e.message); process.exitCode = 1; return; }
  const [left] = await q(`select (select count(*) from companies where id='${C}') c, (select count(*) from nf_voucher_legs where company_id='${C}') legs`);
  console.log('leftover (must be 0/0):', JSON.stringify(left));
})();
