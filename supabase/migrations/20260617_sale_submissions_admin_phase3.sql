-- ============================================================================
-- NEXUNOVA RMS — SALE AGENT SELF-SERVICE — P3: admin approval queue
-- 2026-06-17.  Plan = SALE_AGENT_SELF_SERVICE_PLAN.md.
-- ----------------------------------------------------------------------------
-- The admin reviews a submitted package and, on Approve, ONE transaction:
--   create (or link) the client -> create the sale + schedule (agent attributed)
--   -> reservation 'converted' -> unit 'Sold' -> submission 'approved'.
-- Reuses create_client + _create_sale_with_schedule_core (the real sale path;
-- the core is called directly so the admin's review IS the authority — no second
-- restriction-engine detour). Reject bounces with a reason; unit -> Reserved.
-- ============================================================================

-- ── 1. Admin list (+ full payloads + duplicate-client hint) ─────────────────
CREATE OR REPLACE FUNCTION public.get_sale_submissions_admin(
  p_company_id uuid, p_project_id uuid DEFAULT NULL, p_status text DEFAULT 'pending')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'unit_id', s.unit_id, 'unit_no', u.unit_no,
    'project_id', s.project_id, 'project_name', p.project_name,
    'agent_id', s.agent_id, 'agent_code', ag.agent_code, 'agent_name', ag.full_name,
    'submitted_by_name', su.full_name, 'submitted_by_phone', su.phone,
    'status', s.status, 'reject_reason', s.reject_reason, 'created_at', s.created_at,
    'client', s.client_payload, 'sale', s.sale_payload, 'schedule', s.schedule_payload,
    'net_amount', (COALESCE((s.sale_payload->>'price_per_sqft')::numeric,0) * COALESCE((s.sale_payload->>'area_sqft')::numeric,0))
                  - COALESCE((s.sale_payload->>'discount')::numeric,0),
    'schedule_total', (SELECT COALESCE(SUM((e->>'amount_due')::numeric),0) FROM jsonb_array_elements(s.schedule_payload) e),
    'reservation_id', s.reservation_id,
    'dup_client_id', dup.id, 'dup_client_name', dup.full_name, 'dup_client_code', dup.client_code,
    'created_sale_id', s.created_sale_id, 'created_client_id', s.created_client_id
  ) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sale_submissions s
  JOIN public.units u ON u.id=s.unit_id
  LEFT JOIN public.projects p ON p.id=s.project_id
  LEFT JOIN public.agents ag ON ag.id=s.agent_id
  LEFT JOIN public.sales_users su ON su.id=s.submitted_by
  LEFT JOIN LATERAL (
    SELECT c.id, c.full_name, c.client_code FROM public.clients c
    WHERE c.company_id=s.company_id AND c.project_id=s.project_id
      AND ( (NULLIF(s.client_payload->>'cnic','') IS NOT NULL AND c.cnic = s.client_payload->>'cnic')
         OR (NULLIF(s.client_payload->>'phone_primary','') IS NOT NULL AND c.phone_primary = s.client_payload->>'phone_primary') )
    ORDER BY (c.cnic = s.client_payload->>'cnic') DESC LIMIT 1
  ) dup ON true
  WHERE s.company_id=p_company_id
    AND (p_project_id IS NULL OR s.project_id=p_project_id)
    AND (p_status IS NULL OR p_status='all' OR s.status=p_status);
  RETURN jsonb_build_object('success',true,'submissions',v_rows);
END; $$;

