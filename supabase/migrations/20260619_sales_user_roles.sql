-- ════════════════════════════════════════════════════════════════════════
-- Phase 0 — Sub-agent portal ROLE FOUNDATION (data only, no gated behaviour yet)
-- Adds a role taxonomy to sales_users so every joining member is tagged from
-- approval onward. Roles (corporate hierarchy that logs into the portal):
--   sale_rep (default) · marketing_manager · admin · cfo · director
-- Threads `role` through sales_login (session), admin approval (single +
-- umbrella) and the admin list. New set_sales_user_role lets admins re-tag
-- any existing member + set a parent (team head) for future rollups.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Schema ---------------------------------------------------------------
ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'sale_rep',
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_users_role_check') THEN
    ALTER TABLE public.sales_users
      ADD CONSTRAINT sales_users_role_check
      CHECK (role IN ('sale_rep','marketing_manager','admin','cfo','director'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_users_parent ON public.sales_users(parent_sales_user_id);

-- 2) sales_login — return role + permissions in the session payload -------
CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
        v_max int := 5; v_lock interval := interval '15 minutes'; v_att int;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;

  IF v_su.locked_until IS NOT NULL AND v_su.locked_until > now() THEN
    RETURN jsonb_build_object('success',false,'error','locked',
      'message','Too many wrong PIN attempts. Please try again after '||
        CEIL(EXTRACT(EPOCH FROM (v_su.locked_until - now()))/60)::int||' minute(s).'); END IF;

  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    v_att := COALESCE(v_su.failed_pin_attempts,0) + 1;
    IF v_att >= v_max THEN
      UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=now()+v_lock WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','locked',
        'message','Too many wrong PIN attempts. Your sign-in is locked for 15 minutes.');
    ELSE
      UPDATE public.sales_users SET failed_pin_attempts=v_att WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN',
        'attempts_left', v_max - v_att,
        'message','Invalid phone or PIN. '||(v_max - v_att)||' attempt(s) left before a 15-minute lock.');
    END IF;
  END IF;

  IF v_su.status='pending' THEN
    RETURN jsonb_build_object('success',false,'error','pending',
      'message','Your request is still pending your office''s approval. Please wait — you can sign in once approved.'); END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','inactive',
      'message','Your access has been deactivated. Please contact your office to be reactivated.'); END IF;

  IF COALESCE(v_su.failed_pin_attempts,0) <> 0 OR v_su.locked_until IS NOT NULL THEN
    UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=NULL WHERE id=v_su.id;
  END IF;

  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,'sales_user_name',v_su.full_name,'project_id',v_su.project_id,
    'role', v_su.role, 'permissions', v_su.permissions,
    'upload_token',v_co.sales_signup_token);
END; $function$;

-- 3) set_sales_user_role — admin re-tags role / sets parent (any member) --
CREATE OR REPLACE FUNCTION public.set_sales_user_role(p_id uuid, p_role text, p_parent_sales_user_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_role'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF p_parent_sales_user_id IS NOT NULL THEN
    IF p_parent_sales_user_id = p_id THEN RETURN jsonb_build_object('success',false,'error','self_parent','message','A member cannot be their own team head.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales_users WHERE id=p_parent_sales_user_id AND company_id=v_me.company_id) THEN
      RETURN jsonb_build_object('success',false,'error','invalid_parent'); END IF;
  END IF;
  UPDATE public.sales_users
     SET role=p_role, parent_sales_user_id=p_parent_sales_user_id, updated_at=now()
   WHERE id=p_id;
  RETURN jsonb_build_object('success',true,'role',p_role);
END; $function$;

-- 4) admin_approve_sales_user — stamp role at approval (drop+recreate: new arg)
DROP FUNCTION IF EXISTS public.admin_approve_sales_user(uuid, uuid, numeric, uuid);
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(p_id uuid, p_project_id uuid, p_commission_percent numeric DEFAULT NULL::numeric, p_link_agent_id uuid DEFAULT NULL::uuid, p_role text DEFAULT 'sale_rep')
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
  IF p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director') THEN p_role := 'sale_rep'; END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','project_required',
      'message','Pick the project this sales agent works in — it becomes their reserve scope and agent home project.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;
  IF p_commission_percent IS NOT NULL AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_commission','message','Commission must be between 0 and 100.'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  IF p_link_agent_id IS NOT NULL THEN
    SELECT id INTO v_agent FROM public.agents WHERE id=p_link_agent_id AND company_id=v_me.company_id;
    IF v_agent IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_link_agent'); END IF;
    UPDATE public.agents SET
      cnic               = COALESCE(NULLIF(TRIM(cnic),''),               NULLIF(TRIM(COALESCE(v_su.cnic,'')),'')),
      phone              = CASE WHEN COALESCE(NULLIF(TRIM(phone),''),'0000000000')='0000000000'
                                THEN COALESCE(NULLIF(TRIM(COALESCE(v_su.phone,'')),''), phone) ELSE phone END,
      father_name        = COALESCE(NULLIF(TRIM(father_name),''),        v_su.father_name),
      email              = COALESCE(NULLIF(TRIM(email),''),              v_su.email),
      address            = COALESCE(NULLIF(TRIM(address),''),            v_su.address),
      bank_name          = COALESCE(NULLIF(TRIM(bank_name),''),          v_su.bank_name),
      bank_account_no    = COALESCE(NULLIF(TRIM(bank_account_no),''),    v_su.bank_account_no),
      bank_account_title = COALESCE(NULLIF(TRIM(bank_account_title),''), v_su.bank_account_title),
      profile_photo_url  = COALESCE(NULLIF(TRIM(profile_photo_url),''),  v_su.profile_photo_url),
      cnic_front_url     = COALESCE(NULLIF(TRIM(cnic_front_url),''),     v_su.cnic_front_url),
      cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''),      v_su.cnic_back_url),
      commission_percent = COALESCE(commission_percent, p_commission_percent),
      status             = 'active',
      updated_at         = now()
    WHERE id = v_agent;
    SELECT agent_code INTO v_code FROM public.agents WHERE id=v_agent;

  ELSE
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
  END IF;

  UPDATE public.sales_users
     SET status='active', is_active=true, project_id=p_project_id,
         agent_id=v_agent, kyc_status='verified', role=p_role, updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'agent_id',v_agent,'agent_code',v_code,
                            'linked', (p_link_agent_id IS NOT NULL));
