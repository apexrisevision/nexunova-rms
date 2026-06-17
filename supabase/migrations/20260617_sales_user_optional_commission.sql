-- ════════════════════════════════════════════════════════════════
-- Sub-agent commission is NOT fixed at approval — it's decided per
-- unit/sale (agent proposes in the portal, admin confirms/overrides at
-- approval). So the agent-level commission_percent becomes an OPTIONAL
-- default: NULL = no fixed rate, every sale carries its own rate.
-- Only change vs prior: p_commission_percent default NULL + NULL allowed.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(p_id uuid, p_project_id uuid, p_commission_percent numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_su public.sales_users; v_limit jsonb; v_agent uuid; v_code text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','project_required',
      'message','Pick the project this sales agent works in — it becomes their reserve scope and agent home project.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;
  -- commission is optional now; validate range only when a default IS provided
  IF p_commission_percent IS NOT NULL AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_commission','message','Commission must be between 0 and 100.'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  IF v_su.cnic IS NOT NULL AND TRIM(v_su.cnic) <> '' THEN
    SELECT id INTO v_agent FROM public.agents
     WHERE company_id=v_me.company_id AND cnic=v_su.cnic ORDER BY created_at LIMIT 1;
  END IF;

  IF v_agent IS NULL THEN
    v_code := public.generate_agent_code(v_me.company_id, p_project_id);
    INSERT INTO public.agents (
      company_id, project_id, created_by, agent_code, full_name, father_name, phone, cnic,
      email, address, bank_name, bank_account_no, bank_account_title,
      commission_percent, join_date, status,
      profile_photo_url, cnic_front_url, cnic_back_url
    ) VALUES (
      v_me.company_id, p_project_id, v_me.id, v_code, v_su.full_name, v_su.father_name, v_su.phone,
      NULLIF(TRIM(COALESCE(v_su.cnic,'')),''),
      v_su.email, v_su.address, v_su.bank_name, v_su.bank_account_no, v_su.bank_account_title,
      p_commission_percent, CURRENT_DATE, 'active',
      v_su.profile_photo_url, v_su.cnic_front_url, v_su.cnic_back_url
    ) RETURNING id INTO v_agent;
  ELSE
    SELECT agent_code INTO v_code FROM public.agents WHERE id=v_agent;
  END IF;

  UPDATE public.sales_users
     SET status='active', is_active=true, project_id=p_project_id,
         agent_id=v_agent, kyc_status='verified', updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'agent_id',v_agent,'agent_code',v_code);
END; $function$;
