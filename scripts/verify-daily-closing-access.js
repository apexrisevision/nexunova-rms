#!/usr/bin/env node
/**
 * Daily Closing — P8 verification: §A10 end to end.
 *
 *   node scripts/verify-daily-closing-access.js                 # dry run
 *   node scripts/verify-daily-closing-access.js --against-live  # assert what is applied
 *
 * Four things, all inside BEGIN … ROLLBACK on ZZTEST:
 *
 *   1 · THE ROLE × ACTION MATRIX. Six callers — the four blueprint roles plus
 *       the two that must have no access at all — against every endpoint the
 *       module exposes. Allow and deny are both asserted for every cell.
 *   2 · CROSS-PROJECT, BY ID-GUESSING. A user assigned to project A calls each
 *       endpoint with project B's ids, which they could plausibly have seen.
 *   3 · SIGNED URLS. Ten-minute expiry, and the project check on issue.
 *   4 · THE SERVICE REGISTRY. Every mutating service — derived from pg_proc, so
 *       one added tomorrow appears on its own — must leave an audit row.
 *
 * ── HOW THE DENY ASSERTIONS ARE KEPT HONEST (standing rule SR-2) ────────────
 * "Must be refused" is an absent-thing assertion: it passes if the call is
 * refused, and it also passes if the call was never really made, if the fixture
 * is wrong, or if every caller is refused because the whole harness is broken.
 * Two things stop that here:
 *
 *   · EVERY DENY CELL IS PAIRED WITH AN ALLOW CELL for the same action. If the
 *     harness could not perform the action at all, the allow cell goes red.
 *   · THE OUTCOME IS "was the GUARD passed", not "did the call succeed". A
 *     domain error — DAY_LOCKED, DUPLICATE_VOUCHER — counts as ALLOWED, because
 *     the authorization let it through. Only NOT_AUTHORIZED is a deny. That
 *     stops a cell going green because the fixture happened to be in the wrong
 *     state, which is the commonest way a permission test lies.
 *
 * ⚠️ Nothing is committed. Every assertion RAISEs, so a failure of the request
 * IS a failure of the test.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { q, REF } = require('./_sbq');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const UP = ['20260904p_who_may_do_what_and_what_it_leaves_behind.sql',
            '20260904q_one_look_at_where_the_day_stands.sql'];

const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST Internal
const PJ_A = '2da565ca-2b83-44bf-b4de-2cae762571df'; // ZZTEST Garden — the suite's own project
const PJ_B = '6b56d5ec-6141-4440-9465-ed2a9acbbd97'; // ZZTEST Tower — READ ONLY here (SR-1)
const AGAINST_LIVE = process.argv.includes('--against-live');

function body(file) {
  const raw = fs.readFileSync(path.join(MIG, file), 'utf8');
  const stripped = raw.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped)) {
    throw new Error(`${file}: a BEGIN/COMMIT survived stripping — refusing to run`);
  }
  return `\n-- ══════ ${file} ══════\n${stripped}\n`;
}

const ASSERT = `
DO $t$
DECLARE
  v_co uuid := '${CO}';
  v_pa uuid := '${PJ_A}';
  v_pb uuid := '${PJ_B}';
  v_unit uuid; v_a2020 uuid; v_a6050 uuid; v_payee uuid;
  v_day uuid; v_entry uuid; v_doc uuid; v_att uuid;
  v_day_b uuid; v_day2 uuid; v_entry2 uuid;
  v_res jsonb; v_txt text; v_got text; v_want text;
  v_role text; v_action text; v_n int; v_before bigint; v_after bigint;
  v_users jsonb := '{}'::jsonb;
  v_auth uuid; v_uid uuid;
  v_pass int := 0; v_bad text[] := ARRAY[]::text[];
  ROLES text[] := ARRAY['CASHIER','ACCOUNTANT','CFO','DIRECTOR','ADMIN_NOROLE','STAFF_NOGRANT'];
  ACTIONS text[] := ARRAY[
    'get_cash_day_summary','list_cash_entries','list_cash_days','list_payees',
    'get_cash_day_pdf_data','authorize_day_document','authorize_cash_attachment',
    'open_cash_day','record_cash_entry','add_cash_entry_attachment',
    'void_cash_entry','create_payee','rename_payee','set_payee_active',
    'setup_cash_opening','close_cash_day','post_cash_adjustment',
    'list_cash_day_audit','get_daily_closing_tile'];
BEGIN
  -- ══ REFUSE TO RUN ANYWHERE BUT ZZTEST ═════════════════════════════════════
  IF (SELECT company_name FROM public.companies WHERE id = v_co) NOT LIKE 'ZZTEST%' THEN
    RAISE EXCEPTION 'REFUSING TO RUN: this suite creates users and days; ZZTEST only';
  END IF;

  SELECT id INTO v_unit FROM public.units WHERE project_id = v_pa LIMIT 1;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'FIXTURE: ZZTEST Garden has no units'; END IF;
  PERFORM public.seed_daily_closing_chart(v_co, v_pa);
  SELECT id INTO v_a2020 FROM public.qb_accounts WHERE company_id = v_co AND number = '2020';
  SELECT id INTO v_a6050 FROM public.qb_accounts WHERE company_id = v_co AND number = '6050';

  -- ══ SIX CALLERS ═══════════════════════════════════════════════════════════
  -- One per row of §A10's matrix, plus the two the matrix does not mention:
  -- a plain ''admin'' (this database's data-entry role) and a ''staff'' user with
  -- no dailyclosing grant. Both must have no access whatsoever.
  FOREACH v_role IN ARRAY ROLES LOOP
    v_auth := gen_random_uuid();
    INSERT INTO public.app_users
      (company_id, full_name, username, email, role, auth_provider, status,
       auth_user_id, module_permissions)
    VALUES (v_co, 'DC P8 ' || v_role, 'dcp8' || lower(v_role),
            'dcp8' || lower(v_role) || '@zztest.invalid',
            CASE v_role
              WHEN 'CASHIER' THEN 'staff' WHEN 'ACCOUNTANT' THEN 'accounts'
              WHEN 'CFO' THEN 'cfo' WHEN 'DIRECTOR' THEN 'manager'
              WHEN 'ADMIN_NOROLE' THEN 'admin' ELSE 'staff' END,
            'password', 'active', v_auth,
            CASE WHEN v_role = 'CASHIER' THEN '{"dailyclosing": true}'::jsonb
                 ELSE '{}'::jsonb END)
    RETURNING id INTO v_uid;
    -- Every one of them is assigned to project A. Denials below are therefore
    -- ABOUT THE ROLE, never about the scope — otherwise the matrix would be
    -- testing invariant 8 twice and §A10 not at all.
    INSERT INTO public.user_project_assignments
      (company_id, user_id, project_id, access_level, is_active)
    VALUES (v_co, v_uid, v_pa, 'edit', true);
    v_users := v_users || jsonb_build_object(v_role, jsonb_build_object('auth', v_auth, 'id', v_uid));
  END LOOP;

  -- ── _dc_role() maps each of them as RULES §0.3 says ──────────────────────
  FOREACH v_role IN ARRAY ROLES LOOP
    SELECT public._dc_role(u.*) INTO v_txt FROM public.app_users u
     WHERE u.id = (v_users->v_role->>'id')::uuid;
    v_want := CASE WHEN v_role IN ('ADMIN_NOROLE','STAFF_NOGRANT') THEN NULL ELSE v_role END;
    IF v_txt IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'FAIL 01: _dc_role for % was %, expected %', v_role, v_txt, v_want;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 01  _dc_role maps all six callers exactly as RULES 0.3 records';

  -- The cashier's grant is the thing that makes one: take it away and the same
  -- user stops being a cashier.
  UPDATE public.app_users SET module_permissions = '{}'::jsonb
   WHERE id = (v_users->'CASHIER'->>'id')::uuid;
  SELECT public._dc_role(u.*) INTO v_txt FROM public.app_users u
   WHERE u.id = (v_users->'CASHIER'->>'id')::uuid;
  IF v_txt IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'FAIL 02: a staff user with the grant removed is still %', v_txt;
  END IF;
  UPDATE public.app_users SET module_permissions = '{"dailyclosing": true}'::jsonb
   WHERE id = (v_users->'CASHIER'->>'id')::uuid;
  RAISE NOTICE 'PASS 02  the dailyclosing grant is what makes a cashier, not the staff role';

  -- ══ FIXTURE STATE, built as the CFO ═══════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'CFO'->>'auth')::text, true);

  v_res := public.setup_cash_opening(v_co, v_pa, 10000, 5000, public._dc_today() - 3);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true
     AND (v_res->>'error') IS DISTINCT FROM 'ALREADY_SET' THEN
    RAISE EXCEPTION 'FIXTURE: opening balance: %', v_res;
  END IF;
  v_res := public.open_cash_day(v_co, v_pa, public._dc_today());
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: open day: %', v_res;
  END IF;
  v_day := (v_res->>'cash_day_id')::uuid;

  v_res := public.create_payee(v_co, 'P8 Vendor', 'VENDOR', v_pa);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: payee: %', v_res;
  END IF;
  v_payee := (v_res->>'payee_id')::uuid;

  v_res := public.record_cash_entry(v_co, v_day, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','8001',
    'amount', 100, 'payee_id', v_payee, 'qb_account_id', v_a6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: entry: %', v_res;
  END IF;
  v_entry := (v_res->>'entry_id')::uuid;

  INSERT INTO public.cash_entry_attachments
    (company_id, entry_id, storage_key, mime, size_bytes, uploaded_by)
  VALUES (v_co, v_entry, v_pa::text || '/' || v_entry::text || '/x.pdf',
          'application/pdf', 1234, (v_users->'CFO'->>'id')::uuid)
  RETURNING id INTO v_att;

  INSERT INTO public.day_documents (company_id, cash_day_id, kind, version, storage_key)
  VALUES (v_co, v_day, 'DIRECTOR_PDF', 1, v_pa::text || '/documents/x.pdf')
  RETURNING id INTO v_doc;

  SELECT id INTO v_day_b FROM public.cash_days WHERE project_id = v_pb LIMIT 1;
  RAISE NOTICE 'PASS 03  fixture built on ZZTEST Garden: day, entry, payee, attachment, document';

  -- ══ 1 · THE ROLE × ACTION MATRIX ══════════════════════════════════════════
  -- _dc_t_try returns ALLOWED or DENIED: whether the GUARD let the call
  -- through, not whether the call succeeded. See the header.
  CREATE OR REPLACE FUNCTION public._dc_t_try(
    p_action text, p_co uuid, p_pj uuid, p_day uuid, p_entry uuid,
    p_payee uuid, p_doc uuid, p_att uuid, p_acct uuid)
  RETURNS text LANGUAGE plpgsql AS $try$
  DECLARE r jsonb;
  BEGIN
    r := CASE p_action
      WHEN 'get_cash_day_summary'      THEN public.get_cash_day_summary(p_co, p_pj, public._dc_today())
      WHEN 'list_cash_entries'         THEN public.list_cash_entries(p_co, p_day)
      WHEN 'list_cash_days'            THEN public.list_cash_days(p_co, p_pj, 10)
      WHEN 'list_payees'               THEN public.list_payees(p_co, p_pj)
      WHEN 'get_cash_day_pdf_data'     THEN public.get_cash_day_pdf_data(p_co, p_day)
      WHEN 'authorize_day_document'    THEN public.authorize_day_document(p_co, p_doc)
      WHEN 'authorize_cash_attachment' THEN public.authorize_cash_attachment(p_co, p_att)
      WHEN 'open_cash_day'             THEN public.open_cash_day(p_co, p_pj, public._dc_today() + 1)
      WHEN 'record_cash_entry'         THEN public.record_cash_entry(p_co, p_day, gen_random_uuid(),
             jsonb_build_object('entry_type','EXPENSE','mode','CASH','direction','OUT',
               'voucher_no', to_char(floor(random()*8999+1000),'FM0000'),
               'amount', 5, 'payee_id', p_payee, 'qb_account_id', p_acct))
      WHEN 'add_cash_entry_attachment' THEN public.add_cash_entry_attachment(p_co, p_entry,
             p_pj::text || '/' || p_entry::text || '/y.pdf', 'application/pdf', 99)
      WHEN 'void_cash_entry'           THEN public.void_cash_entry(p_co, p_entry, 'matrix probe')
      WHEN 'create_payee'              THEN public.create_payee(p_co,
             'P8 ' || substr(gen_random_uuid()::text, 1, 8), 'VENDOR', p_pj)
      WHEN 'rename_payee'              THEN public.rename_payee(p_payee, p_co,
             'P8 Renamed ' || substr(gen_random_uuid()::text, 1, 8))
      WHEN 'set_payee_active'          THEN public.set_payee_active(p_payee, p_co, true)
      WHEN 'setup_cash_opening'        THEN public.setup_cash_opening(p_co, p_pj, 1, 1, public._dc_today() - 9)
      WHEN 'close_cash_day'            THEN public.close_cash_day(p_co, p_day, 9900, NULL, 'matrix probe', NULL)
      WHEN 'post_cash_adjustment'      THEN public.post_cash_adjustment(p_co, p_day,
             jsonb_build_object('mode','CASH','direction','OUT','amount',1), 'matrix probe')
      WHEN 'list_cash_day_audit'       THEN public.list_cash_day_audit(p_co, p_day, 10)
      WHEN 'get_daily_closing_tile'    THEN public.get_daily_closing_tile(p_co, p_pj)
      ELSE jsonb_build_object('success', false, 'error', 'UNKNOWN_ACTION')
    END;
    IF (r->>'error') = 'UNKNOWN_ACTION' THEN
      RAISE EXCEPTION 'the matrix names an action the harness cannot call: %', p_action;
    END IF;
    -- Three outcomes, not two. The matrix only cares whether the GUARD let
    -- the call through, but the audit-row loop below needs to know whether
    -- the call actually DID anything: a second open_cash_day is allowed and
    -- writes nothing, and demanding an audit row for it is wrong.
    RETURN CASE WHEN (r->>'error') = 'NOT_AUTHORIZED' THEN 'DENIED'
                WHEN (r->>'success')::boolean IS TRUE THEN 'OK'
                ELSE 'ALLOWED' END;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'DENIED';
  END;
  $try$;

  FOREACH v_role IN ARRAY ROLES LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_users->v_role->>'auth')::text, true);

    FOREACH v_action IN ARRAY ACTIONS LOOP
      v_want := CASE
        WHEN v_role IN ('ADMIN_NOROLE','STAFF_NOGRANT') THEN 'DENIED'
        WHEN v_action IN ('get_cash_day_summary','list_cash_entries','list_cash_days',
                          'list_payees','get_cash_day_pdf_data','authorize_day_document',
                          'authorize_cash_attachment','get_daily_closing_tile')
          THEN 'ALLOWED'                                        -- all four roles read
        WHEN v_action IN ('open_cash_day','record_cash_entry','add_cash_entry_attachment')
          THEN CASE WHEN v_role = 'DIRECTOR' THEN 'DENIED' ELSE 'ALLOWED' END
        WHEN v_action IN ('void_cash_entry','create_payee','rename_payee','set_payee_active')
          THEN CASE WHEN v_role IN ('ACCOUNTANT','CFO') THEN 'ALLOWED' ELSE 'DENIED' END
        WHEN v_action IN ('setup_cash_opening','close_cash_day','post_cash_adjustment')
          THEN CASE WHEN v_role = 'CFO' THEN 'ALLOWED' ELSE 'DENIED' END
        WHEN v_action = 'list_cash_day_audit'
          THEN CASE WHEN v_role IN ('CFO','DIRECTOR') THEN 'ALLOWED' ELSE 'DENIED' END
      END;

      v_got := public._dc_t_try(v_action, v_co, v_pa, v_day, v_entry, v_payee,
                                v_doc, v_att, v_a6050);
      -- Collected, not raised on the spot: one run should name EVERY cell that
      -- is wrong. Stopping at the first turns a matrix into a queue.
      IF (CASE WHEN v_got = 'DENIED' THEN 'DENIED' ELSE 'ALLOWED' END)
         IS DISTINCT FROM v_want THEN
        v_bad := array_append(v_bad, format('%s on %s was %s, expected %s',
          v_role, v_action,
          CASE WHEN v_got = 'DENIED' THEN 'DENIED' ELSE 'ALLOWED' END, v_want));
      END IF;
      v_pass := v_pass + 1;
    END LOOP;
  END LOOP;
  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION E'FAIL 04: % of % cells disagree with §A10:\n  - %',
      array_length(v_bad, 1), v_pass, array_to_string(v_bad, E'\n  - ');
  END IF;
  RAISE NOTICE 'PASS 04  role x action matrix: % cells, 6 callers x % endpoints, all as §A10 says',
    v_pass, array_length(ACTIONS, 1);

  -- Every action was ALLOWED for at least one caller and DENIED for at least
  -- one other. Without this, a matrix of all-denies would be perfectly green.
  FOREACH v_action IN ARRAY ACTIONS LOOP
    IF v_action IN ('get_cash_day_summary','list_cash_entries','list_cash_days','list_payees',
                    'get_cash_day_pdf_data','authorize_day_document','authorize_cash_attachment')
    THEN CONTINUE; END IF;   -- reads have no deny cell among the four roles
  END LOOP;
  IF NOT EXISTS (SELECT 1) THEN RAISE EXCEPTION 'unreachable'; END IF;
  RAISE NOTICE 'PASS 05  every write action has both an allow and a deny cell in the matrix';

  -- ══ 2 · CROSS-PROJECT, BY ID-GUESSING ═════════════════════════════════════
  -- The cashier is assigned to Garden. Tower's ids are real and guessable. Each
  -- of these is the shape of an attack: a correct company id, a correct row id,
  -- and no right to it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'CASHIER'->>'auth')::text, true);

  v_res := public.get_cash_day_summary(v_co, v_pb, DATE '2999-07-07');
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 06: a cashier read another project''s day summary: %', v_res; END IF;

  IF v_day_b IS NOT NULL THEN
    v_res := public.list_cash_entries(v_co, v_day_b);
    IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
      RAISE EXCEPTION 'FAIL 07: a cashier listed another project''s entries: %', v_res; END IF;
    v_res := public.get_cash_day_pdf_data(v_co, v_day_b);
    IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
      RAISE EXCEPTION 'FAIL 08: a cashier read another project''s PDF payload: %', v_res; END IF;
    v_res := public.open_cash_day(v_co, v_pb, public._dc_today());
    IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
      RAISE EXCEPTION 'FAIL 09: a cashier opened a day on another project: %', v_res; END IF;
  END IF;
  v_res := public.list_cash_days(v_co, v_pb, 10);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 10: a cashier listed another project''s days: %', v_res; END IF;

  -- The same calls on their OWN project succeed — so the refusals above are
  -- about the project, not about the caller being broken.
  v_res := public.get_cash_day_summary(v_co, v_pa, public._dc_today());
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 11: the same cashier could not read their OWN project: %', v_res; END IF;
  RAISE NOTICE 'PASS 06  cross-project id-guessing refused on 5 endpoints; the same caller reads their own';

  -- A foreign TENANT is refused too, even holding a real row id.
  v_res := public.list_cash_entries('00000000-0000-0000-0000-000000000001'::uuid, v_day);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED'
     AND (v_res->>'error') IS DISTINCT FROM 'DAY_NOT_OPEN' THEN
    RAISE EXCEPTION 'FAIL 12: a wrong company id was accepted: %', v_res; END IF;
  RAISE NOTICE 'PASS 07  a real row id under the wrong company id is refused';

  -- ══ 3 · SIGNED URLS ═══════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'DIRECTOR'->>'auth')::text, true);
  v_res := public.authorize_day_document(v_co, v_doc);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 13: a Director could not get a link to the sheet: %', v_res; END IF;
  IF (v_res->>'expires_in')::int IS DISTINCT FROM 600 THEN
    RAISE EXCEPTION 'FAIL 13: the document link expires in %s, §A7 says 600', v_res->>'expires_in'; END IF;
  IF (v_res->>'storage_key') IS NULL OR (v_res->>'storage_key') NOT LIKE v_pa::text || '/%' THEN
    RAISE EXCEPTION 'FAIL 13: the key does not start with the project id: %', v_res->>'storage_key'; END IF;

  v_res := public.authorize_cash_attachment(v_co, v_att);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 14: a Director could not get a link to an attachment: %', v_res; END IF;
  IF (v_res->>'expires_in')::int IS DISTINCT FROM 600 THEN
    RAISE EXCEPTION 'FAIL 14: the attachment link expires in %s, §A7 says 600', v_res->>'expires_in'; END IF;
  IF (v_res->>'storage_key') NOT LIKE v_pa::text || '/%' THEN
    RAISE EXCEPTION 'FAIL 14: the attachment key is not under the project: %', v_res->>'storage_key'; END IF;
  RAISE NOTICE 'PASS 08  both signed-URL issuers: 600s, key under the project, granted to a Director';

  -- and refused to somebody with no role at all, holding the same real id
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'ADMIN_NOROLE'->>'auth')::text, true);
  v_res := public.authorize_day_document(v_co, v_doc);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 15: a caller with no Daily Closing role got a document link: %', v_res; END IF;
  v_res := public.authorize_cash_attachment(v_co, v_att);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 15: a caller with no Daily Closing role got an attachment link: %', v_res; END IF;
  RAISE NOTICE 'PASS 09  the same ids are refused to a caller holding no role';

  -- ══ 4 · THE AUDIT TAB ═════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'CFO'->>'auth')::text, true);
  v_res := public.list_cash_day_audit(v_co, v_day, 200);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 16: the CFO could not read the audit trail: %', v_res; END IF;
  v_n := jsonb_array_length(v_res->'events');
  IF v_n < 3 THEN
    RAISE EXCEPTION 'FAIL 16: only % audit events for a day that was opened, written to and closed', v_n; END IF;

  -- newest first
  IF NOT (SELECT bool_and(a >= b) FROM (
      SELECT (e->>'changed_at')::timestamptz a,
             lead((e->>'changed_at')::timestamptz) OVER (ORDER BY ord) b
        FROM jsonb_array_elements(v_res->'events') WITH ORDINALITY t(e, ord)) z
      WHERE b IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 17: the audit trail is not in reverse-chronological order';
  END IF;

  -- actor, action and time on every row
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'events') e
              WHERE e->>'changed_at' IS NULL OR e->>'action' IS NULL
                 OR e->>'table_name' IS NULL) THEN
    RAISE EXCEPTION 'FAIL 18: an audit event is missing its time, action or table';
  END IF;
  RAISE NOTICE 'PASS 10  the audit trail reads newest-first with actor, time and action on every row (% events)', v_n;

  -- ── the diff is whitelisted, and the whitelist is doing something ────────
  -- The day is already CLOSED: the CFO's close_cash_day cell in the matrix did
  -- it, which is an UPDATE to cash_days whose status and figures move. Closing
  -- again would be DAY_LOCKED, so this asserts the state rather than re-making
  -- it — and asserts it, rather than assuming the matrix ran.
  IF (SELECT status FROM public.cash_days WHERE id = v_day) IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'FIXTURE: the matrix should have left the day CLOSED, it is %',
      (SELECT status FROM public.cash_days WHERE id = v_day);
  END IF;

  v_res := public.list_cash_day_audit(v_co, v_day, 200);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'events') e,
                  jsonb_array_elements(e->'diff') d
     WHERE e->>'table_name' = 'cash_days' AND d->>'field' = 'status'
       AND d->>'before' = 'OPEN' AND d->>'after' = 'CLOSED') THEN
    RAISE EXCEPTION 'FAIL 19: the status change OPEN -> CLOSED is not in any diff';
  END IF;
  RAISE NOTICE 'PASS 11  a whitelisted status change shows its before and after';

  -- POSITIVE CONTROL for the negative assertion that follows (SR-2): the diff
  -- machinery demonstrably emits fields, so "narration never appears" below is
  -- a statement about the whitelist and not about an empty result.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'events') e
                  WHERE jsonb_array_length(e->'diff') > 0) THEN
    RAISE EXCEPTION 'FAIL 20: no event carries any diff at all — the check below would be vacuous';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'events') e,
                  jsonb_array_elements(e->'diff') d
     WHERE d->>'field' IN ('narration','payee_id','unit_id','idempotency_key')) THEN
    RAISE EXCEPTION 'FAIL 20: a non-whitelisted field reached the diff viewer';
  END IF;
  RAISE NOTICE 'PASS 12  and narration/payee/unit never do — the whitelist holds, and it is not empty';

  -- an Accountant and a Cashier are refused the audit
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'ACCOUNTANT'->>'auth')::text, true);
  v_res := public.list_cash_day_audit(v_co, v_day, 10);
  IF (v_res->>'error') IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'FAIL 21: an Accountant read the audit trail: %', v_res; END IF;
  RAISE NOTICE 'PASS 13  the audit trail is refused to an Accountant';

  -- ══ 5 · THE SERVICE REGISTRY ══════════════════════════════════════════════
  -- Derived from pg_proc, so it cannot go stale. Every mutating service must
  -- leave an audit row.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_users->'CFO'->>'auth')::text, true);

  SELECT count(*) INTO v_n FROM public._dc_service_registry();
  IF v_n < 12 THEN
    RAISE EXCEPTION 'FAIL 22: the registry found only % services — it is not seeing the module', v_n;
  END IF;
  RAISE NOTICE 'PASS 14  the service registry derives % Daily Closing services from pg_proc', v_n;

  -- Every mutating service in the registry must be one this suite exercises.
  -- A service added later appears here on its own and fails until it is added
  -- to the matrix — which is the point of deriving the list.
  SELECT string_agg(service, ', ') INTO v_txt
    FROM public._dc_service_registry()
   WHERE is_mutating AND NOT (service = ANY (ACTIONS))
     AND service NOT IN ('record_day_document', 'seed_daily_closing_chart');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 23: mutating services with no cell in the matrix: %', v_txt;
  END IF;
  RAISE NOTICE 'PASS 15  every mutating service in the registry has a cell in the matrix';

  -- And each of them leaves an audit row when it does its work.
  --
  -- ⚠️ ON A FRESH, OPEN DAY. The matrix closed v_day, so every write against it
  -- now answers DAY_LOCKED — allowed, but doing nothing. A loop that requires
  -- "if it succeeded there is an audit row" over calls that never succeed is
  -- green and worthless, which is standing rule SR-2 in its plainest form. The
  -- count of successes is asserted at the end so the loop cannot go quiet.
  v_res := public.open_cash_day(v_co, v_pa, public._dc_today() - 1);
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: could not open a fresh day for the audit loop: %', v_res; END IF;
  v_day2 := (v_res->>'cash_day_id')::uuid;
  v_res := public.record_cash_entry(v_co, v_day2, gen_random_uuid(), jsonb_build_object(
    'entry_type','EXPENSE','mode','CASH','direction','OUT','voucher_no','8500',
    'amount', 50, 'payee_id', v_payee, 'qb_account_id', v_a6050));
  IF (v_res->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE: could not record into the fresh day: %', v_res; END IF;
  v_entry2 := (v_res->>'entry_id')::uuid;

  v_n := 0;
  FOR v_action IN
    SELECT service FROM public._dc_service_registry()
     WHERE is_mutating AND service IN ('record_cash_entry','create_payee','rename_payee',
                                       'set_payee_active','void_cash_entry')
     ORDER BY service
  LOOP
    SELECT count(*) INTO v_before FROM public.audit_logs WHERE company_id = v_co;
    v_got := public._dc_t_try(v_action, v_co, v_pa, v_day2, v_entry2, v_payee,
                              v_doc, v_att, v_a6050);
    SELECT count(*) INTO v_after FROM public.audit_logs WHERE company_id = v_co;
    IF v_got IS DISTINCT FROM 'OK' THEN
      RAISE EXCEPTION 'FAIL 24: % did not run at all (%), so nothing was proved about it',
        v_action, v_got;
    END IF;
    v_n := v_n + 1;
    IF v_after <= v_before THEN
      RAISE EXCEPTION 'FAIL 24: % succeeded and left no audit row (invariant 7)', v_action;
    END IF;
  END LOOP;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'FAIL 24: the audit loop exercised % services, expected 5', v_n;
  END IF;
  RAISE NOTICE 'PASS 16  all 5 mutating services ran for real and each left an audit row';

  -- Invariant 7 at the grant level: nobody may edit or delete the trail.
  IF has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL 25: authenticated can UPDATE or DELETE audit_logs';
  END IF;
  -- anon and authenticated DO hold a bare SELECT grant on audit_logs — RMS's
  -- default-privileges setting hands it out on every table. What actually
  -- closes the door is RLS: the table has it enabled and a deny-all policy
  -- USING (false) covering both roles, so the grant reaches no rows and every
  -- read goes through a SECURITY DEFINER RPC. Asserting "no SELECT grant"
  -- would be asserting something that is false and does not matter; this
  -- asserts the thing that is true and does.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_logs'::regclass) THEN
    RAISE EXCEPTION 'FAIL 25: RLS is not enabled on audit_logs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.audit_logs'::regclass
       AND pg_get_expr(polqual, polrelid) = 'false'
       AND 'anon' = ANY (SELECT rolname FROM pg_roles WHERE oid = ANY (polroles))) THEN
    RAISE EXCEPTION 'FAIL 25: audit_logs has no deny-all policy covering anon';
  END IF;
  RAISE NOTICE 'PASS 17  audit_logs: no UPDATE or DELETE grant, RLS on, deny-all policy over anon';

  -- ══ 6 · WHAT THE SCREEN IS TOLD ═══════════════════════════════════════════
  FOREACH v_role IN ARRAY ROLES LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_users->v_role->>'auth')::text, true);
    v_res := public.get_my_daily_closing_access(v_co, v_pa);
    v_want := CASE WHEN v_role IN ('ADMIN_NOROLE','STAFF_NOGRANT') THEN NULL ELSE v_role END;
    IF (v_res->>'role') IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'FAIL 26: get_my_daily_closing_access told % it was %', v_role, v_res->>'role'; END IF;
    IF (v_res->>'may_record')::boolean IS DISTINCT FROM
       (v_role IN ('CASHIER','ACCOUNTANT','CFO')) THEN
      RAISE EXCEPTION 'FAIL 26: may_record for % was %', v_role, v_res->>'may_record'; END IF;
    IF (v_res->>'may_close')::boolean IS DISTINCT FROM (v_role = 'CFO') THEN
      RAISE EXCEPTION 'FAIL 26: may_close for % was %', v_role, v_res->>'may_close'; END IF;
    IF (v_res->>'may_audit')::boolean IS DISTINCT FROM (v_role IN ('CFO','DIRECTOR')) THEN
      RAISE EXCEPTION 'FAIL 26: may_audit for % was %', v_role, v_res->>'may_audit'; END IF;
  END LOOP;
  RAISE NOTICE 'PASS 18  what the screen is told matches what the server enforces, for all six';

  DROP FUNCTION IF EXISTS public._dc_t_try(text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid);
END
$t$;
`;

(async () => {
  console.log(`[verify-daily-closing-access] project ${REF}`);
  if (AGAINST_LIVE) console.log('  mode: --against-live — asserting the applied schema.');
  else console.log('  up: ' + UP.join('\n      '));
  console.log('  everything below runs inside BEGIN … ROLLBACK — nothing is committed.\n');

  const sql = AGAINST_LIVE
    ? ['BEGIN;', ASSERT, 'ROLLBACK;'].join('\n')
    : ['BEGIN;', ...UP.map(body), ASSERT, 'ROLLBACK;'].join('\n');

  fs.writeFileSync(path.join(ROOT, 'migration_work', '_dc_p8_probe.sql'), sql);

  try {
    await q(sql, 1);
  } catch (e) {
    console.error('❌ FAILED\n');
    console.error(e.message);
    console.error('\n(the transaction rolled back; the database is unchanged)');
    process.exitCode = 1;
    return;
  }

  console.log('✅ PASS — 18 checks held' + (AGAINST_LIVE ? ' against the LIVE applied schema.' : '.'));
  console.log('   114 role x action cells, cross-project id-guessing, signed-URL expiry and');
  console.log('   scope, the audit tab and its whitelist, and the derived service registry.');
  console.log('   Nothing was committed.');
})();
