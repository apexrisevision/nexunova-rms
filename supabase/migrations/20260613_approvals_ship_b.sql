-- ════════════════════════════════════════════════════════════════════════════
-- APPROVALS ENGINE — SHIP B (new-sale rules). See APPROVALS_ENGINE_PLAN.md.
-- Wires the 4 booking-time sale controls into create_sale_with_schedule:
--   sale_down_payment  · DP%  < min_dp_pct (default 25)
--   sale_discount      · disc% > max_pct   (default 10)
--   sale_rate_floor    · price_per_sqft < min_rate (default 0 = off)
--   sale_schedule_delivery · last installment due > project.delivery_date + grace
-- create_sale_with_schedule is split into a thin GUARD + _create_sale_with_schedule_core
-- (the original inserts), so approve_request can REPLAY a parked sale via a new
-- 'sale_create' branch. Per owner decision, the 4 sale rules DEFAULT to 'warning'
-- (sale is created + logged, no friction); the soft/approval path is opt-in.
-- create_sale is admin-only, so these rules apply to admins too (four-eyes on
-- booking exceptions); SoD then routes sole-admin (self-approve+log) vs multi-admin.
-- NOTE: PDC bounce-waiver + backdate-on-create are DEFERRED (no waiver substrate /
-- needs a full replace of the complex record_payment) — see the build report.
-- All additive / reversible.
-- ════════════════════════════════════════════════════════════════════════════

-- ── reader v2: per-action default level (the 4 sale rules launch as 'warning') ─
CREATE OR REPLACE FUNCTION public._rms_restriction_rule(p_company_id uuid, p_action text)
RETURNS TABLE(level text, threshold jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT CASE p_action
      WHEN 'discount'               THEN '{"max_pct":10}'::jsonb
      WHEN 'sale_discount'          THEN '{"max_pct":10}'::jsonb
      WHEN 'sale_down_payment'      THEN '{"min_dp_pct":25}'::jsonb
      WHEN 'sale_rate_floor'        THEN '{"min_rate":0}'::jsonb
      WHEN 'sale_schedule_delivery' THEN '{"grace_days":0}'::jsonb
      WHEN 'backdate'               THEN '{"max_days":3}'::jsonb
      WHEN 'payment_backdate'       THEN '{"max_days":3}'::jsonb
      WHEN 'pdc_waiver'             THEN '{"max_auto":0}'::jsonb
      ELSE '{}'::jsonb END AS def,
    CASE p_action
      WHEN 'sale_down_payment'      THEN 'warning'
      WHEN 'sale_discount'          THEN 'warning'
      WHEN 'sale_schedule_delivery' THEN 'warning'
      WHEN 'sale_rate_floor'        THEN 'off'
      ELSE 'soft' END AS deflevel
  )
  SELECT COALESCE(r.level, d.deflevel),
         d.def || COALESCE(r.threshold, '{}'::jsonb)
  FROM d
  LEFT JOIN public.company_restriction_rules r
    ON r.company_id = p_company_id AND r.action = p_action;
$function$;

