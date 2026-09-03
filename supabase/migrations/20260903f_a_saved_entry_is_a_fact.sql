-- ═══════════════════════════════════════════════════════════════════════════
-- A saved entry is a fact
-- ───────────────────────────────────────────────────────────────────────────
-- Three guards and the audit wiring for the cash book created in 20260903e.
--
--   1. cash_entries can never be deleted, and can only be updated on the five
--      routing columns. Everything else about a saved row is a fact: what was
--      counted, when, by whom, against which voucher. RMS approving or
--      rejecting the allocation later changes where the money is APPLIED, not
--      whether it was RECEIVED. (BLUEPRINT invariant 1.)
--
--   2. Nothing may be inserted into a CLOSED day unless it is an adjustment,
--      and the check is taken under a row lock on the day itself — so a close
--      racing an entry cannot interleave. (Invariant 3, §A7 concurrency.)
--
--   3. An entry belongs to its day's project and tenant. Not "should" — cannot.
--      (Invariant 8.)
--
-- Audit (invariant 7) reuses the engine RMS already has rather than building a
-- second one: audit_logs is already append-only at the grant level and already
-- captures actor, before, after, changed fields, reason, IP and user-agent.
-- The new tables simply get the standard trigger. audit_trigger_function is
-- extended to carry project_id — the column added in 20260903e — because a
-- director should be shown the audit for their own project and no other.
--
-- The function body below was dumped from the live database before editing
-- (pg_get_functiondef, 2026-09-03) rather than copied from the repo, which is
-- an incomplete record of what is actually deployed. The only changes are the
-- v_project_id capture, the two new sensitivity rules, and the extra column in
-- the INSERT.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Guard 1 · immutability ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cash_entries_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  -- The whitelist, and the only one. Routing is where the money was applied
  -- and whether it has been exported; neither is the cash fact itself.
  v_allowed CONSTANT text[] := ARRAY[
    'rms_status', 'rms_receipt_ref', 'rms_status_reason', 'qb_status', 'qb_export_id'
  ];
  v_touched   text[];
  v_forbidden text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'cash_entries rows cannot be deleted. A saved entry is a fact; reverse it with an adjustment (invariant 1).'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT COALESCE(array_agg(kv.key ORDER BY kv.key), '{}'::text[])
    INTO v_touched
    FROM jsonb_each(to_jsonb(OLD)) AS kv
   WHERE kv.value IS DISTINCT FROM (to_jsonb(NEW) -> kv.key);

  SELECT string_agg(c, ', ' ORDER BY c)
    INTO v_forbidden
    FROM unnest(v_touched) AS c
   WHERE c <> ALL (v_allowed);

  IF v_forbidden IS NOT NULL THEN
    RAISE EXCEPTION
      'cash_entries is immutable: % cannot be updated. Only % may change after insert (invariant 1).',
      v_forbidden, array_to_string(v_allowed, ', ')
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS _trg_cash_entries_immutable ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_immutable
  BEFORE UPDATE OR DELETE ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.cash_entries_immutable();

-- TRUNCATE bypasses row triggers and bypasses RLS. The grants revoked in
-- 20260903e already close it for anon/authenticated; this closes it for
-- anything holding the table grant directly.
CREATE OR REPLACE FUNCTION public.cash_entries_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RAISE EXCEPTION 'cash_entries cannot be truncated (invariant 1).'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

DROP TRIGGER IF EXISTS _trg_cash_entries_no_truncate ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_no_truncate
  BEFORE TRUNCATE ON public.cash_entries
  FOR EACH STATEMENT EXECUTE FUNCTION public.cash_entries_no_truncate();

-- ── Guards 2 and 3 · the day must be open, and must be the same day ────────
CREATE OR REPLACE FUNCTION public.cash_entries_day_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_status  text;
  v_project uuid;
  v_company uuid;
BEGIN
  -- FOR UPDATE, deliberately. §A7: "Close while an entry is mid-save: entry
  -- insert checks status inside the same lock; loser gets DAY_LOCKED." This is
  -- that lock, and it is also the lock seq_no assignment will take.
  SELECT status, project_id, company_id
    INTO v_status, v_project, v_company
    FROM public.cash_days
   WHERE id = NEW.cash_day_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAY_NOT_OPEN: no cash day %', NEW.cash_day_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_status = 'CLOSED' AND NOT NEW.is_adjustment THEN
    RAISE EXCEPTION
      'DAY_LOCKED: the day is closed. A post-close change is an adjustment entry with a reason (invariant 3).'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.project_id IS DISTINCT FROM v_project
     OR NEW.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION
      'entry does not belong to its day: entry is project %/company %, day is project %/company % (invariant 8).',
      NEW.project_id, NEW.company_id, v_project, v_company
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS _trg_cash_entries_day_guard ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_day_guard
  BEFORE INSERT ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.cash_entries_day_guard();

