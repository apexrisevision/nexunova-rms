-- ═══════════════════════════════════════════════════════════════════════════
-- Who may do what, and what it leaves behind
-- ───────────────────────────────────────────────────────────────────────────
-- P8. §A10 end to end: the four blueprint roles become one server-side
-- predicate each, every endpoint is gated on the right one, and the audit trail
-- becomes readable.
--
-- THREE HOLES THIS CLOSES. All three were the same shape — a scope test doing
-- duty as a role test.
--
--   1 · A DIRECTOR COULD WRITE. open_cash_day, record_cash_entry and
--       add_cash_entry_attachment tested only _dc_may_touch_project, which asks
--       "is this project yours?" and never "may you write?". A `manager`
--       assigned to the project — the Director mapping, RULES §0.3 — could open
--       a day and record entries. §A10 gives the Director a read-only row.
--
--   2 · A DATA-ENTRY ADMIN GOT IN BY DEFAULT. _dc_may_touch_project admits
--       _rms_is_admin(), which is invariant 8's canonical bypass and stays. But
--       `admin` in this database is the everyday data-entry role (RULES §0.4 —
--       FMH's only admin is a filling clerk) and it appears NOWHERE in §A10's
--       matrix. Scope is not a role: an admin now passes the scope test and is
--       then refused for having no Daily Closing role at all.
--
--   3 · THE CASHIER'S MODULE GRANT WAS DECORATION. RULES §0.3 defines Cashier
--       as `staff` PLUS an explicit `dailyclosing` grant. The grant existed only
--       in the Users & Roles UI; the server never read it, so any `staff` user
--       assigned to the project was a cashier. It is now the thing that makes
--       one.
--
-- WHAT IS DELIBERATELY NOT CHANGED. _dc_may_touch_project keeps invariant 8's
-- canonical chain verbatim — _rms_caller() → tenant → _rms_is_admin() → active
-- assignment. Invariant 8 names that chain as its enforcement, so the fix goes
-- ON TOP of it as a role test, never inside it as an exception.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── an explicit module grant, read from where Users & Roles writes it ──────
-- app_users.module_permissions is jsonb, `{"dailyclosing": true}`. TRUE only:
-- a missing key, null, "false" or the string "true" are all not-a-grant. The
-- front end already ticks it (js/pages/users.js); this is what makes it mean
-- something.
CREATE OR REPLACE FUNCTION public._dc_has_module_grant(p_user public.app_users, p_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT COALESCE(p_user.module_permissions -> p_key = 'true'::jsonb, false);
$fn$;

-- ── the one place that decides which blueprint role somebody holds ─────────
-- Returns CFO | ACCOUNTANT | CASHIER | DIRECTOR, or NULL for "not a Daily
-- Closing user at all". Mapped exactly as RULES §0.3/§0.4 records:
--
--   CFO        cfo, owner, super-admin, the company's owner_user_id
--   ACCOUNTANT accounts  (the code also reads 'finance'; only 'accounts' is storable)
--   CASHIER    staff, AND ONLY WITH the dailyclosing module grant
--   DIRECTOR   manager — app-wide read-only, and read-only here
--
-- Order matters: the checks run most-privileged first, so a company owner who
-- also happens to be `staff` is a CFO, not a cashier.
CREATE OR REPLACE FUNCTION public._dc_role(p_user public.app_users)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_user.id IS NULL                       THEN NULL
    WHEN public._dc_is_cfo(p_user)               THEN 'CFO'
    WHEN p_user.role IN ('accounts', 'finance')  THEN 'ACCOUNTANT'
    WHEN p_user.role = 'manager'                 THEN 'DIRECTOR'
    WHEN p_user.role = 'staff'
     AND public._dc_has_module_grant(p_user, 'dailyclosing') THEN 'CASHIER'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public._dc_role(public.app_users) IS
  'The one mapping from an RMS role to a BLUEPRINT §A10 role. NULL means no Daily Closing access of any kind — which is what a plain `admin` (this database''s data-entry role) and a `staff` user without the dailyclosing grant both get. See docs/daily-closing/RULES.md §0.3/§0.4.';

-- ── may this person SEE this project's cash book? ──────────────────────────
-- Scope (invariant 8, unchanged) AND holding one of the four roles.
CREATE OR REPLACE FUNCTION public._dc_may_view(
  p_user public.app_users, p_company_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT public._dc_may_touch_project(p_user, p_company_id, p_project_id)
     AND public._dc_role(p_user) IS NOT NULL;
$fn$;

-- ── may this person WRITE to it? ───────────────────────────────────────────
-- §A10 row 1: "Open day, record entry, attach" is Cashier, Accountant and CFO.
-- The Director column is a dash, and this is the dash.
CREATE OR REPLACE FUNCTION public._dc_may_record(
  p_user public.app_users, p_company_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT public._dc_may_touch_project(p_user, p_company_id, p_project_id)
     AND public._dc_role(p_user) IN ('CASHIER', 'ACCOUNTANT', 'CFO');
$fn$;

COMMENT ON FUNCTION public._dc_may_record(public.app_users, uuid, uuid) IS
  '§A10: Open day / record entry / attach. Cashier, Accountant, CFO — never the Director, whose whole row is read.';

-- The scope test now also gates on holding a role, so every READ endpoint that
-- already calls it inherits the fix without being rewritten. Kept as a separate
-- function from _dc_may_touch_project so invariant 8's canonical chain stays
-- quotable and unmodified.
CREATE OR REPLACE FUNCTION public._dc_may_touch_project(
  p_user public.app_users, p_company_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT p_user.id IS NOT NULL
     AND (COALESCE(p_user.is_super_admin,false) OR p_user.company_id = p_company_id)
     AND (public._rms_is_admin(p_user) OR public._dc_is_cfo(p_user)
          OR EXISTS (SELECT 1 FROM public.user_project_assignments a
                      WHERE a.user_id = p_user.id AND a.company_id = p_company_id
                        AND a.project_id = p_project_id AND a.is_active))
     -- P8: scope is not a role. An `admin` with no Daily Closing role, and a
     -- `staff` user without the dailyclosing grant, both stop here.
     AND public._dc_role(p_user) IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION public._dc_has_module_grant(public.app_users, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dc_role(public.app_users) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dc_may_view(public.app_users, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dc_may_record(public.app_users, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_has_module_grant(public.app_users, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._dc_role(public.app_users) TO service_role;
GRANT EXECUTE ON FUNCTION public._dc_may_view(public.app_users, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._dc_may_record(public.app_users, uuid, uuid) TO service_role;

-- ── what the caller is allowed to know about themselves ────────────────────
-- The screen needs to know which buttons to draw. It asks; it does not decide.
-- Everything this returns is re-checked server-side on every call — §A10:
-- "UI hides, server enforces."
CREATE OR REPLACE FUNCTION public.get_my_daily_closing_access(
  p_company_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_role text; v_projects jsonb;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id
     AND NOT COALESCE(v_me.is_super_admin, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_role := public._dc_role(v_me);
  -- ALWAYS THE SAME SHAPE, even for somebody with no access. A caller that
  -- returns {role, may_view} here and {role, may_view, may_record, ...} there
  -- makes every consumer test for undefined, and undefined is falsy until the
  -- day somebody writes !== false.
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', true, 'role', NULL,
      'may_view', false, 'may_record', false, 'may_void', false,
      'may_close', false, 'may_audit', false, 'projects', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.project_name), '[]'::jsonb) INTO v_projects FROM (
    SELECT p.id AS project_id, p.project_name
      FROM public.projects p
     WHERE p.company_id = p_company_id
       AND public._dc_may_view(v_me, p_company_id, p.id)
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'role', v_role,
    'may_view',    p_project_id IS NULL OR public._dc_may_view(v_me, p_company_id, p_project_id),
    'may_record',  p_project_id IS NOT NULL AND public._dc_may_record(v_me, p_company_id, p_project_id),
    'may_void',    p_project_id IS NOT NULL AND public._dc_may_view(v_me, p_company_id, p_project_id)
                     AND public._dc_is_accountant_plus(v_me),
    'may_close',   p_project_id IS NOT NULL AND public._dc_may_view(v_me, p_company_id, p_project_id)
                     AND public._dc_is_cfo(v_me),
    'may_audit',   v_role IN ('CFO', 'DIRECTOR'),
    'projects',    v_projects);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_daily_closing_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_daily_closing_access(uuid, uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- The audit tab (§A10: "Audit append-only at the DB grant level")
-- ═══════════════════════════════════════════════════════════════════════════
-- Reverse-chronological, for one day, for the CFO and the Director only. An
-- Accountant and a Cashier can see the ledger; who did what to it is an
-- officer's view.
--
-- THE DIFF IS WHITELISTED, NOT WHOLESALE. audit_logs.old_data/new_data hold the
-- entire row, and a cash entry's row carries a payee, a unit and a narration.
-- Handing that to a diff viewer would put a client's business in a panel that
-- §A10 keeps out of the Director PDF two files away. Only the fields below are
-- ever returned, and only when they actually changed.
CREATE OR REPLACE FUNCTION public._dc_audit_whitelist(p_table text)
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE p_table
    WHEN 'cash_days' THEN ARRAY['status','closing_cash','closing_bank','counted_cash',
                                'variance','variance_note','version','closed_at','opening_cash','opening_bank']
    WHEN 'cash_entries' THEN ARRAY['is_voided','reversal_id','rms_status','qb_account_id','is_adjustment']
    WHEN 'payees' THEN ARRAY['is_active','name','kind']
    WHEN 'day_documents' THEN ARRAY['version']
    WHEN 'cash_entry_attachments' THEN ARRAY['mime','size_bytes']
    WHEN 'qb_accounts' THEN ARRAY['is_active','number','name']
    ELSE ARRAY[]::text[]
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_cash_day_audit(
  p_company_id uuid, p_cash_day_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id;
  IF NOT FOUND OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN');
  END IF;
  IF NOT public._dc_may_view(v_me, p_company_id, v_day.project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_role := public._dc_role(v_me);
  IF v_role NOT IN ('CFO', 'DIRECTOR') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED',
      'message', 'The audit trail is for the CFO and the Directors.');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.changed_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_rows FROM (
    SELECT a.id, a.changed_at, a.table_name, a.action, a.record_id,
           a.changed_by_name, a.changed_by_role, a.reason, a.is_sensitive,
           -- The whitelisted before/after, and nothing else.
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'field', f,
                     'before', a.old_data -> f,
                     'after',  a.new_data -> f)), '[]'::jsonb)
              FROM unnest(public._dc_audit_whitelist(a.table_name)) f
             WHERE (a.old_data -> f) IS DISTINCT FROM (a.new_data -> f)
               AND (a.changed_fields IS NULL OR f = ANY (a.changed_fields))
           ) AS diff
      FROM public.audit_logs a
     WHERE a.company_id = p_company_id
       AND a.project_id = v_day.project_id
       AND (
         (a.table_name = 'cash_days' AND a.record_id = v_day.id::text)
         OR (a.table_name = 'cash_entries' AND a.record_id IN (
               SELECT e.id::text FROM public.cash_entries e WHERE e.cash_day_id = v_day.id))
         OR (a.table_name = 'day_documents' AND a.record_id IN (
               SELECT d.id::text FROM public.day_documents d WHERE d.cash_day_id = v_day.id))
         OR (a.table_name = 'cash_entry_attachments' AND a.record_id IN (
               SELECT t.id::text FROM public.cash_entry_attachments t
                JOIN public.cash_entries e ON e.id = t.entry_id
               WHERE e.cash_day_id = v_day.id))
       )
     ORDER BY a.changed_at DESC, a.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  ) x;

  RETURN jsonb_build_object('success', true, 'business_date', v_day.business_date,
                            'events', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public._dc_audit_whitelist(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_audit_whitelist(text) TO service_role;
REVOKE ALL ON FUNCTION public.list_cash_day_audit(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cash_day_audit(uuid, uuid, integer) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- The service registry
-- ═══════════════════════════════════════════════════════════════════════════
-- "Add a test that iterates the service registry and asserts each mutating
-- service emits an audit row" only means something if the registry cannot go
-- stale. So it is DERIVED, not written down: every function in `public` that
--
--   · may be executed by `authenticated`, and
--   · is VOLATILE (Postgres's own word for "this one can write"), and
--   · mentions a Daily Closing table in its body
--
-- is a mutating service of this module, whether or not anybody remembered it.
-- A new RPC added in P9 appears here the moment it is created, and the P8 suite
-- fails until it is shown to write an audit row.
CREATE OR REPLACE FUNCTION public._dc_service_registry()
RETURNS TABLE(service text, args text, is_mutating boolean, touches text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH tabs(t) AS (
    VALUES ('cash_days'), ('cash_entries'), ('payees'), ('qb_accounts'),
           ('cash_accounts'), ('day_documents'), ('cash_entry_attachments')
  )
  SELECT p.proname::text,
         pg_get_function_identity_arguments(p.oid)::text,
         p.provolatile = 'v',
         ARRAY(SELECT t FROM tabs WHERE p.prosrc LIKE '%public.' || t || '%')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     -- A trigger function is not a service: nobody calls it, the table does.
     -- cash_entries_day_guard and cash_entries_qb_head_guard turned up here
     -- on the first run and would have demanded a cell in the RBAC matrix.
     AND p.prorettype <> 'pg_catalog.trigger'::regtype
     AND p.proname NOT LIKE '\_%'                      -- helpers are not services
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND EXISTS (SELECT 1 FROM tabs WHERE p.prosrc LIKE '%public.' || t || '%')
   ORDER BY 1;
$fn$;

REVOKE ALL ON FUNCTION public._dc_service_registry() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._dc_service_registry() TO authenticated, service_role;

COMMENT ON FUNCTION public._dc_service_registry() IS
  'Every Daily Closing service reachable by `authenticated`, derived from pg_proc rather than listed by hand so it cannot go stale. The P8 suite iterates it and requires each mutating one to leave an audit row.';

-- ═══════════════════════════════════════════════════════════════════════════
-- The three write endpoints, re-gated
-- ═══════════════════════════════════════════════════════════════════════════

-- ── open_cash_day ─────────────────────────────────────────────
-- Verbatim from the live database, with _dc_may_touch_project swapped for
-- _dc_may_record. Nothing else in the body is changed.
CREATE OR REPLACE FUNCTION public.open_cash_day(p_company_id uuid, p_project_id uuid, p_business_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_date date; v_prev public.cash_days; v_id uuid;
  v_open_date date; v_o_cash numeric(18,2); v_o_bank numeric(18,2);
BEGIN
  IF NOT public._dc_may_record(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_date := COALESCE(p_business_date, public._dc_today());
  IF v_date > public._dc_today() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A day cannot be opened in the future.');
  END IF;

  -- At most one OPEN day per project (§A4). The partial unique index enforces
  -- it; this returns the blueprint's code and says which day is in the way.
  SELECT business_date INTO v_open_date FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'OPEN' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
      'message', format('%s is still open. Close it before opening another day.', v_open_date));
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_days
              WHERE project_id = p_project_id AND business_date = v_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', format('%s has already been opened and closed.', v_date));
  END IF;

  -- Invariant 2: opening is DERIVED. There is no parameter for it.
  SELECT * INTO v_prev FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'CLOSED'
   ORDER BY business_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SETUP_OPENING_REQUIRED',
      'message', 'Set the opening cash and bank balance before opening the first day.');
  END IF;
  v_o_cash := v_prev.closing_cash;
  v_o_bank := v_prev.closing_bank;

  PERFORM set_config('rms.audit_reason',
    format('opened %s; brought forward from %s', v_date, v_prev.business_date), true);

  INSERT INTO public.cash_days (company_id, project_id, business_date, status,
                                opening_cash, opening_bank, created_by)
  VALUES (p_company_id, p_project_id, v_date, 'OPEN', v_o_cash, v_o_bank, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'DayOpened',
    'cash_day_id', v_id, 'business_date', v_date,
    'opening_cash', v_o_cash, 'opening_bank', v_o_bank,
    'brought_forward_from', v_prev.business_date);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
    'message', 'Another day is already open for this project.');
END;
$function$;

-- ── record_cash_entry ─────────────────────────────────────────────
-- Verbatim from the live database, with _dc_may_touch_project swapped for
-- _dc_may_record. Nothing else in the body is changed.
CREATE OR REPLACE FUNCTION public.record_cash_entry(p_company_id uuid, p_cash_day_id uuid, p_idempotency_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_existing public.cash_entries;
  v_type text; v_mode text; v_dir text; v_vt text; v_no text;
  v_amount numeric(18,2); v_payee uuid; v_unit uuid; v_sale uuid;
  v_head uuid; v_reason text; v_rms text; v_seq integer;
  v_id uuid; v_id_b uuid; v_grp uuid; v_clash date; v_active boolean;
  v_src uuid; v_dst uuid; v_src_acc public.cash_accounts; v_dst_acc public.cash_accounts;
  v_expected numeric(18,2); v_vtag text;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'An idempotency key is required so a retry cannot double-record.');
  END IF;

  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN', 'message', 'No such day.');
  END IF;
  IF NOT public._dc_may_record(v_me, p_company_id, v_day.project_id)
     OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- ── IDEMPOTENCY, before anything else ────────────────────────────────────
  -- A replay is not an error. It returns what the first call produced, so a
  -- cashier whose phone lost the response can press Save again without fear.
  SELECT * INTO v_existing FROM public.cash_entries
   WHERE company_id = p_company_id AND project_id = v_day.project_id
     AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
      'replayed', true, 'entry_id', v_existing.id, 'seq_no', v_existing.seq_no,
      'voucher_type', v_existing.voucher_type, 'voucher_no', v_existing.voucher_no,
      'transfer_group_id', v_existing.transfer_group_id);
  END IF;

  IF v_day.status <> 'OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_LOCKED',
      'message', 'This day is closed. A post-close change is an adjustment.');
  END IF;

  -- ── payload ──────────────────────────────────────────────────────────────
  v_type   := COALESCE(NULLIF(p_payload->>'entry_type',''), 'OTHER');
  v_mode   := NULLIF(p_payload->>'mode','');
  v_dir    := NULLIF(p_payload->>'direction','');
  v_no     := NULLIF(btrim(COALESCE(p_payload->>'voucher_no','')),'');
  v_amount := round(NULLIF(p_payload->>'amount','')::numeric, 2);
  v_payee  := NULLIF(p_payload->>'payee_id','')::uuid;
  v_unit   := NULLIF(p_payload->>'unit_id','')::uuid;
  v_sale   := NULLIF(p_payload->>'sale_id','')::uuid;
  v_head   := NULLIF(p_payload->>'qb_account_id','')::uuid;
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'qb_override_reason','')),'');
  v_expected := round(NULLIF(p_payload->>'expected_amount','')::numeric, 2);
  v_vtag   := NULLIF(p_payload->>'variance_tag','');

  IF v_type NOT IN ('CLIENT_RECEIPT','EXPENSE','TRANSFER','LOAN_CAPITAL','OTHER') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Unknown entry type.');
  END IF;

  -- §A12: the voucher type is DERIVED. A caller trying to set it is a caller
  -- who could make the chip disagree with the row, so it is refused outright
  -- rather than quietly ignored.
  IF p_payload ? 'voucher_type' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'voucher_type is derived from mode and direction and cannot be supplied.');
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'An entry needs a positive amount.');
  END IF;
  IF v_no IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'The voucher number from the book is required.');
  END IF;

  -- Invariant 6: the payee is chosen from the master and must still be active.
  IF v_payee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A payee is required; choose one from the list.');
  END IF;
  SELECT is_active INTO v_active FROM public.payees
   WHERE id = v_payee AND company_id = p_company_id;
  IF v_active IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'That payee does not belong to this company.');
  END IF;
  IF NOT v_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_INACTIVE',
      'message', 'That payee has been deactivated. Choose another.');
  END IF;

  IF v_type = 'CLIENT_RECEIPT' THEN
    IF v_unit IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNIT_REQUIRED',
        'message', 'Client money is always against a unit.');
    END IF;
    v_rms := 'PENDING';
  ELSE
    v_rms := 'NA';
  END IF;

  IF v_expected IS NOT NULL AND v_expected <> v_amount AND v_vtag IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'VARIANCE_TAG_REQUIRED',
      'message', 'The amount differs from what was expected — say which kind of difference it is.');
  END IF;

  -- ── TRANSFER: two rows, one act ──────────────────────────────────────────
  IF v_type = 'TRANSFER' THEN
    v_src := NULLIF(p_payload->>'from_cash_account_id','')::uuid;
    v_dst := NULLIF(p_payload->>'to_cash_account_id','')::uuid;
    IF v_src IS NULL OR v_dst IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'A transfer names the account it leaves and the account it reaches.');
    END IF;
    IF v_src = v_dst THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'A transfer cannot leave and reach the same account.');
    END IF;
    SELECT * INTO v_src_acc FROM public.cash_accounts WHERE id = v_src AND project_id = v_day.project_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
      'message', 'The source account is not one of this project''s.'); END IF;
    SELECT * INTO v_dst_acc FROM public.cash_accounts WHERE id = v_dst AND project_id = v_day.project_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
      'message', 'The destination account is not one of this project''s.'); END IF;
    IF NOT v_src_acc.is_active OR NOT v_dst_acc.is_active THEN
      RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE',
        'message', 'One of those accounts has been deactivated.'); END IF;

    -- Both legs' voucher numbers are checked BEFORE either is written, so the
    -- ordinary duplicate is a clean 409 and not a rolled-back half-transfer.
    FOR v_vt, v_clash IN
      SELECT x.vt, (SELECT e.created_at::date FROM public.cash_entries e
                     WHERE e.project_id = v_day.project_id AND e.voucher_type = x.vt
                       AND e.voucher_no = x.no AND NOT e.is_adjustment LIMIT 1)
      FROM (VALUES
        (public._dc_voucher_for(v_src_acc.kind, 'OUT'), v_no || '-A'),
        (public._dc_voucher_for(v_dst_acc.kind, 'IN'),  v_no || '-B')
      ) AS x(vt, no)
    LOOP
      IF v_clash IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
          'message', format('%s %s was already used on %s.', v_vt, v_no, v_clash),
          'conflicting_date', v_clash);
      END IF;
    END LOOP;

    v_grp := gen_random_uuid();
    SELECT COALESCE(MAX(seq_no), 0) INTO v_seq FROM public.cash_entries WHERE cash_day_id = v_day.id;

    PERFORM set_config('rms.audit_reason',
      format('transfer %s from %s to %s', v_amount, v_src_acc.name, v_dst_acc.name), true);

    -- Leg A — money leaves the source. §A14: OUT debits the QB head and credits
    -- the mode account, so the head on this leg is the DESTINATION's.
    INSERT INTO public.cash_entries (
      company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
      mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
      cash_account_id, qb_account_id, rms_status, transfer_group_id, created_by)
    VALUES (
      p_company_id, v_day.project_id, v_day.id, v_seq + 1, p_idempotency_key, 'TRANSFER',
      v_src_acc.kind, 'OUT', public._dc_voucher_for(v_src_acc.kind,'OUT'), v_no || '-A',
      v_amount, NULLIF(p_payload->>'narration',''), v_payee,
      v_src, v_dst_acc.qb_account_id, 'NA', v_grp, v_me.id)
    RETURNING id INTO v_id;

    -- Leg B — money reaches the destination. No exception handler wraps these
    -- two inserts: if this one fails, leg A goes with it.
    INSERT INTO public.cash_entries (
      company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
      mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
      cash_account_id, qb_account_id, rms_status, transfer_group_id, created_by)
    VALUES (
      p_company_id, v_day.project_id, v_day.id, v_seq + 2, gen_random_uuid(), 'TRANSFER',
      v_dst_acc.kind, 'IN', public._dc_voucher_for(v_dst_acc.kind,'IN'), v_no || '-B',
      v_amount, NULLIF(p_payload->>'narration',''), v_payee,
      v_dst, v_src_acc.qb_account_id, 'NA', v_grp, v_me.id)
    RETURNING id INTO v_id_b;

    RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
      'replayed', false, 'transfer_group_id', v_grp,
      'entry_id', v_id, 'entry_id_b', v_id_b,
      'seq_no', v_seq + 1, 'seq_no_b', v_seq + 2);
  END IF;

  -- ── single movement ──────────────────────────────────────────────────────
  v_vt := public._dc_voucher_for(v_mode, v_dir);
  IF v_vt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'mode must be CASH or BANK and direction IN or OUT.');
  END IF;

  SELECT created_at::date INTO v_clash FROM public.cash_entries
   WHERE project_id = v_day.project_id AND voucher_type = v_vt
     AND voucher_no = v_no AND NOT is_adjustment LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
      'message', format('%s %s was already used on %s.', v_vt, v_no, v_clash),
      'conflicting_date', v_clash);
  END IF;

  BEGIN
    v_head := public._dc_resolve_head(p_company_id, v_type, v_head, v_reason);
  EXCEPTION WHEN restrict_violation THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM,
      'message', CASE SQLERRM
        WHEN 'OVERRIDE_REASON_REQUIRED' THEN 'That is not the usual account for this kind of entry — say why.'
        WHEN 'ACCOUNT_INACTIVE'  THEN 'That QuickBooks account has been deactivated.'
        WHEN 'ACCOUNT_REQUIRED'  THEN 'Choose a QuickBooks account for this entry.'
        ELSE 'That QuickBooks account does not belong to this company.' END);
  END;

  SELECT COALESCE(MAX(seq_no), 0) + 1 INTO v_seq FROM public.cash_entries WHERE cash_day_id = v_day.id;

  PERFORM set_config('rms.audit_reason', format('%s %s recorded', v_vt, v_no), true);

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key, entry_type,
    mode, direction, voucher_type, voucher_no, amount, narration, payee_id,
    unit_id, sale_id, cash_account_id, qb_account_id, qb_override_reason,
    allocation_kind, allocation_ref, expected_amount, variance_tag, variance_note,
    rms_status, created_by)
  VALUES (
    p_company_id, v_day.project_id, v_day.id, v_seq, p_idempotency_key, v_type,
    v_mode, v_dir, v_vt, v_no, v_amount, NULLIF(p_payload->>'narration',''), v_payee,
    v_unit, v_sale, NULLIF(p_payload->>'cash_account_id','')::uuid, v_head, v_reason,
    NULLIF(p_payload->>'allocation_kind',''), NULLIF(p_payload->>'allocation_ref',''),
    v_expected, v_vtag, NULLIF(p_payload->>'variance_note',''),
    v_rms, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
    'replayed', false, 'entry_id', v_id, 'seq_no', v_seq,
    'voucher_type', v_vt, 'voucher_no', v_no, 'rms_status', v_rms);
