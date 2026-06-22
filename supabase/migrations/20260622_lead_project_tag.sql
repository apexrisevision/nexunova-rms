-- ════════════════════════════════════════════════════════════════════════════
-- LEAD PROJECT TAG — tag every entered lead with WHICH PROJECT's ad it came from,
-- so leads from different project ads (each on its own WhatsApp number) land in one
-- pool, tagged by project, for the director to distribute + report on.
--
-- leads.project_id already exists (uuid, FK→projects ON DELETE SET NULL) and
-- create_lead already persists it. This migration:
--   1. list_my_projects(token)  — NEW token-scoped project dropdown source (lead_entry allowed)
--   2. create_lead              — guard: project must belong to the operator's company
--   3. import_leads             — carry project_id from each row into create_lead
--   4. get_my_entered_leads     — surface project_name (operator "Entered" list)
--   5. get_member_leads         — surface project_name (director team drill)
-- All company-scoped; FG untouched; pure RPC definitions.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. token-scoped project list (powers the Project dropdown in lead entry) ──
CREATE OR REPLACE FUNCTION public.list_my_projects(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  -- any valid session (incl. lead_entry) may read its own company's projects
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'code',project_code,'name',project_name)
                            ORDER BY project_name),'[]'::jsonb)
    INTO v_rows
    FROM public.projects
   WHERE company_id=v_ses.company_id AND COALESCE(status,'') <> 'archived';
  RETURN jsonb_build_object('success',true,'projects',v_rows);
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_my_projects(text) TO anon, authenticated;

-- ── 2. create_lead — add a project-ownership guard (project must be company's) ──
CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- project tag: only honour a project that belongs to THIS company (anti cross-tenant)
  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  IF v_proj IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.projects pr WHERE pr.id=v_proj AND pr.company_id=v_ses.company_id) THEN
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

  -- ownership: lead_entry operators feed the director's pool; everyone else owns their own
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

-- ── 3. import_leads — carry each row's project_id into create_lead ──
CREATE OR REPLACE FUNCTION public.import_leads(p_session_token text, p_rows jsonb, p_default_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cfg public.lead_role_config;
        v_n int; i int; v_row jsonb; v_src text; v_payload jsonb; v_res jsonb;
        v_results jsonb := '[]'::jsonb; v_imp int:=0; v_dup int:=0; v_inv int:=0;
        v_status text; v_reason text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads
     OR v_cfg.create_sources IS NULL OR jsonb_array_length(v_cfg.create_sources)=0 THEN
    RETURN jsonb_build_object('success',false,'error','cannot_create',
      'message','Your role can’t create leads, so bulk import isn’t available.'); END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN
    RETURN jsonb_build_object('success',false,'error','bad_input','message','No rows to import.'); END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n>500 THEN RETURN jsonb_build_object('success',false,'error','too_many',
    'message','Import is limited to 500 rows at a time. Split the file and try again.'); END IF;

  FOR i IN 0..v_n-1 LOOP
    v_row := p_rows->i;
    v_src := NULLIF(TRIM(COALESCE(v_row->>'source','')),'');
    IF v_src IS NULL THEN v_src := COALESCE(NULLIF(TRIM(p_default_source),''),'manual'); END IF;
    v_payload := jsonb_build_object(
      'name',       TRIM(COALESCE(v_row->>'name','')),
      'phone',      TRIM(COALESCE(v_row->>'phone','')),
      'source',     v_src,
      'interest',   TRIM(COALESCE(v_row->>'interest','')),
      'budget',     TRIM(COALESCE(v_row->>'budget','')),
      'notes',      TRIM(COALESCE(v_row->>'notes','')),
      'project_id', NULLIF(TRIM(COALESCE(v_row->>'project_id','')),''));   -- project carried per row (create_lead guards ownership)
    v_res := public.create_lead(p_session_token, v_payload, false);   -- single source of truth

    IF (v_res->>'success')::boolean THEN
      v_status:='imported'; v_reason:=NULL; v_imp:=v_imp+1;
    ELSE
      CASE v_res->>'error'
        WHEN 'name_required'       THEN v_status:='invalid';   v_reason:='Missing name';                       v_inv:=v_inv+1;
        WHEN 'duplicate_owned'     THEN v_status:='duplicate'; v_reason:='Already in your pipeline';            v_dup:=v_dup+1;
        WHEN 'duplicate_elsewhere' THEN v_status:='duplicate'; v_reason:='Already exists in the organization';  v_dup:=v_dup+1;
        ELSE v_status:='invalid'; v_reason:=COALESCE(v_res->>'message', v_res->>'error', 'Could not import');   v_inv:=v_inv+1;
      END CASE;
    END IF;

    v_results := v_results || jsonb_build_object(
      'row', i+1, 'name', v_row->>'name', 'phone', v_row->>'phone',
      'status', v_status, 'reason', v_reason, 'lead_id', v_res->>'id');
  END LOOP;

  RETURN jsonb_build_object('success',true,'total',v_n,
    'imported',v_imp,'skipped_duplicate',v_dup,'skipped_invalid',v_inv,'results',v_results);
END; $function$;

-- ── 4. get_my_entered_leads — surface project_name on the operator's Entered list ──
CREATE OR REPLACE FUNCTION public.get_my_entered_leads(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_today int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT count(*) FILTER (WHERE created_at::date=current_date) INTO v_today
    FROM public.leads WHERE created_by_sales_user_id=v_ses.sales_user_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'source',source,
                                               'project_name',project_name,'created_at',created_at)
                            ORDER BY created_at DESC),'[]'::jsonb)
    INTO v_rows FROM (
      SELECT l.id,l.name,l.phone,l.source,l.created_at, p.project_name
      FROM public.leads l LEFT JOIN public.projects p ON p.id=l.project_id
      WHERE l.created_by_sales_user_id=v_ses.sales_user_id ORDER BY l.created_at DESC LIMIT 200) t;
  RETURN jsonb_build_object('success',true,'rows',v_rows,'today',COALESCE(v_today,0));
END; $function$;

-- ── 5. get_member_leads — surface project_name on the director's team drill ──
CREATE OR REPLACE FUNCTION public.get_member_leads(p_session_token text, p_member uuid, p_scope text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text; v_ok boolean; su public.sales_users; v_ids uuid[]; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  WITH RECURSIVE sub AS (SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id)
  SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_member) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  SELECT * INTO su FROM public.sales_users WHERE id=p_member;
  WITH RECURSIVE inset AS (SELECT p_member AS id
    UNION ALL SELECT s.id FROM public.sales_users s JOIN inset ON s.parent_sales_user_id=inset.id WHERE p_scope='team' AND s.status='active')
  SELECT array_agg(id) INTO v_ids FROM inset;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'status', l.status, 'source', l.source,
    'budget', l.budget, 'owner_name', ow.full_name, 'project_name', p.project_name, 'last_activity_at', l.last_activity_at
  ) ORDER BY l.last_activity_at DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM public.leads l
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.owner_sales_user_id=ANY(v_ids);
  RETURN jsonb_build_object('success',true,'name',su.full_name,'role',su.role,'scope',p_scope,'leads',v_rows);
END; $function$;