-- ── _core: the actual sale + schedule writes (replayable by approve_request) ──
CREATE OR REPLACE FUNCTION public._create_sale_with_schedule_core(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID; v_unit_id UUID; v_client_id UUID; v_agent_id UUID; v_project_id UUID;
  v_price_per_sqft NUMERIC; v_area_sqft NUMERIC; v_discount NUMERIC; v_down_payment NUMERIC;
  v_installment_count INTEGER; v_notes TEXT; v_sale_date DATE; v_created_by UUID;
  v_net_amount NUMERIC; v_scheduled_sum NUMERIC; v_sale_id UUID; v_sale_number TEXT;
  v_inst JSONB; v_sold_status_id UUID; v_commission_rate NUMERIC; v_commission_amt NUMERIC;
BEGIN
  v_company_id        := (p_sale->>'company_id')::UUID;
  v_unit_id           := (p_sale->>'unit_id')::UUID;
  v_client_id         := (p_sale->>'client_id')::UUID;
  v_agent_id          := NULLIF(TRIM(COALESCE(p_sale->>'agent_id','')), '')::UUID;
  v_price_per_sqft    := (p_sale->>'price_per_sqft')::NUMERIC;
  v_area_sqft         := (p_sale->>'area_sqft')::NUMERIC;
  v_discount          := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_down_payment      := COALESCE((p_sale->>'down_payment')::NUMERIC, 0);
  v_installment_count := COALESCE((p_sale->>'installment_count')::INTEGER, 0);
  v_notes             := NULLIF(TRIM(COALESCE(p_sale->>'notes','')), '');
  v_sale_date         := COALESCE(NULLIF(p_sale->>'sale_date','')::DATE, CURRENT_DATE);
  v_created_by        := NULLIF(TRIM(COALESCE(p_sale->>'created_by','')), '')::UUID;
  v_commission_rate   := NULLIF(TRIM(COALESCE(p_sale->>'commission_rate','')), '')::NUMERIC;
  v_project_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_sale->>'project_id','')), '')::UUID,
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id));

  IF NOT EXISTS (SELECT 1 FROM public.clients
                 WHERE id = v_client_id AND company_id = v_company_id AND project_id = v_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_project_client',
      'message', 'The selected client does not belong to this sale''s project.');
  END IF;
  IF v_agent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.agents
                   WHERE id = v_agent_id AND company_id = v_company_id AND project_id = v_project_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'cross_project_agent',
        'message', 'The selected agent does not belong to this sale''s project.');
    END IF;
  END IF;

  v_net_amount := (v_price_per_sqft * v_area_sqft) - v_discount;
  SELECT COALESCE(SUM((inst->>'amount_due')::NUMERIC), 0) INTO v_scheduled_sum
  FROM jsonb_array_elements(p_installments) AS inst;
  IF ABS(v_scheduled_sum - v_net_amount) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_mismatch',
      'detail', 'Scheduled ' || v_scheduled_sum || ' ≠ net ' || v_net_amount);
  END IF;

  INSERT INTO public.sales (
    company_id, unit_id, client_id, agent_id, project_id,
    price_per_sqft, area_sqft, discount, down_payment,
    installment_count, notes, status, sale_date, created_by, commission_rate
  ) VALUES (
    v_company_id, v_unit_id, v_client_id, v_agent_id, v_project_id,
    v_price_per_sqft, v_area_sqft, v_discount, v_down_payment,
    v_installment_count, v_notes, 'active', v_sale_date, v_created_by, v_commission_rate
  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    INSERT INTO public.installments (
      company_id, sale_id, project_id, installment_number,
      due_date, amount_due, installment_type, notes
    ) VALUES (
      v_company_id, v_sale_id, v_project_id,
      (v_inst->>'installment_number')::INTEGER,
      NULLIF(v_inst->>'due_date', '')::DATE,
      (v_inst->>'amount_due')::NUMERIC,
      COALESCE(NULLIF(v_inst->>'installment_type',''), 'installment'),
      NULLIF(v_inst->>'notes', ''));
  END LOOP;

  SELECT id INTO v_sold_status_id
  FROM public.category_unit_statuses
  WHERE company_id = v_company_id AND project_id = v_project_id
    AND (LOWER(status_code) = 'sold' OR LOWER(status_name) ILIKE '%sold%')
    AND is_active = true
  ORDER BY sort_order LIMIT 1;
  IF v_sold_status_id IS NOT NULL THEN
    UPDATE public.units SET status_id = v_sold_status_id, updated_at = NOW()
    WHERE id = v_unit_id AND company_id = v_company_id;
  END IF;

  IF v_agent_id IS NOT NULL THEN
    IF v_commission_rate IS NULL THEN
      SELECT commission_percent INTO v_commission_rate
      FROM public.agents WHERE id = v_agent_id AND company_id = v_company_id;
    END IF;
    v_commission_amt := COALESCE(v_net_amount * COALESCE(v_commission_rate, 0) / 100, 0);
    UPDATE public.agents SET
      total_sales_count       = COALESCE(total_sales_count, 0) + 1,
      total_sales_amount      = COALESCE(total_sales_amount, 0) + v_net_amount,
      total_commission_earned = COALESCE(total_commission_earned, 0) + v_commission_amt,
      updated_at = NOW()
    WHERE id = v_agent_id AND company_id = v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── guard: detect the 4 trips, route off/warning/soft/hard, else create ──────
CREATE OR REPLACE FUNCTION public.create_sale_with_schedule(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_company_id uuid := (p_sale->>'company_id')::uuid;
  v_unit_id uuid := (p_sale->>'unit_id')::uuid;
  v_project_id uuid; v_price numeric; v_area numeric; v_discount numeric; v_dp numeric;
  v_net numeric; v_gross numeric; v_dp_pct numeric; v_disc_pct numeric;
  v_max_due date; v_delivery date;
  v_trips text[]; v_rank int; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.'); END IF;

  v_project_id := COALESCE(NULLIF(TRIM(COALESCE(p_sale->>'project_id','')), '')::uuid,
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id));
  v_price    := (p_sale->>'price_per_sqft')::numeric;
  v_area     := (p_sale->>'area_sqft')::numeric;
  v_discount := COALESCE((p_sale->>'discount')::numeric, 0);
  v_dp       := COALESCE((p_sale->>'down_payment')::numeric, 0);
  v_gross    := COALESCE(v_price,0) * COALESCE(v_area,0);
  v_net      := v_gross - v_discount;
  v_dp_pct   := CASE WHEN v_net > 0 THEN v_dp / v_net * 100 ELSE 100 END;
  v_disc_pct := CASE WHEN v_gross > 0 THEN v_discount / v_gross * 100 ELSE 0 END;
  SELECT MAX(NULLIF(inst->>'due_date','')::date) INTO v_max_due FROM jsonb_array_elements(p_installments) inst;
  SELECT delivery_date INTO v_delivery FROM public.projects WHERE id = v_project_id AND company_id = v_company_id;

  -- evaluate the 4 rules; collect tripped actions + the worst routing rank
  WITH checks(action, tripped) AS (
    VALUES
      ('sale_down_payment',
        v_dp_pct < COALESCE((SELECT (threshold->>'min_dp_pct')::numeric FROM public._rms_restriction_rule(v_company_id,'sale_down_payment')), 25)),
      ('sale_discount',
        v_disc_pct > COALESCE((SELECT (threshold->>'max_pct')::numeric FROM public._rms_restriction_rule(v_company_id,'sale_discount')), 10)),
      ('sale_rate_floor',
        COALESCE((SELECT (threshold->>'min_rate')::numeric FROM public._rms_restriction_rule(v_company_id,'sale_rate_floor')),0) > 0
        AND v_price < COALESCE((SELECT (threshold->>'min_rate')::numeric FROM public._rms_restriction_rule(v_company_id,'sale_rate_floor')),0)),
      ('sale_schedule_delivery',
        v_delivery IS NOT NULL AND v_max_due IS NOT NULL
        AND v_max_due > (v_delivery + COALESCE((SELECT (threshold->>'grace_days')::int FROM public._rms_restriction_rule(v_company_id,'sale_schedule_delivery')),0)))
  )
  SELECT array_agg(c.action ORDER BY c.action) FILTER (WHERE c.tripped),
         COALESCE(MAX(CASE r.level WHEN 'hard' THEN 3 WHEN 'soft' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END) FILTER (WHERE c.tripped), 0)
  INTO v_trips, v_rank
  FROM checks c CROSS JOIN LATERAL public._rms_restriction_rule(v_company_id, c.action) r;

  -- no trips (or all 'off') → create directly
  IF v_trips IS NULL OR v_rank = 0 THEN
    RETURN public._create_sale_with_schedule_core(p_sale, p_installments);
  END IF;

  -- hard → block
  IF v_rank = 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked',
      'action', 'sale_create', 'trips', to_jsonb(v_trips));
  END IF;

  -- soft → park the whole payload for approval
  IF v_rank = 2 THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','sale_create','entity_table','sales','project_id',v_project_id,
      'title','New sale — booking exception ('||array_to_string(v_trips,', ')||')',
      'amount', v_net, 'comment','Sale booking trips: '||array_to_string(v_trips,', '),
      'payload', jsonb_build_object('sale', p_sale, 'installments', p_installments, 'trips', to_jsonb(v_trips))));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id', 'trips', to_jsonb(v_trips));
  END IF;

  -- warning → log + create
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data,
    changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason)
  VALUES (v_company_id, 'sales', v_unit_id::text, 'restriction_warning',
    jsonb_build_object('trips', to_jsonb(v_trips), 'dp_pct', round(v_dp_pct,2), 'disc_pct', round(v_disc_pct,2)),
    v_me.id, v_me.full_name, v_me.role, true, 'restrictions', 'sale_create');
  RETURN public._create_sale_with_schedule_core(p_sale, p_installments);
