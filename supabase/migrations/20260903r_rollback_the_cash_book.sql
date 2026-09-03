-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback the cash book  ·  the down path for 20260903e / f / g
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ THIS IS NOT A NORMAL MIGRATION. It is never applied as part of moving
-- forward. It exists so the P1 schema has a proven way back, and so the up
-- migrations can be tested by running e → f → g → r inside one transaction and
-- confirming the database is byte-for-byte where it started.
--
-- ⚠️ IT DESTROYS DATA. Every cash entry, every closed day, every rendered
-- Director PDF row and every audit project_id goes with it. Run it only
-- against a database where the cash book has never carried real figures — in
-- practice, only before the pilot's first close.
--
-- What it deliberately does NOT undo:
--   · Files already written to the daily-closing storage bucket. Rows pointing
--     at them are dropped; the objects themselves are left, because deleting a
--     rendered Director PDF is not something a schema rollback should decide.
--   · The 'cfo' string on any app_users row. Dropping _dc_is_cfo() removes the
--     privilege; rewriting somebody's role is a people decision, not a DDL one.
--     Such an account simply falls back to having no officer rights.
--
-- Order is children first, without CASCADE — if something unexpected depends
-- on one of these tables, this should fail loudly rather than quietly drop it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 20260903g · the CFO predicate ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public._dc_is_cfo(public.app_users);

-- ── 20260903f · guards ─────────────────────────────────────────────────────
-- Table triggers go with their tables below; these are the standalone objects.
DROP TRIGGER  IF EXISTS _trg_cash_entries_immutable   ON public.cash_entries;
DROP TRIGGER  IF EXISTS _trg_cash_entries_no_truncate ON public.cash_entries;
DROP TRIGGER  IF EXISTS _trg_cash_entries_day_guard   ON public.cash_entries;
DROP FUNCTION IF EXISTS public.cash_entries_immutable();
DROP FUNCTION IF EXISTS public.cash_entries_no_truncate();
DROP FUNCTION IF EXISTS public.cash_entries_day_guard();

-- ── 20260903f · audit_trigger_function back to its 2026-07-06 body ─────────
-- Restored verbatim from pg_get_functiondef() taken on the live database on
-- 2026-09-03 before this module changed it. The only differences from the
-- forward version are the absence of v_project_id, the two Daily Closing
-- sensitivity rules, and the project_id column in the INSERT.
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

  BEGIN
    INSERT INTO public.audit_logs (
      company_id, table_name, record_id, action, old_data, new_data, changed_fields,
      changed_by, changed_by_name, changed_by_role, is_sensitive, reason, module, ip_address, user_agent
    ) VALUES (
      v_company_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old_data, v_new_data, v_changed_fields,
      v_auth_uid, COALESCE(v_user_name, 'system'), COALESCE(v_user_role, 'unknown'),
      v_is_sensitive, v_reason, TG_TABLE_NAME, v_ip, v_user_agent
    );
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[audit] %.% failed: %', TG_TABLE_NAME, TG_OP, SQLERRM; END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ── 20260903e · the tables, children first ─────────────────────────────────
DROP TABLE IF EXISTS public.pdc_register;
DROP TABLE IF EXISTS public.reconciliations;
DROP TABLE IF EXISTS public.day_documents;
DROP TABLE IF EXISTS public.client_receipts;
DROP TABLE IF EXISTS public.receipt_counters;
DROP TABLE IF EXISTS public.cash_entry_attachments;
DROP TABLE IF EXISTS public.cash_entries;
DROP TABLE IF EXISTS public.qb_exports;
DROP TABLE IF EXISTS public.cash_days;
DROP TABLE IF EXISTS public.entry_type_defaults;
DROP TABLE IF EXISTS public.payees;
DROP TABLE IF EXISTS public.cash_accounts;
DROP TABLE IF EXISTS public.qb_accounts;

-- ── 20260903e · audit_logs loses the project column ────────────────────────
DROP INDEX IF EXISTS public.audit_logs_project_idx;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS project_id;

-- app_users.role keeps its comment rather than reverting to none; a comment is
-- documentation, and the sentence about cfo stays true for anyone reading the
-- history. Uncomment the next line if a byte-exact revert is wanted.
-- COMMENT ON COLUMN public.app_users.role IS NULL;

COMMIT;