EXCEPTION
  WHEN unique_violation THEN
    -- Two replays racing, or a voucher that slipped between check and insert.
    SELECT * INTO v_existing FROM public.cash_entries
     WHERE company_id = p_company_id AND project_id = v_day.project_id
       AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'event', 'EntryRecorded',
        'replayed', true, 'entry_id', v_existing.id, 'seq_no', v_existing.seq_no);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_VOUCHER',
      'message', 'That voucher number is already used.');
END;
$function$;

-- ── add_cash_entry_attachment ─────────────────────────────────────────────
-- Verbatim from the live database, with _dc_may_touch_project swapped for
-- _dc_may_record. Nothing else in the body is changed.
CREATE OR REPLACE FUNCTION public.add_cash_entry_attachment(p_company_id uuid, p_entry_id uuid, p_storage_key text, p_mime text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_e public.cash_entries; v_id uuid;
BEGIN
  SELECT * INTO v_e FROM public.cash_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION', 'message', 'No such entry.');
  END IF;
  IF NOT public._dc_may_record(v_me, p_company_id, v_e.project_id)
     OR v_e.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- §A7: jpg/png/pdf, 10 MB. Checked here as well as by the CHECK constraints
  -- so the caller gets a sentence instead of a constraint name.
  IF p_mime IS NULL OR p_mime NOT IN ('image/jpeg','image/jpg','image/png','application/pdf') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Attachments must be a JPG, PNG or PDF.');
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Attachments must be larger than nothing and no more than 10 MB.');
  END IF;
  IF p_storage_key IS NULL OR btrim(p_storage_key) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A storage key is required.');
  END IF;
  -- Invariant 8: the path is scoped to the project, so one project's bill can
  -- never be addressed from another's.
  IF p_storage_key NOT LIKE (v_e.project_id::text || '/%') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED',
      'message', 'The storage path must begin with this entry''s project id.');
  END IF;

  INSERT INTO public.cash_entry_attachments (company_id, entry_id, storage_key, mime, size_bytes, uploaded_by)
  VALUES (p_company_id, p_entry_id, btrim(p_storage_key),
          CASE WHEN p_mime = 'image/jpg' THEN 'image/jpeg' ELSE p_mime END,
          p_size_bytes, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'attachment_id', v_id, 'entry_id', p_entry_id);
