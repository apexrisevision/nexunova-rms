#!/usr/bin/env node
/* Dry run of 20261012a_sale_approval_form.sql against the live RMS database.

   The migration and the database tests go up as ONE request — one transaction
   — and the test block ends with RAISE EXCEPTION carrying the results, so the
   whole thing rolls back: no table, no function, no flag, no test row is left
   behind. Afterwards this script checks that sale_approval_forms does not
   exist, so "rolled back" is measured, not assumed.

   Usage: node scripts/dryrun-saf.js            (prints the result lines)        */
const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20261012a_sale_approval_form.sql');

const TESTS = String.raw`
DO $t$
DECLARE
  co  constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  rT  constant text := 'saf_dry_rashid';  aT constant text := 'saf_dry_accounts';  nT constant text := 'saf_dry_naeem';
  u1  uuid; u2 uuid; u3 uuid; res jsonb; s jsonb; id1 uuid; id2 uuid; out text := ''; ok int := 0; bad int := 0;
  led jsonb; v_dir uuid := '67f8f136-802a-4235-8785-c9151f666644'; v_sale uuid; v_err text; v_n int;
BEGIN
  INSERT INTO sales_sessions (company_id, sales_user_id, session_token) VALUES
    (co, '015effd0-7ac7-4939-a1b3-dd2826ab8fba', rT),
    (co, 'c94705b2-842b-48a9-801d-c373044974cd', aT),
    (co, '67f8f136-802a-4235-8785-c9151f666644', nT);
  SELECT id INTO u1 FROM units WHERE company_id = co AND unit_no = 'LG-01';

  -- 1. unit + money come from the source
  res := saf_new(rT, u1); s := res->'saf'; id1 := (s->>'id')::uuid;
  SELECT e INTO led FROM jsonb_array_elements(_nf_token_ledger_body(co, NULL, NULL)->'units') e WHERE e->>'unit_code' = 'LG-01';
  IF (s->>'base_price')::numeric = (SELECT base_price FROM units WHERE id = u1)
     AND (s->>'rate_per_sqft')::numeric = round((SELECT base_price/area FROM units WHERE id = u1), 2)
     AND (s->>'total_received')::numeric = (led->>'net')::numeric
     AND jsonb_array_length(s->'receipts') = jsonb_array_length(led->'lines')
  THEN ok := ok + 1; out := out || E'\nT1 PASS ' || (s->>'saf_no') || ' base ' || (s->>'base_price') || ' rate ' || (s->>'rate_per_sqft')
                         || ' received ' || (s->>'total_received') || ' lines ' || jsonb_array_length(s->'receipts')
                         || ' buyer ' || coalesce(s->>'buyer_name','-') || ' agent ' || coalesce(s->>'agent_name','-');
  ELSE bad := bad + 1; out := out || E'\nT1 FAIL ' || s::text; END IF;

  -- 2. dp_balance
  IF (s->>'dp_balance')::numeric = (s->>'dp_amount')::numeric - (s->>'total_received')::numeric
     AND (s->>'dp_amount')::numeric = round((s->>'net_price')::numeric * 0.30, 0)
  THEN ok := ok + 1; out := out || E'\nT2 PASS dp ' || (s->>'dp_amount') || ' - received ' || (s->>'total_received') || ' = ' || (s->>'dp_balance');
  ELSE bad := bad + 1; out := out || E'\nT2 FAIL dp ' || (s->>'dp_amount') || ' bal ' || (s->>'dp_balance'); END IF;

  -- 3a. missing CNIC refused
  PERFORM saf_save(rT, id1, jsonb_build_object('buyer_relation','S/O','buyer_father','Test Father','buyer_phone','03001234567'));
  res := saf_submit(rT, id1);
  IF res->>'error' = 'incomplete' AND res::text LIKE '%13 digits%' THEN ok := ok + 1; out := out || E'\nT3a PASS missing CNIC: ' || (res->>'message');
  ELSE bad := bad + 1; out := out || E'\nT3a FAIL ' || res::text; END IF;
  -- 3b. custom schedule total != net refused
  PERFORM saf_save(rT, id1, jsonb_build_object('buyer_cnic','17301-1234567-1','plan_type','custom',
            'schedule_json', jsonb_build_array(jsonb_build_object('installment_number',0,'installment_type','down_payment','due_date','2026-10-12','amount_due',1000))));
  res := saf_submit(rT, id1);
  IF res->>'error' = 'incomplete' AND res::text LIKE '%schedule adds up%' THEN ok := ok + 1; out := out || E'\nT3b PASS short schedule: ' || (res->>'message');
  ELSE bad := bad + 1; out := out || E'\nT3b FAIL ' || res::text; END IF;

  -- 4. discount beyond the plan: refused without a director, flagged with one
  res := saf_save(rT, id1, jsonb_build_object('plan_type','full_100','discount_amount', round((s->>'base_price')::numeric * 0.15, 0),
                                             'discount_reason','Test: bulk buyer'));
  res := saf_submit(rT, id1);
  IF res->>'error' = 'incomplete' AND res::text LIKE '%director%' THEN ok := ok + 1; out := out || E'\nT4a PASS 15% on a 10% plan, no director: refused';
  ELSE bad := bad + 1; out := out || E'\nT4a FAIL ' || res::text; END IF;
  res := saf_save(rT, id1, jsonb_build_object('discount_approved_by', v_dir));
  IF (res->'saf'->>'discount_beyond_standard')::boolean AND res->'saf'->'flags'->>0 LIKE 'Discount beyond%'
  THEN ok := ok + 1; out := out || E'\nT4b PASS with director ' || (res->'saf'->>'discount_approved_by_name') || ', flag: ' || (res->'saf'->'flags'->>0);
  ELSE bad := bad + 1; out := out || E'\nT4b FAIL ' || res::text; END IF;

  -- 5. submit -> verify (Accounts) -> approve (Rashid); lock; supersede
  res := saf_submit(rT, id1);
  IF res->>'success' <> 'true' THEN bad := bad + 1; out := out || E'\nT5 submit FAIL ' || res::text; END IF;
  res := saf_approve(rT, id1);
  IF res->>'error' = 'not_verified' THEN ok := ok + 1; out := out || E'\nT5a PASS approve before Accounts: refused';
  ELSE bad := bad + 1; out := out || E'\nT5a FAIL ' || res::text; END IF;
  res := saf_verify(nT, id1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nT5b PASS a director cannot verify';
  ELSE bad := bad + 1; out := out || E'\nT5b FAIL ' || res::text; END IF;
  res := saf_verify(aT, id1);
  IF res->>'success' <> 'true' THEN bad := bad + 1; out := out || E'\nT5 verify FAIL ' || res::text; END IF;
  res := saf_approve(nT, id1);
  IF res->>'error' = 'forbidden' THEN ok := ok + 1; out := out || E'\nT5c PASS Naeem cannot approve';
  ELSE bad := bad + 1; out := out || E'\nT5c FAIL ' || res::text; END IF;
  res := saf_approve(rT, id1);
  IF res->>'success' = 'true' AND length(res->'saf'->>'snapshot_hash') = 64
     AND res->'saf'->>'snapshot_hash' = encode(sha256(convert_to((res->'saf'->'snapshot')::text,'UTF8')),'hex')
  THEN ok := ok + 1; out := out || E'\nT5d PASS approved, hash ' || left(res->'saf'->>'snapshot_hash', 16) || '...';
  ELSE bad := bad + 1; out := out || E'\nT5d FAIL ' || res::text; END IF;
  BEGIN
    UPDATE sale_approval_forms SET net_price = net_price - 1 WHERE id = id1;
    bad := bad + 1; out := out || E'\nT5e FAIL direct UPDATE of an approved SAF went through';
  EXCEPTION WHEN OTHERS THEN ok := ok + 1; out := out || E'\nT5e PASS direct UPDATE refused: ' || SQLERRM; END;
  res := saf_supersede(rT, id1); id2 := (res->'saf'->>'id')::uuid;
  PERFORM saf_save(rT, id2, jsonb_build_object('plan_type','standard','discount_amount',0,'discount_reason',NULL));
  PERFORM saf_submit(rT, id2); PERFORM saf_verify(aT, id2); res := saf_approve(rT, id2);
  IF res->>'success' = 'true' AND (SELECT status FROM sale_approval_forms WHERE id = id1) = 'superseded'
     AND (SELECT superseded_by FROM sale_approval_forms WHERE id = id1) = id2
  THEN ok := ok + 1; out := out || E'\nT5f PASS ' || (res->'saf'->>'saf_no') || ' approved, ' || (SELECT saf_no FROM sale_approval_forms WHERE id = id1) || ' now SUPERSEDED';
  ELSE bad := bad + 1; out := out || E'\nT5f FAIL ' || res::text; END IF;

  -- 6. sale: refused without a SAF, made from one with its numbers
  SELECT id INTO u2 FROM units u WHERE company_id = co AND unit_no = '5F-596';
  res := _create_sale_with_schedule_core(jsonb_build_object('company_id', co, 'unit_id', u2, 'client_id', gen_random_uuid(),
           'price_per_sqft', 11000, 'area_sqft', 577.8, 'down_payment', 0), '[]'::jsonb);
  IF res->>'error' = 'saf_required' THEN ok := ok + 1; out := out || E'\nT6a PASS sale without SAF: saf_required';
  ELSE bad := bad + 1; out := out || E'\nT6a FAIL ' || res::text; END IF;
  res := saf_create_sale(rT, id2); v_sale := (res->>'sale_id')::uuid;
  IF res->>'success' = 'true'
     AND (SELECT saf_id FROM sales WHERE id = v_sale) = id2
     AND (SELECT price_per_sqft*area_sqft - discount FROM sales WHERE id = v_sale) = (SELECT net_price FROM sale_approval_forms WHERE id = id2)
     AND (SELECT down_payment FROM sales WHERE id = v_sale) = (SELECT dp_amount FROM sale_approval_forms WHERE id = id2)
     AND (SELECT count(*) FROM installments WHERE sale_id = v_sale) = (SELECT jsonb_array_length(schedule_json) FROM sale_approval_forms WHERE id = id2)
     AND (SELECT sum(amount_due) FROM installments WHERE sale_id = v_sale) = (SELECT net_price FROM sale_approval_forms WHERE id = id2)
     AND (SELECT commission_rate FROM sales WHERE id = v_sale) IS NOT DISTINCT FROM (SELECT commission_pct FROM sale_approval_forms WHERE id = id2)
  THEN ok := ok + 1; out := out || E'\nT6b PASS ' || (res->>'sale_number') || ' = ' || (res->>'saf_no') || ' (net, DP, '
                         || (SELECT count(*) FROM installments WHERE sale_id = v_sale) || ' installments, commission), unit now '
                         || (SELECT cs.status_name FROM units u JOIN category_unit_statuses cs ON cs.id = u.status_id WHERE u.id = u1);
  ELSE bad := bad + 1; out := out || E'\nT6b FAIL ' || res::text; END IF;

  -- 7. Sold by direct SQL with no buyer / agent
  SELECT u.id INTO u3 FROM units u JOIN category_unit_statuses cs ON cs.id = u.status_id
   WHERE u.company_id = co AND cs.is_available AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status = 'active') LIMIT 1;
  BEGIN
    UPDATE units SET status_id = (SELECT id FROM category_unit_statuses WHERE company_id = co AND status_code = 'SOLD_ENTRY_PENDING') WHERE id = u3;
    bad := bad + 1; out := out || E'\nT7 FAIL a free unit went to Sold - Entry Pending with nobody on it';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = PG_EXCEPTION_DETAIL;
    IF v_err = 'sold_needs_buyer_and_agent' THEN ok := ok + 1; out := out || E'\nT7 PASS ' || SQLERRM;
    ELSE bad := bad + 1; out := out || E'\nT7 FAIL other error ' || SQLERRM; END IF;
  END;
  -- 7b. FMH untouched: the same move on another company is not checked
  out := out || E'\nT7b flag on for FMH? ' || _saf_on((SELECT company_id FROM units WHERE company_id <> co LIMIT 1))::text;

  -- 8. audit names
  SELECT count(*) INTO v_n FROM audit_logs WHERE table_name = 'sale_approval_forms' AND changed_by_name IN ('system','unknown')
     AND record_id IN (id1::text, id2::text);
  out := out || E'\nT8 audit rows: ' || (SELECT string_agg(DISTINCT changed_by_name, ', ') FROM audit_logs WHERE table_name = 'sale_approval_forms' AND record_id IN (id1::text, id2::text))
             || ' | rows named system: ' || v_n;
  IF v_n = 0 THEN ok := ok + 1; ELSE bad := bad + 1; END IF;

  -- security: the tables are closed to the public key
  out := out || E'\nSEC anon SELECT saf table: ' || has_table_privilege('anon', 'public.sale_approval_forms', 'SELECT')::text
             || ', RLS ' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_approval_forms'::regclass)::text
             || ', anon EXECUTE _saf_compute: ' || has_function_privilege('anon', 'public._saf_compute(jsonb)', 'EXECUTE')::text
             || ', anon EXECUTE saf_new: ' || has_function_privilege('anon', 'public.saf_new(text,uuid)', 'EXECUTE')::text;

  RAISE EXCEPTION 'DRYRUN_RESULT pass=% fail=% %', ok, bad, out;
END
$t$;
`;

(async () => {
  console.log('project', REF);
  const sql = 'BEGIN;\n' + fs.readFileSync(MIG, 'utf8') + '\n' + TESTS;
  // _sbq.q cuts an error body at 500 characters; the result IS the error here
  const { TOKEN } = require('./_sbq');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const msg = res.ok ? 'NO EXCEPTION — the test block did not raise; check the database for leftovers'
                     : await res.text();
  const m = msg.match(/DRYRUN_RESULT[\s\S]*/);
  console.log(m ? m[0].replace(/\\n/g, '\n').replace(/\\"/g, '"') : msg);
  const left = await q(`select to_regclass('public.sale_approval_forms') t,
      (select count(*) from company_feature_flags where feature_key='sale_approval_form') flags,
      (select count(*) from information_schema.columns where table_name='sales' and column_name='saf_id') col,
      (select count(*) from sales_sessions where session_token like 'saf_dry_%') sessions`);
  console.log('after rollback:', JSON.stringify(left));
})();
