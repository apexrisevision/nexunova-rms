-- ══ PHASE 2B — AUDIT LOG HARDENING (final consolidated state) ═════════════════
-- Applied to prod via MCP 2026-07-06. The Audit Log itself (audit_logs table,
-- audit_trigger_function on 27 tables, director-only viewer via definer RPCs) was
-- already live; this migration closes three gaps:
--   P0  append-only lock (revoke write/truncate grants)
--   P1  coverage: subscriptions trigger + units.status flagged sensitive
--   P2  required-reason plumbing on destructive money paths + reason in viewer

-- ── P0: structural append-only ───────────────────────────────────────────────
-- The write trigger + read RPCs are SECURITY DEFINER (run as owner), so these
-- grants are unnecessary. Revoking closes the TRUNCATE hole (TRUNCATE bypasses RLS)
-- and enforces immutability. RLS deny_all_anon remains as belt-and-suspenders.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated, PUBLIC;

-- ── P1 + P2 trigger: units.status + subscriptions sensitive; operator reason wins ─
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    IF TG_TABLE_NAME = 'units' AND (v_old_data->>'status') IS DISTINCT FROM (v_new_data->>'status') THEN v_is_sensitive := TRUE; END IF;  -- P1
    IF TG_TABLE_NAME = 'subscriptions' THEN v_is_sensitive := TRUE; END IF;  -- P1
  END IF;

  IF v_new_data IS NOT NULL THEN
    BEGIN
      IF NULLIF(v_new_data->>'payment_date','')::date < (CURRENT_DATE - 1)
         OR NULLIF(v_new_data->>'sale_date','')::date < (CURRENT_DATE - 1) THEN
        v_is_sensitive := TRUE; v_reason := 'backdated_entry';
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- P2: operator-entered reason (from the destructive-money RPCs) WINS over the auto tag.
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

DROP TRIGGER IF EXISTS _trg_audit ON public.subscriptions;
CREATE TRIGGER _trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ── P2: required-reason (min 10 chars) on destructive money paths ─────────────
-- cancel_payment — reason mandatory for ALL callers; propagated to the audit row.
CREATE OR REPLACE FUNCTION public.cancel_payment(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_level text; v_project uuid; v_found boolean; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  IF length(TRIM(COALESCE(p_reason,''))) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required',
      'message', 'A reason (at least 10 characters) is required to void a payment.');
  END IF;
  PERFORM set_config('rms.audit_reason', p_reason, true);

  SELECT true, s.project_id INTO v_found, v_project
  FROM public.payments p LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._cancel_payment_core(p_payment_id, p_company_id, COALESCE(p_cancelled_by, v_me.id));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'payment_void');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'payment_void');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'payments', p_payment_id::text, 'restriction_warning', true, 'restrictions', p_reason);
    RETURN public._cancel_payment_core(p_payment_id, p_company_id, COALESCE(p_cancelled_by, v_me.id));
  ELSE
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','payment_void','entity_table','payments','entity_id',p_payment_id,
      'project_id',v_project,'title','Payment void','comment',p_reason,
      'payload',jsonb_build_object('payment_id',p_payment_id,'reason',p_reason)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- edit_sale — reason required ONLY when a protected field's VALUE actually changes
