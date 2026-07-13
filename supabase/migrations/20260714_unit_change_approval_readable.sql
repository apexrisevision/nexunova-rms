-- Change Unit — make the APPROVAL readable.
--
-- Found by driving the non-admin path for real (a recovery-role user submitted a change and an
-- owner approved it). The replay branch worked, but the request itself carried only unit UUIDs:
-- the Admin was being asked to approve a bare "Change unit" with no way to see WHICH unit was
-- moving WHERE, for whom, or for how much. That is signing blind on a money-moving action.
--
-- The soft-block branch now stamps the unit numbers and the client's name into the request's
-- title, description and payload. approvals.js reads these to render a "What changes if you
-- approve" block (see _apRiskCallouts case 'unit_change').
--
-- Only the soft-block branch of execute_unit_change changes; _execute_unit_change_core is untouched.
CREATE OR REPLACE FUNCTION public.execute_unit_change(
  p_company_id uuid, p_change_date date, p_project_id uuid,
  p_sale_id uuid, p_client_id uuid, p_old_unit_id uuid, p_new_unit_id uuid,
  p_price_per_sqft numeric, p_area_sqft numeric, p_discount numeric DEFAULT 0,
  p_installments jsonb DEFAULT '[]'::jsonb,
  p_change_fee numeric DEFAULT 0, p_documentation_charges numeric DEFAULT 0,
  p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL,
  p_charges_paid_by text DEFAULT 'client', p_charges_payment_method text DEFAULT NULL,
  p_charges_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_level text; v_ar jsonb; v_me public.app_users := public._rms_caller();
  v_old_no text; v_new_no text; v_client text;
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
    RETURN public._execute_unit_change_core(
      p_company_id, p_change_date, p_project_id, p_sale_id, p_client_id, p_old_unit_id, p_new_unit_id,
      p_price_per_sqft, p_area_sqft, p_discount, p_installments,
      p_change_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
      p_charges_paid_by, p_charges_payment_method, p_charges_reference,
      p_reason, p_notes, COALESCE(p_created_by, v_me.id::text));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'unit_change');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'unit_change');
  ELSIF v_level = 'soft' THEN
    SELECT COALESCE(NULLIF(unit_no,''), unit_code) INTO v_old_no FROM public.units WHERE id=p_old_unit_id AND company_id=p_company_id;
    SELECT COALESCE(NULLIF(unit_no,''), unit_code) INTO v_new_no FROM public.units WHERE id=p_new_unit_id AND company_id=p_company_id;
    SELECT full_name INTO v_client FROM public.clients WHERE id=p_client_id AND company_id=p_company_id;

    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','unit_change','entity_table','units','entity_id',p_old_unit_id,
      'project_id',p_project_id,
      'title', 'Change unit ' || COALESCE(v_old_no,'?') || ' → ' || COALESCE(v_new_no,'?'),
      'description', COALESCE(v_client,'Client') || ' moves from unit ' || COALESCE(v_old_no,'?')
                     || ' to unit ' || COALESCE(v_new_no,'?')
                     || CASE WHEN NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN '' ELSE '. ' || p_reason END,
      'amount',0,
      'comment',COALESCE(NULLIF(TRIM(p_reason),''), NULLIF(TRIM(p_notes),'')),
      'payload',jsonb_build_object(
        'change_date',p_change_date,'project_id',p_project_id,'sale_id',p_sale_id,'client_id',p_client_id,
        'old_unit_id',p_old_unit_id,'new_unit_id',p_new_unit_id,
        'old_unit_no',v_old_no,'new_unit_no',v_new_no,'client_name',v_client,
        'price_per_sqft',p_price_per_sqft,'area_sqft',p_area_sqft,'discount',p_discount,
        'installments',p_installments,
        'change_fee',p_change_fee,'documentation_charges',p_documentation_charges,
        'other_charges',p_other_charges,'other_charges_desc',p_other_charges_desc,
        'charges_paid_by',p_charges_paid_by,'charges_payment_method',p_charges_payment_method,
        'charges_reference',p_charges_reference,
        'reason',p_reason,'notes',p_notes,'created_by',COALESCE(p_created_by, v_me.id::text))
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_old_unit_id::text, 'restriction_warning', true, 'restrictions', 'unit_change');
  END IF;

  RETURN public._execute_unit_change_core(
    p_company_id, p_change_date, p_project_id, p_sale_id, p_client_id, p_old_unit_id, p_new_unit_id,
    p_price_per_sqft, p_area_sqft, p_discount, p_installments,
    p_change_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
    p_charges_paid_by, p_charges_payment_method, p_charges_reference,
    p_reason, p_notes, COALESCE(p_created_by, v_me.id::text));
END;
$function$;