END;
$function$;

-- ── approve_request: add the 'sale_create' replay branch ─────────────────────
-- (full body re-issued from Ship A with one new WHEN branch before 'cancellation')
CREATE OR REPLACE FUNCTION public.approve_request(p_request_id uuid, p_comment text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_req public.approval_requests; v_comment text := NULLIF(TRIM(p_comment),'');
  v_pl jsonb; v_rc integer; v_res jsonb; v_self boolean := false;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Only the Admin can approve.'); END IF;
  IF v_comment IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','comment_required','message','A comment is required to approve.'); END IF;
  SELECT * INTO v_req FROM public.approval_requests WHERE id=p_request_id;
  IF NOT FOUND OR v_req.company_id <> v_me.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('success',false,'error','not_pending','message','Already '||v_req.status||'.'); END IF;

  IF v_req.requested_by = v_me.id THEN
    IF EXISTS (SELECT 1 FROM public.app_users
               WHERE company_id = v_me.company_id AND status = 'active'
                 AND role IN ('owner','admin') AND id <> v_me.id) THEN
      RETURN jsonb_build_object('success',false,'error','self_approval_blocked',
        'message','You created this request — a different Admin must approve it.');
    END IF;
    v_self := true;
  END IF;

  v_pl := COALESCE(v_req.payload, '{}'::jsonb);

  CASE v_req.request_type
    WHEN 'discount' THEN
      UPDATE public.sales SET discount_amount=(v_pl->>'discount_amount')::numeric, updated_at=now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'price_revision' THEN
      UPDATE public.sales SET net_amount=(v_pl->>'net_amount')::numeric, updated_at=now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'refund' THEN
      UPDATE public.payments SET status='refunded', refund_amount=(v_pl->>'refund_amount')::numeric, updated_at=now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'dnd' THEN
      UPDATE public.clients SET dnd_status=true, updated_at=now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'blacklist' THEN
      UPDATE public.clients SET is_blacklisted=true, updated_at=now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'payment_void' THEN
      SELECT public._cancel_payment_core((v_pl->>'payment_id')::uuid, v_req.company_id, v_me.id) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'payment_void_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'payment_backdate' THEN
      SELECT public._edit_payment_meta_core((v_pl->>'payment_id')::uuid, v_req.company_id,
        NULLIF(v_pl->>'payment_date','')::date, v_pl->>'payment_method', v_pl->>'reference_no',
        v_pl->>'bank_name', NULLIF(v_pl->>'bank_id','')::uuid, v_pl->>'notes', v_me.id) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'payment_backdate_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'schedule_change' THEN
      SELECT public._edit_installment_schedule_core((v_pl->>'sale_id')::uuid, v_req.company_id, COALESCE(v_pl->'schedule','[]'::jsonb)) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'schedule_change_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'client_status' THEN
      SELECT public._set_client_status_core((v_pl->>'client_id')::uuid, v_req.company_id, v_pl->>'status') INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'client_status_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'legal_delete' THEN
      SELECT public._delete_legal_case_core((v_pl->>'case_id')::uuid, v_req.company_id) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'legal_delete_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'sale_edit' THEN
      SELECT public._edit_sale_core((v_pl->>'sale_id')::uuid, v_req.company_id, COALESCE(v_pl->'fields','{}'::jsonb)) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'sale_edit_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'sale_create' THEN
      SELECT public._create_sale_with_schedule_core(v_pl->'sale', COALESCE(v_pl->'installments','[]'::jsonb)) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'sale_create_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'cancellation' THEN
      IF NOT EXISTS (SELECT 1 FROM public.units WHERE id=v_req.entity_id AND company_id=v_req.company_id) THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
      SELECT public._execute_unit_cancellation_core(
        p_company_id=>v_req.company_id, p_unit_id=>(v_pl->>'unit_id')::uuid, p_project_id=>(v_pl->>'project_id')::uuid,
        p_sale_id=>(v_pl->>'sale_id')::uuid, p_client_id=>(v_pl->>'client_id')::uuid, p_agent_id=>(v_pl->>'agent_id')::uuid,
        p_cancellation_date=>(v_pl->>'cancellation_date')::date, p_effective_date=>(v_pl->>'effective_date')::date,
        p_cancellation_type=>v_pl->>'cancellation_type', p_reason_category=>v_pl->>'reason_category', p_detailed_reason=>v_pl->>'detailed_reason',
        p_overdue_count=>COALESCE((v_pl->>'overdue_count')::int,0), p_days_past_due=>COALESCE((v_pl->>'days_past_due')::int,0),
        p_notices_sent=>COALESCE((v_pl->>'notices_sent')::int,0), p_last_notice_date=>(v_pl->>'last_notice_date')::date,
        p_legal_action=>COALESCE((v_pl->>'legal_action')::boolean,false), p_total_paid=>COALESCE((v_pl->>'total_paid')::numeric,0),
        p_booking_forfeiture=>COALESCE((v_pl->>'booking_forfeiture')::numeric,0), p_cancellation_charges=>COALESCE((v_pl->>'cancellation_charges')::numeric,0),
        p_late_penalty=>COALESCE((v_pl->>'late_penalty')::numeric,0), p_processing_fee=>COALESCE((v_pl->>'processing_fee')::numeric,0),
        p_other_deductions=>COALESCE((v_pl->>'other_deductions')::numeric,0), p_other_deductions_note=>v_pl->>'other_deductions_note',
        p_net_refund=>COALESCE((v_pl->>'net_refund')::numeric,0), p_refund_method=>v_pl->>'refund_method',
        p_refund_payment_mode=>v_pl->>'refund_payment_mode', p_refund_bank_id=>(v_pl->>'refund_bank_id')::uuid,
        p_refund_reference=>v_pl->>'refund_reference', p_refund_date=>(v_pl->>'refund_date')::date,
        p_expected_refund_date=>(v_pl->>'expected_refund_date')::date, p_refund_notes=>v_pl->>'refund_notes',
        p_agent_commission_total=>COALESCE((v_pl->>'agent_commission_total')::numeric,0), p_agent_commission_paid=>COALESCE((v_pl->>'agent_commission_paid')::numeric,0),
        p_agent_commission_pending=>COALESCE((v_pl->>'agent_commission_pending')::numeric,0), p_commission_action=>COALESCE(v_pl->>'commission_action','no_clawback'),
        p_commission_recovery_amt=>COALESCE((v_pl->>'commission_recovery_amt')::numeric,0), p_commission_recovery_method=>v_pl->>'commission_recovery_method',
        p_commission_notes=>v_pl->>'commission_notes', p_client_flag=>COALESCE(v_pl->>'client_flag','none'),
        p_blacklist_reason=>v_pl->>'blacklist_reason', p_initiated_by=>COALESCE(v_pl->>'initiated_by', v_me.id::text), p_notes=>v_pl->>'notes'
      ) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'cancellation_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    WHEN 'transfer' THEN
      IF NOT EXISTS (SELECT 1 FROM public.units WHERE id=v_req.entity_id AND company_id=v_req.company_id) THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
      SELECT public._execute_unit_transfer_v2_core(
        p_company_id=>v_req.company_id, p_transfer_date=>(v_pl->>'transfer_date')::date, p_unit_id=>(v_pl->>'unit_id')::uuid,
        p_project_id=>(v_pl->>'project_id')::uuid, p_old_sale_id=>(v_pl->>'old_sale_id')::uuid, p_old_client_id=>(v_pl->>'old_client_id')::uuid,
        p_old_total_paid=>COALESCE((v_pl->>'old_total_paid')::numeric,0), p_old_outstanding=>COALESCE((v_pl->>'old_outstanding')::numeric,0),
        p_old_sale_price=>COALESCE((v_pl->>'old_sale_price')::numeric,0), p_old_close_note=>v_pl->>'old_close_note',
        p_new_client_id=>(v_pl->>'new_client_id')::uuid, p_new_sale=>COALESCE(v_pl->'new_sale','{}'::jsonb), p_installments=>COALESCE(v_pl->'installments','[]'::jsonb),
        p_transfer_fee=>COALESCE((v_pl->>'transfer_fee')::numeric,0), p_documentation_charges=>COALESCE((v_pl->>'documentation_charges')::numeric,0),
        p_other_charges=>COALESCE((v_pl->>'other_charges')::numeric,0), p_other_charges_desc=>v_pl->>'other_charges_desc',
        p_charges_paid_by=>COALESCE(v_pl->>'charges_paid_by','new'), p_charges_payment_method=>v_pl->>'charges_payment_method',
        p_charges_reference=>v_pl->>'charges_reference', p_agent_id=>(v_pl->>'agent_id')::uuid, p_commission_rate=>COALESCE((v_pl->>'commission_rate')::numeric,0),
        p_notes=>v_pl->>'notes', p_created_by=>COALESCE(v_pl->>'created_by', v_me.id::text)
      ) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'transfer_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
    ELSE RAISE EXCEPTION 'unsupported_request_type';
  END CASE;

  UPDATE public.approval_requests SET status='approved', decided_by=v_me.id, decided_at=now(), decision_comment=v_comment WHERE id=p_request_id;
  INSERT INTO public.approval_request_comments (company_id, request_id, author_id, action, comment)
  VALUES (v_me.company_id, p_request_id, v_me.id, 'approved', v_comment);
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason)
  VALUES (v_req.company_id, v_req.entity_table, v_req.entity_id::text, 'approval_applied',
          v_pl || jsonb_build_object('_self_approved', v_self), v_me.id, v_me.full_name, v_me.role, true, 'approvals',
          CASE WHEN v_self THEN 'self_approved_sole_admin:'||v_req.request_type ELSE v_req.request_type END);
  RETURN jsonb_build_object('success',true,'status','approved','entity_table',v_req.entity_table,'entity_id',v_req.entity_id,'applied',true,'self_approved',v_self);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','apply_failed','message',SQLERRM);
