-- =====================================================================
-- Phase 3 / Component 1 — Audit trigger coverage + backdate warning.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase3_audit_trigger_coverage).
--
--  (1) Attach the existing _trg_audit (audit_trigger_function) to the
--      three previously-uncovered operational tables:
--      contact_logs, follow_up_reminders, approval_requests
--      (same AFTER INSERT/UPDATE/DELETE FOR EACH ROW pattern as the
--      existing audit triggers on payments/sales/units/...).
--
--  (2) Add backdated-entry detection to audit_trigger_function (§5
--      "warning" level): on INSERT/UPDATE, if payment_date or sale_date
--      is older than CURRENT_DATE - 1, set is_sensitive = true and
--      reason = 'backdated_entry'. Null-safe — tables without those
--      columns yield NULL and are skipped; malformed values are caught
--      and ignored so the parent operation never fails.
--
-- Only ADDITIVE changes to the function (new v_reason var, the backdate
-- block, and the reason column in the audit_logs INSERT); every piece of
-- the existing logic — header capture, actor resolution, change-field
-- diff, per-table sensitive flags, company resolution, wrapped insert —
-- is preserved verbatim.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_data JSONB;
  v_new_data JSONB;
  v_row_data JSONB;
  v_changed_fields TEXT[];
  v_auth_uid UUID;
  v_user_name TEXT := 'system';
  v_user_role TEXT := 'unknown';
  v_company_id UUID;
  v_record_id TEXT;
  v_is_sensitive BOOLEAN := FALSE;
  v_reason TEXT := NULL;
  v_ip INET;
  v_user_agent TEXT;
  v_headers JSONB;
BEGIN
  -- ── Request headers (IP, user-agent from Supabase request context) ──
  BEGIN
    v_headers := current_setting('request.headers', true)::JSONB;
    BEGIN
      v_ip := (COALESCE( split_part(v_headers->>'x-forwarded-for', ',', 1), v_headers->>'x-real-ip', '' ))::INET;
    EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
    v_user_agent := left(COALESCE(v_headers->>'user-agent',''), 500);
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_user_agent := NULL;
  END;

  -- ── Auth user ──────────────────────────────────────────────────────
  BEGIN
    v_auth_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN v_auth_uid := NULL; END;
  IF v_auth_uid IS NOT NULL THEN
    BEGIN
      SELECT full_name, role INTO v_user_name, v_user_role
      FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_user_name := v_auth_uid::TEXT; v_user_role := 'unknown';
    END;
  END IF;

  -- ── Build data snapshots ───────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD); v_new_data := NULL; v_row_data := v_old_data;
    v_is_sensitive := TRUE; -- every delete is sensitive
  ELSIF TG_OP = 'INSERT' THEN
    v_old_data := NULL; v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
  ELSE -- UPDATE
    v_old_data := to_jsonb(OLD); v_new_data := to_jsonb(NEW); v_row_data := v_new_data;
    -- Which columns actually changed?
    SELECT array_agg(kv.key ORDER BY kv.key) INTO v_changed_fields
    FROM jsonb_each(v_old_data) AS kv
    WHERE kv.value IS DISTINCT FROM (v_new_data -> kv.key);

    -- Flag sensitive changes by table + field
    IF TG_TABLE_NAME = 'payments' AND (v_old_data->>'amount') IS DISTINCT FROM (v_new_data->>'amount') THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'sales' AND (
         (v_old_data->>'sale_price') IS DISTINCT FROM (v_new_data->>'sale_price')
      OR (v_old_data->>'net_amount') IS DISTINCT FROM (v_new_data->>'net_amount')) THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'installments' AND (v_old_data->>'amount_due') IS DISTINCT FROM (v_new_data->>'amount_due') THEN
      v_is_sensitive := TRUE;
    END IF;
    IF TG_TABLE_NAME = 'pdc_cheques'
       AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status')
       AND (v_new_data->>'status' = 'bounced' OR v_old_data->>'status' = 'bounced') THEN
      v_is_sensitive := TRUE;
    END IF;
  END IF;

  -- ── Backdated-entry warning (INSERT/UPDATE only; null-safe across tables) ──
  -- Not every table has payment_date / sale_date; absent columns -> NULL -> no-op.
  IF v_new_data IS NOT NULL THEN
    BEGIN
      IF NULLIF(v_new_data->>'payment_date','')::date < (CURRENT_DATE - 1)
         OR NULLIF(v_new_data->>'sale_date','')::date < (CURRENT_DATE - 1) THEN
        v_is_sensitive := TRUE;
        v_reason := 'backdated_entry';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- malformed/non-date value -> ignore, never break the parent op
    END;
  END IF;

  -- ── Record ID & company ─────────────────────────────────────────────
  v_record_id := COALESCE(v_row_data->>'id', '?');
  BEGIN
    v_company_id := (v_row_data->>'company_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_company_id := NULL; END;
  IF v_company_id IS NULL AND v_auth_uid IS NOT NULL THEN
    BEGIN
      SELECT company_id INTO v_company_id FROM public.app_users WHERE auth_user_id = v_auth_uid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ── Write audit log — wrapped so it NEVER fails the parent op ───────
  BEGIN
    INSERT INTO public.audit_logs (
      company_id, table_name, record_id, action, old_data, new_data, changed_fields,
      changed_by, changed_by_name, changed_by_role, is_sensitive, reason, module, ip_address, user_agent
    ) VALUES (
      v_company_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old_data, v_new_data, v_changed_fields,
      v_auth_uid, COALESCE(v_user_name, 'system'), COALESCE(v_user_role, 'unknown'),
      v_is_sensitive, v_reason, TG_TABLE_NAME, v_ip, v_user_agent
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[audit] %.% failed: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ── Attach _trg_audit to the 3 previously-uncovered operational tables ──
DROP TRIGGER IF EXISTS _trg_audit ON public.contact_logs;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.contact_logs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS _trg_audit ON public.follow_up_reminders;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.follow_up_reminders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS _trg_audit ON public.approval_requests;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
