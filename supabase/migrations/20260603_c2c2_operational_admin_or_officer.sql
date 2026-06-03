-- BATCH C2-c2 (2026-06-03): gate the remaining operational mutators (admin-or-assigned-officer).
-- Same gate as c2c1 (FOUND-based existence check). Special handling:
--   * cancel_payment_link / cancel_promise / mark_promise_kept have NO p_company_id param -> company_id & project_id
--     derived from the target row (also closes a pre-existing no-company-filter cross-tenant hole on the promises).
--   * update_campaign / close_campaign operate on recovery_campaigns (no project_id) -> admin OR any non-manager (company-level).
--   * upload_payment_screenshot: anon_exec=false (NOT buyer-reachable), called by staff (payment-links.js) -> gated like the rest,
--     deriving company/project from the payment_link; the link sent/expiry checks are retained.

CREATE OR REPLACE FUNCTION public.update_escalation(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM public.escalations WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','escalation_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE public.escalations SET
    status=COALESCE(p_data->>'status', status),
    resolution_note=COALESCE(NULLIF(p_data->>'resolution_note',''), resolution_note),
    resolved_at=COALESCE((p_data->>'resolved_at')::timestamptz, resolved_at),
    to_level=COALESCE((p_data->>'to_level')::int, to_level), updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

CREATE OR REPLACE FUNCTION public.update_noc_status(p_id uuid, p_company_id uuid, p_status text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM public.noc WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','noc_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF p_status = 'under_review' THEN
    UPDATE noc SET status='under_review', reviewed_by=p_data->>'reviewed_by', reviewed_at=now(), updated_at=now() WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'approved' THEN
    UPDATE noc SET status='approved', approved_by=p_data->>'approved_by', approved_at=now(),
      valid_from=COALESCE(NULLIF(p_data->>'valid_from','')::date, CURRENT_DATE), valid_until=NULLIF(p_data->>'valid_until','')::date, updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'rejected' THEN
    UPDATE noc SET status='rejected', reviewed_by=p_data->>'reviewed_by', reviewed_at=now(), rejection_reason=p_data->>'rejection_reason', updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'revoked' THEN
    UPDATE noc SET status='revoked', revoked_by=p_data->>'revoked_by', revoked_at=now(), revocation_reason=p_data->>'revocation_reason', updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.add_legal_document(p_company_id uuid, p_case_id uuid, p_doc jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid; v_docs jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id, documents INTO v_project, v_docs FROM public.legal_cases WHERE id=p_case_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Case not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE public.legal_cases SET documents=COALESCE(v_docs,'[]'::jsonb) || jsonb_build_array(p_doc), updated_at=now() WHERE id=p_case_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true);
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_payment_link(p_payment_link_id uuid, p_cancelled_by text, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_link RECORD;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  SELECT id, status, ref_code, company_id, project_id INTO v_link FROM public.payment_links WHERE id=p_payment_link_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'link_not_found'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM v_link.company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_link.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=v_link.company_id AND project_id=v_link.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_link.status NOT IN ('sent', 'screenshot_received') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'current_status', v_link.status); END IF;
  UPDATE public.payment_links SET status='cancelled', updated_at=NOW() WHERE id=p_payment_link_id;
  INSERT INTO public.payment_link_status_history (payment_link_id, from_status, to_status, changed_by, notes)
  VALUES (p_payment_link_id, v_link.status, 'cancelled', p_cancelled_by, COALESCE(p_reason, 'Cancelled'));
  RETURN jsonb_build_object('success', true, 'ref_code', v_link.ref_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_promise(p_promise_id uuid, p_cancel_reason text DEFAULT NULL::text, p_updated_by text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_co uuid; v_project uuid; v_status text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  SELECT company_id, project_id, status INTO v_co, v_project, v_status FROM public.payment_promises WHERE id=p_promise_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_found_or_not_pending'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM v_co THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=v_co AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE payment_promises SET status='cancelled',
    notes=COALESCE(notes || ' | ', '') || 'Cancelled: ' || COALESCE(p_cancel_reason, 'No reason given'), updated_at=NOW()
  WHERE id=p_promise_id AND company_id=v_co AND status='pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_found_or_not_pending'); END IF;
  RETURN jsonb_build_object('success', true, 'id', p_promise_id, 'status', 'cancelled');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.mark_promise_kept(p_promise_id uuid, p_actual_amount numeric, p_actual_date date DEFAULT NULL::date, p_actual_via text DEFAULT NULL::text, p_related_payment_id uuid DEFAULT NULL::uuid, p_updated_by text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_co uuid; v_project uuid; v_promised numeric; v_status text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  SELECT company_id, project_id, promised_amount, status INTO v_co, v_project, v_promised, v_status FROM public.payment_promises WHERE id=p_promise_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_found'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM v_co THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=v_co AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'promise_not_pending'); END IF;
  UPDATE payment_promises SET
    status=CASE WHEN COALESCE(p_actual_amount,0) >= v_promised THEN 'kept' ELSE 'partial' END,
    actual_paid_amount=COALESCE(p_actual_amount, 0), actual_paid_date=COALESCE(p_actual_date, CURRENT_DATE),
    actual_paid_via=p_actual_via, related_payment_id=p_related_payment_id, updated_at=NOW()
  WHERE id=p_promise_id AND company_id=v_co;
  RETURN (SELECT jsonb_build_object('success', true, 'id', pp.id, 'status', pp.status, 'actual_paid_amount', pp.actual_paid_amount) FROM payment_promises pp WHERE pp.id=p_promise_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_campaign(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) AND v_me.role='manager' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM recovery_campaigns WHERE id=p_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found'); END IF;
  UPDATE recovery_campaigns SET
    name=COALESCE(NULLIF(p_data->>'name',''), name), description=COALESCE(p_data->>'description', description),
    target_amount=COALESCE((p_data->>'target_amount')::numeric, target_amount),
    start_date=COALESCE(NULLIF(p_data->>'start_date','')::date, start_date),
    end_date=COALESCE(NULLIF(p_data->>'end_date','')::date, end_date), updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.close_campaign(p_id uuid, p_company_id uuid, p_outcome_summary text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) AND v_me.role='manager' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
  UPDATE recovery_campaigns SET status='closed', outcome_summary=COALESCE(p_outcome_summary, outcome_summary), closed_at=now(), updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.upload_payment_screenshot(p_payment_link_id uuid, p_screenshot_url text, p_uploaded_by text, p_client_claimed_amount numeric DEFAULT NULL::numeric, p_client_claimed_method text DEFAULT NULL::text, p_client_claimed_ref text DEFAULT NULL::text, p_client_claimed_date date DEFAULT NULL::date, p_client_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_link RECORD;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  SELECT id, status, expires_at, company_id, project_id INTO v_link FROM payment_links WHERE id=p_payment_link_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment link not found'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM v_link.company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_link.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=v_link.company_id AND project_id=v_link.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'link_expired'); END IF;
  IF v_link.status <> 'sent' THEN RETURN jsonb_build_object('success', false, 'error', 'Link must be in sent status'); END IF;
  UPDATE payment_links SET status='screenshot_received', screenshot_url=p_screenshot_url, screenshot_uploaded_by=p_uploaded_by,
    screenshot_received_at=NOW(), client_claimed_amount=p_client_claimed_amount, client_claimed_method=p_client_claimed_method,
    client_claimed_ref=p_client_claimed_ref, client_claimed_date=p_client_claimed_date, client_notes=p_client_notes, updated_at=NOW()
  WHERE id=p_payment_link_id;
  INSERT INTO payment_link_status_history (payment_link_id, from_status, to_status, changed_by, notes)
  VALUES (p_payment_link_id, 'sent', 'screenshot_received', p_uploaded_by, 'Screenshot uploaded');
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