-- ── 2. Approve — atomic: client -> sale+schedule -> reservation -> unit ──────
CREATE OR REPLACE FUNCTION public.approve_sale_submission(
  p_id uuid, p_overrides jsonb DEFAULT NULL, p_client_id_to_link uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me public.app_users; v_sub public.sale_submissions; v_res public.reservations;
  v_client uuid; v_cres jsonb; v_sale jsonb; v_sres jsonb; v_sale_id uuid; v_inst_count int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;

  SELECT * INTO v_sub FROM public.sale_submissions
   WHERE id=p_id AND company_id=v_me.company_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_pending'); END IF;

  -- reservation must still be active
  SELECT * INTO v_res FROM public.reservations WHERE id=v_sub.reservation_id FOR UPDATE;
  IF v_res.id IS NULL OR v_res.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','reservation_inactive',
      'message','The reservation is no longer active — cannot approve this sale.'); END IF;

  -- already-sold guard
  IF EXISTS (SELECT 1 FROM public.sales WHERE unit_id=v_sub.unit_id AND company_id=v_me.company_id AND status='active') THEN
    RETURN jsonb_build_object('success',false,'error','already_sold',
      'message','This unit already has an active sale.'); END IF;

  -- ── client: link existing, or create (auto-link on CNIC dup) ──
  IF p_client_id_to_link IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients
                   WHERE id=p_client_id_to_link AND company_id=v_me.company_id AND project_id=v_sub.project_id) THEN
      RETURN jsonb_build_object('success',false,'error','invalid_client',
        'message','The linked client is not in this sale''s project.'); END IF;
    v_client := p_client_id_to_link;
  ELSE
    v_cres := public.create_client(
      v_sub.client_payload
      || jsonb_build_object('company_id', v_me.company_id, 'project_id', v_sub.project_id,
                            'created_by', v_me.id, 'status', 'active'));
    IF COALESCE((v_cres->>'success')::boolean,false) THEN
      v_client := COALESCE(NULLIF(v_cres->>'id',''), NULLIF(v_cres->>'client_id',''))::uuid;
    ELSIF v_cres->>'duplicate_field'='cnic' AND NULLIF(v_cres->>'duplicate_id','') IS NOT NULL THEN
      v_client := (v_cres->>'duplicate_id')::uuid;          -- link to the existing client
    ELSE
      RETURN jsonb_build_object('success',false,'error','client_failed',
        'message', COALESCE(v_cres->>'message', v_cres->>'error', 'Could not create the client.'),
        'detail', v_cres); END IF;
  END IF;

  -- ── sale: build payload (overrides win over submitted; ids authoritative) ──
  SELECT count(*) INTO v_inst_count FROM jsonb_array_elements(v_sub.schedule_payload) e
   WHERE COALESCE(e->>'installment_type','installment')='installment';

  v_sale := v_sub.sale_payload
    || COALESCE(p_overrides, '{}'::jsonb)
    || jsonb_build_object('company_id', v_me.company_id, 'unit_id', v_sub.unit_id,
                          'project_id', v_sub.project_id, 'client_id', v_client,
                          'agent_id', v_sub.agent_id, 'created_by', v_me.id,
                          'installment_count', v_inst_count);

  v_sres := public._create_sale_with_schedule_core(v_sale, v_sub.schedule_payload);
  IF NOT COALESCE((v_sres->>'success')::boolean,false) THEN
    RETURN jsonb_build_object('success',false,'error','sale_failed',
      'message', COALESCE(v_sres->>'message', v_sres->>'error', 'Could not create the sale.'),
      'detail', v_sres); END IF;
  v_sale_id := (v_sres->>'sale_id')::uuid;

  -- ── reservation -> converted, submission -> approved (unit set Sold by core) ──
  UPDATE public.reservations
     SET status='converted', converted_sale_id=v_sale_id, updated_at=now()
   WHERE id=v_sub.reservation_id;

  UPDATE public.sale_submissions
     SET status='approved', created_client_id=v_client, created_sale_id=v_sale_id,
         matched_client_id=p_client_id_to_link, decided_by=v_me.id, decided_at=now(), updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'sale_id',v_sale_id,
    'sale_number', v_sres->>'sale_number', 'client_id', v_client);
END; $$;

-- ── 3. Reject — bounce with a reason; unit back to Reserved ─────────────────
CREATE OR REPLACE FUNCTION public.reject_sale_submission(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_sub public.sale_submissions; v_resv_status uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_sub FROM public.sale_submissions
   WHERE id=p_id AND company_id=v_me.company_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_pending'); END IF;

  UPDATE public.sale_submissions
     SET status='rejected', reject_reason=NULLIF(TRIM(COALESCE(p_reason,'')),''),
         decided_by=v_me.id, decided_at=now(), updated_at=now()
   WHERE id=p_id;

  -- reservation is still active -> put the unit back to Reserved
  IF EXISTS (SELECT 1 FROM public.reservations WHERE id=v_sub.reservation_id AND status='active') THEN
    SELECT id INTO v_resv_status FROM public.category_unit_statuses
     WHERE company_id=v_sub.company_id AND project_id=v_sub.project_id
       AND (LOWER(status_code)='reserved' OR status_name ILIKE '%reserved%') AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_resv_status IS NOT NULL THEN
      UPDATE public.units SET status_id=v_resv_status, updated_at=now() WHERE id=v_sub.unit_id; END IF;
  END IF;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 4. Grants (admin RPCs: _rms_caller + _rms_is_admin gated) ───────────────
GRANT EXECUTE ON FUNCTION public.get_sale_submissions_admin(uuid,uuid,text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sale_submission(uuid,jsonb,uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_sale_submission(uuid,text)               TO anon, authenticated;
