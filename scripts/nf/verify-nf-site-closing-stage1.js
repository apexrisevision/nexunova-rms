#!/usr/bin/env node
/**
 * NexuFinance — Site Closing, Stage 1 (20261117b), driven for real.
 *
 * ONE request to the database, inside ONE transaction that always ends in
 * RAISE, so everything rolls back: the migration itself (unless it is already
 * applied — then it is re-run, which is idempotent for CREATE OR REPLACE but
 * not for CREATE TABLE, so pass --applied to skip it), a throw-away
 * ZZTEST company with the real chart, four throw-away users (site,
 * accountant, director, viewer), and every check below. Awami is never written.
 * No service-role key is used: users are inserted into auth.users inside the
 * transaction and every call is made with that user's JWT claims set; the
 * table-level checks switch to the `authenticated` role so RLS really applies.
 *
 *   node scripts/nf/verify-nf-site-closing-stage1.js [--applied] > "$SCRATCH/nf-site1.log" 2>&1
 *
 * Exit: 0 all passed · 1 something failed · 2 could not run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF, TOKEN } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));
const MIG = path.join(ROOT, 'supabase', 'migrations', '20261117b_nf_site_closing_stage1.sql');
const APPLIED = process.argv.includes('--applied');
// --plus <migration.sql>: also run a later migration (Stage 2 changes the doc-no rule: a paper
// number may repeat on the SAME day — one voucher, two heads — but never on another day)
const PLUS = process.argv.includes('--plus') ? path.resolve(process.argv[process.argv.indexOf('--plus') + 1]) : null;
// --stage2: Stage 2 is already applied live (its doc-no rule is in force without --plus)
const STAGE2 = !!PLUS || process.argv.includes('--stage2');
// number and name required on every line (20261119a): checked when that migration is in the run
const REQUIRED = (PLUS && /20261119a/.test(PLUS)) || process.argv.includes('--required');

const C = crypto.randomUUID();
const U = { S: crypto.randomUUID(), A: crypto.randomUUID(), D: crypto.randomUUID(), V: crypto.randomUUID() };
const run = crypto.randomBytes(3).toString('hex');

const PRE = String.raw`
CREATE TEMP TABLE _r (n serial, id text, pass boolean, detail text) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated;
GRANT ALL ON SEQUENCE _r_n_seq TO authenticated;
CREATE TEMP TABLE _seen (phase text, who text, tbl text, n bigint) ON COMMIT DROP;
GRANT ALL ON _seen TO authenticated;

CREATE FUNCTION pg_temp.as_(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', u::text, true) $$;
CREATE FUNCTION pg_temp.ok(i text, p boolean, d text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r (id, pass, detail) VALUES (i, COALESCE(p, false), d) $$;
-- runs a statement and returns the NF: error code it raised, or 'OK'
CREATE FUNCTION pg_temp.err(s text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE s; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- WHAT A MEMBER CAN READ: every row of every pre-existing nf_ table, counted
-- as that user under RLS. Taken before and after the migration.
CREATE FUNCTION pg_temp.seen(ph text, who text, u uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text; c bigint;
BEGIN
  PERFORM pg_temp.as_(u);
  FOR t IN SELECT unnest(${'${TABLES}'}) LOOP
    BEGIN
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO c;
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN insufficient_privilege THEN c := -1;
    END;
    INSERT INTO _seen VALUES (ph, who, t, c);
  END LOOP;
END $$;
${'${SNAP_PRE}'}
`;

const TESTS = String.raw`

DO $t$
DECLARE
  co constant uuid := '${C}';
  us constant uuid := '${U.S}'; ua constant uuid := '${U.A}'; ud constant uuid := '${U.D}'; uv constant uuid := '${U.V}';
  r jsonb; e text; d1 uuid; d2 uuid; d3 uuid; l1 uuid; l2 uuid; lb uuid; v int; hoday uuid; n numeric; x int;
BEGIN
  -- ── roles ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_(us);
  PERFORM pg_temp.ok('R-01 a site member is not an nf_is_member (table policies)', NOT public.nf_is_member(co, false), '');
  PERFORM pg_temp.as_(ua);
  PERFORM pg_temp.ok('R-02 an accountant still is', public.nf_is_member(co, false), '');

  PERFORM pg_temp.as_(us);
  e := pg_temp.err(format('SELECT public.nf_list_heads(%L)', co));
  PERFORM pg_temp.ok('R-03 site: HO head list refused', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_get_trial_balance(%L, %L)', co, '2026-11-30'));
  PERFORM pg_temp.ok('R-04 site: trial balance refused', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_get_cash_bank_movement(%L, %L, %L)', co, '2026-11-01', '2026-11-30'));
  PERFORM pg_temp.ok('R-05 site: cash & bank movement refused', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_list_days(%L, NULL, NULL)', co));
  PERFORM pg_temp.ok('R-06 site: HO day list refused', e LIKE 'NF:NOT_ALLOWED%', e);
  r := public.nf_site_list_heads(co);
  PERFORM pg_temp.ok('R-07 site: site head list works, no cash/bank account in it',
    jsonb_array_length(r) > 50 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) h WHERE h->>'code' IN ('10100','10200','10300')),
    jsonb_array_length(r)::text);
  PERFORM pg_temp.as_(ua);
  PERFORM pg_temp.ok('R-08 accountant: site head list = HO head list', public.nf_site_list_heads(co) = public.nf_list_heads(co), '');

  -- ── the first day ──────────────────────────────────────────────────────
  PERFORM pg_temp.as_(us);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'IN','Z-1','X',NULL,NULL,'40900','SITE_CASH',100,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('F-01 no line before HO sets the opening', e LIKE 'NF:SITE_FIRST_DAY_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_start_first_day(%L,'2026-11-05',10000)$$, co));
  PERFORM pg_temp.ok('F-02 site cannot set the opening', e LIKE 'NF:NOT_ALLOWED%', e);
  PERFORM pg_temp.as_(ua);
  r := public.nf_site_start_first_day(co, '2026-11-05', 10000);
  d1 := (r->>'id')::uuid;
  PERFORM pg_temp.ok('F-03 HO starts the box at 10,000', (r->>'opening')::numeric = 10000 AND r->>'status' = 'DRAFT', r::text);
  e := pg_temp.err(format($$SELECT public.nf_site_start_first_day(%L,'2026-11-06',5)$$, co));
  PERFORM pg_temp.ok('F-04 only one first day', e LIKE 'NF:SITE_ALREADY_STARTED%', e);

  -- ── lines ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_(us);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'IN','R-1','Sakhi Jan','FF-120',NULL,'21100','SITE_CASH',5000,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-01 token money needs the token no', e LIKE 'NF:SITE_TOKEN_NO_REQUIRED%', e);
  r := public.nf_site_save_line(co, '2026-11-05', NULL, 'IN', 'R-1', 'Sakhi Jan', 'FF-120', 209, '21100', 'SITE_CASH', 5000, NULL, NULL, NULL, NULL);
  l1 := (SELECT id FROM public.nf_site_lines WHERE site_day_id = d1 AND doc_no = 'R-1');
  PERFORM pg_temp.ok('L-02 a token receipt saves; book 15,000', (r->>'book_now')::numeric = 15000 AND (r->>'cash_in')::numeric = 5000, r->>'book_now');
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','P-1','Labour',NULL,NULL,'52600','SITE_CASH',20000,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-03 the box cannot go below zero', e LIKE 'NF:SITE_CASH_NEGATIVE%', e);
  r := public.nf_site_save_line(co, '2026-11-05', NULL, 'OUT', 'P-1', 'Labour', NULL, NULL, '52600', 'SITE_CASH', 12000, NULL, NULL, NULL, NULL);
  l2 := (SELECT id FROM public.nf_site_lines WHERE site_day_id = d1 AND doc_no = 'P-1');
  PERFORM pg_temp.ok('L-04 a payment saves; book 3,000', (r->>'book_now')::numeric = 3000, r->>'book_now');
  r := public.nf_site_save_line(co, '2026-11-05', NULL, 'IN', 'R-2', 'Irfan Ullah', 'LG-57', 208, '21100', 'BANK', 20000, 'RAAST 778', NULL, NULL, NULL);
  lb := (SELECT id FROM public.nf_site_lines WHERE site_day_id = d1 AND doc_no = 'R-2');
  PERFORM pg_temp.ok('L-05 a BANK line does not touch the site box', (r->>'book_now')::numeric = 3000, r->>'book_now');
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'${STAGE2 ? '2026-11-06' : '2026-11-05'}',NULL,'IN','r-1 ','Dup',NULL,7,'21100','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-06 a receipt no is not used twice${STAGE2 ? ' on another day' : ''} (case/space blind)', e LIKE 'NF:DUPLICATE_DOC_NO%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','R-1','Other side',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-07 …but the same no on the payment side is allowed', e = 'OK', e);
${REQUIRED ? String.raw`  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT',' ','Somebody',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('Q-01 a line without its receipt / voucher number is refused', e LIKE 'NF:SITE_DOC_NO_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Q-2',NULL,NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('Q-02 a line without who it came from / went to is refused', e LIKE 'NF:SITE_PARTY_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','R-1','Same voucher, second head',NULL,NULL,'70500','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('Q-03 the same paper number on the same day still goes in (one voucher, two heads)', e = 'OK', e);
  DELETE FROM public.nf_site_lines WHERE site_day_id = d1 AND party_name = 'Same voucher, second head';` : ''}
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'10100','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-08 a cash account is not a head', e LIKE 'NF:HEAD_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','Cash',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-09 via is SITE_CASH or BANK only', e LIKE 'NF:VIA_UNKNOWN%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2099-01-01',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-10 no future dates', e LIKE 'NF:SITE_FUTURE_DATE%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-01',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-11 no date before the first day', e LIKE 'NF:SITE_BEFORE_FIRST_DAY%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10.005,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-12 amounts carry at most two decimals', e LIKE 'NF:%', e);
  -- the 10 on the payment side from L-07 is still there: book 2,990
  DELETE FROM public.nf_site_lines WHERE site_day_id = d1 AND doc_no = 'R-1' AND side = 'OUT';

  -- edit: version-checked, and resets the match
  UPDATE public.nf_site_lines SET match_status = 'DUPLICATE', match_reason = 'test' WHERE id = l2;
  v := (SELECT version FROM public.nf_site_lines WHERE id = l2);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',%L,'OUT','P-1','Labour',NULL,NULL,'52600','SITE_CASH',11000,NULL,NULL,NULL,%s)$$, co, l2, v + 5));
  PERFORM pg_temp.ok('L-13 a stale edit is refused', e LIKE 'NF:VERSION_CONFLICT%', e);
  r := public.nf_site_save_line(co, '2026-11-05', l2, 'OUT', 'P-1', 'Labour', NULL, NULL, '52600', 'SITE_CASH', 11000, NULL, NULL, NULL, v);
  PERFORM pg_temp.ok('L-14 an edit saves and puts the line back to NEW',
    (SELECT match_status = 'NEW' AND match_reason IS NULL AND amount = 11000 FROM public.nf_site_lines WHERE id = l2), '');
  UPDATE public.nf_site_lines SET posted_voucher_id = (SELECT id FROM public.nf_vouchers LIMIT 1) WHERE id = lb;
  v := (SELECT version FROM public.nf_site_lines WHERE id = lb);
  e := pg_temp.err(format('SELECT public.nf_site_delete_line(%L, %s)', lb, v));
  PERFORM pg_temp.ok('L-15 a line already posted cannot be deleted', e LIKE 'NF:SITE_LINE_POSTED%', e);
  UPDATE public.nf_site_lines SET posted_voucher_id = NULL WHERE id = lb;

  PERFORM pg_temp.as_(uv);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('L-16 a viewer cannot write', e LIKE 'NF:NOT_ALLOWED%', e);
  PERFORM pg_temp.ok('L-17 …but can read', (public.nf_site_get_day(co, '2026-11-05')->>'exists')::boolean, '');
  PERFORM pg_temp.as_(ua);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('H-01 HO cannot add a site line', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',%L,'OUT','P-1','Labour',NULL,NULL,'52600','SITE_CASH',1,NULL,NULL,NULL,%s)$$,
                          co, l2, (SELECT version FROM public.nf_site_lines WHERE id = l2)));
  PERFORM pg_temp.ok('H-02 HO cannot change a site line', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_delete_line(%L, %s)', l2, (SELECT version FROM public.nf_site_lines WHERE id = l2)));
  PERFORM pg_temp.ok('H-03 HO cannot delete a site line', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_submit(%L, 4000, NULL, NULL, %s)', d1, (SELECT version FROM public.nf_site_days WHERE id = d1)));
  PERFORM pg_temp.ok('H-04 HO cannot submit the site day', e LIKE 'NF:NOT_ALLOWED%', e);
  PERFORM pg_temp.as_(ud);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('H-05 a director cannot add a site line either', e LIKE 'NF:NOT_ALLOWED%', e);

  -- ── submit ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_(us);
  v := (SELECT version FROM public.nf_site_days WHERE id = d1);
  e := pg_temp.err(format('SELECT public.nf_site_submit(%L, NULL, NULL, NULL, %s)', d1, v));
  PERFORM pg_temp.ok('S-01 no submit without a cash count', e LIKE 'NF:SITE_COUNT_REQUIRED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_submit(%L, 3500, NULL, NULL, %s)', d1, v));
  PERFORM pg_temp.ok('S-02 a variance needs a reason', e LIKE 'NF:VARIANCE_REASON_REQUIRED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_submit(%L, 4000, NULL, NULL, %s)', d1, v - 1));
  PERFORM pg_temp.ok('S-03 a stale screen cannot submit', e LIKE 'NF:VERSION_CONFLICT%', e);
  e := pg_temp.err(format($$SELECT public.nf_site_submit(%L, 3000, '{"1000":4}', NULL, %s)$$, d1, v));
  PERFORM pg_temp.ok('S-04 typed count must agree with the notes', e LIKE 'NF:BAD_COUNT%', e);
  r := public.nf_site_submit(d1, NULL, '{"1000":4}'::jsonb, NULL, v);
  PERFORM pg_temp.ok('S-05 submits on the notes (4 x 1000 = book 4,000)',
    r->>'status' = 'SUBMITTED' AND (r->>'book_closing')::numeric = 4000 AND (r->>'variance')::numeric = 0, r::text);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',NULL,'OUT','Z-1','X',NULL,NULL,'52600','SITE_CASH',10,NULL,NULL,NULL,NULL)$$, co));
  PERFORM pg_temp.ok('S-06 a submitted day takes no lines', e LIKE 'NF:SITE_DAY_LOCKED%', e);
  PERFORM pg_temp.as_(ua);
  e := pg_temp.err(format('SELECT public.nf_site_reopen(%L, NULL, %s)', d1, (SELECT version FROM public.nf_site_days WHERE id = d1)));
  PERFORM pg_temp.ok('H-06 HO cannot pull a submitted day back to draft (it returns it instead)', e LIKE 'NF:NOT_ALLOWED%', e);
  PERFORM pg_temp.as_(us);

  -- the next days open from the last one's closing
  PERFORM pg_temp.ok('S-07 06-Nov (not made yet) opens at 4,000', (public.nf_site_get_day(co, '2026-11-06')->>'opening')::numeric = 4000, '');
  r := public.nf_site_save_line(co, '2026-11-06', NULL, 'OUT', 'P-2', 'Tea', NULL, NULL, '70500', 'SITE_CASH', 4000, NULL, NULL, NULL, NULL);
  d2 := (r->>'id')::uuid;
  PERFORM pg_temp.ok('S-08 06-Nov spends it all: book 0, allowed', (r->>'book_now')::numeric = 0 AND (r->>'opening')::numeric = 4000, r->>'book_now');
  r := public.nf_site_save_line(co, '2026-11-07', NULL, 'IN', 'R-3', 'Tahir', NULL, 205, '21100', 'SITE_CASH', 10000, NULL, NULL, NULL, NULL);
  d3 := (r->>'id')::uuid;
  e := pg_temp.err(format('SELECT public.nf_site_submit(%L, 10000, NULL, NULL, %s)', d3, (r->>'version')::int));
  PERFORM pg_temp.ok('S-09 07-Nov cannot be submitted while 06-Nov is still a draft', e LIKE 'NF:SITE_PREVIOUS_DAY_OPEN%', e);
  r := public.nf_site_submit(d2, 0, NULL, NULL, (SELECT version FROM public.nf_site_days WHERE id = d2));
  PERFORM pg_temp.ok('S-10 06-Nov submits', r->>'status' = 'SUBMITTED', r->>'status');

  -- ── return / reopen ────────────────────────────────────────────────────
  e := pg_temp.err(format('SELECT public.nf_site_return(%L, %L, %s)', d1, 'x', (SELECT version FROM public.nf_site_days WHERE id = d1)));
  PERFORM pg_temp.ok('T-01 site cannot return a day', e LIKE 'NF:NOT_ALLOWED%', e);
  e := pg_temp.err(format('SELECT public.nf_site_reopen(%L, NULL, %s)', d1, (SELECT version FROM public.nf_site_days WHERE id = d1)));
  PERFORM pg_temp.ok('T-02 05-Nov cannot be withdrawn while 06-Nov is submitted', e LIKE 'NF:SITE_LATER_DAY_SUBMITTED%', e);
  PERFORM pg_temp.as_(ua);
  e := pg_temp.err(format('SELECT public.nf_site_return(%L, %L, %s)', d1, ' ', (SELECT version FROM public.nf_site_days WHERE id = d1)));
  PERFORM pg_temp.ok('T-03 a return needs a reason', e LIKE 'NF:REASON_REQUIRED%', e);
  r := public.nf_site_return(d1, 'Receipt R-1 photo missing', (SELECT version FROM public.nf_site_days WHERE id = d1));
  PERFORM pg_temp.ok('T-04 HO returns 05-Nov…', r->>'status' = 'RETURNED' AND r->>'returned_reason' = 'Receipt R-1 photo missing', r->>'status');
  PERFORM pg_temp.ok('T-05 …and 06-Nov goes back with it', (SELECT status = 'RETURNED' AND returned_reason LIKE 'Returned with 05-Nov%' FROM public.nf_site_days WHERE id = d2), '');

  -- a change on 05-Nov that would leave 06-Nov below zero is refused
  PERFORM pg_temp.as_(us);
  v := (SELECT version FROM public.nf_site_lines WHERE id = l2);
  e := pg_temp.err(format($$SELECT public.nf_site_save_line(%L,'2026-11-05',%L,'OUT','P-1','Labour',NULL,NULL,'52600','SITE_CASH',11500,NULL,NULL,NULL,%s)$$, co, l2, v));
  -- 05-Nov itself would still end at 3,500, so the refusal can only be 06-Nov's
  PERFORM pg_temp.ok('T-06 an edit that would sink a LATER day is refused',
    e LIKE 'NF:SITE_CASH_NEGATIVE%' AND public._nf_site_book(co, '2026-11-05') - 500 >= 0, e);
  r := public.nf_site_submit(d1, 4000, NULL, NULL, (SELECT version FROM public.nf_site_days WHERE id = d1));
  e := pg_temp.err(format('SELECT public.nf_site_reopen(%L, %L, 0)', d1, 'forgot a line'));
  PERFORM pg_temp.ok('T-07 resubmit after return; a stale reopen is refused', r->>'status' = 'SUBMITTED' AND e LIKE 'NF:VERSION_CONFLICT%', e);
END
$t$;

-- second block: reopen, audit, withdrawals (the first block ended in a handled raise)
DO $t$
DECLARE
  co constant uuid := '${C}';
  us constant uuid := '${U.S}'; ua constant uuid := '${U.A}'; ud constant uuid := '${U.D}';
  r jsonb; e text; d1 uuid; d2 uuid; hoday uuid; n int; v int;
BEGIN
  SELECT id INTO d1 FROM public.nf_site_days WHERE company_id = co AND business_date = '2026-11-05';
  SELECT id INTO d2 FROM public.nf_site_days WHERE company_id = co AND business_date = '2026-11-06';
  PERFORM pg_temp.as_(us);
  PERFORM pg_temp.ok('T-08 05-Nov is SUBMITTED again after the return', (SELECT status FROM public.nf_site_days WHERE id = d1) = 'SUBMITTED',
                     (SELECT status FROM public.nf_site_days WHERE id = d1));
  r := public.nf_site_reopen(d1, 'forgot a line', (SELECT version FROM public.nf_site_days WHERE id = d1));
  PERFORM pg_temp.ok('T-09 the site accountant withdraws his own submission', r->>'status' = 'DRAFT', r->>'status');
  e := pg_temp.err(format('SELECT public.nf_site_reopen(%L, NULL, %s)', d2, (SELECT version FROM public.nf_site_days WHERE id = d2)));
  PERFORM pg_temp.ok('T-10 nothing to reopen on a RETURNED day', e LIKE 'NF:SITE_NOTHING_TO_REOPEN%', e);

  -- ── audit ──────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.nf_audit WHERE company_id = co AND entity = 'nf_site_lines' AND actor = us;
  PERFORM pg_temp.ok('A-01 every site line write is audited with its author', n >= 5, n::text);
  SELECT count(*) INTO n FROM public.nf_audit WHERE company_id = co AND entity = 'nf_site_days'
     AND after->>'status' = 'RETURNED' AND actor = ua;
  PERFORM pg_temp.ok('A-02 the return is audited with HO as the actor', n >= 1, n::text);

  -- ── withdrawals ────────────────────────────────────────────────────────
  PERFORM pg_temp.as_(ud);
  r := public.nf_start_first_day(co, '2026-11-05', 'DC-1', 500000, 0, 1000000);
  SELECT id INTO hoday FROM public.nf_days WHERE company_id = co AND business_date = '2026-11-05';
  r := public.nf_save_withdrawal(hoday, 'BPV-0046', 'Bank', 'Petty', 300000, '1313826265', 'Cash for the site box', '2026-11-16');
  SELECT count(*) INTO n FROM public.nf_vouchers v JOIN public.nf_voucher_legs a ON a.voucher_id = v.id AND a.account_code = '10200' AND a.debit = 300000
    JOIN public.nf_voucher_legs b ON b.voucher_id = v.id AND b.account_code = '10300' AND b.credit = 300000
   WHERE v.company_id = co AND v.manual_no = 'BPV-0046' AND v.voucher_no LIKE 'BPV-%' AND v.source = 'DAY'
     AND v.narration LIKE '%BOP chq #1313826265%';
  PERFORM pg_temp.ok('W-01 Bank -> site box posts a BPV day voucher Dr 10200 / Cr 10300, cheque in the narration', n = 1, n::text);
  r := public.nf_save_withdrawal(hoday, NULL, 'Bank', 'Cash', 100000, 'chq 1313826270', NULL, '2026-11-14');
  SELECT count(*) INTO n FROM public.nf_vouchers v JOIN public.nf_voucher_legs a ON a.voucher_id = v.id AND a.account_code = '10100' AND a.debit = 100000
   WHERE v.company_id = co AND v.narration LIKE '%#1313826270%';
  PERFORM pg_temp.ok('W-02 Bank -> Cash posts Dr 10100', n = 1, n::text);
  SELECT count(*) INTO n FROM public.nf_vouchers WHERE company_id = co AND manual_no = 'BPV-0046' AND real_date = '2026-11-16' AND voucher_date = '2026-11-05';
  PERFORM pg_temp.ok('W-11 the real date is stored (16-Nov) beside the day''s date (05-Nov)', n = 1, n::text);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 10, '1313826291', 'x', NULL)$$, hoday));
  PERFORM pg_temp.ok('W-12 the real date is required', e LIKE 'NF:REAL_DATE_REQUIRED%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 10, '1313826292', 'x', '2099-01-01')$$, hoday));
  PERFORM pg_temp.ok('W-13 the real date cannot be in the future', e LIKE 'NF:REAL_DATE_FUTURE%', e);
  PERFORM pg_temp.ok('W-14 older (Awami) vouchers keep real_date empty',
    NOT EXISTS (SELECT 1 FROM public.nf_vouchers WHERE company_id = '${AWAMI_COMPANY_ID}' AND real_date IS NOT NULL), '');
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 5000, '1313826265', 'again', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-03 the same cheque cannot be cashed twice', e LIKE 'NF:DUPLICATE_CHEQUE%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, 'BPV-0046', 'Bank', 'Cash', 5000, '1313826299', 'x', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-04 the manual BPV no is not reused', e LIKE 'NF:DUPLICATE_VOUCHER%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 900000, '1313826288', 'too much', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-05 the bank cannot go negative', e LIKE 'NF:NEGATIVE_POSITION%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Cash', 'Petty', 10, '1313826289', 'x', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-06 only from the bank', e LIKE 'NF:WITHDRAWAL_FROM_BANK_ONLY%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Bank', 10, '1313826289', 'x', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-07 only into cash or the site box', e LIKE 'NF:WITHDRAWAL_TO_CASH_OR_PETTY%', e);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 10, '', 'x', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-08 a cheque no is required', e LIKE 'NF:CHEQUE_REQUIRED%', e);
  PERFORM pg_temp.as_(us);
  e := pg_temp.err(format($$SELECT public.nf_save_withdrawal(%L, NULL, 'Bank', 'Cash', 10, '1313826290', 'x', '2026-11-16')$$, hoday));
  PERFORM pg_temp.ok('W-09 a site user cannot withdraw', e LIKE 'NF:NOT_ALLOWED%', e);
  PERFORM pg_temp.as_(ud);
  r := public.nf_get_day(co, '2026-11-05');
  PERFORM pg_temp.ok('W-10 the HO day position shows it (petty 3,00,000, bank 6,00,000)',
    r::text LIKE '%300000%' AND r::text LIKE '%600000%', left((r->'position')::text, 300));
END
$t$;

-- ── tables, under RLS, as the site user and as the accountant ──────────
SELECT pg_temp.as_('${U.S}');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('RLS-01 site: sees NO HO voucher (table read)', (SELECT count(*) FROM public.nf_vouchers WHERE company_id = '${C}') = 0,
                  (SELECT count(*) FROM public.nf_vouchers WHERE company_id = '${C}')::text);
SELECT pg_temp.ok('RLS-02 site: sees NO voucher leg / HO day / account / party',
  (SELECT count(*) FROM public.nf_voucher_legs WHERE company_id = '${C}') + (SELECT count(*) FROM public.nf_days WHERE company_id = '${C}')
  + (SELECT count(*) FROM public.nf_accounts WHERE company_id = '${C}') + (SELECT count(*) FROM public.nf_parties WHERE company_id = '${C}') = 0, '');
SELECT pg_temp.ok('RLS-03 site: sees his site days and lines',
  (SELECT count(*) FROM public.nf_site_days WHERE company_id = '${C}') = 3 AND (SELECT count(*) FROM public.nf_site_lines WHERE company_id = '${C}') >= 4, '');
SELECT pg_temp.ok('RLS-04 site: sees no other company''s site days', (SELECT count(*) FROM public.nf_site_days WHERE company_id <> '${C}') = 0, '');
SELECT pg_temp.ok('RLS-05 site: cannot write a site line directly',
  pg_temp.err($$UPDATE public.nf_site_lines SET amount = 1 WHERE company_id = '${C}'$$) LIKE '%permission denied%', '');
SELECT pg_temp.ok('RLS-06 site: cannot call nf_post_voucher', pg_temp.err($$SELECT public.nf_post_voucher(NULL,NULL,'X','2026-11-05','x',0,'[]')$$) LIKE '%permission denied%', '');
SELECT pg_temp.as_('${U.A}');
SELECT pg_temp.ok('RLS-07 accountant: still reads the vouchers', (SELECT count(*) FROM public.nf_vouchers WHERE company_id = '${C}') = 2, '');
SELECT pg_temp.ok('RLS-08 accountant: reads site days', (SELECT count(*) FROM public.nf_site_days WHERE company_id = '${C}') = 3, '');
RESET ROLE;

DO $c$
DECLARE r record; bad text := ''; n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _seen WHERE phase = 'pre') THEN
    PERFORM pg_temp.ok('X-00 before/after read sets (skipped: migration already applied)', true, '');
    RETURN;
  END IF;
  FOR r IN SELECT a.who, a.tbl, a.n pre, b.n post FROM _seen a JOIN _seen b ON b.who = a.who AND b.tbl = a.tbl AND b.phase = 'post'
            WHERE a.phase = 'pre' ORDER BY a.who, a.tbl LOOP
    n := n + 1;
    IF r.pre IS DISTINCT FROM r.post THEN bad := bad || format('%s/%s %s->%s; ', r.who, r.tbl, r.pre, r.post); END IF;
  END LOOP;
  PERFORM pg_temp.ok(format('X-01 accountant/director/viewer read exactly the same rows before and after (%s role x table pairs)', n), n > 0 AND bad = '', bad);
  PERFORM pg_temp.ok('X-02 …including Awami''s real director (reads the real vouchers)',
    (SELECT bool_and(x.n > 0) FROM _seen x WHERE x.phase = 'post' AND x.who LIKE 'awami-%' AND x.tbl = 'nf_vouchers'), '');
END
$c$;

DO $f$
DECLARE s text; p int; f int;
BEGIN
  SELECT string_agg((CASE WHEN pass THEN 'PASS ' ELSE 'FAIL ' END) || id || CASE WHEN pass THEN '' ELSE '  ' || left(COALESCE(detail,''), 300) END, E'\n' ORDER BY n),
         count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass)
    INTO s, p, f FROM _r;
  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', p, f, E'\n' || s;
END
$f$;
`;

(async () => {
  console.log(`[verify-nf-site-closing-stage1] project ${REF} · run ${run} · migration ${APPLIED ? 'already applied' : 'inside the transaction'}`);
  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed:\n' + built.failures.join('\n')); process.exitCode = 2; return; }
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = Object.entries(U).map(([k, id]) =>
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nf-site1-${k.toLowerCase()}-${run}@zztest-nf.invalid', '', now(), now(), now());`).join('\n');
  // the site member can only exist once the migration has run
  const members = `INSERT INTO public.nf_members (company_id, user_id, role, display_name, active) VALUES
    ('${C}','${U.A}','accountant','HO Accountant',true), ('${C}','${U.D}','director','Director',true),
    ('${C}','${U.V}','viewer','Viewer',true);`;
  const siteMember = `SELECT pg_temp.as_('${U.D}');  -- a director adds members
INSERT INTO public.nf_members (company_id, user_id, role, display_name, active) VALUES ('${C}','${U.S}','site','Site Accountant',true);`;
  const aw = await q(`select user_id, role from nf_members where company_id = '${AWAMI_COMPANY_ID}' and active and role in ('director','accountant','viewer')`);
  const who = [...aw.map(m => ['awami-' + m.role, m.user_id]), ['test-accountant', U.A], ['test-director', U.D], ['test-viewer', U.V]];
  const tables = "ARRAY['nf_accounts','nf_audit','nf_days','nf_floors','nf_iif_batch_vouchers','nf_iif_batches','nf_members','nf_parties','nf_party_aliases','nf_pdcs','nf_report_categories','nf_settings','nf_voucher_counters','nf_voucher_legs','nf_vouchers']";
  const snap = ph => who.map(([w, u]) => `SELECT pg_temp.seen('${ph}', '${w}', '${u}');`).join('\n');
  const pre = PRE.split('${TABLES}').join(tables).split('${SNAP_PRE}').join(APPLIED ? '' : snap('pre'));
  console.log('  read-set compared for:', who.map(w => w[0]).join(', '));
  const sql = ['BEGIN;',
    `INSERT INTO public.companies (id, company_code, company_name) VALUES ('${C}', 'ZZSITE${run}', 'ZZTEST-NF-SITE-${run}');`,
    seedSql(C, built.seed), users, members, pre,
    APPLIED ? '' : fs.readFileSync(MIG, 'utf8'),
    APPLIED ? '' : snap('post'),
    siteMember, PLUS ? fs.readFileSync(PLUS, 'utf8') : '', TESTS].join('\n');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const msg = res.ok ? 'NO EXCEPTION — the transaction did not roll back; check for leftovers' : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  const out = m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/"\}$/, '') : msg;
  console.log(out);
  const left = await q(`select (select count(*) from companies where id = '${C}') co, (select count(*) from auth.users where email like '%-${run}@zztest-nf.invalid') users,
                               (select count(*) from pg_proc where proname = 'nf_site_save_line') fn_live`);
  console.log('after rollback:', JSON.stringify(left));
  const f = /pass=(\d+) fail=(\d+)/.exec(out);
  process.exitCode = !f ? 2 : Number(f[2]) === 0 ? 0 : 1;
})().catch(e => { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; });
