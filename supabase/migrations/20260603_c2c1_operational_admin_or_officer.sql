-- BATCH C2-c1 (2026-06-03): gate operational mutators as ADMIN-or-ASSIGNED-OFFICER.
-- Full cancel_payment-style gate: null->auth_required; tenant-match->wrong_tenant;
--   manager->read-only forbidden; non-admin officer must hold an active user_project_assignment for the row's project.
-- Project derived from the row's own project_id. Existence gated via PL/pgSQL FOUND (NOT a v_found boolean,
--   which would be NULL on a no-row SELECT INTO and fall through).
-- Deliberate hardening: update_unit project_id is IMMUTABLE; upsert_client CREATE path is admin-only and requires
--   a valid in-company project_id (project_required / project_not_in_company), matching create_client.

CREATE OR REPLACE FUNCTION public.update_pdc_cheque(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller(); v_project uuid;
  v_allowed text[] := ARRAY['cheque_no','bank_name','amount','cheque_date','received_date','status','notes',
    'bounce_reason','bounce_date','penalty_amount','penalty_collected','penalty_date','penalty_notes',
    'deposit_date','clearance_date','sale_id','client_id'];
  v_setters text := ''; v_key text; v_sql text;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM pdc_cheques WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','pdc_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_data) LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters || format('%I = NULLIF($1->>%L, %L)::%s, ', v_key, v_key, '',
        CASE v_key WHEN 'amount' THEN 'numeric' WHEN 'penalty_amount' THEN 'numeric'
          WHEN 'cheque_date' THEN 'date' WHEN 'received_date' THEN 'date' WHEN 'bounce_date' THEN 'date'
          WHEN 'penalty_date' THEN 'date' WHEN 'deposit_date' THEN 'date' WHEN 'clearance_date' THEN 'date'
          WHEN 'sale_id' THEN 'uuid' WHEN 'client_id' THEN 'uuid' WHEN 'penalty_collected' THEN 'boolean' ELSE 'text' END);
    END IF;
  END LOOP;
  IF v_setters = '' THEN RETURN jsonb_build_object('success', true, 'updated', 0); END IF;
  v_setters := v_setters || 'updated_at = now()';
  v_sql := format('UPDATE pdc_cheques SET %s WHERE id = %L AND company_id = %L', v_setters, p_id, p_company_id);
  EXECUTE v_sql USING p_data;
  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.mark_pdc_bounced(p_cheque_id uuid, p_company_id uuid, p_bounce_date date, p_bounce_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_row pdc_cheques%ROWTYPE; v_has_open_escalation boolean; v_escalation_id uuid := NULL;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT * INTO v_row FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_row.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_row.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_row.status = 'cleared' THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot bounce a cleared cheque'); END IF;
  UPDATE pdc_cheques SET status='bounced', bounce_date=p_bounce_date, bounce_reason=p_bounce_reason, updated_at=NOW()
   WHERE id=p_cheque_id AND company_id=p_company_id;
  IF v_row.payment_id IS NOT NULL THEN
    UPDATE payments SET status='bounced', updated_at=NOW() WHERE id=v_row.payment_id AND company_id=p_company_id;
  END IF;
  IF v_row.client_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM escalations WHERE client_id=v_row.client_id AND company_id=p_company_id AND status='open') INTO v_has_open_escalation;
    IF NOT v_has_open_escalation THEN
      INSERT INTO escalations (company_id, client_id, from_level, to_level, reason, status, created_at, updated_at)
      VALUES (p_company_id, v_row.client_id, 1, 2,
        'Auto-escalated: PDC cheque ' || COALESCE(v_row.cheque_no,'?') || ' bounced (PKR ' || COALESCE(v_row.amount,0)::text || ')' || COALESCE(' — ' || p_bounce_reason, ''),
        'open', NOW(), NOW()) RETURNING id INTO v_escalation_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'cheque_no', v_row.cheque_no, 'auto_escalated', v_escalation_id IS NOT NULL, 'escalation_id', v_escalation_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.mark_pdc_cleared(p_cheque_id uuid, p_company_id uuid, p_cleared_date date, p_deposit_ref text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_row pdc_cheques%ROWTYPE;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT * INTO v_row FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_row.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_row.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_row.status = 'cleared' THEN RETURN jsonb_build_object('success', false, 'error', 'Already cleared'); END IF;
  UPDATE pdc_cheques SET status='cleared', clearance_date=p_cleared_date, deposit_date=COALESCE(deposit_date, p_cleared_date),
      notes = CASE WHEN p_deposit_ref IS NOT NULL THEN COALESCE(notes || ' | ', '') || 'Deposit Ref: ' || p_deposit_ref ELSE notes END, updated_at=NOW()
  WHERE id=p_cheque_id AND company_id=p_company_id;
  IF v_row.payment_id IS NOT NULL THEN
    UPDATE payments SET status='cleared', updated_at=NOW() WHERE id=v_row.payment_id AND company_id=p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'cheque_no', v_row.cheque_no);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.mark_pdc_deposited(p_cheque_id uuid, p_company_id uuid, p_deposit_date date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_status text; v_project uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT status, project_id INTO v_status, v_project FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_status IN ('cleared','bounced') THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque already ' || v_status); END IF;
  UPDATE pdc_cheques SET status='presented', deposit_date=COALESCE(p_deposit_date, deposit_date, CURRENT_DATE), updated_at=NOW()
   WHERE id=p_cheque_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true, 'id', p_cheque_id, 'status', 'presented');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.redeposit_pdc(p_cheque_id uuid, p_company_id uuid, p_new_deposit_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_row pdc_cheques%ROWTYPE;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT * INTO v_row FROM pdc_cheques WHERE id=p_cheque_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Cheque not found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_row.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_row.project_id AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  IF v_row.status <> 'bounced' THEN RETURN jsonb_build_object('success', false, 'error', 'Only a bounced cheque can be re-deposited'); END IF;
  IF p_new_deposit_date IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'new_deposit_date_required'); END IF;
  UPDATE pdc_cheques SET status='presented', deposit_date=p_new_deposit_date,
     notes=COALESCE(notes || ' | ', '') || 'Re-deposited (prev bounce ' || COALESCE(v_row.bounce_date::text,'?') || ')', updated_at=NOW()
   WHERE id=p_cheque_id AND company_id=p_company_id;
  IF v_row.payment_id IS NOT NULL THEN
    UPDATE payments SET status='pending', updated_at=NOW() WHERE id=v_row.payment_id AND company_id=p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', p_cheque_id, 'status', 'presented', 'deposit_date', p_new_deposit_date);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.schedule_pdc_deposit_bulk(p_company_id uuid, p_cheque_ids jsonb, p_deposit_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_admin boolean; v_pids uuid[]; v_count int := 0; v_id uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF p_company_id IS NULL OR p_cheque_ids IS NULL OR p_deposit_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params'); END IF;
  IF jsonb_typeof(p_cheque_ids) <> 'array' THEN RETURN jsonb_build_object('success', false, 'error', 'cheque_ids_must_be_array'); END IF;
  v_admin := public._rms_is_admin(v_me);
  IF NOT v_admin THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    SELECT COALESCE(array_agg(project_id),'{}'::uuid[]) INTO v_pids FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND is_active;
  END IF;
  FOR v_id IN SELECT (value #>> '{}')::uuid FROM jsonb_array_elements(p_cheque_ids) LOOP
    UPDATE pdc_cheques SET deposit_date=p_deposit_date,
           status=CASE WHEN status='pending' THEN 'presented' ELSE status END, updated_at=NOW()
     WHERE id=v_id AND company_id=p_company_id AND status NOT IN ('cleared','bounced','cancelled')
       AND (v_admin OR project_id = ANY(v_pids));
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'scheduled', v_count);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_unit(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid; v_rows integer;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM public.units WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Unit not found or access denied'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE public.units SET
    unit_no=COALESCE(p_data->>'unit_no', unit_no),
    unit_type_id=CASE WHEN p_data ? 'unit_type_id' THEN NULLIF(p_data->>'unit_type_id','')::UUID ELSE unit_type_id END,
    status_id=CASE WHEN p_data ? 'status_id' THEN NULLIF(p_data->>'status_id','')::UUID ELSE status_id END,
    floor_id=CASE WHEN p_data ? 'floor_id' THEN NULLIF(p_data->>'floor_id','')::UUID ELSE floor_id END,
    floor_no=CASE WHEN p_data ? 'floor_no' THEN NULLIF(p_data->>'floor_no','')::INTEGER ELSE floor_no END,
    floor_label=CASE WHEN p_data ? 'floor_label' THEN NULLIF(p_data->>'floor_label','') ELSE floor_label END,
    block=CASE WHEN p_data ? 'block' THEN NULLIF(p_data->>'block','') ELSE block END,
    area=CASE WHEN p_data ? 'area' THEN NULLIF(p_data->>'area','')::NUMERIC ELSE area END,
    carpet_area=CASE WHEN p_data ? 'carpet_area' THEN NULLIF(p_data->>'carpet_area','')::NUMERIC ELSE carpet_area END,
    area_unit=CASE WHEN p_data ? 'area_unit' THEN COALESCE(NULLIF(p_data->>'area_unit',''),'sqft') ELSE area_unit END,
    bedrooms=CASE WHEN p_data ? 'bedrooms' THEN NULLIF(p_data->>'bedrooms','')::INTEGER ELSE bedrooms END,
    bathrooms=CASE WHEN p_data ? 'bathrooms' THEN NULLIF(p_data->>'bathrooms','')::INTEGER ELSE bathrooms END,
    parking_count=CASE WHEN p_data ? 'parking_count' THEN COALESCE(NULLIF(p_data->>'parking_count','')::INTEGER,0) ELSE parking_count END,
    facing=CASE WHEN p_data ? 'facing' THEN NULLIF(p_data->>'facing','') ELSE facing END,
    base_price=CASE WHEN p_data ? 'base_price' THEN COALESCE(NULLIF(p_data->>'base_price','')::NUMERIC,0) ELSE base_price END,
    features=CASE WHEN p_data ? 'features' THEN COALESCE(p_data->'features','{}'::JSONB) ELSE features END,
    notes=CASE WHEN p_data ? 'notes' THEN NULLIF(p_data->>'notes','') ELSE notes END,
    is_premium=CASE WHEN p_data ? 'is_premium' THEN COALESCE((p_data->>'is_premium')::BOOLEAN,false) ELSE is_premium END,
    is_corner=CASE WHEN p_data ? 'is_corner' THEN COALESCE((p_data->>'is_corner')::BOOLEAN,false) ELSE is_corner END,
    maintenance_monthly=CASE WHEN p_data ? 'maintenance_monthly' THEN NULLIF(p_data->>'maintenance_monthly','')::NUMERIC ELSE maintenance_monthly END,
    possession_date=CASE WHEN p_data ? 'possession_date' THEN NULLIF(p_data->>'possession_date','')::DATE ELSE possession_date END,
    handover_status=CASE WHEN p_data ? 'handover_status' THEN NULLIF(p_data->>'handover_status','') ELSE handover_status END,
    transfer_history=CASE WHEN p_data ? 'transfer_history' THEN NULLIF(p_data->>'transfer_history','') ELSE transfer_history END,
    image_urls=CASE WHEN p_data ? 'image_urls' THEN COALESCE(p_data->'image_urls','[]'::JSONB) ELSE image_urls END,
    document_urls=CASE WHEN p_data ? 'document_urls' THEN COALESCE(p_data->'document_urls','[]'::JSONB) ELSE document_urls END,
    updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('success',false,'error','Unit not found or access denied'); END IF;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_unit_possession_fields(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM public.units WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE public.units SET
    handover_status=COALESCE(p_data->>'handover_status', handover_status),
    possession_date=COALESCE(NULLIF(p_data->>'possession_date','')::date, possession_date)
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

CREATE OR REPLACE FUNCTION public.set_client_comms_optout(p_client_id uuid, p_company_id uuid, p_opt_out boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_project uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  SELECT project_id INTO v_project FROM clients WHERE id=p_client_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'client_not_found'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
  END IF;
  UPDATE clients SET comms_opt_out = COALESCE(p_opt_out, false) WHERE id=p_client_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true, 'client_id', p_client_id, 'comms_opt_out', COALESCE(p_opt_out,false));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.upsert_client(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_id uuid; v_row record; v_data jsonb; v_project uuid; v_new_proj uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF p_id IS NULL THEN
    IF NOT public._rms_is_admin(v_me) THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Only an admin can create clients.'); END IF;
    v_new_proj := NULLIF(p_data->>'project_id','')::uuid;
    IF v_new_proj IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','project_required','message','A project must be selected for this client.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=v_new_proj AND company_id=p_company_id) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_in_company','message','The selected project does not belong to your company.'); END IF;
    v_data := p_data || jsonb_build_object('company_id', p_company_id);
    IF NULLIF(v_data->>'id','') IS NULL THEN v_data := v_data || jsonb_build_object('id', gen_random_uuid()); END IF;
    IF NULLIF(v_data->>'status','') IS NULL THEN v_data := v_data || jsonb_build_object('status', 'active'); END IF;
    IF NULLIF(v_data->>'comms_opt_out','') IS NULL THEN v_data := v_data || jsonb_build_object('comms_opt_out', false); END IF;
    INSERT INTO public.clients SELECT * FROM jsonb_populate_record(NULL::public.clients, v_data) RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSE
    SELECT project_id INTO v_project FROM public.clients WHERE id=p_id AND company_id=p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;
    IF NOT public._rms_is_admin(v_me) THEN
      IF v_me.role='manager' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
      IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
          WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
        RETURN jsonb_build_object('success',false,'error','project_not_assigned'); END IF;
    END IF;
    UPDATE public.clients SET
      full_name=COALESCE(p_data->>'full_name', full_name), father_name=COALESCE(p_data->>'father_name', father_name),
      cnic=COALESCE(p_data->>'cnic', cnic), passport_no=COALESCE(p_data->>'passport_no', passport_no),
      phone_primary=COALESCE(p_data->>'phone_primary', phone_primary), phone_secondary=COALESCE(p_data->>'phone_secondary', phone_secondary),
      whatsapp=COALESCE(p_data->>'whatsapp', whatsapp), email=COALESCE(p_data->>'email', email),
      address=COALESCE(p_data->>'address', address), city=COALESCE(p_data->>'city', city), country=COALESCE(p_data->>'country', country),
      occupation=COALESCE(p_data->>'occupation', occupation), company_name=COALESCE(p_data->>'company_name', company_name),
      reference_by=COALESCE(p_data->>'reference_by', reference_by), client_category=COALESCE(p_data->>'client_category', client_category),
      notes=COALESCE(p_data->>'notes', notes), status=COALESCE(p_data->>'status', status),
      client_photo_url=COALESCE(p_data->>'client_photo_url', client_photo_url),
      cnic_front_url=COALESCE(p_data->>'cnic_front_url', cnic_front_url), cnic_back_url=COALESCE(p_data->>'cnic_back_url', cnic_back_url),
      overseas_local=COALESCE(p_data->>'overseas_local', overseas_local),
      next_of_kin_name=COALESCE(p_data->>'next_of_kin_name', next_of_kin_name),
      next_of_kin_relation=COALESCE(p_data->>'next_of_kin_relation', next_of_kin_relation),
      next_of_kin_phone=COALESCE(p_data->>'next_of_kin_phone', next_of_kin_phone),
      lead_source=COALESCE(p_data->>'lead_source', lead_source), bank_name=COALESCE(p_data->>'bank_name', bank_name),
      bank_account_title=COALESCE(p_data->>'bank_account_title', bank_account_title),
      bank_account_no=COALESCE(p_data->>'bank_account_no', bank_account_no), bank_iban=COALESCE(p_data->>'bank_iban', bank_iban),
      metadata=COALESCE(p_data->'metadata', metadata), updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;
