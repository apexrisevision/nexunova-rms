-- ════════════════════════════════════════════════════════════════════════
-- CRM — LEAD ROUTING BY ROLE (foundation: "who gets leads, role-wise")
-- Hierarchy:  Facebook ─► Director ─► Manager ─► Sub-agent
-- Each role also self-sources Manual + Walk-in. Director alone has Facebook.
-- CFO / Admin do NOT get leads. `receives_from_role` / `assigns_to_role`
-- define the down-chain handoff (built next). This migration = the rule table
-- + a per-caller config RPC + create_lead now enforces role eligibility/source.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_role_config (
  role                text PRIMARY KEY,
  can_have_leads      boolean NOT NULL DEFAULT false,
  create_sources      jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- selectable when adding manually
  receives_from_role  text,                                   -- who hands leads down to this role
  assigns_to_role     text                                    -- who this role hands leads down to
);

INSERT INTO public.lead_role_config (role, can_have_leads, create_sources, receives_from_role, assigns_to_role) VALUES
  ('director',          true,  '["facebook","manual","walkin"]'::jsonb, NULL,               'marketing_manager'),
  ('marketing_manager', true,  '["manual","walkin"]'::jsonb,            'director',          'sale_rep'),
  ('sale_rep',          true,  '["manual","walkin"]'::jsonb,            'marketing_manager', NULL),
  ('admin',             false, '[]'::jsonb,                              NULL,               NULL),
  ('cfo',               false, '[]'::jsonb,                              NULL,               NULL)
ON CONFLICT (role) DO UPDATE SET
  can_have_leads=EXCLUDED.can_have_leads, create_sources=EXCLUDED.create_sources,
  receives_from_role=EXCLUDED.receives_from_role, assigns_to_role=EXCLUDED.assigns_to_role;

-- label helper for source/role keys (kept inline-simple) ----------------------
CREATE OR REPLACE FUNCTION public._lead_source_label(p text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'facebook' THEN 'Facebook' WHEN 'manual' THEN 'Manual'
                WHEN 'walkin' THEN 'Walk-in' WHEN 'assigned' THEN 'Assigned' ELSE initcap(p) END;
$$;
CREATE OR REPLACE FUNCTION public._lead_role_label(p text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'director' THEN 'Director' WHEN 'marketing_manager' THEN 'Marketing Manager'
                WHEN 'sale_rep' THEN 'Sub-agent' WHEN 'admin' THEN 'Admin' WHEN 'cfo' THEN 'CFO' ELSE initcap(p) END;
$$;

-- get_my_lead_config — the caller's lead rules (drives portal gating + form) --
CREATE OR REPLACE FUNCTION public.get_my_lead_config(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cfg public.lead_role_config; v_sources jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'role',v_role,'role_label',public._lead_role_label(v_role),
      'can_have_leads',false,'sources','[]'::jsonb,'can_assign',false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('value',s,'label',public._lead_source_label(s))),'[]'::jsonb)
    INTO v_sources FROM jsonb_array_elements_text(v_cfg.create_sources) s;

  RETURN jsonb_build_object('success',true,
    'role', v_role, 'role_label', public._lead_role_label(v_role),
    'can_have_leads', v_cfg.can_have_leads,
    'sources', v_sources,
    'receives_from_role', v_cfg.receives_from_role,
    'receives_from_label', CASE WHEN v_cfg.receives_from_role IS NULL THEN NULL ELSE public._lead_role_label(v_cfg.receives_from_role) END,
    'can_assign', (v_cfg.assigns_to_role IS NOT NULL),
    'assigns_to_role', v_cfg.assigns_to_role,
    'assigns_to_label', CASE WHEN v_cfg.assigns_to_role IS NULL THEN NULL ELSE public._lead_role_label(v_cfg.assigns_to_role) END
  );
END; $function$;

-- create_lead — now enforces role eligibility + allowed source ----------------
CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_name text; v_role text; v_cfg public.lead_role_config; v_src text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads THEN
    RETURN jsonb_build_object('success',false,'error','role_no_leads','message','Your role does not handle leads.'); END IF;

  v_name := NULLIF(TRIM(COALESCE(p_payload->>'name','')),'');
  IF v_name IS NULL THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Lead name is required.'); END IF;

  -- source must be one this role may pick; otherwise fall back to the first allowed
  v_src := NULLIF(TRIM(COALESCE(p_payload->>'source','')),'');
  IF v_src IS NULL OR NOT (v_src IN (SELECT jsonb_array_elements_text(v_cfg.create_sources))) THEN
    v_src := COALESCE(v_cfg.create_sources->>0,'manual');
  END IF;

  INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, name, phone, email,
    source, interest, unit_type_id, unit_id, budget, status, notes)
  VALUES (
    v_ses.company_id,
    COALESCE(NULLIF(p_payload->>'project_id','')::uuid, v_ses.project_id),
    v_ses.sales_user_id, v_name,
    NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''),
    NULLIF(TRIM(COALESCE(p_payload->>'email','')),''),
    v_src,
    NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''),
    NULLIF(p_payload->>'unit_type_id','')::uuid,
    NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(p_payload->>'budget','')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
END; $function$;
