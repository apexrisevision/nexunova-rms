-- ============================================================================
-- NEXUNOVA RMS — SALE AGENT SELF-SERVICE — PHASE 1: identity link
-- 2026-06-17.  Plan = SALE_AGENT_SELF_SERVICE_PLAN.md.
-- ----------------------------------------------------------------------------
-- Core principle: Sale Agent = Sale User = ONE identity. When the admin approves
-- a portal-signup sales person, a REAL agents row is created (agent_code/ID +
-- commission %) and linked back via sales_users.agent_id. The person is now a
-- registered Sale Agent who can reserve and (Phase 2/3) self-submit sales.
--
-- Owner-locked decisions baked in here:
--   (1) agent becomes real at SIGNUP-approval (this RPC).
--   (3) linked agent is EXEMPT from the max_agents plan limit — they already
--       consumed a sales-access seat (check_plan_limit('sales_users') still runs).
-- Behavior change: project is now REQUIRED at approval (an agent must have a home
--   project — agents.project_id is NOT NULL). The chosen project is both the
--   reserve-scope and the agent's home project.
-- CNIC reuse: if an agent with the same CNIC already exists in the company, we
--   LINK to it instead of creating a duplicate (mirrors create_agent's dup guard).
-- Additive + backward-compatible: old 2-arg callers resolve to the new function
--   via the DEFAULT 3rd arg.
-- ============================================================================

-- ── 1. The link column + signup capture columns ─────────────────────────────
ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;
-- Photos/CNIC scans captured at signup (camera or browse) — carried to the agent
-- record on approval. NULL until the signup form is extended (Phase 2).
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS profile_photo_url text;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS cnic_front_url   text;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS cnic_back_url    text;

-- ── 2. admin_approve_sales_user — now also mints/links the agent ─────────────
DROP FUNCTION IF EXISTS public.admin_approve_sales_user(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(
  p_id uuid, p_project_id uuid, p_commission_percent numeric DEFAULT 2.00)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me     public.app_users;
  v_su     public.sales_users;
  v_limit  jsonb;
  v_agent  uuid;
  v_code   text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending',
      'message','This registration is already '||v_su.status||'.'); END IF;

  -- project is REQUIRED now (the agent record needs a home project)
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','project_required',
      'message','Pick the project this sales agent works in — it becomes their reserve scope and agent home project.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;

  IF p_commission_percent IS NULL OR p_commission_percent < 0 OR p_commission_percent > 100 THEN
    RETURN jsonb_build_object('success',false,'error','invalid_commission',
      'message','Commission must be between 0 and 100.'); END IF;

  -- sales-access seat limit (unchanged gate)
  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  -- ── mint or link the agent (EXEMPT from max_agents per decision 3) ──
  -- reuse an existing agent if the same CNIC is already on file in this company
  IF v_su.cnic IS NOT NULL AND TRIM(v_su.cnic) <> '' THEN
    SELECT id INTO v_agent FROM public.agents
     WHERE company_id=v_me.company_id AND cnic=v_su.cnic
     ORDER BY created_at LIMIT 1;
  END IF;

  IF v_agent IS NULL THEN
    v_code := public.generate_agent_code(v_me.company_id, p_project_id);
    INSERT INTO public.agents (
      company_id, project_id, created_by, agent_code, full_name, phone, cnic,
      commission_percent, join_date, status,
      profile_photo_url, cnic_front_url, cnic_back_url
    ) VALUES (
      v_me.company_id, p_project_id, v_me.id, v_code, v_su.full_name, v_su.phone,
      NULLIF(TRIM(COALESCE(v_su.cnic,'')),''), p_commission_percent, CURRENT_DATE, 'active',
      v_su.profile_photo_url, v_su.cnic_front_url, v_su.cnic_back_url
    ) RETURNING id INTO v_agent;
  ELSE
    SELECT agent_code INTO v_code FROM public.agents WHERE id=v_agent;
  END IF;

  UPDATE public.sales_users
     SET status='active', is_active=true, project_id=p_project_id,
         agent_id=v_agent, updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'agent_id',v_agent,'agent_code',v_code);
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_approve_sales_user(uuid,uuid,numeric) TO anon, authenticated;

-- ── 3. Surface the linked agent in the admin list ───────────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'phone', su.phone,
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
