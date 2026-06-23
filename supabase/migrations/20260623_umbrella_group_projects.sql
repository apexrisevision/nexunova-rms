-- ════════════════════════════════════════════════════════════════════════════
-- UMBRELLA GROUP PROJECTS — let an umbrella operator pick any group project
-- The lead_entry operator lives in the umbrella home company (e.g. Awami). The
-- other member companies (FMH, Fourteen Group) hold projects but have no directors
-- — sales are run by the home company's directors. So: the project dropdown shows
-- ALL projects across the operator's dealer group, and a lead/page tagged to any of
-- them STAYS in the operator's own company pool (owned by its director, seen
-- company-wide and distributed by them) while keeping the chosen project tag.
-- Backward-compatible: companies with dealer_group_id = NULL behave exactly as
-- before (own-company projects only). Only the project guard changed in
-- create_lead / save_fb_page (own company OR same dealer_group_id).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_my_projects(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_grp uuid; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT dealer_group_id INTO v_grp FROM public.companies WHERE id=v_ses.company_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'code',p.project_code,'name',p.project_name,
                                               'company_id',p.company_id,'company_name',c.company_name)
            ORDER BY (p.company_id=v_ses.company_id) DESC, c.company_name, p.project_name),'[]'::jsonb)
    INTO v_rows
    FROM public.projects p JOIN public.companies c ON c.id=p.company_id
   WHERE COALESCE(p.status,'') <> 'archived'
     AND ( p.company_id=v_ses.company_id OR (v_grp IS NOT NULL AND c.dealer_group_id=v_grp) );
  RETURN jsonb_build_object('success',true,'projects',v_rows);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_name text; v_role text; v_cfg public.lead_role_config; v_src text;
        v_phone text; v_norm text; v_dup record; v_can_force boolean; v_owner uuid; v_proj uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads THEN
    RETURN jsonb_build_object('success',false,'error','role_no_leads','message','Your role does not handle leads.'); END IF;
  IF v_cfg.create_sources IS NULL OR jsonb_array_length(v_cfg.create_sources)=0 THEN
    RETURN jsonb_build_object('success',false,'error','cannot_create','message','Your role receives leads from your manager — you can’t create them.'); END IF;
  v_name := NULLIF(TRIM(COALESCE(p_payload->>'name','')),'');
  IF v_name IS NULL THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Lead name is required.'); END IF;
  v_src := NULLIF(TRIM(COALESCE(p_payload->>'source','')),'');
  IF v_src IS NULL OR NOT (v_src IN (SELECT jsonb_array_elements_text(v_cfg.create_sources))) THEN
    v_src := COALESCE(v_cfg.create_sources->>0,'manual'); END IF;
  v_phone := NULLIF(TRIM(COALESCE(p_payload->>'phone','')),'');
  v_norm := public._norm_phone(v_phone);

  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  -- accept a project from the caller's company OR any company in the same dealer group (umbrella)
  IF v_proj IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.projects pr JOIN public.companies c ON c.id=pr.company_id
        WHERE pr.id=v_proj
          AND ( pr.company_id=v_ses.company_id
                OR (c.dealer_group_id IS NOT NULL
                    AND c.dealer_group_id=(SELECT dealer_group_id FROM public.companies WHERE id=v_ses.company_id))) ) THEN
    v_proj := NULL;
  END IF;

  IF v_norm IS NOT NULL THEN
    SELECT l.id, l.status, ow.full_name AS owner_name,
           (l.owner_sales_user_id IN (
              WITH RECURSIVE sub AS (
                SELECT id FROM public.sales_users WHERE id=v_ses.sales_user_id
                UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
              ) SELECT id FROM sub)) AS visible
      INTO v_dup
    FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    WHERE l.company_id=v_ses.company_id AND l.status NOT IN ('won','lost')
      AND public._norm_phone(l.phone)=v_norm
    ORDER BY l.created_at ASC LIMIT 1;
    IF v_dup.id IS NOT NULL THEN
      IF v_dup.visible THEN
        RETURN jsonb_build_object('success',false,'error','duplicate_owned',
          'message','This client already exists in your pipeline.',
          'lead_id',v_dup.id,'owner_name',v_dup.owner_name,'status',v_dup.status);
      ELSE
        v_can_force := v_role IN ('marketing_manager','director');
        IF NOT (p_force AND v_can_force) THEN
          RETURN jsonb_build_object('success',false,'error','duplicate_elsewhere',
            'message','A lead with this phone already exists in the organization.','can_force', v_can_force);
        END IF;
      END IF;
    END IF;
  END IF;

  v_owner := v_ses.sales_user_id;
  IF v_role='lead_entry' THEN
    v_owner := public._lead_entry_owner(v_ses.sales_user_id, v_ses.company_id);
    IF v_owner IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','no_director','message','No director is set up to receive leads yet. Ask your admin.'); END IF;
  END IF;

  INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, created_by_sales_user_id, name, phone, email,
    source, interest, unit_type_id, unit_id, budget, status, notes)
  VALUES (v_ses.company_id, COALESCE(v_proj, v_ses.project_id),
    v_owner, v_ses.sales_user_id, v_name, v_phone,
    NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), v_src,
    NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''),
    NULLIF(p_payload->>'unit_type_id','')::uuid, NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.save_fb_page(p_session_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_id uuid; v_pid text; v_tok text;
        v_proj uuid; v_recip uuid; v_status text; v_exists uuid; v_is_le boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  v_is_le := (v_role='lead_entry');

  v_pid := NULLIF(TRIM(COALESCE(p_payload->>'page_id','')),'');
  IF v_pid IS NULL THEN RETURN jsonb_build_object('success',false,'error','page_required','message','Facebook Page ID is required.'); END IF;
  v_id  := NULLIF(p_payload->>'id','')::uuid;
  v_tok := NULLIF(TRIM(COALESCE(p_payload->>'page_access_token','')),'');

  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  -- accept a project from this company OR any company in the same dealer group
  IF v_proj IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.projects pr JOIN public.companies c ON c.id=pr.company_id
        WHERE pr.id=v_proj
          AND ( pr.company_id=v_co
                OR (c.dealer_group_id IS NOT NULL
                    AND c.dealer_group_id=(SELECT dealer_group_id FROM public.companies WHERE id=v_co))) ) THEN
    v_proj:=NULL;
  END IF;

  IF v_is_le THEN
    v_recip := NULL;
  ELSE
    v_recip := NULLIF(p_payload->>'recipient_sales_user_id','')::uuid;
    IF v_recip IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.sales_users WHERE id=v_recip AND company_id=v_co AND role IN ('director','admin')) THEN
      v_recip := NULL;
    END IF;
  END IF;
  IF v_recip IS NULL THEN
    SELECT id INTO v_recip FROM public.sales_users
     WHERE company_id=v_co AND role='director' AND status='active'
     ORDER BY created_at NULLS LAST, id LIMIT 1;
  END IF;

  SELECT id INTO v_exists FROM public.fb_connections WHERE page_id=v_pid LIMIT 1;
  IF v_exists IS NOT NULL AND (v_id IS NULL OR v_exists <> v_id) THEN
    RETURN jsonb_build_object('success',false,'error','page_taken','message','That Facebook Page is already connected.');
  END IF;

  IF v_id IS NOT NULL THEN
    IF v_is_le THEN
      UPDATE public.fb_connections SET
        page_id=v_pid, page_name=NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''),
        page_access_token=COALESCE(v_tok, page_access_token),
        app_secret=COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), app_secret),
        project_id=v_proj, auto_notify=COALESCE((p_payload->>'auto_notify')::boolean, auto_notify), updated_at=now()
      WHERE id=v_id AND company_id=v_co;
    ELSE
      PERFORM set_config('app.fb_recip_ok','1', true);
      UPDATE public.fb_connections SET
        page_id=v_pid, page_name=NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''),
        page_access_token=COALESCE(v_tok, page_access_token),
        app_secret=COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), app_secret),
        project_id=v_proj, recipient_sales_user_id=v_recip,
        auto_notify=COALESCE((p_payload->>'auto_notify')::boolean, auto_notify), updated_at=now()
      WHERE id=v_id AND company_id=v_co;
    END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  ELSE
    PERFORM set_config('app.fb_recip_ok','1', true);
    INSERT INTO public.fb_connections(company_id, page_id, page_name, page_access_token, app_secret,
                                      project_id, recipient_sales_user_id, auto_notify)
    VALUES (v_co, v_pid, NULLIF(TRIM(COALESCE(p_payload->>'page_name','')),''), v_tok,
            NULLIF(TRIM(COALESCE(p_payload->>'app_secret','')),''), v_proj, v_recip,
            COALESCE((p_payload->>'auto_notify')::boolean, true))
    RETURNING id INTO v_id;
  END IF;

  SELECT page_access_token INTO v_tok FROM public.fb_connections WHERE id=v_id;
  v_status := CASE WHEN v_pid IS NOT NULL AND v_tok IS NOT NULL THEN 'connected' ELSE 'disconnected' END;
  UPDATE public.fb_connections SET status=v_status WHERE id=v_id;
  RETURN jsonb_build_object('success',true,'id',v_id,'status',v_status);
END; $function$;
