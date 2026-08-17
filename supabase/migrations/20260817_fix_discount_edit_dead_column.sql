-- =====================================================================
-- Fix: an edited discount never reached the sale.
--
-- sales.net_amount / remaining_amount are GENERATED from sales.discount.
-- Two live paths wrote the DEAD legacy column sales.discount_amount instead,
-- so the edit 'succeeded' and changed nothing:
--   1. request_discount_change  (all three apply branches)
--   2. approve_request 'discount' branch
-- A third, approve_request 'price_revision', wrote the GENERATED net_amount
-- column directly and could only ever error.
--
-- Evidence: FMH BKG-252 — discount_amount 1,091,305 vs discount 1,021,745.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.request_discount_change(
  p_sale_id uuid,
  p_new_discount numeric,
  p_maker_comment text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS \$
DECLARE
  v_me      public.app_users;
  v_company uuid;
  v_project uuid;
  v_level   text;
  v_ar      jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;

  SELECT company_id, project_id INTO v_company, v_project
  FROM public.sales WHERE id = p_sale_id;
  IF v_company IS NULL OR v_company <> v_me.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  v_level := public._rms_restriction_level(v_me.company_id, 'discount');

  IF v_level = 'hard' THEN
    RAISE EXCEPTION 'action_hard_blocked';
  END IF;

  -- Admin bypasses the soft/warning routing — applies directly.
  IF public._rms_is_admin(v_me) THEN
    UPDATE public.sales
       SET discount = p_new_discount, discount_amount = p_new_discount, updated_at = now()
     WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied', 'admin_bypass', true);
  END IF;

  IF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type', 'discount',
      'entity_table', 'sales',
      'entity_id',    p_sale_id,
      'project_id',   v_project,
      'title',        'Discount change',
      'amount',       p_new_discount,
      'comment',      p_maker_comment,
      'payload',      jsonb_build_object('discount', p_new_discount,
                                         'discount_amount', p_new_discount)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN
      RETURN v_ar;
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');

  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (
      company_id, table_name, record_id, action, new_data,
      changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason
    ) VALUES (
      v_me.company_id, 'sales', p_sale_id::text, 'restriction_warning',
      jsonb_build_object('discount', p_new_discount),
      v_me.id, v_me.full_name, v_me.role, true, 'restrictions', 'discount'
    );
    UPDATE public.sales
       SET discount = p_new_discount, discount_amount = p_new_discount, updated_at = now()
     WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied');

  ELSE
    UPDATE public.sales
       SET discount = p_new_discount, discount_amount = p_new_discount, updated_at = now()
     WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied');
  END IF;
END;
\$;

GRANT EXECUTE ON FUNCTION public.request_discount_change(uuid, numeric, text)
  TO anon, authenticated, service_role;

-- ── approve_request: fixed 'discount' + 'price_revision' apply branches ──

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
      -- FIX: net_amount is GENERATED from sales.discount — writing discount_amount
      -- (a dead legacy column) applied nothing. Accept either payload key.
      UPDATE public.sales
         SET discount = COALESCE((v_pl->>'discount')::numeric, (v_pl->>'discount_amount')::numeric),
             discount_amount = COALESCE((v_pl->>'discount')::numeric, (v_pl->>'discount_amount')::numeric),
             updated_at = now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id
          AND COALESCE((v_pl->>'discount')::numeric, (v_pl->>'discount_amount')::numeric) IS NOT NULL;
      GET DIAGNOSTICS v_rc=ROW_COUNT; IF v_rc=0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
    WHEN 'price_revision' THEN
      -- FIX: net_amount is a GENERATED column — the old UPDATE always errored.
      -- Apply the source fields instead (net follows from them).
      UPDATE public.sales
         SET price_per_sqft = COALESCE((v_pl->>'price_per_sqft')::numeric, price_per_sqft),
             area_sqft      = COALESCE((v_pl->>'area_sqft')::numeric,      area_sqft),
             discount       = COALESCE((v_pl->>'discount')::numeric,       discount),
             updated_at     = now()
        WHERE id=v_req.entity_id AND company_id=v_req.company_id
          AND (v_pl ? 'price_per_sqft' OR v_pl ? 'area_sqft' OR v_pl ? 'discount');
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
    WHEN 'unit_change' THEN
      IF NOT EXISTS (SELECT 1 FROM public.units WHERE id=v_req.entity_id AND company_id=v_req.company_id) THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;
      SELECT public._execute_unit_change_core(
        p_company_id=>v_req.company_id, p_change_date=>(v_pl->>'change_date')::date, p_project_id=>(v_pl->>'project_id')::uuid,
        p_sale_id=>(v_pl->>'sale_id')::uuid, p_client_id=>(v_pl->>'client_id')::uuid,
        p_old_unit_id=>(v_pl->>'old_unit_id')::uuid, p_new_unit_id=>(v_pl->>'new_unit_id')::uuid,
        p_price_per_sqft=>COALESCE((v_pl->>'price_per_sqft')::numeric,0), p_area_sqft=>COALESCE((v_pl->>'area_sqft')::numeric,0),
        p_discount=>COALESCE((v_pl->>'discount')::numeric,0), p_installments=>COALESCE(v_pl->'installments','[]'::jsonb),
        p_change_fee=>COALESCE((v_pl->>'change_fee')::numeric,0), p_documentation_charges=>COALESCE((v_pl->>'documentation_charges')::numeric,0),
        p_other_charges=>COALESCE((v_pl->>'other_charges')::numeric,0), p_other_charges_desc=>v_pl->>'other_charges_desc',
        p_charges_paid_by=>COALESCE(v_pl->>'charges_paid_by','client'), p_charges_payment_method=>v_pl->>'charges_payment_method',
        p_charges_reference=>v_pl->>'charges_reference',
        p_reason=>v_pl->>'reason', p_notes=>v_pl->>'notes', p_created_by=>COALESCE(v_pl->>'created_by', v_me.id::text)
      ) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RAISE EXCEPTION 'unit_change_apply_failed: %', COALESCE(v_res->>'error',v_res->>'message','unknown'); END IF;
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
END; $function$
;
