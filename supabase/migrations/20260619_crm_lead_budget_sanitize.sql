-- ════════════════════════════════════════════════════════════════════════
-- FIX: lead budget with commas/symbols (e.g. "8,000,000") crashed ::numeric
-- ("invalid input syntax for type numeric") → create/update lead failed
-- ("Could not save"). Strip everything except digits & dot before casting.
-- ════════════════════════════════════════════════════════════════════════

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
    NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_lead(p_session_token text, p_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.leads SET
    name     = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'name','')),''), name),
    phone    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''), phone),
    email    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), email),
    source   = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'source','')),''), source),
    interest = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''), interest),
    budget   = COALESCE(NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric, budget),
    notes    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'notes','')),''), notes),
    updated_at = now()
  WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  RETURN jsonb_build_object('success',true);
END; $function$;
