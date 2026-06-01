-- Bucket C — close 3 authz holes in unit cancellation / transfer.
--
-- FIX 1: DROP the dead, fully-ungated v1 execute_unit_transfer (no DB/cron/frontend
--        consumer; v2 does not call it). Overload-safe drop via exact 33-arg signature.
-- FIX 2: REVOKE EXECUTE on the two _core executors FROM authenticated — they were
--        directly callable, bypassing the SECURITY DEFINER wrappers' restriction gate.
--        (Neither has `anon`, so no anon revoke needed.) They remain callable by the
--        wrappers (SECURITY DEFINER runs as owner) + postgres/service_role.
-- FIX 3: add caller-resolve + tenant + manager-block + UPA gate to the two LIVE wrappers
--        (execute_unit_cancellation, execute_unit_transfer_v2), BEFORE the restriction-level
--        logic, so unauthorized callers are rejected before any approval request is created.
--        Both already take explicit p_project_id, so no project lookup is needed.
-- Bodies otherwise byte-for-byte unchanged (restriction logic, _core delegation, search_path).
-- Neither wrapper has an EXCEPTION block — none added.

-- ── FIX 1: drop dead v1 ───────────────────────────────────────────────────────
DROP FUNCTION public.execute_unit_transfer(
  p_company_id uuid, p_transfer_date date, p_unit_id uuid, p_project_id uuid,
  p_old_sale_id uuid, p_old_client_id uuid, p_old_total_paid numeric, p_old_outstanding numeric,
  p_old_sale_price numeric, p_settlement_type text, p_settlement_amount numeric, p_new_client_id uuid,
  p_new_sale jsonb, p_installments jsonb, p_settlement_method text, p_settlement_bank_id uuid,
  p_settlement_reference text, p_settlement_note text, p_settlement_deduction numeric,
  p_margin_beneficiary text, p_old_client_margin_pct numeric, p_margin_to_old_client numeric,
  p_margin_to_company numeric, p_transfer_fee numeric, p_documentation_charges numeric,
  p_other_charges numeric, p_other_charges_desc text, p_charges_paid_by text,
  p_charges_split_old_pct numeric, p_charges_payment_method text, p_charges_reference text,
  p_notes text, p_created_by text
);