-- ── Invariant 7 · audit_logs learns which project a change belonged to ─────
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_data JSONB; v_new_data JSONB; v_row_data JSONB; v_changed_fields TEXT[];
  v_auth_uid UUID; v_user_name TEXT := 'system'; v_user_role TEXT := 'unknown';
  v_company_id UUID; v_record_id TEXT; v_is_sensitive BOOLEAN := FALSE;
  v_reason TEXT := NULL; v_ip INET; v_user_agent TEXT; v_headers JSONB;
  v_project_id UUID;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::JSONB;
    BEGIN
      v_ip := (COALESCE( split_part(v_headers->>'x-forwarded-for', ',', 1), v_headers->>'x-real-ip', '' ))::INET;
    EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
    v_user_agent := left(COALESCE(v_headers->>'user-agent',''), 500);
  EXCEPTION WHEN OTHERS THEN v_ip := NULL; v_user_agent := NULL; END;

  BEGIN v_auth_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_auth_uid := NULL; END;
  IF v_auth_uid IS NOT NULL THEN
    BEGIN
      SELECT full_name, role INTO v_user_name, v_user_role FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_user_name := v_auth_uid::TEXT; v_user_role := 'unknown'; END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD); v_new_data := NULL; v_row_data := v_old_data; v_is_sensitive := TRUE;
  ELSIF TG_OP = 'INSERT' THEN
    v_old_data := NULL; v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
  ELSE
    v_old_data := to_jsonb(OLD); v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
    SELECT array_agg(kv.key ORDER BY kv.key) INTO v_changed_fields
    FROM jsonb_each(v_old_data) AS kv WHERE kv.value IS DISTINCT FROM (v_new_data -> kv.key);

    IF TG_TABLE_NAME = 'payments' AND (v_old_data->>'amount') IS DISTINCT FROM (v_new_data->>'amount') THEN v_is_sensitive := TRUE; END IF;
    IF TG_TABLE_NAME = 'sales' AND (
         (v_old_data->>'sale_price') IS DISTINCT FROM (v_new_data->>'sale_price')
      OR (v_old_data->>'net_amount') IS DISTINCT FROM (v_new_data->>'net_amount')) THEN v_is_sensitive := TRUE; END IF;
    IF TG_TABLE_NAME = 'installments' AND (v_old_data->>'amount_due') IS DISTINCT FROM (v_new_data->>'amount_due') THEN v_is_sensitive := TRUE; END IF;
    IF TG_TABLE_NAME = 'pdc_cheques'
       AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status')
       AND (v_new_data->>'status' = 'bounced' OR v_old_data->>'status' = 'bounced') THEN v_is_sensitive := TRUE; END IF;
    IF TG_TABLE_NAME = 'units' AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status') THEN v_is_sensitive := TRUE; END IF;
    IF TG_TABLE_NAME = 'subscriptions' THEN v_is_sensitive := TRUE; END IF;

    -- Daily Closing: locking a day is the moment the figures stop being
    -- editable, so it is always worth a director's attention.
    IF TG_TABLE_NAME = 'cash_days'
       AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status')
       AND v_new_data->>'status' = 'CLOSED' THEN v_is_sensitive := TRUE; END IF;
  END IF;

  -- Daily Closing: an adjustment is a change to a day that was already locked.
  IF TG_TABLE_NAME = 'cash_entries' AND TG_OP = 'INSERT'
     AND COALESCE((v_new_data->>'is_adjustment')::boolean, false) THEN
    v_is_sensitive := TRUE;
    v_reason := COALESCE(NULLIF(v_new_data->>'adjustment_reason',''), v_reason);
  END IF;

  IF v_new_data IS NOT NULL THEN
    BEGIN
      IF NULLIF(v_new_data->>'payment_date','')::date < (CURRENT_DATE - 1)
         OR NULLIF(v_new_data->>'sale_date','')::date < (CURRENT_DATE - 1) THEN
        v_is_sensitive := TRUE; v_reason := 'backdated_entry';
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Operator-entered reason (destructive money RPCs) WINS over the auto tag.
  v_reason := COALESCE(NULLIF(current_setting('rms.audit_reason', true), ''), v_reason);

  v_record_id := COALESCE(v_row_data->>'id', '?');
  BEGIN v_company_id := (v_row_data->>'company_id')::UUID; EXCEPTION WHEN OTHERS THEN v_company_id := NULL; END;
  IF v_company_id IS NULL AND v_auth_uid IS NOT NULL THEN
    BEGIN SELECT company_id INTO v_company_id FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- New: the audited row's own project, when it has one. Tables that are
  -- company-scoped only leave this NULL, exactly as before.
  BEGIN v_project_id := (v_row_data->>'project_id')::UUID; EXCEPTION WHEN OTHERS THEN v_project_id := NULL; END;

  BEGIN
    INSERT INTO public.audit_logs (
      company_id, project_id, table_name, record_id, action, old_data, new_data, changed_fields,
      changed_by, changed_by_name, changed_by_role, is_sensitive, reason, module, ip_address, user_agent
    ) VALUES (
      v_company_id, v_project_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old_data, v_new_data, v_changed_fields,
      v_auth_uid, COALESCE(v_user_name, 'system'), COALESCE(v_user_role, 'unknown'),
      v_is_sensitive, v_reason, TG_TABLE_NAME, v_ip, v_user_agent
    );
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[audit] %.% failed: %', TG_TABLE_NAME, TG_OP, SQLERRM; END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ── Invariant 7 · the new tables join the audit ────────────────────────────
DO $audit$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_days','cash_entries','cash_accounts','payees','qb_accounts',
    'entry_type_defaults','qb_exports','client_receipts','day_documents',
    'pdc_register','reconciliations','cash_entry_attachments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS _trg_audit ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER _trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function()', t);
  END LOOP;
END
$audit$;

-- ── Invariant 7 · append-only, re-asserted ─────────────────────────────────
-- Already done by 20260706_phase2b_audit_hardening.sql. Repeated here because
-- this migration is where a reader looks for the audit contract, and because a
-- REVOKE that is already in force costs nothing.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated, PUBLIC;

COMMENT ON FUNCTION public.cash_entries_immutable() IS
  'BLUEPRINT invariant 1. Rejects every DELETE and every UPDATE that touches anything but rms_status, rms_receipt_ref, rms_status_reason, qb_status, qb_export_id.';
COMMENT ON FUNCTION public.cash_entries_day_guard() IS
  'BLUEPRINT invariants 3 and 8. Locks the cash_days row, refuses a non-adjustment insert into a CLOSED day, and refuses an entry whose project/company is not its day''s.';

COMMIT;
