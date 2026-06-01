-- Project-isolation gates — Batch 2 (the doer-RPCs that do NOT derive project internally).
-- Non-admins must be assigned (user_project_assignments) to the row's resolved project.
-- Admin/owner/super-admin and the no-session service path bypass (matches record_payment + batch 1).
-- v_proj is resolved from the available id (sale/unit/client) purely for the AUTH check.
-- Bodies otherwise byte-for-byte unchanged. EXCEPTION blocks preserved where present;
-- none added where absent. log_payment_promise also gains SET search_path=public (it lacked it).
--
-- NOTE: for create_reminder_log / log_field_visit, when no unit/sale/client link is supplied
-- v_proj is NULL → a non-admin caller is rejected with project_not_assigned (strict isolation).

-- ── 1. create_escalation (p_data; client_id req + sale_id opt; no EXCEPTION) ────
CREATE OR REPLACE FUNCTION public.create_escalation(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  v_proj := (SELECT project_id FROM public.sales WHERE id = NULLIF(p_data->>'sale_id','')::uuid AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.clients WHERE id = (p_data->>'client_id')::uuid AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO public.escalations (
    company_id, client_id, sale_id, from_level, to_level, reason,
    escalated_by, escalated_to, status
  ) VALUES (
    p_company_id, (p_data->>'client_id')::uuid, NULLIF(p_data->>'sale_id','')::uuid,
    COALESCE((p_data->>'from_level')::int, 1), (p_data->>'to_level')::int,
    p_data->>'reason', NULLIF(p_data->>'escalated_by','')::uuid,
    NULLIF(p_data->>'escalated_to','')::uuid, COALESCE(p_data->>'status', 'open')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 2. create_reminder_log (p_data; unit_id|sale_id; no EXCEPTION) ─────────────
CREATE OR REPLACE FUNCTION public.create_reminder_log(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  v_proj := (SELECT project_id FROM public.units WHERE id = NULLIF(p_data->>'unit_id','')::uuid AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.sales WHERE id = NULLIF(p_data->>'sale_id','')::uuid AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO public.reminder_logs (
    company_id, unit_id, sale_id, client_name, phone, reminder_type, amount_due, message, sent_by, notes, sent_at
  ) VALUES (
    p_company_id, NULLIF(p_data->>'unit_id','')::uuid, NULLIF(p_data->>'sale_id','')::uuid,
    NULLIF(p_data->>'client_name',''), NULLIF(p_data->>'phone',''),
    COALESCE(p_data->>'reminder_type','whatsapp'),
    COALESCE((p_data->>'amount_due')::numeric, 0),
    NULLIF(p_data->>'message',''), NULLIF(p_data->>'sent_by',''),
    NULLIF(p_data->>'notes',''),
    COALESCE((p_data->>'sent_at')::timestamptz, now())
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 3. log_field_visit (p_data; unit_id|client_id; HAS EXCEPTION; table has no project_id) ──
CREATE OR REPLACE FUNCTION public.log_field_visit(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := gen_random_uuid();
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  IF NULLIF(trim(p_data->>'officer_name'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Officer name required');
  END IF;
  IF NULLIF(p_data->>'visit_date', '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Visit date required');
  END IF;

  v_proj := (SELECT project_id FROM public.units WHERE id = NULLIF(p_data->>'unit_id','')::uuid AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.clients WHERE id = NULLIF(p_data->>'client_id','')::uuid AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO field_visits (
    id, company_id,
    officer_id, officer_name,
    client_id, client_name, unit_id, unit_no, project_name,
    visit_date, visit_time,
    latitude, longitude, location_name,
    outcome, notes, photo_url
  ) VALUES (
    v_id, p_company_id,
    NULLIF(p_data->>'officer_id', '')::uuid,
    trim(p_data->>'officer_name'),
    NULLIF(p_data->>'client_id', '')::uuid,
    p_data->>'client_name',
    NULLIF(p_data->>'unit_id', '')::uuid,
    p_data->>'unit_no',
    p_data->>'project_name',
    (p_data->>'visit_date')::date,
    NULLIF(p_data->>'visit_time', '')::time,
    NULLIF(p_data->>'latitude', '')::numeric,
    NULLIF(p_data->>'longitude', '')::numeric,
    p_data->>'location_name',
    COALESCE(NULLIF(p_data->>'outcome', ''), 'other'),
    p_data->>'notes',
    p_data->>'photo_url'
  );
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── 4. log_payment_promise (explicit args; HAS EXCEPTION; gains search_path) ───
CREATE OR REPLACE FUNCTION public.log_payment_promise(p_company_id uuid, p_client_id uuid, p_promised_amount numeric, p_promise_date date, p_sale_id uuid DEFAULT NULL::uuid, p_installment_id uuid DEFAULT NULL::uuid, p_promised_via text DEFAULT 'call'::text, p_promised_by_client text DEFAULT NULL::text, p_logged_by text DEFAULT ''::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_existing UUID;
  v_me public.app_users := public._rms_caller();
  v_proj uuid;
BEGIN
  IF COALESCE(p_promised_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;
  IF p_promise_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_date_required');
  END IF;

  v_proj := (SELECT project_id FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id);
  IF v_proj IS NULL THEN
    v_proj := (SELECT project_id FROM public.clients WHERE id = p_client_id AND company_id = p_company_id);
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_proj IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_proj AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  IF p_installment_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM payment_promises
    WHERE installment_id = p_installment_id AND status = 'pending' AND company_id = p_company_id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_active_promise', 'existing_id', v_existing);
    END IF;
  END IF;

  INSERT INTO payment_promises (
    company_id, client_id, sale_id, installment_id,
    promised_amount, promise_date, promised_via,
    promised_by_client, logged_by, notes
  ) VALUES (
    p_company_id, p_client_id, p_sale_id, p_installment_id,
    p_promised_amount, p_promise_date, COALESCE(p_promised_via, 'call'),
    p_promised_by_client, COALESCE(p_logged_by, ''), p_notes
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO contact_logs (
      company_id, client_id, sale_id, channel, direction,
      contact_date, response_received, promise_to_pay,
      promise_amount, promise_date, remarks, status_tag
    ) VALUES (
      p_company_id, p_client_id, p_sale_id,
      COALESCE(p_promised_via, 'call'), 'outbound',
      CURRENT_DATE, 'Promised', TRUE,
      p_promised_amount, p_promise_date,
      COALESCE(p_notes, 'Payment promise logged'), 'promise'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN (SELECT jsonb_build_object(
    'success', true, 'id', pp.id,
    'promised_amount', pp.promised_amount, 'promise_date', pp.promise_date, 'status', pp.status
  ) FROM payment_promises pp WHERE pp.id = v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;$function$;