-- (numeric-aware, applies to admins too); reason propagated to the audit row.
CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_res jsonb; v_sale_row jsonb;
  v_protected_keys text[] := ARRAY['discount','discount_amount','discount_percentage','price_per_sqft','area_sqft',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_prot jsonb; v_benign jsonb; v_changed_prot int;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true, project_id, to_jsonb(s.*) INTO v_found, v_project, v_sale_row
    FROM public.sales s WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT jsonb_object_agg(k, p_data->k) INTO v_prot FROM unnest(v_protected_keys) k WHERE p_data ? k;
  v_benign := p_data - v_protected_keys;

  SELECT count(*) INTO v_changed_prot FROM unnest(v_protected_keys) k
   WHERE p_data ? k AND (
     CASE WHEN (p_data->>k) ~ '^-?[0-9]+(\.[0-9]+)?$' AND (v_sale_row->>k) ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (p_data->>k)::numeric IS DISTINCT FROM (v_sale_row->>k)::numeric
          ELSE (p_data->>k) IS DISTINCT FROM (v_sale_row->>k)
     END);
  IF v_changed_prot > 0 THEN
    IF length(TRIM(COALESCE(p_reason,''))) < 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message', 'A reason (at least 10 characters) is required for price/discount/status changes.');
    END IF;
    PERFORM set_config('rms.audit_reason', p_reason, true);
  END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_sale_core(p_sale_id, p_company_id, p_data);
  END IF;

  IF v_benign <> '{}'::jsonb THEN
    v_res := public._edit_sale_core(p_sale_id, p_company_id, v_benign);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  IF v_prot IS NULL THEN RETURN jsonb_build_object('success', true); END IF;

  v_level := public._rms_restriction_level(p_company_id, 'sale_edit');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'sale_edit');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', v_prot, true, 'restrictions', p_reason);
    RETURN public._edit_sale_core(p_sale_id, p_company_id, v_prot);
  ELSE
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required','message','A reason is required to request protected sale changes (discount/price/status).'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','sale_edit','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Protected sale edit','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'fields',v_prot)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- delete_payment — dead (EXECUTE revoked, no caller) but destructive: add a
-- REQUIRED reason + audit propagation for defense; keep it revoked.
DROP FUNCTION IF EXISTS public.delete_payment(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id uuid, p_company_id uuid, p_deleted_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_amount numeric; v_sale_id uuid; v_pay_code text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  IF length(TRIM(COALESCE(p_reason,''))) < 10 THEN
    RETURN jsonb_build_object('success',false,'error','reason_required',
      'message','A reason (at least 10 characters) is required to delete a payment.'); END IF;
  PERFORM set_config('rms.audit_reason', p_reason, true);

  SELECT amount, sale_id, payment_code INTO v_amount, v_sale_id, v_pay_code
  FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','payment_not_found'); END IF;

  DELETE FROM public.payments WHERE id=p_payment_id AND company_id=p_company_id;
  IF v_sale_id IS NOT NULL THEN PERFORM public._rms_rebuild_sale_allocation(p_company_id, v_sale_id); END IF;

  RETURN jsonb_build_object('success',true,'payment_code',v_pay_code,'reversed',v_amount);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.delete_payment(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Viewer: surface `reason` in the diff modal + record timeline ─────────────
DROP FUNCTION IF EXISTS public.get_audit_entry(uuid, bigint);
CREATE OR REPLACE FUNCTION public.get_audit_entry(p_company_id uuid, p_audit_id bigint)
 RETURNS TABLE(id bigint, table_name text, record_id text, action text, changed_fields text[], old_data jsonb, new_data jsonb, changed_by uuid, changed_by_name text, changed_by_role text, changed_at timestamp with time zone, ip_address inet, user_agent text, module text, is_sensitive boolean, reason text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.id, a.table_name, a.record_id, a.action, a.changed_fields,
         a.old_data, a.new_data, a.changed_by, a.changed_by_name, a.changed_by_role,
         a.changed_at, a.ip_address, a.user_agent, a.module, a.is_sensitive, a.reason
    FROM public.audit_logs a WHERE a.company_id = p_company_id AND a.id = p_audit_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_audit_entry(uuid, bigint) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.get_record_history(uuid, text, text);
CREATE OR REPLACE FUNCTION public.get_record_history(p_company_id uuid, p_table_name text, p_record_id text)
 RETURNS TABLE(id bigint, action text, changed_fields text[], old_data jsonb, new_data jsonb, changed_by uuid, changed_by_name text, changed_by_role text, changed_at timestamp with time zone, is_sensitive boolean, reason text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.id, a.action, a.changed_fields, a.old_data, a.new_data,
         a.changed_by, a.changed_by_name, a.changed_by_role, a.changed_at, a.is_sensitive, a.reason
  FROM public.audit_logs a
  WHERE a.company_id = p_company_id AND a.table_name = p_table_name AND a.record_id = p_record_id
  ORDER BY a.changed_at ASC;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_record_history(uuid, text, text) TO authenticated, anon;
