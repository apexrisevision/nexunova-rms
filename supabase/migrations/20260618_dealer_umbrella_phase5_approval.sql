-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — Phase 5: grouped approval (in the HOME company's admin).
-- get_umbrella_approval_context: members + their default project + active agents +
--   auto-matches (by CNIC/phone) — feeds the per-company merge chooser in the UI.
-- admin_approve_sales_user_grouped: one approval creates/links an agent in EVERY
--   member company (merge existing or save new, per the assignments), records the
--   dealer↔per-company agent map (dealer_company_agents), and activates the dealer
--   (sales_users.project_id = NULL so they see all member projects).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_umbrella_approval_context(p_sales_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users; v_group uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_sales_user_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_me.company_id;
  IF v_group IS NULL THEN RETURN jsonb_build_object('success',true,'umbrella',false); END IF;

  RETURN jsonb_build_object('success',true,'umbrella',true,'home_company_id',v_su.company_id,
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company_name', c.company_name,
        'project_id', (SELECT id FROM public.projects WHERE company_id=c.id ORDER BY created_at LIMIT 1),
        'project_name', (SELECT project_name FROM public.projects WHERE company_id=c.id ORDER BY created_at LIMIT 1),
        'matches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'full_name',a.full_name,'agent_code',a.agent_code,
                       'match_on', CASE WHEN NULLIF(TRIM(a.cnic),'')=NULLIF(TRIM(v_su.cnic),'') THEN 'CNIC' ELSE 'phone' END))
                     FROM public.agents a WHERE a.company_id=c.id
                       AND ( (NULLIF(TRIM(a.cnic),'') IS NOT NULL AND NULLIF(TRIM(a.cnic),'')=NULLIF(TRIM(v_su.cnic),''))
                          OR public._normalize_pk_mobile(a.phone)=public._normalize_pk_mobile(v_su.phone) )),'[]'::jsonb),
        'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'full_name',a.full_name,'agent_code',a.agent_code) ORDER BY a.full_name)
                     FROM public.agents a WHERE a.company_id=c.id AND a.status='active'),'[]'::jsonb)
      ) ORDER BY (c.id=v_su.company_id) DESC, c.company_name)
      FROM public.companies c WHERE c.dealer_group_id=v_group AND c.status='active'
    ),'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.get_umbrella_approval_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_umbrella_approval_context(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_approve_sales_user_grouped(p_id uuid, p_assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users; v_group uuid; v_limit jsonb;
        v_home uuid; comp uuid; proj uuid; link uuid; comm numeric; a jsonb; v_aid uuid; v_code text;
        v_results jsonb := '[]'::jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
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
      UPDATE public.sales_users SET status='active', is_active=true, agent_id=v_aid, kyc_status='verified', project_id=NULL, updated_at=now()
       WHERE id=p_id;
    END IF;
    v_results := v_results || jsonb_build_object('company_id',comp,'agent_id',v_aid);
  END LOOP;

  RETURN jsonb_build_object('success',true,'registered',v_results);
END $function$;
REVOKE ALL ON FUNCTION public.admin_approve_sales_user_grouped(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_sales_user_grouped(uuid,jsonb) TO anon, authenticated;
