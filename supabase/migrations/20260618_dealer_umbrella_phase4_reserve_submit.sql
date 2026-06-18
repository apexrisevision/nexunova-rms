-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — Phase 4: group-aware reserve_unit + submit_sale.
-- An umbrella dealer (sales_user in the group HOME company) can reserve/submit a
-- unit belonging to ANY member company. The reservation / sale_submission is created
-- in the UNIT'S OWN company → that company's admin approval queue + recovery +
-- commission own it (separation preserved). The submission's agent_id is the dealer's
-- agent in the unit's company (from dealer_company_agents, populated at approval).
-- Standalone companies (dealer_group_id NULL) behave exactly as before.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserve_unit(p_session_token text, p_unit_id uuid, p_client_name text, p_client_phone text, p_expiry_days integer, p_token_received boolean, p_token_amount numeric, p_note text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_unit public.units; v_reserved_status uuid; v_days int; v_res_id uuid; v_expiry timestamptz;
        v_group uuid; v_companies uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF TRIM(COALESCE(p_client_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','client_name_required'); END IF;
  v_days := CASE WHEN p_expiry_days IN (3,7) THEN p_expiry_days ELSE 7 END;

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  IF v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  SELECT * INTO v_unit FROM public.units WHERE id=p_unit_id AND company_id = ANY(v_companies) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  IF v_group IS NULL AND v_ses.project_id IS NOT NULL AND v_unit.project_id <> v_ses.project_id THEN
    RETURN jsonb_build_object('success',false,'error','out_of_scope'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.category_unit_statuses st WHERE st.id=v_unit.status_id AND st.is_available) THEN
    RETURN jsonb_build_object('success',false,'error','unit_unavailable','message','This unit is no longer available - it may have just been reserved or sold.'); END IF;
  IF EXISTS (SELECT 1 FROM public.reservations WHERE unit_id=p_unit_id AND status='active') THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved','message','This unit already has an active reservation.'); END IF;
  SELECT id INTO v_reserved_status FROM public.category_unit_statuses
   WHERE company_id=v_unit.company_id AND project_id=v_unit.project_id
     AND (LOWER(status_code)='reserved' OR status_name ILIKE '%reserved%') AND is_active ORDER BY sort_order LIMIT 1;
  IF v_reserved_status IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_reserved_status','message','This project has no Reserved status configured.'); END IF;
  v_expiry := now() + (v_days || ' days')::interval;
  INSERT INTO public.reservations (company_id, project_id, unit_id, reserved_by, client_name, client_phone,
     expiry_date, token_received, token_amount, note, status)
  VALUES (v_unit.company_id, v_unit.project_id, p_unit_id, v_ses.sales_user_id, TRIM(p_client_name),
     NULLIF(TRIM(COALESCE(p_client_phone,'')),''), v_expiry, COALESCE(p_token_received,false), COALESCE(p_token_amount,0),
     NULLIF(TRIM(COALESCE(p_note,'')),''), 'active')
  RETURNING id INTO v_res_id;
  UPDATE public.units SET status_id=v_reserved_status, updated_at=now() WHERE id=p_unit_id AND company_id=v_unit.company_id;
  RETURN jsonb_build_object('success',true,'reservation_id',v_res_id,'expiry_date',v_expiry);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','already_reserved','message','This unit already has an active reservation.');
END; $function$;

CREATE OR REPLACE FUNCTION public.submit_sale(p_session_token text, p_reservation_id uuid, p_client jsonb, p_sale jsonb, p_schedule jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_res public.reservations; v_unit public.units;
        v_su public.sales_users; v_review uuid; v_sub uuid; v_group uuid; v_companies uuid[]; v_agent uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  IF v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id = ANY(v_companies)
     AND reserved_by=v_ses.sales_user_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_yours',
    'message','This reservation is not active or not yours.'); END IF;

  IF EXISTS (SELECT 1 FROM public.sale_submissions WHERE reservation_id=p_reservation_id AND status='pending') THEN
    RETURN jsonb_build_object('success',false,'error','already_submitted',
      'message','You have already submitted this sale — it is awaiting office approval.'); END IF;

  IF TRIM(COALESCE(p_client->>'full_name',''))='' THEN
    RETURN jsonb_build_object('success',false,'error','client_required','message','Client name is required.'); END IF;
  IF COALESCE((p_sale->>'area_sqft')::numeric,0) <= 0 OR COALESCE((p_sale->>'price_per_sqft')::numeric,0) <= 0 THEN
    RETURN jsonb_build_object('success',false,'error','price_required','message','Enter the unit price and area.'); END IF;
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' OR jsonb_array_length(p_schedule) = 0 THEN
    RETURN jsonb_build_object('success',false,'error','schedule_required','message','Add at least one payment in the schedule.'); END IF;

  SELECT * INTO v_unit FROM public.units WHERE id=v_res.unit_id AND company_id=v_res.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;

  SELECT agent_id INTO v_agent FROM public.dealer_company_agents
   WHERE sales_user_id=v_ses.sales_user_id AND company_id=v_res.company_id;
  IF v_agent IS NULL AND v_res.company_id=v_ses.company_id THEN v_agent := v_su.agent_id; END IF;

  INSERT INTO public.sale_submissions
    (company_id, project_id, unit_id, reservation_id, submitted_by, agent_id,
     client_payload, sale_payload, schedule_payload, status)
  VALUES
    (v_res.company_id, v_res.project_id, v_res.unit_id, v_res.id, v_ses.sales_user_id, v_agent,
     p_client, p_sale, p_schedule, 'pending')
  RETURNING id INTO v_sub;

  SELECT id INTO v_review FROM public.category_unit_statuses
   WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND status_code='SALE_REVIEW' AND is_active LIMIT 1;
  IF v_review IS NOT NULL THEN
    UPDATE public.units SET status_id=v_review, updated_at=now() WHERE id=v_res.unit_id; END IF;

  RETURN jsonb_build_object('success',true,'submission_id',v_sub);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','already_submitted',
    'message','You have already submitted this sale — it is awaiting office approval.');
END; $function$;
