-- ════════════════════════════════════════════════════════════════════════════
-- CONNECTIONS OVERVIEW — one read for the operator's "Connections" health page.
-- Aggregates every lead source (Facebook pages, WhatsApp numbers, Instagram
-- accounts, Website form) for the caller's company. Gated lead_entry/director/admin.
-- (Applied live via MCP 2026-06-24; this file is the repo record. Also fixed the
--  WhatsApp/Instagram list_* RPCs to join projects.project_name, not .name.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_connections_overview(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid;
        v_fb jsonb; v_wa jsonb; v_ig jsonb; v_web_on boolean; v_web_leads int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',COALESCE(f.page_name,f.page_id),'status',f.status,
            'leads',COALESCE(f.leads_count,0),'last_event',f.last_lead_at,
            'project',(SELECT project_name FROM public.projects WHERE id=f.project_id)) ORDER BY f.created_at),'[]'::jsonb)
    INTO v_fb FROM public.fb_connections f WHERE f.company_id=v_co;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',COALESCE(w.display_number,w.phone_number_id),
            'leads',COALESCE(w.leads_count,0),'last_event',w.last_event_at,'active',w.active,
            'project',(SELECT project_name FROM public.projects WHERE id=w.project_id)) ORDER BY w.created_at),'[]'::jsonb)
    INTO v_wa FROM public.whatsapp_connections w WHERE w.company_id=v_co;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',COALESCE('@'||i.ig_username,i.ig_account_id),
            'leads',COALESCE(i.leads_count,0),'last_event',i.last_event_at,'active',i.active,
            'project',(SELECT project_name FROM public.projects WHERE id=i.project_id)) ORDER BY i.created_at),'[]'::jsonb)
    INTO v_ig FROM public.instagram_connections i WHERE i.company_id=v_co;
  SELECT EXISTS(SELECT 1 FROM public.web_lead_config WHERE company_id=v_co AND active) INTO v_web_on;
  SELECT count(*) INTO v_web_leads FROM public.leads WHERE company_id=v_co AND source='website';
  RETURN jsonb_build_object('success',true,'facebook',v_fb,'whatsapp',v_wa,'instagram',v_ig,
    'website', jsonb_build_object('configured', v_web_on, 'leads', COALESCE(v_web_leads,0)));
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_connections_overview(text) TO anon, authenticated, service_role;

-- fix: projects join column is project_name (not name) in the WhatsApp/Instagram lists
CREATE OR REPLACE FUNCTION public.list_whatsapp_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'phone_number_id', w.phone_number_id, 'display_number', w.display_number, 'waba_id', w.waba_id,
    'verify_token', w.verify_token, 'project_id', w.project_id, 'project_name', p.project_name,
    'has_token', (w.access_token IS NOT NULL AND length(w.access_token)>0),
    'active', w.active, 'leads_count', w.leads_count, 'last_event_at', w.last_event_at
  ) ORDER BY w.created_at), '[]'::jsonb) INTO v_rows
  FROM public.whatsapp_connections w LEFT JOIN public.projects p ON p.id=w.project_id
  WHERE w.company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'connections',v_rows);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_instagram_connections(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ig_account_id', w.ig_account_id, 'ig_username', w.ig_username, 'page_id', w.page_id,
    'verify_token', w.verify_token, 'project_id', w.project_id, 'project_name', p.project_name,
    'has_token', (w.access_token IS NOT NULL AND length(w.access_token)>0),
    'active', w.active, 'leads_count', w.leads_count, 'last_event_at', w.last_event_at
  ) ORDER BY w.created_at), '[]'::jsonb) INTO v_rows
  FROM public.instagram_connections w LEFT JOIN public.projects p ON p.id=w.project_id
  WHERE w.company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'connections',v_rows);
END; $function$;