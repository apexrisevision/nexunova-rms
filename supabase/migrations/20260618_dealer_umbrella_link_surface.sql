-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — surface the umbrella context in Portal Access.
-- list_sales_users_admin now returns an 'umbrella' object when the company belongs
-- to a group, so the Portal Access page shows the ONE umbrella signup link (instead
-- of the company's own link) and tells non-home admins where dealers are approved.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies; v_umb jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'father_name', su.father_name, 'phone', su.phone, 'cnic', su.cnic,
    'email', su.email, 'address', su.address,
    'bank_name', su.bank_name, 'bank_account_no', su.bank_account_no, 'bank_account_title', su.bank_account_title,
    'profile_photo_url', su.profile_photo_url, 'cnic_front_url', su.cnic_front_url, 'cnic_back_url', su.cnic_back_url,
    'kyc_status', su.kyc_status,
    'project_id', su.project_id, 'project_name', p.project_name,
    'status', su.status, 'is_active', su.is_active,
    'agent_id', su.agent_id, 'agent_code', ag.agent_code,
    'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY (su.status='pending') DESC, su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su
  LEFT JOIN public.projects p ON p.id=su.project_id
  LEFT JOIN public.agents   ag ON ag.id=su.agent_id
  WHERE su.company_id=p_company_id;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  SELECT CASE WHEN g.id IS NOT NULL THEN jsonb_build_object(
      'group_id', g.id, 'group_name', g.name, 'signup_token', g.signup_token,
      'home_company_id', g.home_company_id, 'is_home', (g.home_company_id=p_company_id),
      'home_company_name', (SELECT company_name FROM public.companies WHERE id=g.home_company_id),
      'members', (SELECT string_agg(company_name, ', ' ORDER BY created_at) FROM public.companies WHERE dealer_group_id=g.id)
    ) ELSE NULL END INTO v_umb
  FROM public.companies c LEFT JOIN public.company_groups g ON g.id=c.dealer_group_id
  WHERE c.id=p_company_id;

  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code,
    'umbrella', v_umb);
END; $function$;
