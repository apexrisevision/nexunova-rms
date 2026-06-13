-- ════════════════════════════════════════════════════════════════════════════
-- APPROVALS ENGINE — SHIP A (foundation). See APPROVALS_ENGINE_PLAN.md.
-- Brings the 7 already-built maker-checker rules ALIVE:
--   1. Widen audit_logs_action_check so approve_request / restriction-warning paths
--      stop rolling back (the one bug that dead-ended every approval).
--   2. _rms_restriction_rule(company,action) → (level, threshold) reader.
--   3. approve_request: maker≠checker SoD (sole-admin self-approve allowed + logged).
--   4. request_discount_change: numeric threshold (max_pct) drives the trip.
--   5. edit_payment_meta: numeric threshold (max_days) drives the backdate trip.
--   6. get_approval_settings / save_approval_settings for the Settings editor.
-- All additive / reversible. No table or column drops.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Audit CHECK widening — the unblock-everything change ──────────────────
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    'INSERT','UPDATE','DELETE',
    'approval_applied','approval_rejected','restriction_warning','restriction_block'
  ]::text[]));

-- ── 2. Config reader returning BOTH level and threshold ─────────────────────
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
      ELSE '{}'::jsonb END AS def
  )
  SELECT COALESCE(r.level, 'soft'),
         d.def || COALESCE(r.threshold, '{}'::jsonb)   -- stored values override defaults
  FROM d
  LEFT JOIN public.company_restriction_rules r
    ON r.company_id = p_company_id AND r.action = p_action;
$function$;
GRANT EXECUTE ON FUNCTION public._rms_restriction_rule(uuid,text) TO authenticated, anon, service_role;

-- ── 3. approve_request — add maker≠checker SoD (audit fix is automatic via #1) ─
CREATE OR REPLACE FUNCTION public.approve_request(p_request_id uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- Separation of duties: a maker may not approve their OWN request — unless they
  -- are the sole owner/admin of the company, in which case it is allowed but the
  -- audit row is explicitly stamped as a self-approval (dual-control exception).
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

-- ── 4. request_discount_change — numeric threshold (max_pct) drives the trip ──
CREATE OR REPLACE FUNCTION public.request_discount_change(p_sale_id uuid, p_new_discount numeric, p_maker_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_company uuid; v_project uuid; v_total numeric;
  v_level text; v_thr jsonb; v_max_pct numeric; v_pct numeric; v_trip boolean; v_ar jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;

  SELECT company_id, project_id, total_amount INTO v_company, v_project, v_total
  FROM public.sales WHERE id = p_sale_id;
  IF v_company IS NULL OR v_company <> v_me.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  SELECT level, threshold INTO v_level, v_thr FROM public._rms_restriction_rule(v_me.company_id, 'discount');
  v_max_pct := COALESCE((v_thr->>'max_pct')::numeric, 10);
  v_pct  := CASE WHEN COALESCE(v_total,0) > 0 THEN (p_new_discount / v_total) * 100 ELSE 0 END;
  v_trip := (v_pct > v_max_pct);

  -- Within the configured limit (or rule disabled) → apply directly, no approval.
  IF NOT v_trip OR v_level = 'off' THEN
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied', 'tripped', v_trip);
  END IF;

  -- Above the limit + rule active:
  IF v_level = 'hard' THEN
    RAISE EXCEPTION 'action_hard_blocked';
  END IF;
  IF public._rms_is_admin(v_me) THEN          -- admin is the approver → applies directly
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied', 'admin_bypass', true);
  END IF;
  IF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data,
      changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason)
    VALUES (v_me.company_id, 'sales', p_sale_id::text, 'restriction_warning',
      jsonb_build_object('discount_amount', p_new_discount, 'pct', round(v_pct,2)),
      v_me.id, v_me.full_name, v_me.role, true, 'restrictions', 'discount');
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied');
  END IF;
  -- soft → park for approval
  v_ar := public.create_approval_request(jsonb_build_object(
    'request_type','discount','entity_table','sales','entity_id',p_sale_id,'project_id',v_project,
    'title','Discount '||round(v_pct,1)||'% (over '||v_max_pct||'% limit)','amount',p_new_discount,
    'comment',p_maker_comment,'payload',jsonb_build_object('discount_amount',p_new_discount)));
  IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
  RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
END;
$function$;

-- ── 5. edit_payment_meta — backdate trip = payment_date < today − max_days ────
CREATE OR REPLACE FUNCTION public.edit_payment_meta(p_payment_id uuid, p_company_id uuid, p_payment_date date DEFAULT NULL::date, p_payment_method text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur_date date; v_project uuid; v_found boolean;
  v_level text; v_thr jsonb; v_max_days int; v_ar jsonb; v_backdate boolean;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, p.payment_date, s.project_id INTO v_found, v_cur_date, v_project
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
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  SELECT level, threshold INTO v_level, v_thr FROM public._rms_restriction_rule(p_company_id, 'backdate');
  v_max_days := COALESCE((v_thr->>'max_days')::int, 3);
  -- Trip only when the new date is MORE than max_days before today (a far backdate).
  v_backdate := (p_payment_date IS NOT NULL AND p_payment_date < (CURRENT_DATE - v_max_days));

  IF NOT v_backdate OR v_level = 'off' THEN
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'backdate');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'payments', p_payment_id::text, 'restriction_warning', true, 'restrictions', 'backdate');
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  ELSE
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required','message','A reason is required to request a backdated payment edit.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','payment_backdate','entity_table','payments','entity_id',p_payment_id,
      'project_id',v_project,'title','Backdated payment edit','comment',p_reason,
      'payload',jsonb_build_object('payment_id',p_payment_id,'payment_date',p_payment_date,
        'payment_method',p_payment_method,'reference_no',p_reference_no,'bank_name',p_bank_name,'bank_id',p_bank_id,'notes',p_notes)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

-- ── 6. Settings editor RPCs — read full catalog, upsert one rule ─────────────
CREATE OR REPLACE FUNCTION public.get_approval_settings(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_catalog jsonb := '[
    {"action":"discount",        "group":"Sale",      "label":"Sale discount above limit",   "desc":"Discounts over the limit need approval.",                "num":"max_pct",   "num_label":"Max discount %","unit":"%"},
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
                                    FROM public._rms_restriction_rule(p_company_id, c->>'action') r)
                              ORDER BY c->>'group', c->>'label'), '[]'::jsonb)
    FROM jsonb_array_elements(v_catalog) c
  ));
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_approval_settings(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.save_approval_settings(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_action text := NULLIF(p_data->>'action','');
  v_level  text := NULLIF(p_data->>'level','');
  v_thr    jsonb := COALESCE(p_data->'threshold','{}'::jsonb);
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me)
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF v_action IS NULL OR v_level NOT IN ('off','warning','soft','hard') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_input');
  END IF;
  INSERT INTO public.company_restriction_rules (company_id, action, level, threshold, updated_at)
  VALUES (p_company_id, v_action, v_level, v_thr, now())
  ON CONFLICT (company_id, action) DO UPDATE
    SET level = EXCLUDED.level, threshold = EXCLUDED.threshold, updated_at = now();
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason)
  VALUES (p_company_id, 'company_restriction_rules', v_action, 'UPDATE',
          jsonb_build_object('action',v_action,'level',v_level,'threshold',v_thr),
          v_me.id, v_me.full_name, v_me.role, true, 'settings', 'approval_rule_changed');
  RETURN jsonb_build_object('success', true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.save_approval_settings(uuid,jsonb) TO authenticated, anon, service_role;