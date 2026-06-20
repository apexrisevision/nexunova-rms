-- Restricted "lead_entry" data-entry role. Applied live via MCP (crm_lead_entry_role); filed for the record.
-- Operator CREATES leads (manual/whatsapp/csv) that land in the DIRECTOR's pool (owner=director,
-- created_by=operator for audit) and is SERVER-LOCKED out of every other portal RPC.

-- 1) allow the new role
ALTER TABLE public.sales_users DROP CONSTRAINT sales_users_role_check;
ALTER TABLE public.sales_users ADD CONSTRAINT sales_users_role_check
  CHECK (role = ANY (ARRAY['sale_rep','marketing_manager','admin','cfo','director','lead_entry']));

-- 2) role config: creates leads from the four channels; owns nothing (see create_lead)
DELETE FROM public.lead_role_config WHERE role='lead_entry';
INSERT INTO public.lead_role_config(role,can_have_leads,create_sources,receives_from_role,assigns_to_role)
VALUES ('lead_entry', true, '["facebook","whatsapp","instagram","manual"]'::jsonb, null, null);

-- 3) admin can assign the role (set_sales_user_role allowlist += lead_entry; still requires a parent)
--    [full body re-applied in the live migration; only the IN-list changed]

-- 4) helpers: caller role + director-resolution (topmost director ancestor, else company's primary director)
CREATE OR REPLACE FUNCTION public._sales_role_of(p_session_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT su.role FROM public.sales_sessions ss JOIN public.sales_users su ON su.id=ss.sales_user_id
  WHERE ss.session_token=p_session_token AND ss.expires_at>now();
$$;
CREATE OR REPLACE FUNCTION public._lead_entry_owner(p_operator uuid, p_company uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  WITH RECURSIVE up AS (
    SELECT id, parent_sales_user_id, role, 0 AS lvl FROM public.sales_users WHERE id=p_operator
    UNION ALL SELECT s.id, s.parent_sales_user_id, s.role, up.lvl+1 FROM public.sales_users s JOIN up ON s.id=up.parent_sales_user_id)
  SELECT id INTO v FROM up WHERE role='director' ORDER BY lvl DESC LIMIT 1;
  IF v IS NULL THEN
    SELECT id INTO v FROM public.sales_users WHERE company_id=p_company AND role='director' AND status='active'
      ORDER BY created_at NULLS LAST, id LIMIT 1;
  END IF;
  RETURN v;
END; $$;

-- 5) operator's own entered leads (audit by created_by) — allowed for the role
CREATE OR REPLACE FUNCTION public.get_my_entered_leads(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_today int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT count(*) FILTER (WHERE created_at::date=current_date) INTO v_today
    FROM public.leads WHERE created_by_sales_user_id=v_ses.sales_user_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'source',source,'created_at',created_at) ORDER BY created_at DESC),'[]'::jsonb)
    INTO v_rows FROM (SELECT id,name,phone,source,created_at FROM public.leads
      WHERE created_by_sales_user_id=v_ses.sales_user_id ORDER BY created_at DESC LIMIT 200) t;
  RETURN jsonb_build_object('success',true,'rows',v_rows,'today',COALESCE(v_today,0));
END; $$;
GRANT EXECUTE ON FUNCTION public.get_my_entered_leads(text) TO anon, authenticated;

-- 6) create_lead: for lead_entry, owner = tenant director (their pool); created_by = operator (audit).
--    [full create_lead body re-applied live — only the ownership block was added:]
--      v_owner := v_ses.sales_user_id;
--      IF v_role='lead_entry' THEN v_owner := public._lead_entry_owner(...); (error no_director if null) END IF;
--      INSERT ... owner_sales_user_id=v_owner, created_by_sales_user_id=v_ses.sales_user_id ...

-- 7) SERVER LOCK-DOWN: a role guard was injected after the session check of every non-entry portal RPC
--    (47 functions) via a DO block that string-replaces the session-expired line with:
--      IF public._sales_role_of(p_session_token)='lead_entry'
--        THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
--    The guard is a NO-OP for any non-lead_entry session. Allowlist (NOT gated): create_lead,
--    import_leads, get_my_entered_leads, get_my_profile, update_my_profile, change_my_pin,
--    get_my_lead_config, the agreement RPCs, and all buyer-portal RPCs.