END;
$function$;

-- ── list_payees ─────────────────────────────────────────────
-- Verbatim from the live database, with its inlined scope chain replaced by
-- _dc_may_view plus an explicit role test.
CREATE OR REPLACE FUNCTION public.list_payees(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_include_inactive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_rows jsonb;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- P8: this one inlined invariant 8's chain instead of calling the shared
  -- predicate, so the ROLE test added in P8 never reached it — a plain admin
  -- and a staff user with no dailyclosing grant could both list the payee
  -- master. The matrix caught it. Scope is unchanged; the role test is new.
  IF public._dc_role(v_me) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_project_id IS NOT NULL
     AND NOT public._dc_may_view(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.is_active DESC,
                                     r.last_used_at DESC NULLS LAST,
                                     r.name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT p.id, p.name, p.kind, p.project_id, p.client_id, p.is_active,
           p.normalized_name,
           (SELECT max(e.created_at) FROM public.cash_entries e WHERE e.payee_id = p.id) AS last_used_at
      FROM public.payees p
     WHERE p.company_id = p_company_id
       AND (p_include_inactive OR p.is_active)
       AND (p_project_id IS NULL OR p.project_id IS NULL OR p.project_id = p_project_id)
  ) r;

  RETURN jsonb_build_object('success', true, 'payees', v_rows);
END;
$function$;

COMMIT;