-- ── FIX 2: revoke wrapper-bypass on _core executors ───────────────────────────
REVOKE EXECUTE ON FUNCTION public._execute_unit_cancellation_core(
  p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid,
  p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text,
  p_detailed_reason text, p_overdue_count integer, p_days_past_due integer, p_notices_sent integer,
  p_last_notice_date date, p_legal_action boolean, p_total_paid numeric, p_booking_forfeiture numeric,
  p_cancellation_charges numeric, p_late_penalty numeric, p_processing_fee numeric, p_other_deductions numeric,
  p_other_deductions_note text, p_net_refund numeric, p_refund_method text, p_refund_payment_mode text,
  p_refund_bank_id uuid, p_refund_reference text, p_refund_date date, p_expected_refund_date date,
  p_refund_notes text, p_agent_commission_total numeric, p_agent_commission_paid numeric,
  p_agent_commission_pending numeric, p_commission_action text, p_commission_recovery_amt numeric,
  p_commission_recovery_method text, p_commission_notes text, p_client_flag text, p_blacklist_reason text,
  p_initiated_by text, p_notes text
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public._execute_unit_transfer_v2_core(
  p_company_id uuid, p_transfer_date date, p_unit_id uuid, p_project_id uuid, p_old_sale_id uuid,
  p_old_client_id uuid, p_old_total_paid numeric, p_old_outstanding numeric, p_old_sale_price numeric,
  p_old_close_note text, p_new_client_id uuid, p_new_sale jsonb, p_installments jsonb, p_transfer_fee numeric,
  p_documentation_charges numeric, p_other_charges numeric, p_other_charges_desc text, p_charges_paid_by text,
  p_charges_payment_method text, p_charges_reference text, p_agent_id uuid, p_commission_rate numeric,
  p_notes text, p_created_by text
) FROM authenticated;

-- ── FIX 3a: gate execute_unit_cancellation ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_unit_cancellation(p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid, p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text, p_detailed_reason text, p_overdue_count integer DEFAULT 0, p_days_past_due integer DEFAULT 0, p_notices_sent integer DEFAULT 0, p_last_notice_date date DEFAULT NULL::date, p_legal_action boolean DEFAULT false, p_total_paid numeric DEFAULT 0, p_booking_forfeiture numeric DEFAULT 0, p_cancellation_charges numeric DEFAULT 0, p_late_penalty numeric DEFAULT 0, p_processing_fee numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_other_deductions_note text DEFAULT NULL::text, p_net_refund numeric DEFAULT 0, p_refund_method text DEFAULT NULL::text, p_refund_payment_mode text DEFAULT NULL::text, p_refund_bank_id uuid DEFAULT NULL::uuid, p_refund_reference text DEFAULT NULL::text, p_refund_date date DEFAULT NULL::date, p_expected_refund_date date DEFAULT NULL::date, p_refund_notes text DEFAULT NULL::text, p_agent_commission_total numeric DEFAULT 0, p_agent_commission_paid numeric DEFAULT 0, p_agent_commission_pending numeric DEFAULT 0, p_commission_action text DEFAULT 'no_clawback'::text, p_commission_recovery_amt numeric DEFAULT 0, p_commission_recovery_method text DEFAULT NULL::text, p_commission_notes text DEFAULT NULL::text, p_client_flag text DEFAULT 'none'::text, p_blacklist_reason text DEFAULT NULL::text, p_initiated_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_level := public._rms_restriction_level(p_company_id, 'cancellation');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'cancellation');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','cancellation','entity_table','units','entity_id',p_unit_id,
      'project_id',p_project_id,'title','Unit cancellation','description',p_detailed_reason,
      'amount',p_net_refund,
      'comment',COALESCE(NULLIF(TRIM(p_detailed_reason),''), NULLIF(TRIM(p_notes),'')),
      'payload',jsonb_build_object(
        'unit_id',p_unit_id,'project_id',p_project_id,'sale_id',p_sale_id,'client_id',p_client_id,'agent_id',p_agent_id,
        'cancellation_date',p_cancellation_date,'effective_date',p_effective_date,'cancellation_type',p_cancellation_type,
        'reason_category',p_reason_category,'detailed_reason',p_detailed_reason,'overdue_count',p_overdue_count,
        'days_past_due',p_days_past_due,'notices_sent',p_notices_sent,'last_notice_date',p_last_notice_date,
        'legal_action',p_legal_action,'total_paid',p_total_paid,'booking_forfeiture',p_booking_forfeiture,
        'cancellation_charges',p_cancellation_charges,'late_penalty',p_late_penalty,'processing_fee',p_processing_fee,
        'other_deductions',p_other_deductions,'other_deductions_note',p_other_deductions_note,'net_refund',p_net_refund,
        'refund_method',p_refund_method,'refund_payment_mode',p_refund_payment_mode,'refund_bank_id',p_refund_bank_id,
        'refund_reference',p_refund_reference,'refund_date',p_refund_date,'expected_refund_date',p_expected_refund_date,
        'refund_notes',p_refund_notes,'agent_commission_total',p_agent_commission_total,
        'agent_commission_paid',p_agent_commission_paid,'agent_commission_pending',p_agent_commission_pending,
        'commission_action',p_commission_action,'commission_recovery_amt',p_commission_recovery_amt,
        'commission_recovery_method',p_commission_recovery_method,'commission_notes',p_commission_notes,
        'client_flag',p_client_flag,'blacklist_reason',p_blacklist_reason,'initiated_by',p_initiated_by,'notes',p_notes)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_unit_id::text, 'restriction_warning', true, 'restrictions', 'cancellation');
  END IF;

  -- proceed (warning / non-soft) -> delegate to the preserved executor
  RETURN public._execute_unit_cancellation_core(
    p_company_id, p_unit_id, p_project_id, p_sale_id, p_client_id, p_agent_id,
    p_cancellation_date, p_effective_date, p_cancellation_type, p_reason_category, p_detailed_reason,
    p_overdue_count, p_days_past_due, p_notices_sent, p_last_notice_date, p_legal_action, p_total_paid,
    p_booking_forfeiture, p_cancellation_charges, p_late_penalty, p_processing_fee, p_other_deductions,
    p_other_deductions_note, p_net_refund, p_refund_method, p_refund_payment_mode, p_refund_bank_id,
    p_refund_reference, p_refund_date, p_expected_refund_date, p_refund_notes, p_agent_commission_total,
    p_agent_commission_paid, p_agent_commission_pending, p_commission_action, p_commission_recovery_amt,
    p_commission_recovery_method, p_commission_notes, p_client_flag, p_blacklist_reason, p_initiated_by, p_notes
  );
