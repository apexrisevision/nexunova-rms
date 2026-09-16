/**
 * NexuFinance v1 — Phase 1 rehearsal: migrations a–c, the seed, and every rule
 * R1–R8, driven through the real RPCs as real roles, against the real engine.
 *
 *   node scripts/nf/verify-nf-schema.js > "$SCRATCH/nf-schema.log" 2>&1        rehearsal
 *   node scripts/nf/verify-nf-schema.js --mutants > "$SCRATCH/nf-mut.log" 2>&1  + prove each rule can go red
 *
 * HOW IT STAYS HARMLESS
 * There is no local Postgres and no branch database, so the engine is the live
 * project. Postgres has transactional DDL: the whole run is ONE batch that
 * begins a transaction, applies the migrations, runs every assertion, and then
 * raises a deliberate exception carrying the results. The exception aborts the
 * transaction — nothing can be committed, whatever passed or failed. After the
 * request returns, the harness queries live and PRINTS proof that no nf_ object
 * and no rehearsal company exists.
 *
 * HOW EACH ASSERTION RUNS
 * Its own DO block and sub-transaction, as one of:
 *   D / A / V / O   a director, accountant, viewer, outsider: request.jwt.claims
 *                   set to that user AND `SET LOCAL ROLE authenticated`, so the
 *                   grants, row security and SECURITY DEFINER boundaries are
 *                   the ones PostgREST would give that user
 *   anon            `SET LOCAL ROLE anon`
 *   rawA / rawD     the claims of A or D but still the table owner: writes go
 *                   straight at the tables, past every RPC, so a refusal here
 *                   proves the TRIGGER holds the rule (SR-12)
 *   op              the operator, no JWT (structure checks, seeding)
 * A failure in one assertion rolls back only that assertion.
 *
 * WHAT IT CANNOT SEE (named, per SR-7)
 *   · real HTTPS / PostgREST / JWT verification — verify-nf-rules.js does that,
 *     after the migrations are applied
 *   · two concurrent writers — one transaction cannot race itself
 *   · the screen — Phase 2
 * The golden-day lines come from the reference file's own `sample` and are
 * checked against the owner's list typed below, so neither can drift silently.
 *
 * Exit: 0 held · 1 something under test failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql } = require('./gen-seed');
const { WRITTEN_OUTSIDE_NF } = require('./write-guard');

const ROOT = path.resolve(__dirname, '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const FILES = ['20260916a_nf_tables.sql', '20260916b_nf_guards.sql', '20260916c_nf_rpcs.sql'];

// ── the owner's golden day, typed independently of the reference (2026-09-16) ──
const OWNER = {
  open: { Cash: 250000, Petty: 20000, Bank: 1500000 },
  in: [['CRV-001', '21100', 'GF', 'Cash', 500000], ['BRV-001', '40100', 'FF', 'Bank', 350000], ['CRV-002', '40300', 'GF', 'Cash', 15000]],
  out: [['CPV-001', '53100', 'P-W', 'Cash', 100000], ['CPV-002', '52200', 'P-W', 'Cash', 52000], ['CPV-003', '70200', 'P-W', 'Petty', 6500],
        ['BPV-001', '60200', 'P-W', 'Bank', 40000], ['BPV-002', '85100', 'P-W', 'Bank', 1040]],
  tBank: 300000,
  count: { 5000: 50, 1000: 60, 500: 5, 100: 5 },
  close: { Cash: 313000, Petty: 13500, Bank: 2108960 },
  total: 2435460,
  net: 665460,
};

// ── SQL helpers ─────────────────────────────────────────────────────────────
const lit = s => (s === null || s === undefined) ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
const get = k => `pg_temp.nf_get(${lit(k)})`;
const dayId = k => `${get(k)}::uuid`;
const dayVer = k => `(SELECT version FROM public.nf_days WHERE id = ${dayId(k)})`;
const lineId = (k, v) => `(SELECT id FROM public.nf_lines WHERE day_id = ${dayId(k)} AND voucher_key = ${lit(v)})`;
const lineVer = (k, v) => `(SELECT version FROM public.nf_lines WHERE day_id = ${dayId(k)} AND voucher_key = ${lit(v)})`;
const set = (k, expr) => `PERFORM pg_temp.nf_set(${lit(k)}, (${expr})::text);`;
const saveLine = (k, side, v, desc, head, floor, via, amt) =>
  `res := public.nf_save_line(${dayId(k)}, NULL, ${lit(side)}, ${lit(v)}, ${lit(desc)}, ${lit(head)}, ${lit(floor)}, ${lit(via)}, ${amt === null ? 'NULL' : amt}, NULL);`;
const closingOf = (via) => `(SELECT (x->>'closing')::numeric FROM jsonb_array_elements(res->'position'->'rows') x WHERE x->>'via' = ${lit(via)})`;
const openingOf = (via) => `(SELECT (x->>'opening')::numeric FROM jsonb_array_elements(res->'position'->'rows') x WHERE x->>'via' = ${lit(via)})`;

function buildTests(ids, golden, ref) {
  const T = [];
  // expect: { ok: '<boolean sql>' } | { err: 'NF:CODE' } | { like: 'sql LIKE pattern' }
  const t = (id, rule, who, body, expect) => T.push({ id, rule, who, body, expect });
  const C = lit(ids.C);

  // ── WRITE GUARD: what this transaction wrote outside nf_ ──────────────────
  // W01 the migrations wrote nothing outside nf_; W02 the positive control —
  // the rehearsal's own fixture inserts ARE seen; W03 the seed and the members
  // added nothing to that.
  t('W01', 'write-guard', 'op', `res := ${get('w_after_migrations')}::jsonb;`, { ok: `res = '{}'::jsonb` });
  t('W02', 'write-guard', 'op', `res := ${get('w_after_fixtures')}::jsonb;`,
    { ok: `(res->>'public.companies')::int = 2 AND (res->>'auth.users')::int = 4` });
  t('W03', 'write-guard', 'op', `res := jsonb_build_object('fixtures', ${get('w_after_fixtures')}::jsonb, 'seed', ${get('w_after_seed')}::jsonb);`,
    { ok: `res->'fixtures' = res->'seed'` });

  // ── STRUCTURE ─────────────────────────────────────────────────────────────
  const TABLES = ['nf_members', 'nf_settings', 'nf_accounts', 'nf_floors', 'nf_report_categories', 'nf_days', 'nf_lines', 'nf_pdcs', 'nf_audit'];
  const tabArr = `ARRAY[${TABLES.map(lit).join(',')}]`;
  t('S01', 'structure', 'op', `res := to_jsonb((SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname = ANY(${tabArr}) AND relrowsecurity));`,
    { ok: `res = '9'::jsonb` });
  t('S02', 'grants', 'op', `res := (SELECT jsonb_agg(grantee||':'||table_name||':'||privilege_type) FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name = ANY(${tabArr}) AND grantee IN ('anon','authenticated','PUBLIC')
           AND NOT (grantee='authenticated' AND privilege_type='SELECT'));`,
    { ok: `res IS NULL` });
  t('S02b', 'grants', 'op', `res := to_jsonb((SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name = ANY(${tabArr}) AND grantee='authenticated' AND privilege_type='SELECT'));`,
    { ok: `res = '9'::jsonb` });
  t('S03', 'grants', 'op', `res := (SELECT jsonb_agg(p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
         AND (p.proname LIKE 'nf\\_%' OR p.proname LIKE '\\_nf\\_%') AND has_function_privilege('anon', p.oid, 'EXECUTE'));`,
    { ok: `res IS NULL` });
  const RPCS = ['nf_get_context', 'nf_list_heads', 'nf_list_floors', 'nf_list_vias', 'nf_list_days', 'nf_get_day', 'nf_list_audit',
    'nf_start_first_day', 'nf_start_next_day', 'nf_set_first_day_opening', 'nf_save_line', 'nf_delete_line', 'nf_set_transfers',
    'nf_save_count', 'nf_set_remarks', 'nf_save_pdc', 'nf_resolve_pdc', 'nf_delete_pdc', 'nf_submit_day', 'nf_close_day',
    'nf_return_day', 'nf_reopen_day', 'nf_get_report', 'nf_set_member', 'nf_is_member'].sort();
  t('S04', 'grants', 'op', `res := (SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
         AND (p.proname LIKE 'nf\\_%' OR p.proname LIKE '\\_nf\\_%') AND has_function_privilege('authenticated', p.oid, 'EXECUTE'));`,
    { ok: `res = ${lit(JSON.stringify(RPCS))}::jsonb` });
  t('S05', 'grants', 'op', `res := jsonb_build_object(
         'svc_seed', has_function_privilege('service_role', 'public._nf_seed_company(uuid,jsonb)', 'EXECUTE'),
         'svc_purge', has_function_privilege('service_role', 'public._nf_test_purge(uuid)', 'EXECUTE'),
         'auth_seed', has_function_privilege('authenticated', 'public._nf_seed_company(uuid,jsonb)', 'EXECUTE'),
         'auth_purge', has_function_privilege('authenticated', 'public._nf_test_purge(uuid)', 'EXECUTE'));`,
    { ok: `res = '{"svc_seed":true,"svc_purge":true,"auth_seed":false,"auth_purge":false}'::jsonb` });
  const NODEFAULT = {
    nf_lines: ['side', 'voucher_no', 'description', 'head_code', 'floor_code', 'via', 'amount'],
    nf_days: ['business_date', 'closing_no', 'status', 'is_first_day', 'typed_open_cash', 'typed_open_petty', 'typed_open_bank',
              'transfer_to_bank', 'transfer_to_petty', 'denominations', 'variance_reason'],
    nf_pdcs: ['direction', 'cheque_no', 'party', 'bank', 'due_date', 'amount', 'status'],
  };
  const pairs = Object.entries(NODEFAULT).flatMap(([tb, cols]) => cols.map(c => `(${lit(tb)},${lit(c)})`)).join(',');
  t('S06', 'R8', 'op', `res := (SELECT jsonb_agg(v.t||'.'||v.c) FROM (VALUES ${pairs}) v(t,c)
         JOIN pg_attribute a ON a.attrelid = ('public.'||v.t)::regclass AND a.attname = v.c
         WHERE a.atthasdef OR a.attname IS NULL);
       IF (SELECT count(*) FROM (VALUES ${pairs}) v(t,c) JOIN pg_attribute a ON a.attrelid = ('public.'||v.t)::regclass AND a.attname = v.c)
          <> ${Object.values(NODEFAULT).flat().length} THEN RAISE EXCEPTION 'a listed column does not exist'; END IF;`,
    { ok: `res IS NULL` });
  t('S07', 'R8', 'op', `res := (SELECT jsonb_agg(p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
         AND (p.proname LIKE 'nf\\_%' OR p.proname LIKE '\\_nf\\_%') AND p.pronargdefaults > 0);`,
    { ok: `res IS NULL` });
  t('S08', 'seed', 'op', `res := jsonb_build_object(
         'accounts', (SELECT count(*) FROM public.nf_accounts WHERE company_id=${C}),
         'heads', (SELECT count(*) FROM public.nf_accounts WHERE company_id=${C} AND is_head),
         'vias', (SELECT jsonb_agg(code||'='||via||'='||via_label ORDER BY code) FROM public.nf_accounts WHERE company_id=${C} AND via IS NOT NULL),
         'floors', (SELECT jsonb_agg(code||'='||qb_class ORDER BY sort) FROM public.nf_floors WHERE company_id=${C}),
         'cats', (SELECT count(*) FROM public.nf_report_categories WHERE company_id=${C}),
         'c104', (SELECT count(*) FROM public.nf_accounts WHERE company_id=${C} AND code LIKE '104%'),
         'recv', (SELECT jsonb_agg(code||':'||qb_type||':'||is_head||':'||coalesce(via,'-')||':'||parent_code ORDER BY code) FROM public.nf_accounts WHERE company_id=${C} AND code IN ('12600','12610','12620')));`,
    { ok: `res = '{"accounts":110,"heads":78,"vias":["10100=Cash=Cash in hand","10200=Petty=Petty cash","10300=Bank=Bank Al-Habib"],
                  "floors":["LG=LG","GF=GF","FF=FF","SF=SF","TF=TF","4F=4F","5F=5F","CB=CB","P-W=Project-wide"],"cats":29,"c104":0,
                  "recv":["12600:Other Current Asset:false:-:12000","12610:Other Current Asset:true:-:12600","12620:Other Current Asset:true:-:12600"]}'::jsonb` });

  // ── GOLDEN DAY ────────────────────────────────────────────────────────────
  const s = golden;
  t('G01', 'golden', 'D', `res := public.nf_start_first_day(${C}, ${lit(s.date)}, ${lit(s.cno)}, ${s.open.Cash}, ${s.open.Petty}, ${s.open.Bank});
       ${set('day1', `res->'day'->>'id'`)}`,
    { ok: `res->'day'->>'status' = 'OPEN' AND res->'day'->>'closing_no' = 'DC-001' AND (res->'day'->>'is_first_day')::boolean` });
  [...s.in.map(r => ['IN', r]), ...s.out.map(r => ['OUT', r])].forEach(([side, r], i) =>
    t(`G02.${i + 1}`, 'golden', 'A', saveLine('day1', side, r.v, r.d, r.h, r.f, r.m, r.a), { ok: `true` }));
  t('G03', 'golden', 'A', `res := public.nf_set_transfers(${dayId('day1')}, ${s.tBank}, NULL, ${dayVer('day1')});`,
    { ok: `(res->'day'->>'transfer_to_bank')::numeric = ${s.tBank}` });
  t('G04', 'golden', 'A', `res := public.nf_save_count(${dayId('day1')}, ${lit(JSON.stringify(s.den))}::jsonb, ${dayVer('day1')});`,
    { ok: `(res->'day'->>'counted_cash')::numeric = ${OWNER.close.Cash}` });
  s.pdcIn.forEach((p, i) => t(`G05.${i + 1}`, 'golden', 'A',
    `res := public.nf_save_pdc(${dayId('day1')}, NULL, 'RECEIVED', ${lit(p.n)}, ${lit(p.p)}, ${lit(p.b)}, ${lit(p.d)}, ${p.a}, NULL);`,
    { ok: `jsonb_array_length(res->'pdcs') = ${i + 1}` }));
  t('G06', 'golden', 'A', `res := public.nf_get_day(${C}, ${lit(s.date)});`,
    { ok: `${closingOf('Cash')} = ${OWNER.close.Cash} AND ${closingOf('Petty')} = ${OWNER.close.Petty} AND ${closingOf('Bank')} = ${OWNER.close.Bank}
           AND ${openingOf('Cash')} = ${OWNER.open.Cash} AND ${openingOf('Petty')} = ${OWNER.open.Petty} AND ${openingOf('Bank')} = ${OWNER.open.Bank}
           AND (res->'position'->'total'->>'closing')::numeric = ${OWNER.total}
           AND (res->'position'->>'net')::numeric = ${OWNER.net}
           AND (res->'position'->'total'->>'transfers')::numeric = 0
           AND (res->'position'->>'receipts')::int = 3 AND (res->'position'->>'payments')::int = 5
           AND res->'checks' = '[]'::jsonb AND (res->>'balanced')::boolean` });
  t('G07', 'golden', 'V', `res := public.nf_get_report(${dayId('day1')});`,
    { ok: `res->'in_categories' = ${lit(JSON.stringify(s.expect.inCats))}::jsonb
           AND res->'out_categories' = ${lit(JSON.stringify(s.expect.outCats))}::jsonb
           AND res->'large_payments' = ${lit(JSON.stringify(s.expect.large))}::jsonb
           AND (res->>'total_in')::numeric = ${s.expect.totalIn} AND (res->>'total_out')::numeric = ${s.expect.totalOut}
           AND (res->>'total_close')::numeric = ${OWNER.total}
           AND res->'accounts' = ${lit(JSON.stringify(s.expect.cards))}::jsonb
           AND (res->>'counted')::boolean AND (res->>'count_diff')::numeric = 0 AND (res->>'balanced')::boolean
           AND (res->>'transfer_to_bank')::numeric = ${s.tBank} AND res->>'bank_label' = 'Bank Al-Habib'
           AND res->'pdc_due' = '[]'::jsonb
           AND res->'pdc_pending' = ${lit(JSON.stringify(s.expect.pdcPending))}::jsonb
           AND (res->>'large_threshold')::numeric = ${ref.BIG}
           AND res->>'report_title' = 'Awami Market, daily report'` });
  // No voucher number, account code or row id may leave the report …
  const LEAK = `(r::text ~ '(CRV|CPV|BRV|BPV)-' OR r::text ~ '"[0-9]{5}[" ]' OR r::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-')`;
  t('G08', 'report-no-codes', 'D', `res := public.nf_get_report(${dayId('day1')});
       res := jsonb_build_object('leak', (SELECT ${LEAK} FROM (SELECT res AS r) z), 'len', length(res::text));`,
    { ok: `(res->>'leak')::boolean = false AND (res->>'len')::int > 500` });
  // … and the detector must fire on a payload that does carry all three (SR-2).
  t('G08b', 'report-no-codes', 'D', `res := public.nf_get_day(${C}, ${lit(s.date)});
       res := jsonb_build_object(
         'voucher', (SELECT r::text ~ '(CRV|CPV|BRV|BPV)-' FROM (SELECT res AS r) z),
         'code',    (SELECT r::text ~ '"[0-9]{5}[" ]' FROM (SELECT res AS r) z),
         'uuid',    (SELECT r::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' FROM (SELECT res AS r) z));`,
    { ok: `res = '{"voucher":true,"code":true,"uuid":true}'::jsonb` });
  t('G09', 'golden', 'A', `res := public.nf_close_day(${dayId('day1')}, ${dayVer('day1')}, NULL);`,
    { ok: `res->'day'->>'status' = 'CLOSED' AND (res->'day'->>'variance')::numeric = 0
           AND (SELECT close_cash = ${OWNER.close.Cash} AND close_petty = ${OWNER.close.Petty} AND close_bank = ${OWNER.close.Bank}
                  FROM public.nf_days WHERE id = ${dayId('day1')})` });

  // ── CARRY FORWARD: nothing seeded; the server brings the opening ───────────
  t('C01', 'R5', 'A', `res := public.nf_start_next_day(${C}, NULL); ${set('day2', `res->'day'->>'id'`)}`,
    { ok: `res->'day'->>'business_date' = '2026-09-17' AND res->'day'->>'closing_no' = 'DC-002'
           AND NOT (res->'day'->>'is_first_day')::boolean
           AND ${openingOf('Cash')} = ${OWNER.close.Cash} AND ${openingOf('Petty')} = ${OWNER.close.Petty} AND ${openingOf('Bank')} = ${OWNER.close.Bank}
           AND res->'day'->>'typed_open_cash' IS NULL` });

  // ── R1 ────────────────────────────────────────────────────────────────────
  t('R1-01', 'R1', 'A', saveLine('day2', 'OUT', 'CPV-101', 'one paisa too much', '81300', 'P-W', 'Cash', '313000.01'), { err: 'NF:NEGATIVE_POSITION' });
  t('R1-02', 'R1', 'A', saveLine('day2', 'OUT', 'CPV-101', 'exactly the drawer', '81300', 'P-W', 'Cash', '313000'), { ok: `${closingOf('Cash')} = 0` });
  t('R1-03', 'R1', 'A', saveLine('day2', 'IN', 'CRV-101', 'receipt', '21100', 'GF', 'Cash', '150000'), { ok: `${closingOf('Cash')} = 150000` });
  t('R1-04', 'R1', 'A', saveLine('day2', 'OUT', 'CPV-102', 'spend it', '52600', 'P-W', 'Cash', '100000'), { ok: `${closingOf('Cash')} = 50000` });
  t('R1-05', 'R1', 'A', `res := public.nf_delete_line(${lineId('day2', 'CRV-101')}, ${lineVer('day2', 'CRV-101')});`, { err: 'NF:NEGATIVE_POSITION' });
  t('R1-06', 'R1', 'A', `res := public.nf_save_line(${dayId('day2')}, ${lineId('day2', 'CRV-101')}, 'IN', 'CRV-101', 'receipt', '21100', 'GF', 'Cash', 50000, ${lineVer('day2', 'CRV-101')});`, { err: 'NF:NEGATIVE_POSITION' });
  t('R1-07', 'R1', 'A', `res := public.nf_save_line(${dayId('day2')}, ${lineId('day2', 'CRV-101')}, 'IN', 'CRV-101', 'receipt', '21100', 'GF', 'Petty', 150000, ${lineVer('day2', 'CRV-101')});`, { err: 'NF:NEGATIVE_POSITION' });
  t('R1-08', 'R1', 'A', `res := public.nf_set_transfers(${dayId('day2')}, 50000.01, NULL, ${dayVer('day2')});`, { err: 'NF:NEGATIVE_POSITION' });
  t('R1-09', 'R1', 'A', `res := public.nf_set_transfers(${dayId('day2')}, 25000, 25000, ${dayVer('day2')});`, { ok: `${closingOf('Cash')} = 0 AND ${closingOf('Petty')} = 38500` });
  t('R1-10', 'R1', 'A', `res := public.nf_set_transfers(${dayId('day2')}, NULL, NULL, ${dayVer('day2')});`, { ok: `${closingOf('Cash')} = 50000` });
  t('R1-11', 'R1', 'A', saveLine('day2', 'OUT', 'CPV-103', 'petty over', '81300', 'P-W', 'Petty', '13500.01'), { err: 'NF:NEGATIVE_POSITION' });
  t('R1-12', 'R1', 'A', saveLine('day2', 'OUT', 'BPV-101', 'bank over', '81300', 'P-W', 'Bank', '2108960.01'), { err: 'NF:NEGATIVE_POSITION' });
  t('R1-13', 'R1', 'rawA', `INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, head_code, floor_code, via, amount, sort, created_by)
       VALUES (${C}, ${dayId('day2')}, 'OUT', 'CPV-104', '81300', 'P-W', 'Cash', 50000.01, 99, ${lit(ids.A)});`, { err: 'NF:NEGATIVE_POSITION' });

  // ── R2 ────────────────────────────────────────────────────────────────────
  t('R2-01', 'R2', 'A', saveLine('day2', 'IN', ' crv-001 ', 'again', '21100', 'GF', 'Cash', '1'), { err: 'NF:DUPLICATE_VOUCHER' });
  t('R2-02', 'R2', 'A', saveLine('day2', 'OUT', 'CPV-001', 'again', '81300', 'P-W', 'Cash', '1'), { err: 'NF:DUPLICATE_VOUCHER' });
  t('R2-03', 'R2', 'rawA', `INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, head_code, floor_code, via, amount, sort, created_by)
       VALUES (${C}, ${dayId('day2')}, 'IN', 'Crv-001', '21100', 'GF', 'Cash', 1, 99, ${lit(ids.A)});`, { like: '%nf_lines_voucher_unique%' });

  // ── R3 ────────────────────────────────────────────────────────────────────
  const r3 = (id, v, head, floor, via, amt, expect) => t(id, 'R3', 'A', saveLine('day2', 'IN', v, 'r3', head, floor, via, amt), expect);
  r3('R3-01', 'CRV-102', '21100', 'GF', 'Cash', '0', { err: 'NF:AMOUNT_NOT_POSITIVE' });
  r3('R3-02', 'CRV-102', '21100', 'GF', 'Cash', '-5', { err: 'NF:AMOUNT_NOT_POSITIVE' });
  r3('R3-03', 'CRV-102', '21100', 'GF', 'Cash', '10.005', { err: 'NF:AMOUNT_SCALE' });
  r3('R3-04', 'CRV-102', '21100', 'GF', 'Cash', '10.25', { ok: `${closingOf('Cash')} = 50010.25` });
  r3('R3-05', 'CRV-103', '10000', 'GF', 'Cash', '1', { err: 'NF:HEAD_NOT_POSTABLE' });
  r3('R3-06', 'CRV-103', '10100', 'GF', 'Cash', '1', { err: 'NF:HEAD_NOT_POSTABLE' });
  r3('R3-07', 'CRV-103', '11000', 'GF', 'Cash', '1', { err: 'NF:HEAD_NOT_POSTABLE' });
  r3('R3-08', 'CRV-103', '99999', 'GF', 'Cash', '1', { err: 'NF:HEAD_NOT_POSTABLE' });
  r3('R3-09', 'CRV-103', '21100', 'XX', 'Cash', '1', { err: 'NF:FLOOR_UNKNOWN' });
  r3('R3-10', 'CRV-103', '21100', null, 'Cash', '1', { err: 'NF:FLOOR_REQUIRED' });
  r3('R3-11', 'CRV-103', '21100', 'GF', null, '1', { err: 'NF:VIA_REQUIRED' });
  r3('R3-12', 'CRV-103', null, 'GF', 'Cash', '1', { err: 'NF:HEAD_REQUIRED' });
  r3('R3-13', '  ', '21100', 'GF', 'Cash', '1', { err: 'NF:VOUCHER_REQUIRED' });
  r3('R3-13b', 'CRV-103', '21100', 'GF', 'Cash', null, { err: 'NF:AMOUNT_REQUIRED' });
  t('R3-14', 'R3', 'rawA', `INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, head_code, floor_code, via, amount, sort, created_by)
       VALUES (${C}, ${dayId('day2')}, 'IN', 'CRV-104', '10000', 'GF', 'Cash', 1, 99, ${lit(ids.A)});`, { err: 'NF:HEAD_NOT_POSTABLE' });
  t('R3-15', 'R3', 'rawA', `INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, head_code, floor_code, via, amount, sort, created_by)
       VALUES (${C}, ${dayId('day2')}, 'IN', 'CRV-104', '21100', NULL, 'Cash', 1, 99, ${lit(ids.A)});`, { like: '%null value in column "floor_code"%' });
  t('R3-16', 'R3', 'rawA', `INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, head_code, floor_code, via, amount, sort, created_by)
       VALUES (${C}, ${dayId('day2')}, 'IN', 'CRV-104', '21100', 'GF', 'Cash', 0, 99, ${lit(ids.A)});`, { like: '%nf_lines_amount_check%' });

  // ── voucher prefixes (owner Q9) ───────────────────────────────────────────
  t('P-01', 'prefix', 'A', saveLine('day2', 'IN', 'CPV-201', 'p', '21100', 'GF', 'Cash', '1'), { err: 'NF:VOUCHER_PREFIX' });
  t('P-02', 'prefix', 'A', saveLine('day2', 'IN', 'BRV-201', 'p', '21100', 'GF', 'Cash', '1'), { err: 'NF:VOUCHER_VIA_MISMATCH' });
  t('P-03', 'prefix', 'A', saveLine('day2', 'OUT', 'BPV-201', 'p', '81300', 'P-W', 'Petty', '1'), { err: 'NF:VOUCHER_VIA_MISMATCH' });
  t('P-04', 'prefix', 'A', saveLine('day2', 'OUT', 'CPV-202', 'p', '81300', 'P-W', 'Bank', '1'), { err: 'NF:VOUCHER_VIA_MISMATCH' });
  t('P-05', 'prefix', 'A', saveLine('day2', 'IN', 'CRV-', 'p', '21100', 'GF', 'Cash', '1'), { err: 'NF:VOUCHER_PREFIX' });
  t('P-06', 'prefix', 'A', saveLine('day2', 'IN', 'XRV-1', 'p', '21100', 'GF', 'Cash', '1'), { err: 'NF:VOUCHER_PREFIX' });
  t('P-07', 'prefix', 'A', saveLine('day2', 'IN', 'crv-203', 'petty receipt on a C voucher', '81300', 'P-W', 'Petty', '1'), { ok: `${closingOf('Petty')} = 13501` });
  t('P-08', 'prefix', 'A', saveLine('day2', 'IN', 'BRV-201', 'p', '40900', 'P-W', 'Bank', '1'), { ok: `${closingOf('Bank')} = 2108961` });

  // ── R4 ────────────────────────────────────────────────────────────────────
  t('R4-01', 'R4', 'A', saveLine('day2', 'OUT', 'CPV-301', 'r4', '81300', 'P-W', '12610', '1'), { err: 'NF:VIA_UNKNOWN' });
  t('R4-02', 'R4', 'A', saveLine('day2', 'OUT', 'CPV-301', 'cash handed to a director', '12610', 'P-W', 'Cash', '1000'), { ok: `${closingOf('Cash')} = 49010.25` });
  t('R4-03', 'R4', 'A', saveLine('day2', 'IN', 'CRV-301', 'a director returns cash', '12620', 'P-W', 'Cash', '500'), { ok: `${closingOf('Cash')} = 49510.25` });
  t('R4-04', 'R4', 'V', `res := public.nf_get_day(${C}, '2026-09-17');`,
    { ok: `(SELECT jsonb_agg(x->>'code' ORDER BY x->>'code') FROM jsonb_array_elements(res->'position'->'rows') x) = '["10100","10200","10300"]'::jsonb
           AND (res->'position'->'total'->>'closing')::numeric = ${closingOf('Cash')} + ${closingOf('Petty')} + ${closingOf('Bank')}` });
  t('R4-05', 'R4', 'op', `UPDATE public.nf_accounts SET via = 'Cash', via_label = 'x' WHERE company_id = ${C} AND code = '12610';`, { like: '%nf_accounts_head_not_via%' });
  t('R4-06', 'R4', 'op', `INSERT INTO public.nf_accounts (company_id, code, name, qb_type, is_head, sort, active) VALUES (${C}, '10410', 'x', 'Bank', false, 999, true);`, { like: '%nf_accounts_no_104%' });
  t('R4-07', 'R4', 'op', `INSERT INTO public.nf_accounts (company_id, code, name, qb_type, is_head, via, via_label, sort, active) VALUES (${C}, '10900', 'x', 'Bank', false, 'Cash', 'x', 999, true);`, { like: '%nf_accounts_one_per_via%' });

  // ── R5 ────────────────────────────────────────────────────────────────────
  t('R5-01', 'R5', 'A', `res := public.nf_start_first_day(${C}, '2026-09-01', 'DC-900', 0, 0, 0);`, { err: 'NF:NOT_ALLOWED' });
  t('R5-02', 'R5', 'D', `res := public.nf_start_first_day(${C}, '2026-09-01', 'DC-900', 0, 0, 0);`, { err: 'NF:FIRST_DAY_EXISTS' });
  t('R5-03', 'R5', 'A', `res := public.nf_start_next_day(${C}, NULL);`, { err: 'NF:PREVIOUS_DAY_NOT_CLOSED' });
  t('R5-03b', 'R5', 'rawA', `INSERT INTO public.nf_days (company_id, business_date, closing_no, status, is_first_day, created_by)
       VALUES (${C}, '2026-09-18', 'DC-902', 'OPEN', false, ${lit(ids.A)});`, { err: 'NF:PREVIOUS_DAY_NOT_CLOSED' });
  t('R5-05', 'R5', 'rawD', `INSERT INTO public.nf_days (company_id, business_date, closing_no, status, is_first_day, typed_open_cash, typed_open_petty, typed_open_bank, created_by)
       VALUES (${C}, '2026-09-01', 'DC-901', 'OPEN', true, 0, 0, 0, ${lit(ids.D)});`, { err: 'NF:FIRST_DAY_EXISTS' });
  t('R5-06', 'R5', 'A', `res := public.nf_set_first_day_opening(${dayId('day2')}, 1, 1, 1, ${dayVer('day2')});`, { err: 'NF:NOT_ALLOWED' });
  t('R5-07', 'R5', 'D', `res := public.nf_set_first_day_opening(${dayId('day2')}, 1, 1, 1, ${dayVer('day2')});`, { err: 'NF:OPENING_IS_COMPUTED' });

  // ── R6 ────────────────────────────────────────────────────────────────────
  t('R6-01', 'R6', 'A', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, NULL);`, { err: 'NF:CHECKS_FAILED' });
  t('R6-01b', 'R6', 'A', `res := public.nf_get_day(${C}, '2026-09-17');`,
    { ok: `res->'checks' = '[{"key":"not_counted","text":"Cash in hand has not been counted yet."}]'::jsonb AND NOT (res->>'balanced')::boolean` });
  t('R6-02', 'R6', 'A', `res := public.nf_save_count(${dayId('day2')}, '{"coins":1}'::jsonb, ${dayVer('day2')});`,
    { ok: `(SELECT c->>'key' = 'count_mismatch' AND c->>'text' = 'Cash in hand is short by Rs 49,509.25.' FROM jsonb_array_elements(res->'checks') c)` });
  t('R6-03', 'R6', 'A', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, NULL);`, { err: 'NF:VARIANCE_NEEDS_DIRECTOR' });
  t('R6-04', 'R6', 'A', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, 'an accountant explains');`, { err: 'NF:VARIANCE_NEEDS_DIRECTOR' });
  t('R6-05', 'R6', 'D', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, '   ');`, { err: 'NF:VARIANCE_REASON_REQUIRED' });
  t('R6-06', 'R6', 'A', `res := public.nf_submit_day(${dayId('day2')}, ${dayVer('day2')});`, { ok: `res->'day'->>'status' = 'SUBMITTED' AND res->'day'->>'prepared_by_name' = 'Test Accountant'` });
  t('R6-07', 'R7', 'A', saveLine('day2', 'IN', 'CRV-401', 'late', '21100', 'GF', 'Cash', '1'), { err: 'NF:DAY_LOCKED' });
  t('R6-08', 'R6', 'A', `res := public.nf_return_day(${dayId('day2')}, 'x', ${dayVer('day2')});`, { err: 'NF:NOT_ALLOWED' });
  t('R6-09', 'R6', 'D', `res := public.nf_return_day(${dayId('day2')}, '', ${dayVer('day2')});`, { err: 'NF:REASON_REQUIRED' });
  t('R6-10', 'R6', 'D', `res := public.nf_return_day(${dayId('day2')}, 'count again', ${dayVer('day2')});`, { ok: `res->'day'->>'status' = 'OPEN'` });
  t('R6-11', 'R6', 'D', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, 'Counted twice; the drawer holds Rs 1.');`,
    { ok: `res->'day'->>'status' = 'CLOSED' AND (res->'day'->>'variance')::numeric = 49509.25
           AND res->'day'->>'variance_reason' = 'Counted twice; the drawer holds Rs 1.'` });
  t('R6-12', 'R6', 'op', `res := (SELECT jsonb_agg(jsonb_build_object('a', action, 'r', reason, 'who', actor_name)) FROM public.nf_audit
       WHERE day_id = ${dayId('day2')} AND entity = 'nf_days' AND action IN ('CLOSE','CLOSE_WITH_VARIANCE','SUBMIT','RETURN'));`,
    { ok: `res = '[{"a":"SUBMIT","r":null,"who":"Test Accountant"},{"a":"RETURN","r":"count again","who":"Test Director"},
                   {"a":"CLOSE_WITH_VARIANCE","r":"Counted twice; the drawer holds Rs 1.","who":"Test Director"}]'::jsonb` });
  t('R6-13', 'R6', 'V', `res := public.nf_get_report(${dayId('day2')});`,
    { ok: `(res->>'count_diff')::numeric = 49509.25 AND res->>'variance_reason' = 'Counted twice; the drawer holds Rs 1.' AND NOT (res->>'balanced')::boolean` });

  // ── R7 ────────────────────────────────────────────────────────────────────
  t('R7-01', 'R7', 'A', saveLine('day2', 'IN', 'CRV-401', 'late', '21100', 'GF', 'Cash', '1'), { err: 'NF:DAY_LOCKED' });
  t('R7-02', 'R7', 'A', `res := public.nf_delete_line(${lineId('day2', 'CRV-301')}, ${lineVer('day2', 'CRV-301')});`, { err: 'NF:DAY_LOCKED' });
  t('R7-03', 'R7', 'A', `res := public.nf_set_transfers(${dayId('day2')}, 1, NULL, ${dayVer('day2')});`, { err: 'NF:DAY_LOCKED' });
  t('R7-04', 'R7', 'A', `res := public.nf_save_count(${dayId('day2')}, '{"coins":2}'::jsonb, ${dayVer('day2')});`, { err: 'NF:DAY_LOCKED' });
  t('R7-05', 'R7', 'A', `res := public.nf_save_pdc(${dayId('day2')}, NULL, 'ISSUED', '777', 'x', 'y', '2026-09-20', 1, NULL);`, { err: 'NF:DAY_LOCKED' });
  t('R7-06', 'R7', 'A', `res := public.nf_set_remarks(${dayId('day2')}, 'late remark', ${dayVer('day2')});`, { err: 'NF:DAY_LOCKED' });
  t('R7-07', 'R7', 'rawA', `UPDATE public.nf_lines SET amount = 1 WHERE id = ${lineId('day2', 'CRV-301')};`, { err: 'NF:DAY_LOCKED' });
  t('R7-08', 'R7', 'rawA', `DELETE FROM public.nf_lines WHERE id = ${lineId('day2', 'CRV-301')};`, { err: 'NF:DAY_LOCKED' });
  t('R7-09', 'R7', 'rawA', `UPDATE public.nf_days SET remarks = 'x' WHERE id = ${dayId('day2')};`, { err: 'NF:DAY_LOCKED' });
  t('R7-10', 'R7', 'A', `UPDATE public.nf_lines SET amount = 1 WHERE id = ${lineId('day2', 'CRV-301')};`, { like: 'permission denied%' });
  t('R7-10b', 'R7', 'rawA', `DELETE FROM public.nf_days WHERE id = ${dayId('day2')};`, { err: 'NF:DAY_CANNOT_BE_DELETED' });
  t('R7-11', 'R7', 'A', `res := public.nf_reopen_day(${dayId('day2')}, 'x', ${dayVer('day2')});`, { err: 'NF:NOT_ALLOWED' });
  t('R7-11b', 'R7', 'rawA', `UPDATE public.nf_days SET status = 'OPEN', last_reopen_reason = 'x' WHERE id = ${dayId('day2')};`, { err: 'NF:REOPEN_NEEDS_DIRECTOR' });
  t('R7-12', 'R7', 'D', `res := public.nf_reopen_day(${dayId('day2')}, '  ', ${dayVer('day2')});`, { err: 'NF:REASON_REQUIRED' });
  t('R7-13', 'R7', 'D', `res := public.nf_reopen_day(${dayId('day1')}, 'older day', ${dayVer('day1')});`, { err: 'NF:LATER_DAY_EXISTS' });
  t('R7-14', 'R7', 'D', `res := public.nf_reopen_day(${dayId('day2')}, 'wrong count', ${dayVer('day2')});`,
    { ok: `res->'day'->>'status' = 'OPEN' AND (res->'day'->>'reopen_count')::int = 1 AND res->'day'->>'variance' IS NULL
           AND (SELECT close_cash IS NULL AND closed_at IS NULL FROM public.nf_days WHERE id = ${dayId('day2')})` });
  t('R7-15', 'R7', 'op', `res := (SELECT jsonb_agg(jsonb_build_object('r', reason, 'who', actor_name)) FROM public.nf_audit WHERE day_id = ${dayId('day2')} AND action = 'REOPEN');`,
    { ok: `res = '[{"r":"wrong count","who":"Test Director"}]'::jsonb` });
  t('R7-16', 'R6', 'A', `res := public.nf_get_day(${C}, '2026-09-17');
       res := public.nf_save_count(${dayId('day2')}, jsonb_build_object('coins', ${closingOf('Cash')}), ${dayVer('day2')});`,
    { ok: `res->'checks' = '[]'::jsonb` });
  t('R7-17', 'R6', 'A', `res := public.nf_close_day(${dayId('day2')}, ${dayVer('day2')}, NULL);`, { ok: `res->'day'->>'status' = 'CLOSED' AND (res->'day'->>'variance')::numeric = 0` });
  t('R7-18', 'R7', 'rawD', `UPDATE public.nf_days SET status = 'OPEN' WHERE id = ${dayId('day2')};`, { err: 'NF:REASON_REQUIRED' });
  t('R5-04', 'R5', 'rawA', `INSERT INTO public.nf_days (company_id, business_date, closing_no, status, is_first_day, typed_open_cash, typed_open_petty, typed_open_bank, created_by)
       VALUES (${C}, '2026-09-18', 'DC-903', 'OPEN', false, 1, 1, 1, ${lit(ids.A)});`, { like: '%nf_days_typed_opening_first_day_only%' });

  // ── carry forward again, and dates ────────────────────────────────────────
  t('C02', 'R5', 'A', `res := public.nf_start_next_day(${C}, '2026-09-17');`, { err: 'NF:DATE_NOT_AFTER_PREVIOUS' });
  t('C03', 'R5', 'A', `res := public.nf_start_next_day(${C}, NULL); ${set('day3', `res->'day'->>'id'`)}`,
    { ok: `res->'day'->>'business_date' = '2026-09-18' AND res->'day'->>'closing_no' = 'DC-003'
           AND (SELECT ${openingOf('Cash')} = d.close_cash AND ${openingOf('Petty')} = d.close_petty AND ${openingOf('Bank')} = d.close_bank
                  FROM public.nf_days d WHERE d.id = ${dayId('day2')})` });
  t('R6-14', 'R6', 'A', `res := public.nf_get_day(${C}, '2026-09-18');
       res := public.nf_save_count(${dayId('day3')}, jsonb_build_object('coins', ${openingOf('Cash')}), ${dayVer('day3')});
       res := public.nf_close_day(${dayId('day3')}, ${dayVer('day3')}, 'nothing to explain');`, { err: 'NF:NO_VARIANCE_TO_EXPLAIN' });

  // ── edit log ──────────────────────────────────────────────────────────────
  t('E01', 'edit-log', 'A', saveLine('day3', 'IN', 'CRV-401', 'first', '21100', 'GF', 'Cash', '1000'), { ok: `true` });
  t('E02', 'edit-log', 'A', `res := public.nf_save_line(${dayId('day3')}, ${lineId('day3', 'CRV-401')}, 'IN', 'CRV-401', 'corrected', '21100', 'GF', 'Cash', 1500, ${lineVer('day3', 'CRV-401')});`, { ok: `true` });
  t('E03', 'edit-log', 'op', `res := (SELECT jsonb_build_object('before', before->'amount', 'after', after->'amount', 'bd', before->>'description',
         'ad', after->>'description', 'who', actor_name, 'actor', actor::text = ${lit(ids.A)}, 'at', at IS NOT NULL)
         FROM public.nf_audit WHERE entity = 'nf_lines' AND action = 'UPDATE' AND entity_id = (${lineId('day3', 'CRV-401')})::text);`,
    { ok: `res = '{"before":1000,"after":1500,"bd":"first","ad":"corrected","who":"Test Accountant","actor":true,"at":true}'::jsonb` });
  t('E04', 'edit-log', 'D', `${set('e04', lineId('day3', 'CRV-401'))} res := public.nf_delete_line(${lineId('day3', 'CRV-401')}, ${lineVer('day3', 'CRV-401')});`, { ok: `true` });
  t('E05', 'edit-log', 'op', `res := (SELECT jsonb_build_object('before', before->'amount', 'after', after, 'who', actor_name)
         FROM public.nf_audit WHERE entity = 'nf_lines' AND action = 'DELETE' AND entity_id = ${get('e04')});`,
    { ok: `res = '{"before":1500,"after":null,"who":"Test Director"}'::jsonb` });
  t('E06', 'edit-log', 'V', `res := public.nf_list_audit(${dayId('day3')});`, { err: 'NF:NOT_ALLOWED' });
  t('E07', 'edit-log', 'D', `res := public.nf_list_audit(${dayId('day3')});`, { ok: `jsonb_array_length(res) >= 3` });

  // ── roles ─────────────────────────────────────────────────────────────────
  t('V01', 'roles', 'V', saveLine('day3', 'IN', 'CRV-501', 'v', '21100', 'GF', 'Cash', '1'), { err: 'NF:NOT_ALLOWED' });
  t('V02', 'roles', 'V', `res := public.nf_get_day(${C}, '2026-09-16');`, { ok: `jsonb_array_length(res->'lines') = 8` });
  t('V03', 'roles', 'A', `res := public.nf_get_report(${dayId('day1')});`, { ok: `(res->>'total_close')::numeric = ${OWNER.total}` });
  t('V04', 'roles', 'V', `res := public.nf_start_next_day(${C}, NULL);`, { err: 'NF:NOT_ALLOWED' });
  t('V05', 'roles', 'V', `res := public.nf_close_day(${dayId('day3')}, ${dayVer('day3')}, NULL);`, { err: 'NF:NOT_ALLOWED' });
  t('V06', 'roles', 'V', `res := public.nf_save_count(${dayId('day3')}, '{"coins":1}'::jsonb, ${dayVer('day3')});`, { err: 'NF:NOT_ALLOWED' });
  t('V07', 'roles', 'V', `res := to_jsonb((SELECT count(*) FROM public.nf_lines WHERE company_id = ${C}));`, { ok: `(res::text)::int > 0` });
  t('O01', 'roles', 'O', `res := public.nf_get_day(${C}, NULL);`, { err: 'NF:NOT_ALLOWED' });
  t('O02', 'roles', 'O', `res := to_jsonb((SELECT count(*) FROM public.nf_lines WHERE company_id = ${C}));`, { ok: `res = '0'::jsonb` });
  t('O03', 'roles', 'O', `res := public.nf_get_context();`, { ok: `res->'memberships' = '[]'::jsonb` });
  t('AN01', 'roles', 'anon', `res := public.nf_get_day(${C}, NULL);`, { like: 'permission denied for function%' });
  t('AN02', 'roles', 'anon', `res := to_jsonb((SELECT count(*) FROM public.nf_days));`, { like: 'permission denied for table%' });
  t('M01', 'members', 'A', `res := public.nf_set_member(${C}, ${lit(ids.O)}, 'viewer', 'Outsider', true);`, { err: 'NF:NOT_ALLOWED' });
  t('M02', 'members', 'D', `res := public.nf_set_member(${C}, ${lit(ids.D)}, 'director', 'Test Director', false);`, { err: 'NF:LAST_DIRECTOR' });
  t('M03', 'members', 'D', `res := public.nf_set_member(${C}, ${lit(ids.O)}, 'viewer', 'Outsider', true);`, { ok: `jsonb_array_length(res) = 4` });
  t('M04', 'members', 'O', `res := public.nf_get_day(${C}, '2026-09-16');`, { ok: `res->'day'->>'closing_no' = 'DC-001'` });
  t('M05', 'members', 'D', `res := public.nf_set_member(${C}, ${lit(ids.O)}, 'viewer', 'Outsider', false);`, { ok: `true` });
  t('M06', 'members', 'O', `res := public.nf_get_day(${C}, '2026-09-16');`, { err: 'NF:NOT_ALLOWED' });

  // ── audit is append-only ──────────────────────────────────────────────────
  t('AU01', 'audit', 'rawD', `UPDATE public.nf_audit SET reason = 'edited' WHERE company_id = ${C};`, { err: 'NF:AUDIT_IS_APPEND_ONLY' });
  t('AU02', 'audit', 'rawD', `DELETE FROM public.nf_audit WHERE company_id = ${C};`, { err: 'NF:AUDIT_IS_APPEND_ONLY' });

  // ── PDCs across days ──────────────────────────────────────────────────────
  const pdc = `(SELECT id FROM public.nf_pdcs WHERE company_id = ${C} AND cheque_no = '004512')`;
  const pdcVer = `(SELECT version FROM public.nf_pdcs WHERE company_id = ${C} AND cheque_no = '004512')`;
  t('PD01', 'pdc', 'A', `res := public.nf_get_day(${C}, '2026-09-18');`, { ok: `jsonb_array_length(res->'pdcs') = 1 AND NOT (res->'pdcs'->0->>'entered_here')::boolean` });
  t('PD02', 'pdc', 'A', `res := public.nf_save_pdc(${dayId('day3')}, ${pdc}, 'RECEIVED', '004512', 'Shahid Iqbal', 'MCB', '2026-10-30', 250000, ${pdcVer});`, { err: 'NF:DAY_LOCKED' });
  t('PD03', 'pdc', 'A', `res := public.nf_resolve_pdc(${dayId('day3')}, ${pdc}, 'CLEARED', ${pdcVer});`, { ok: `res->'pdcs' = '[]'::jsonb` });
  t('PD04', 'pdc', 'A', `res := public.nf_get_day(${C}, '2026-09-16');`, { ok: `jsonb_array_length(res->'pdcs') = 1` });
  t('PD05', 'pdc', 'A', `res := public.nf_save_pdc(${dayId('day3')}, NULL, 'ISSUED', '900001', 'Supplier', 'BAHL', '2026-09-20', 75000, NULL);`,
    { ok: `(SELECT count(*) FROM jsonb_array_elements(res->'pdcs') p WHERE p->>'direction' = 'ISSUED') = 1` });
  t('PD06', 'pdc', 'A', `res := public.nf_get_report(${dayId('day3')});`,
    { ok: `res->'pdc_due' = '[{"direction":"ISSUED","amount":75000,"party":"Supplier","due_date":"2026-09-20"}]'::jsonb
           AND res->'pdc_pending' = '{"received":0,"issued":75000}'::jsonb` });

  // ── purge: refuses a real name, empties a test company ────────────────────
  t('PU01', 'purge', 'op', `res := public._nf_test_purge(${lit(ids.N)});`, { err: 'NF:PURGE_REFUSED' });
  t('PU02', 'purge', 'op', `res := public._nf_test_purge(${C});`, { ok: `(res->>'companies')::int = 1 AND (res->>'nf_accounts_left')::int = 0` });
  t('PU03', 'purge', 'op', `res := jsonb_build_object(
         'members', (SELECT count(*) FROM public.nf_members WHERE company_id = ${C}),
         'settings', (SELECT count(*) FROM public.nf_settings WHERE company_id = ${C}),
         'accounts', (SELECT count(*) FROM public.nf_accounts WHERE company_id = ${C}),
         'floors', (SELECT count(*) FROM public.nf_floors WHERE company_id = ${C}),
         'cats', (SELECT count(*) FROM public.nf_report_categories WHERE company_id = ${C}),
         'days', (SELECT count(*) FROM public.nf_days WHERE company_id = ${C}),
         'lines', (SELECT count(*) FROM public.nf_lines WHERE company_id = ${C}),
         'pdcs', (SELECT count(*) FROM public.nf_pdcs WHERE company_id = ${C}),
         'audit', (SELECT count(*) FROM public.nf_audit WHERE company_id = ${C}),
         'company', (SELECT count(*) FROM public.companies WHERE id = ${C}));`,
    { ok: `res = '{"members":0,"settings":0,"accounts":0,"floors":0,"cats":0,"days":0,"lines":0,"pdcs":0,"audit":0,"company":0}'::jsonb` });

  // ── rollback file: takes the database back to having no nf_ object ─────────
  const rb = fs.readFileSync(path.join(MIG, '20260916r_nf_rollback.sql'), 'utf8')
    .replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(rb)) throw new Error('rollback: a BEGIN/COMMIT survived stripping');
  // SET CONSTRAINTS: the deferred chart check has events queued in this one
  // long transaction; a real rollback runs in its own and has none.
  t('RB01', 'rollback', 'op', `SET CONSTRAINTS ALL IMMEDIATE;
       EXECUTE ${lit(rb)};
       res := jsonb_build_object(
         'rel', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'nf\\_%'),
         'fn',  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'nf\\_%' OR proname LIKE '\\_nf\\_%')),
         'old_cash_book', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('cash_days','cash_entries')));`,
    { ok: `res = '{"rel":0,"fn":0,"old_cash_book":2}'::jsonb` });

  return T;
}

function block(test, ids) {
  const uid = { D: ids.D, A: ids.A, V: ids.V, O: ids.O, rawA: ids.A, rawD: ids.D }[test.who];
  let pre = '', post = '';
  if (uid) pre += `PERFORM set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);\n`;
  if (['D', 'A', 'V', 'O'].includes(test.who)) pre += `EXECUTE 'SET LOCAL ROLE authenticated';\n`;
  if (test.who === 'anon') pre += `PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);\nEXECUTE 'SET LOCAL ROLE anon';\n`;
  post = `EXECUTE 'RESET ROLE';\nPERFORM set_config('request.jwt.claims', '', true);\n`;

  const e = test.expect;
  const okPass = e.ok ? `(${e.ok})` : 'false';
  const errPass = e.err ? `SQLERRM = ${lit(e.err)}` : e.like ? `SQLERRM LIKE ${lit(e.like)}` : 'false';
  const tag = `${lit(test.id)}, ${lit(test.rule)}, ${lit(test.who)}`;
  return `
DO $blk$
DECLARE res jsonb; v_pass boolean;
BEGIN
${pre}  BEGIN
${test.body}
    v_pass := COALESCE(${okPass}, false);
    INSERT INTO pg_temp.nf_results (id, rule, who, pass, detail) VALUES (${tag}, v_pass, 'returned ' || left(COALESCE(res::text, '(nothing)'), 700));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp.nf_results (id, rule, who, pass, detail) VALUES (${tag}, COALESCE(${errPass}, false), 'raised ' || SQLERRM);
  END;
${post}END
$blk$;`;
}

function migrationBody(file, mutate) {
  let raw = fs.readFileSync(path.join(MIG, file), 'utf8');
  if (mutate) raw = mutate(file, raw);
  const stripped = raw.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped)) throw new Error(`${file}: a BEGIN/COMMIT survived stripping`);
  return `\n-- ══════ ${file} ══════\n${stripped}\n`;
}

function buildBatch({ ids, seed, golden, ref, mutate }) {
  const temp = `
CREATE TEMP TABLE nf_results (seq serial, id text, rule text, who text, pass boolean, detail text);
CREATE TEMP TABLE nf_ctx (k text PRIMARY KEY, v text);
GRANT ALL ON pg_temp.nf_results, pg_temp.nf_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE pg_temp.nf_results_seq_seq TO authenticated, anon;
CREATE FUNCTION pg_temp.nf_set(k text, v text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO pg_temp.nf_ctx VALUES (k, v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $f$;
CREATE FUNCTION pg_temp.nf_get(k text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT v FROM pg_temp.nf_ctx WHERE nf_ctx.k = $1 $f$;
`;
  // what this transaction has written outside nf_, captured at three points (W01–W03)
  const capture = k => `SELECT pg_temp.nf_set(${lit(k)}, ${WRITTEN_OUTSIDE_NF}::text);`;
  const setup = `
${capture('w_after_migrations')}
-- throwaway rehearsal fixtures (all rolled back)
INSERT INTO public.companies (id, company_code, company_name) VALUES
  (${lit(ids.C)}, ${lit('ZZNF' + ids.run)}, ${lit('ZZTEST-NF-rehearsal-' + ids.run)}),
  (${lit(ids.N)}, ${lit('ZZNN' + ids.run)}, ${lit('NOT-A-TEST-NAME-rehearsal-' + ids.run)});
INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  (${lit(ids.D)}, ${lit('nf-d-' + ids.run + '@rehearsal.invalid')}, 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  (${lit(ids.A)}, ${lit('nf-a-' + ids.run + '@rehearsal.invalid')}, 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  (${lit(ids.V)}, ${lit('nf-v-' + ids.run + '@rehearsal.invalid')}, 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  (${lit(ids.O)}, ${lit('nf-o-' + ids.run + '@rehearsal.invalid')}, 'authenticated', 'authenticated', '{}', '{}', now(), now());
${capture('w_after_fixtures')}
${seedSql(ids.C, seed)}
INSERT INTO public.nf_members (company_id, user_id, role, display_name, active) VALUES
  (${lit(ids.C)}, ${lit(ids.D)}, 'director',   'Test Director',   true),
  (${lit(ids.C)}, ${lit(ids.A)}, 'accountant', 'Test Accountant', true),
  (${lit(ids.C)}, ${lit(ids.V)}, 'viewer',     'Test Viewer',     true);
${capture('w_after_seed')}
`;
  const tests = buildTests(ids, golden, ref);
  const finish = `
DO $fin$
DECLARE j text;
BEGIN
  SELECT json_agg(json_build_object('id', id, 'rule', rule, 'who', who, 'pass', pass, 'detail', detail) ORDER BY seq)::text
    INTO j FROM pg_temp.nf_results;
  RAISE EXCEPTION 'NF_RESULTS:%', COALESCE(j, '[]');
END
$fin$;`;
  return {
    tests,
    sql: ['BEGIN;', temp, ...FILES.map(f => migrationBody(f, mutate)), setup, ...tests.map(t => block(t, ids)), finish, 'ROLLBACK;'].join('\n'),
  };
}

async function send(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: res.status, text: await res.text() };
}

function parseResults(text) {
  let msg;
  try { msg = JSON.parse(text).message || text; } catch { msg = text; }
  const i = msg.indexOf('NF_RESULTS:');
  if (i < 0) return { error: msg };
  const tail = msg.slice(i + 'NF_RESULTS:'.length);
  const end = tail.lastIndexOf(']');
  return { results: JSON.parse(tail.slice(0, end + 1)) };
}

async function liveHasNothing(ids) {
  const { status, text } = await send(`select json_build_object(
      'nf_relations', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'nf\\_%'),
      'nf_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'nf\\_%' or proname like '\\_nf\\_%')),
      'rehearsal_companies', (select count(*) from public.companies where id in ('${ids.C}','${ids.N}')),
      'rehearsal_users', (select count(*) from auth.users where id in ('${ids.D}','${ids.A}','${ids.V}','${ids.O}'))) as j`);
  if (status !== 201) return { ok: false, detail: text };
  const j = JSON.parse(text)[0].j;
  return { ok: Object.values(j).every(v => v === 0), detail: j };
}

function goldenFromReference(ref, failures) {
  const s = ref.sample;
  const rows = side => s[side].filter(r => Number(r.a)).map(r => ({ v: r.v, d: r.d, h: r.h, f: r.f, m: r.m, a: Number(r.a) }));
  const g = {
    date: s.date, cno: s.cno, open: s.open,
    in: rows('in'), out: rows('out'), tBank: Number(s.tBank),
    den: Object.fromEntries(Object.entries(s.den).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])),
    pdcIn: s.pdcIn.filter(p => p.n || Number(p.a)),
  };
  // The reference sample and the owner's list must be the same day.
  const same = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`G00 reference sample ≠ owner list (${what}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); };
  same(g.open, OWNER.open, 'openings');
  same(g.in.map(r => [r.v, r.h, r.f, r.m, r.a]), OWNER.in, 'receipts');
  same(g.out.map(r => [r.v, r.h, r.f, r.m, r.a]), OWNER.out, 'payments');
  same(g.tBank, OWNER.tBank, 'cash to bank');
  same(g.den, Object.fromEntries(Object.entries(OWNER.count).map(([k, v]) => [String(k), v])), 'cash count');
  if (s.tPetty !== '') failures.push('G00 reference sample has a petty transfer the owner list does not');
  if (s.pdcOut.some(p => p.n || Number(p.a))) failures.push('G00 reference sample has an issued PDC the owner list does not');

  // Expected report aggregates, computed with the reference's own catIn/catOut
  // and its grouping rule (sum, count, largest first, ties in first-seen order).
  const group = (list, fn) => {
    const m = new Map();
    for (const r of list) { const k = fn(r.h); const e = m.get(k) || { label: k, amount: 0, count: 0 }; e.amount += r.a; e.count += 1; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const sum = (list, via) => list.filter(r => !via || r.m === via).reduce((t, r) => t + r.a, 0);
  const close = {};
  for (const via of ['Cash', 'Petty', 'Bank']) {
    const trf = via === 'Cash' ? -g.tBank : via === 'Bank' ? g.tBank : 0;
    close[via] = g.open[via] + sum(g.in, via) - sum(g.out, via) + trf;
  }
  same(close, OWNER.close, 'closings computed from the reference sample');
  g.expect = {
    inCats: group(g.in, ref.catIn),
    outCats: group(g.out, ref.catOut),
    large: g.out.filter(r => r.a >= ref.BIG).sort((a, b) => b.a - a.a)
      .map(r => ({ description: r.d, category: ref.catOut(r.h), by: r.m === 'Bank' ? 'bank' : 'cash', amount: r.a })),
    totalIn: sum(g.in), totalOut: sum(g.out),
    cards: [['Cash', 'Cash in hand'], ['Petty', 'Petty cash'], ['Bank', 'Bank Al-Habib']]
      .map(([via, label]) => ({ via, label, opening: g.open[via], closing: close[via] })),
    pdcPending: { received: g.pdcIn.reduce((t, p) => t + Number(p.a), 0), issued: 0 },
  };
  return g;
}

// ── mutants: each removes one guard and names the assertions that must go red ──
const MUTANTS = [
  { name: 'R1 · lines position guard does nothing', file: 'b', find: '  PERFORM public.nf_assert_not_negative(COALESCE(NEW.day_id, OLD.day_id));', repl: '  NULL;',
    red: ['R1-01', 'R1-05', 'R1-06', 'R1-07', 'R1-11', 'R1-12', 'R1-13'] },
  { name: 'R1 · day position guard does nothing', file: 'b', find: '    PERFORM public.nf_assert_not_negative(NEW.id);', repl: '    NULL;', red: ['R1-08'] },
  { name: 'R2 · voucher uniqueness dropped', file: 'a', find: '  CONSTRAINT nf_lines_voucher_unique UNIQUE (company_id, voucher_key),\n', repl: '', red: ['R2-01', 'R2-02', 'R2-03'] },
  { name: 'R3 · head postability not checked', file: 'b', find: 'IF NOT FOUND OR NOT v_acc.is_head OR NOT v_acc.active THEN', repl: 'IF NOT FOUND THEN', red: ['R3-05', 'R3-06', 'R3-07', 'R3-14'] },
  { name: 'R4 · a head may be a Via', file: 'a', find: '  CONSTRAINT nf_accounts_head_not_via CHECK (NOT (is_head AND via IS NOT NULL)),\n', repl: '', red: ['R4-05'] },
  { name: 'R4 · 104xx allowed back', file: 'a', find: "  CONSTRAINT nf_accounts_no_104       CHECK (code !~ '^104'),\n", repl: '', red: ['R4-06'] },
  { name: 'R5 · typed opening allowed on any day', file: 'a', find: 'OR (NOT is_first_day AND typed_open_cash IS NULL AND typed_open_petty IS NULL AND typed_open_bank IS NULL)', repl: 'OR (NOT is_first_day)', red: ['R5-04'] },
  { name: 'R5 · next day may start before the previous closes', file: 'b', find: "      IF v_latest.status <> 'CLOSED' THEN\n        RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED' USING DETAIL = v_latest.business_date::text;\n      END IF;\n", repl: '',
    // Through the RPC this rule is held four times (RPC check, this trigger,
    // the one-unclosed-day index, and nf_position_row refusing an opening from
    // an unclosed day), so an RPC-path test cannot see one layer go. R5-03b
    // writes past the RPC; the trigger is the first thing it meets.
    red: ['R5-03b'] },
  { name: 'R6 · accountant may close with a variance', file: 'b', find: "            RAISE EXCEPTION 'NF:VARIANCE_NEEDS_DIRECTOR' USING DETAIL = v_mis::text;", repl: '            NULL;', red: ['R6-03', 'R6-04'] },
  { name: 'R6 · checks not run on close', file: 'b', find: "        RAISE EXCEPTION 'NF:CHECKS_FAILED' USING DETAIL = v_hard::text;", repl: '        NULL;', red: ['R6-01'] },
  { name: 'R7 · lines writable on a locked day', file: 'b', find: "  IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;", repl: '', red: ['R6-07', 'R7-01', 'R7-02', 'R7-07', 'R7-08'] },
  { name: 'R7 · reopen of a non-latest day', file: 'b', find: "        RAISE EXCEPTION 'NF:LATER_DAY_EXISTS';", repl: '        NULL;', red: ['R7-13'] },
  { name: 'R7 · reopen without a director (trigger layer)', file: 'b', find: "      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:REOPEN_NEEDS_DIRECTOR'; END IF;", repl: '', red: ['R7-11b'] },
  { name: 'R7 · a stale reopen reason is reused', file: 'b', find: '        NEW.last_reopen_reason := NULL;   -- so the next reopen must bring its own', repl: '', red: ['R7-18'] },
  { name: 'R8 · a floor default sneaks in', file: 'a', find: '  floor_code   text          NOT NULL,', repl: "  floor_code   text          NOT NULL DEFAULT 'P-W',", red: ['S06'] },
  { name: 'edit log · lines not audited', file: 'b', find: "'nf_days','nf_lines','nf_pdcs'] LOOP\n    EXECUTE format('CREATE TRIGGER nf_audit_row", repl: "'nf_days','nf_pdcs'] LOOP\n    EXECUTE format('CREATE TRIGGER nf_audit_row", red: ['E03', 'E05'] },
  { name: 'grants · PUBLIC keeps EXECUTE', file: 'c', find: "    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);\n    IF v_name IN", repl: "    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);\n    IF v_name IN", red: ['S03', 'AN01'] },
];

function mutatorFor(m) {
  const letter = f => f.slice(8, 9); // 20260916a_… → a
  const edits = [{ file: m.file, find: m.find, repl: m.repl }, ...[].concat(m.also || [])];
  return (file, raw) => {
    let out = raw;
    for (const e of edits) {
      if (letter(file) !== e.file) continue;
      if (!out.includes(e.find)) throw new Error(`mutant "${m.name}": text to replace not found in ${file}`);
      out = out.replace(e.find, e.repl);
    }
    return out;
  };
}

function summarise(results, expectedIds) {
  const byId = new Map(results.map(r => [r.id, r]));
  const missing = expectedIds.filter(id => !byId.has(id));
  const failed = results.filter(r => !r.pass);
  return { byId, missing, failed };
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  const ids = { run, C: crypto.randomUUID(), N: crypto.randomUUID(), D: crypto.randomUUID(), A: crypto.randomUUID(), V: crypto.randomUUID(), O: crypto.randomUUID() };
  console.log(`[verify-nf-schema] project ${REF} · run ${run}`);
  console.log(`  migrations: ${FILES.join(', ')} + seed built by gen-seed.js`);
  console.log('  everything runs in ONE transaction that ends in a deliberate exception — nothing can be committed.\n');

  let built;
  try { built = buildSeed(); } catch (e) { console.error('COULD NOT RUN — seed:', e.message); process.exit(2); }
  if (built.failures.length) { console.error('FAIL — the seed does not hold:\n  ' + built.failures.join('\n  ')); process.exit(1); }

  const g00 = [];
  const golden = goldenFromReference(built.ref, g00);
  if (g00.length) { console.error('FAIL —\n  ' + g00.join('\n  ')); process.exit(1); }
  console.log('  G00 PASS  the reference sample is the owner\'s golden day (openings, 8 lines, transfer, count, closings)\n');

  const batch = buildBatch({ ids, seed: built.seed, golden, ref: built.ref });
  const probe = path.join(ROOT, 'migration_work', '_nf_p1_rehearsal.sql');
  fs.writeFileSync(probe, batch.sql);

  let resp;
  try { resp = await send(batch.sql); } catch (e) { console.error('COULD NOT RUN — request failed:', e.message); process.exit(2); }
  const parsed = parseResults(resp.text);
  if (parsed.error) {
    console.error(`FAIL — the batch raised before the assertions finished (HTTP ${resp.status}):\n${parsed.error}`);
    const clean = await liveHasNothing(ids);
    console.error(`\nlive after the run: ${JSON.stringify(clean.detail)} → ${clean.ok ? 'nothing persisted' : 'SOMETHING PERSISTED'}`);
    process.exit(clean.ok ? 1 : 1);
  }

  const { results } = parsed;
  const { missing, failed } = summarise(results, batch.tests.map(t => t.id));
  let lastRule = '';
  for (const r of results) {
    if (r.rule !== lastRule) { console.log(`\n── ${r.rule}`); lastRule = r.rule; }
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(7)} ${r.who.padEnd(5)} ${r.pass ? '' : r.detail}`);
  }
  console.log(`\n${results.length} assertions · ${results.length - failed.length} passed · ${failed.length} failed · ${missing.length} missing`);
  if (missing.length) console.log('missing: ' + missing.join(', '));

  const clean = await liveHasNothing(ids);
  console.log(`\nlive database after the run: ${JSON.stringify(clean.detail)}`);
  console.log(clean.ok ? '→ nothing from this run exists on live: no nf_ table, no nf_ function, no rehearsal company, no rehearsal user.'
                       : '→ ⚠️ SOMETHING FROM THIS RUN EXISTS ON LIVE. Stop and look.');

  let mutantFail = 0;
  if (process.argv.includes('--mutants') && failed.length === 0 && missing.length === 0) {
    console.log('\n══ mutants: each removes one guard; the named assertions must go red ══');
    for (const m of MUTANTS) {
      const mids = { ...ids, run: crypto.randomBytes(4).toString('hex'), C: crypto.randomUUID(), N: crypto.randomUUID(),
                     D: crypto.randomUUID(), A: crypto.randomUUID(), V: crypto.randomUUID(), O: crypto.randomUUID() };
      let mb;
      try { mb = buildBatch({ ids: mids, seed: built.seed, golden, ref: built.ref, mutate: mutatorFor(m) }); }
      catch (e) { console.log(`  COULD NOT BUILD  ${m.name}: ${e.message}`); mutantFail++; continue; }
      const mr = parseResults((await send(mb.sql)).text);
      if (mr.error) { console.log(`  KILLED (batch raised)  ${m.name}: ${mr.error.slice(0, 160)}`); continue; }
      const red = new Set(mr.results.filter(r => !r.pass).map(r => r.id));
      const notRed = m.red.filter(id => !red.has(id));
      const extra = [...red].filter(id => !m.red.includes(id));
      if (notRed.length) {
        mutantFail++;
        console.log(`  SURVIVED  ${m.name} — still green: ${notRed.join(', ')}`);
        mr.results.filter(r => notRed.includes(r.id)).forEach(r => console.log(`            ${r.id}: ${r.detail}`));
      }
      else console.log(`  killed    ${m.name} — red: ${m.red.join(', ')}${extra.length ? `  (also red: ${extra.join(', ')})` : ''}`);
      const mc = await liveHasNothing(mids);
      if (!mc.ok) { console.log(`  ⚠️ mutant run left something on live: ${JSON.stringify(mc.detail)}`); mutantFail++; }
    }
    console.log(mutantFail ? `\n${mutantFail} mutant(s) survived or could not run.` : `\nall ${MUTANTS.length} mutants killed.`);
  } else if (process.argv.includes('--mutants')) {
    console.log('\nmutants skipped: the rehearsal itself is not green.');
  }

  process.exit(failed.length || missing.length || !clean.ok || mutantFail ? 1 : 0);
})();
