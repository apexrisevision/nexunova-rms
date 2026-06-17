-- ============================================================================
-- NEXUNOVA RMS — list_sales_users_admin: surface father_name for the admin
-- review preview (Sales Access pending → full application view). 2026-06-17.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies;
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
  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code);
END; $$;
GRANT EXECUTE ON FUNCTION public.list_sales_users_admin(uuid) TO anon, authenticated;
