-- BATCH C2-b (2026-06-03): gate master-data + company-settings mutators as ADMIN-ONLY.
-- Previously had NO caller gate (filtered only id + p_company_id). Same proven prelude as cancel_payment.
-- Functions: update_agent, update_agent_extended, update_blacklist_entry,
--            set_payment_method_default, toggle_payment_method_active. Bodies otherwise unchanged.

CREATE OR REPLACE FUNCTION public.update_agent(p_id uuid, p_company_id uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_cnic text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_commission_percent numeric DEFAULT NULL::numeric, p_bank_name text DEFAULT NULL::text, p_bank_account_no text DEFAULT NULL::text, p_bank_account_title text DEFAULT NULL::text, p_join_date date DEFAULT NULL::date, p_termination_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_profile_photo_url text DEFAULT NULL::text, p_cnic_front_url text DEFAULT NULL::text, p_cnic_back_url text DEFAULT NULL::text, p_rating numeric DEFAULT NULL::numeric, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_proj uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT project_id INTO v_proj FROM public.agents WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF p_project_id IS NOT NULL AND p_project_id IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'An agent cannot be moved to another project. Create a new agent instead.');
  END IF;
  IF p_cnic IS NOT NULL AND p_cnic <> '' THEN
    IF EXISTS (SELECT 1 FROM public.agents WHERE company_id = p_company_id AND project_id = v_proj AND cnic = p_cnic AND id <> p_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_cnic',
        'message', 'An agent with this CNIC already exists in this project.');
    END IF;
  END IF;
  IF p_commission_percent IS NOT NULL AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_commission',
      'message', 'Commission must be between 0 and 100.');
  END IF;
  UPDATE public.agents SET
    full_name=COALESCE(p_full_name,full_name), phone=COALESCE(p_phone,phone), email=COALESCE(p_email,email),
    cnic=COALESCE(p_cnic,cnic), address=COALESCE(p_address,address),
    commission_percent=COALESCE(p_commission_percent,commission_percent),
    bank_name=COALESCE(p_bank_name,bank_name), bank_account_no=COALESCE(p_bank_account_no,bank_account_no),
    bank_account_title=COALESCE(p_bank_account_title,bank_account_title),
    join_date=COALESCE(p_join_date,join_date), termination_date=COALESCE(p_termination_date,termination_date),
    notes=COALESCE(p_notes,notes), status=COALESCE(p_status,status),
    profile_photo_url=COALESCE(p_profile_photo_url,profile_photo_url),
    cnic_front_url=COALESCE(p_cnic_front_url,cnic_front_url), cnic_back_url=COALESCE(p_cnic_back_url,cnic_back_url),
    rating=COALESCE(p_rating,rating)
  WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_agent_extended(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller(); v_proj uuid; v_parent uuid := NULLIF(p_data->>'parent_agent_id','')::uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  SELECT project_id INTO v_proj FROM public.agents WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF (p_data ? 'project_id') AND (p_data->>'project_id') IS NOT NULL
     AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'An agent cannot be moved to another project.');
  END IF;
  IF v_parent IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = v_parent AND company_id = p_company_id AND project_id = v_proj) THEN
      RETURN jsonb_build_object('success', false, 'error', 'parent_cross_project',
        'message', 'The parent agent must belong to the same project.');
    END IF;
  END IF;
  UPDATE public.agents SET
    territory=COALESCE(NULLIF(p_data->>'territory',''), territory),
    monthly_target=COALESCE(NULLIF(p_data->>'monthly_target','')::numeric, monthly_target),
    quarterly_target=COALESCE(NULLIF(p_data->>'quarterly_target','')::numeric, quarterly_target),
    contract_doc_url=COALESCE(NULLIF(p_data->>'contract_doc_url',''), contract_doc_url),
    parent_agent_id=COALESCE(NULLIF(p_data->>'parent_agent_id','')::uuid, parent_agent_id)
  WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

CREATE OR REPLACE FUNCTION public.update_blacklist_entry(p_id uuid, p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.blacklisted_clients SET
    is_active=COALESCE((p_data->>'is_active')::bool, is_active),
    removed_date=COALESCE((p_data->>'removed_date')::date, removed_date),
    removed_by=COALESCE(NULLIF(p_data->>'removed_by',''), removed_by),
    removal_reason=COALESCE(NULLIF(p_data->>'removal_reason',''), removal_reason),
    reason=COALESCE(NULLIF(p_data->>'reason',''), reason)
  WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

CREATE OR REPLACE FUNCTION public.set_payment_method_default(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.company_payment_methods SET is_default=false WHERE company_id=p_company_id AND id <> p_id;
  UPDATE public.company_payment_methods SET is_default=true, updated_at=now() WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

CREATE OR REPLACE FUNCTION public.toggle_payment_method_active(p_id uuid, p_company_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin access required.'); END IF;
  UPDATE public.company_payment_methods SET is_active=p_active, updated_at=now()
  WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;