END;
$function$;

-- ── FIX 3b: gate execute_unit_transfer_v2 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_unit_transfer_v2(p_company_id uuid, p_transfer_date date, p_unit_id uuid, p_project_id uuid, p_old_sale_id uuid, p_old_client_id uuid, p_old_total_paid numeric, p_old_outstanding numeric, p_old_sale_price numeric, p_old_close_note text, p_new_client_id uuid, p_new_sale jsonb, p_installments jsonb DEFAULT '[]'::jsonb, p_transfer_fee numeric DEFAULT 0, p_documentation_charges numeric DEFAULT 0, p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL::text, p_charges_paid_by text DEFAULT 'new'::text, p_charges_payment_method text DEFAULT NULL::text, p_charges_reference text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_commission_rate numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_created_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_level := public._rms_restriction_level(p_company_id, 'transfer');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'transfer');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','transfer','entity_table','units','entity_id',p_unit_id,
      'project_id',p_project_id,'title','Unit transfer','description',p_old_close_note,
      'comment',COALESCE(NULLIF(TRIM(p_notes),''), NULLIF(TRIM(p_old_close_note),'')),
      'payload',jsonb_build_object(
        'transfer_date',p_transfer_date,'unit_id',p_unit_id,'project_id',p_project_id,'old_sale_id',p_old_sale_id,
        'old_client_id',p_old_client_id,'old_total_paid',p_old_total_paid,'old_outstanding',p_old_outstanding,
        'old_sale_price',p_old_sale_price,'old_close_note',p_old_close_note,'new_client_id',p_new_client_id,
        'new_sale',p_new_sale,'installments',p_installments,'transfer_fee',p_transfer_fee,
        'documentation_charges',p_documentation_charges,'other_charges',p_other_charges,
        'other_charges_desc',p_other_charges_desc,'charges_paid_by',p_charges_paid_by,
        'charges_payment_method',p_charges_payment_method,'charges_reference',p_charges_reference,
        'agent_id',p_agent_id,'commission_rate',p_commission_rate,'notes',p_notes,'created_by',p_created_by)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_unit_id::text, 'restriction_warning', true, 'restrictions', 'transfer');
  END IF;

  RETURN public._execute_unit_transfer_v2_core(
    p_company_id, p_transfer_date, p_unit_id, p_project_id, p_old_sale_id, p_old_client_id,
    p_old_total_paid, p_old_outstanding, p_old_sale_price, p_old_close_note, p_new_client_id, p_new_sale,
    p_installments, p_transfer_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
    p_charges_paid_by, p_charges_payment_method, p_charges_reference, p_agent_id, p_commission_rate,
    p_notes, p_created_by
  );
END;
$function$;
