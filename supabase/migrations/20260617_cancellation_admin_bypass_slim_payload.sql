-- ============================================================================
-- NEXUNOVA RMS — execute_unit_cancellation: admins cancel directly (no approval)
-- + slim the approval payload (RMS records only, no financial fields). 2026-06-17.
-- ----------------------------------------------------------------------------
--  1. Admins/owners now bypass the restriction/approval gate and cancel directly
--     (like edit_sale / edit_installment_schedule). Only NON-admin cancellations
--     route to the admin for approval.
--  2. The 'soft' approval payload dropped all the financial/refund/clawback keys
--     (they were rendered as a cluttered list of empty 0/— fields). Replay
--     (approve_request cancellation branch) COALESCEs the missing keys to 0/null.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.execute_unit_cancellation(p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid, p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text, p_detailed_reason text, p_overdue_count integer DEFAULT 0, p_days_past_due integer DEFAULT 0, p_notices_sent integer DEFAULT 0, p_last_notice_date date DEFAULT NULL::date, p_legal_action boolean DEFAULT false, p_total_paid numeric DEFAULT 0, p_booking_forfeiture numeric DEFAULT 0, p_cancellation_charges numeric DEFAULT 0, p_late_penalty numeric DEFAULT 0, p_processing_fee numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_other_deductions_note text DEFAULT NULL::text, p_net_refund numeric DEFAULT 0, p_refund_method text DEFAULT NULL::text, p_refund_payment_mode text DEFAULT NULL::text, p_refund_bank_id uuid DEFAULT NULL::uuid, p_refund_reference text DEFAULT NULL::text, p_refund_date date DEFAULT NULL::date, p_expected_refund_date date DEFAULT NULL::date, p_refund_notes text DEFAULT NULL::text, p_agent_commission_total numeric DEFAULT 0, p_agent_commission_paid numeric DEFAULT 0, p_agent_commission_pending numeric DEFAULT 0, p_commission_action text DEFAULT 'no_clawback'::text, p_commission_recovery_amt numeric DEFAULT 0, p_commission_recovery_method text DEFAULT NULL::text, p_commission_notes text DEFAULT NULL::text, p_client_flag text DEFAULT 'none'::text, p_blacklist_reason text DEFAULT NULL::text, p_initiated_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_level text; v_ar jsonb; v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF p_project_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=p_project_id AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned','message','You are not assigned to this project.'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._execute_unit_cancellation_core(
      p_company_id, p_unit_id, p_project_id, p_sale_id, p_client_id, p_agent_id,
      p_cancellation_date, p_effective_date, p_cancellation_type, p_reason_category, p_detailed_reason,
      p_overdue_count, p_days_past_due, p_notices_sent, p_last_notice_date, p_legal_action, p_total_paid,
      p_booking_forfeiture, p_cancellation_charges, p_late_penalty, p_processing_fee, p_other_deductions,
      p_other_deductions_note, p_net_refund, p_refund_method, p_refund_payment_mode, p_refund_bank_id,
      p_refund_reference, p_refund_date, p_expected_refund_date, p_refund_notes, p_agent_commission_total,
      p_agent_commission_paid, p_agent_commission_pending, p_commission_action, p_commission_recovery_amt,
      p_commission_recovery_method, p_commission_notes, p_client_flag, p_blacklist_reason, p_initiated_by, p_notes);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'cancellation');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'cancellation');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','cancellation','entity_table','units','entity_id',p_unit_id,
      'project_id',p_project_id,'title','Unit cancellation','description',p_detailed_reason,
      'amount',0,
      'comment',COALESCE(NULLIF(TRIM(p_detailed_reason),''), NULLIF(TRIM(p_notes),'')),
      'payload',jsonb_build_object(
        'unit_id',p_unit_id,'project_id',p_project_id,'sale_id',p_sale_id,'client_id',p_client_id,'agent_id',p_agent_id,
        'cancellation_date',p_cancellation_date,'effective_date',p_effective_date,'cancellation_type',p_cancellation_type,
        'reason_category',p_reason_category,'detailed_reason',p_detailed_reason,
        'client_flag',p_client_flag,'blacklist_reason',p_blacklist_reason,
        'initiated_by',p_initiated_by,'notes',p_notes)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_unit_id::text, 'restriction_warning', true, 'restrictions', 'cancellation');
  END IF;

  RETURN public._execute_unit_cancellation_core(
    p_company_id, p_unit_id, p_project_id, p_sale_id, p_client_id, p_agent_id,
    p_cancellation_date, p_effective_date, p_cancellation_type, p_reason_category, p_detailed_reason,
    p_overdue_count, p_days_past_due, p_notices_sent, p_last_notice_date, p_legal_action, p_total_paid,
    p_booking_forfeiture, p_cancellation_charges, p_late_penalty, p_processing_fee, p_other_deductions,
    p_other_deductions_note, p_net_refund, p_refund_method, p_refund_payment_mode, p_refund_bank_id,
    p_refund_reference, p_refund_date, p_expected_refund_date, p_refund_notes, p_agent_commission_total,
    p_agent_commission_paid, p_agent_commission_pending, p_commission_action, p_commission_recovery_amt,
    p_commission_recovery_method, p_commission_notes, p_client_flag, p_blacklist_reason, p_initiated_by, p_notes);
END;
$function$;
