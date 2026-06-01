-- Explicit MANAGER read-only block on all 7 gated doer-RPCs.
-- The existing gates are role-blind (non-admin + active user_project_assignment → allowed),
-- so a manager granted a UPA could write. Managers are read-only oversight and must NEVER
-- write via these RPCs. Surgical change only: inside each existing
--   IF NOT public._rms_is_admin(v_me) THEN
-- add a manager block as the FIRST check, BEFORE the UPA check. Everything else byte-identical
-- (return envelopes, project resolution, UPA check, inserts, EXCEPTION blocks, search_path).
-- role column = app_users.role; manager value = 'manager'.

-- ── 1. create_contact_log ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_contact_log(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row jsonb;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_project uuid; v_client uuid; v_sale uuid;
  v_enriched jsonb;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
    SELECT s.id, s.client_id INTO v_sale, v_client
      FROM public.sales s
      WHERE s.unit_id = v_unit AND s.company_id = p_company_id AND s.status <> 'cancelled'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project) AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project),
         'client_id',  COALESCE(NULLIF(p_data->>'client_id','')::uuid,  v_client),
         'sale_id',    COALESCE(NULLIF(p_data->>'sale_id','')::uuid,     v_sale)));

  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'created_at','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('created_at', now());
  END IF;

  INSERT INTO public.contact_logs
  SELECT * FROM jsonb_populate_record(NULL::public.contact_logs, v_enriched)
  RETURNING id INTO v_id;

  SELECT to_jsonb(cl) INTO v_row FROM public.contact_logs cl WHERE cl.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $function$;

-- ── 2. create_follow_up_reminder ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_follow_up_reminder(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_project IS NULL AND v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
  END IF;
  IF v_project IS NULL AND v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = v_project AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO public.follow_up_reminders (
    company_id, contact_log_id, unit_id, client_id, sale_id, project_id,
    remind_at, channels, message, status, created_by
  ) VALUES (
    p_company_id,
    NULLIF(p_data->>'contact_log_id','')::uuid,
    v_unit,
    NULLIF(p_data->>'client_id','')::uuid,
    v_sale,
    v_project,
    (p_data->>'remind_at')::timestamptz,
    CASE WHEN p_data->'channels' IS NULL THEN '{}'::text[]
         ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'channels')) END,
    NULLIF(p_data->>'message',''),
    COALESCE(p_data->>'status', 'pending'),
    NULLIF(p_data->>'created_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 3. create_payment_promise ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_promise(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid;
  v_enriched jsonb;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project) AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project)));

  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'promise_made_on','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('promise_made_on', CURRENT_DATE);
  END IF;
  IF NULLIF(v_enriched->>'logged_by','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('logged_by', '');
  END IF;
  IF NULLIF(v_enriched->>'status','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('status', 'pending');
  END IF;

  INSERT INTO public.payment_promises
  SELECT * FROM jsonb_populate_record(NULL::public.payment_promises, v_enriched)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 4. log_payment_promise ────────────────────────────────────────────────────
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
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
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

-- ── 5. create_reminder_log ────────────────────────────────────────────────────
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
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
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

-- ── 6. log_field_visit ────────────────────────────────────────────────────────
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
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
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

-- ── 7. create_escalation ──────────────────────────────────────────────────────
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
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden',
        'message','Managers have read-only access.');
    END IF;
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
