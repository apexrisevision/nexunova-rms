-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — PHASE 3 (final)
-- 2026-06-15.  Additive only. Plan = AVAILABILITY_RESERVATION_PLAN.md.
-- ----------------------------------------------------------------------------
-- Per-plan SALES-ACCESS limit (owner-locked: Basic 15 / Pro 25 / Ultimate 50;
-- free_trial 3 [flagged for confirm]; enterprise 999). Separate from the paid
-- admin/user seats (max_users) — adding a sales person never touches that count.
--
-- (1) subscription_plans.max_sales_users — NULLABLE on purpose so any plan we
--     don't explicitly set FAILS OPEN (the limit reader COALESCEs NULL -> 999),
--     never bricking a tenant.
-- (2) check_plan_limit gains a 'sales_users' branch — IDENTICAL shape to the
--     existing 'users' branch (counts ACTIVE rows only; deactivated free a slot)
--     + COALESCE(max_sales_users,999) fail-open. No other branch is touched.
-- (3) create_sales_user enforces it (rejects the N+1 with a clean message), but
--     only when the call adds a NET-NEW active slot (re-inviting an already
--     active phone does not consume one).
-- (4) list_sales_users_admin now also returns the live limit for the admin badge.
-- ============================================================================

-- ── 1. Additive column + per-tier values (idempotent: only fills NULLs) ─────
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_sales_users integer;

UPDATE public.subscription_plans SET max_sales_users = CASE
    WHEN plan_code LIKE 'free_trial%' THEN 3
    WHEN plan_code LIKE 'basic%'      THEN 15
    WHEN plan_code LIKE 'pro%'        THEN 25
    WHEN plan_code LIKE 'ultimate%'   THEN 50
    WHEN plan_code = 'enterprise'     THEN 999
    ELSE 15   -- safe default for any other/legacy tier
  END
WHERE max_sales_users IS NULL;

-- ── 2. check_plan_limit + 'sales_users' branch (rest BYTE-IDENTICAL) ────────
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_company_id uuid, p_resource_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_plan  record; v_sub record; v_count integer; v_max integer;
BEGIN
  SELECT s.* INTO v_sub FROM public.subscriptions s
  WHERE s.company_id = p_company_id ORDER BY s.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_add',true,'current_count',0,'max_allowed',999);
  END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('can_add',true,'current_count',0,'max_allowed',999); END IF;
  CASE p_resource_type
    WHEN 'projects' THEN SELECT COUNT(*) INTO v_count FROM public.projects WHERE company_id=p_company_id; v_max:=v_plan.max_projects;
    WHEN 'units'    THEN SELECT COUNT(*) INTO v_count FROM public.units    WHERE company_id=p_company_id; v_max:=v_plan.max_units;
    WHEN 'clients'  THEN SELECT COUNT(*) INTO v_count FROM public.clients  WHERE company_id=p_company_id; v_max:=v_plan.max_clients;
    WHEN 'users'    THEN SELECT COUNT(*) INTO v_count FROM public.app_users WHERE company_id=p_company_id AND status='active'; v_max:=v_plan.max_users;
    WHEN 'sales_users' THEN SELECT COUNT(*) INTO v_count FROM public.sales_users WHERE company_id=p_company_id AND is_active=true; v_max:=COALESCE(v_plan.max_sales_users, 999);
    ELSE RETURN jsonb_build_object('can_add',true,'current_count',0,'max_allowed',999);
  END CASE;
  RETURN jsonb_build_object('can_add',v_count<v_max,'current_count',v_count,'max_allowed',v_max,'plan_name',v_plan.plan_name);
END;
$function$;

-- ── 3. create_sales_user — enforce the limit on a net-new active slot ───────
CREATE OR REPLACE FUNCTION public.create_sales_user(p_company_id uuid, p_project_id uuid, p_name text, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_me public.app_users; v_co public.companies; v_pin text; v_tok text; v_id uuid; v_limit jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF TRIM(COALESCE(p_name,''))='' OR TRIM(COALESCE(p_phone,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','name_phone_required'); END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;

  -- Plan limit: only enforce when this call adds a NET-NEW active slot.
  -- Re-inviting a phone that is already active does not consume a new slot.
  IF NOT EXISTS (SELECT 1 FROM public.sales_users
                 WHERE company_id=p_company_id AND lower(phone)=lower(trim(p_phone)) AND is_active=true) THEN
    v_limit := public.check_plan_limit(p_company_id, 'sales_users');
    IF NOT (v_limit->>'can_add')::boolean THEN
      RETURN jsonb_build_object('success',false,'error','plan_limit',
        'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an unused sales person, or upgrade your plan.',
        'limit', v_limit);
    END IF;
  END IF;

  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;
  v_pin := LPAD((FLOOR(random()*1000000))::int::text, 6, '0');
  v_tok := encode(gen_random_bytes(32),'hex');

  INSERT INTO public.sales_users
    (company_id, project_id, full_name, phone, pin_hash, temp_token, temp_token_expires_at, is_active, created_by)
  VALUES
    (p_company_id, p_project_id, TRIM(p_name), TRIM(p_phone), crypt(v_pin, gen_salt('bf',8)),
     v_tok, now()+interval '30 days', true, v_me.id)
  ON CONFLICT (company_id, lower(phone)) DO UPDATE SET
    full_name=TRIM(p_name), project_id=p_project_id, pin_hash=crypt(v_pin, gen_salt('bf',8)),
    temp_token=v_tok, temp_token_expires_at=now()+interval '30 days', is_active=true, updated_at=now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'sales_user_id',v_id,
    'temp_pin',v_pin,'temp_token',v_tok,'company_code',v_co.company_code);
END; $$;

-- ── 4. list_sales_users_admin — also return the live limit for the badge ────
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'phone', su.phone,
    'project_id', su.project_id, 'project_name', p.project_name,
    'is_active', su.is_active, 'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r
                            WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su
  LEFT JOIN public.projects p ON p.id=su.project_id
  WHERE su.company_id=p_company_id;
  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id, 'sales_users'));
END; $$;