END; $function$;

-- ── extend the Settings catalog with the 4 sale rules ───────────────────────
CREATE OR REPLACE FUNCTION public.get_approval_settings(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_catalog jsonb := '[
    {"action":"sale_down_payment",     "group":"Sale",      "label":"Down-payment below floor",   "desc":"Bookings with a down-payment under the minimum %.",        "num":"min_dp_pct","num_label":"Min DP %",      "unit":"%"},
    {"action":"sale_discount",         "group":"Sale",      "label":"Booking discount above limit","desc":"New-sale discounts over the limit.",                       "num":"max_pct",   "num_label":"Max discount %","unit":"%"},
    {"action":"sale_rate_floor",       "group":"Sale",      "label":"Rate below floor",            "desc":"Price per sqft under the floor (0 = off).",                "num":"min_rate",  "num_label":"Min rate",      "unit":"/sqft"},
    {"action":"sale_schedule_delivery","group":"Sale",      "label":"Schedule past delivery",      "desc":"Last installment due after the project delivery date.",    "num":"grace_days","num_label":"Grace days",    "unit":"days"},
    {"action":"discount",        "group":"Sale",      "label":"Post-sale discount above limit","desc":"Discount changes after booking, over the limit.",        "num":"max_pct",   "num_label":"Max discount %","unit":"%"},
    {"action":"sale_edit",       "group":"Sale",      "label":"Post-sale protected edit",     "desc":"Edits to discount / price / status after booking.",      "num":null},
    {"action":"backdate",        "group":"Money",     "label":"Backdated receipt",            "desc":"Receipts dated more than N days in the past.",            "num":"max_days",  "num_label":"Grace days",    "unit":"days"},
    {"action":"payment_void",    "group":"Money",     "label":"Receipt void / delete",        "desc":"Voiding or deleting a recorded receipt.",                 "num":null},
    {"action":"cancellation",    "group":"Money",     "label":"Unit cancellation + refund",   "desc":"Cancelling a sale and issuing a refund.",                "num":null},
    {"action":"schedule_change", "group":"Structure", "label":"Installment reschedule",       "desc":"Restructuring an installment schedule.",                  "num":null},
    {"action":"transfer",        "group":"Structure", "label":"Unit / client transfer",       "desc":"Transferring a unit to another client.",                 "num":null},
    {"action":"client_status",   "group":"Other",     "label":"Client status / DND / blacklist","desc":"Flagging a client status, DND, or blacklist.",          "num":null},
    {"action":"legal_delete",    "group":"Other",     "label":"Legal case delete",            "desc":"Deleting a legal case record.",                          "num":null}
  ]'::jsonb;
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me)
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  RETURN jsonb_build_object('success', true, 'rules', (
    SELECT COALESCE(jsonb_agg(c || (SELECT jsonb_build_object('level', r.level, 'threshold', r.threshold)
                                    FROM public._rms_restriction_rule(p_company_id, c->>'action') r)), '[]'::jsonb)
    FROM jsonb_array_elements(v_catalog) c
  ));
END; $function$;