END; $function$;

-- 5) admin_approve_sales_user_grouped — stamp role on the home record -----
DROP FUNCTION IF EXISTS public.admin_approve_sales_user_grouped(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user_grouped(p_id uuid, p_assignments jsonb, p_role text DEFAULT 'sale_rep')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users; v_group uuid; v_limit jsonb;
        v_home uuid; comp uuid; proj uuid; link uuid; comm numeric; a jsonb; v_aid uuid; v_code text;
        v_results jsonb := '[]'::jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director') THEN p_role := 'sale_rep'; END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_me.company_id;
  IF v_group IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_umbrella','message','This company is not part of an umbrella; use the standard approval.'); END IF;
  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||').','limit',v_limit); END IF;
  v_home := v_su.company_id;

  FOR comp IN SELECT id FROM public.companies WHERE dealer_group_id=v_group AND status='active' LOOP
    SELECT x INTO a FROM jsonb_array_elements(COALESCE(p_assignments,'[]'::jsonb)) x WHERE (x->>'company_id')::uuid = comp LIMIT 1;
    proj := NULLIF(a->>'project_id','')::uuid;
    link := NULLIF(a->>'link_agent_id','')::uuid;
    comm := NULLIF(a->>'commission_percent','')::numeric;
    IF proj IS NULL THEN SELECT id INTO proj FROM public.projects WHERE company_id=comp ORDER BY created_at LIMIT 1; END IF;
    IF proj IS NULL THEN CONTINUE; END IF;
    IF comm IS NOT NULL AND (comm < 0 OR comm > 100) THEN comm := NULL; END IF;

    IF link IS NOT NULL THEN
      SELECT id INTO v_aid FROM public.agents WHERE id=link AND company_id=comp;
      IF v_aid IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_link_agent','company_id',comp); END IF;
      UPDATE public.agents SET
        cnic               = COALESCE(NULLIF(TRIM(cnic),''), NULLIF(TRIM(COALESCE(v_su.cnic,'')),'')),
        phone              = CASE WHEN COALESCE(NULLIF(TRIM(phone),''),'0000000000')='0000000000'
                                  THEN COALESCE(NULLIF(TRIM(COALESCE(v_su.phone,'')),''), phone) ELSE phone END,
        father_name        = COALESCE(NULLIF(TRIM(father_name),''), v_su.father_name),
        email              = COALESCE(NULLIF(TRIM(email),''), v_su.email),
        address            = COALESCE(NULLIF(TRIM(address),''), v_su.address),
        profile_photo_url  = COALESCE(NULLIF(TRIM(profile_photo_url),''), v_su.profile_photo_url),
        cnic_front_url     = COALESCE(NULLIF(TRIM(cnic_front_url),''), v_su.cnic_front_url),
        cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''), v_su.cnic_back_url),
        commission_percent = COALESCE(commission_percent, comm),
        status='active', updated_at=now()
      WHERE id=v_aid;
    ELSE
      v_code := public.generate_agent_code(comp, proj);
      INSERT INTO public.agents (company_id, project_id, created_by, agent_code, full_name, father_name, phone, cnic,
        email, address, bank_name, bank_account_no, bank_account_title, commission_percent, join_date, status,
        profile_photo_url, cnic_front_url, cnic_back_url)
      VALUES (comp, proj, v_me.id, v_code, v_su.full_name, v_su.father_name, v_su.phone, NULLIF(TRIM(COALESCE(v_su.cnic,'')),''),
        v_su.email, v_su.address, v_su.bank_name, v_su.bank_account_no, v_su.bank_account_title, comm, CURRENT_DATE, 'active',
        v_su.profile_photo_url, v_su.cnic_front_url, v_su.cnic_back_url)
      RETURNING id INTO v_aid;
    END IF;

    INSERT INTO public.dealer_company_agents (group_id, sales_user_id, company_id, agent_id)
    VALUES (v_group, p_id, comp, v_aid)
    ON CONFLICT (sales_user_id, company_id) DO UPDATE SET agent_id=EXCLUDED.agent_id;

    IF comp = v_home THEN
      UPDATE public.sales_users SET status='active', is_active=true, agent_id=v_aid, kyc_status='verified', project_id=NULL, role=p_role, updated_at=now()
       WHERE id=p_id;
    END IF;
    v_results := v_results || jsonb_build_object('company_id',comp,'agent_id',v_aid);
  END LOOP;

  RETURN jsonb_build_object('success',true,'registered',v_results);
END; $function$;

-- 6) list_sales_users_admin — surface role + parent for the admin UI ------
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    'role', su.role, 'parent_sales_user_id', su.parent_sales_user_id,
    'parent_name', (SELECT pp.full_name FROM public.sales_users pp WHERE pp.id=su.parent_sales_user_id),
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
