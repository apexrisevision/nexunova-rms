-- ════════════════════════════════════════════════════════════════════════════
-- Lead assignment = hand DOWN to your own DIRECT REPORTS. 2026-06-21.
-- Owner: "Director ke neeche jo team hai usi ko assign kar sake — Rashid sirf
-- Maria (uske neeche) ko, na ke Amar ko." The earlier role-flow logic let a
-- director assign to ANY company marketing_manager (so Rashid wrongly saw Amar,
-- who reports to a different director, and not Maria, his own rep).
-- New simple rule: you may assign a lead to anyone who reports DIRECTLY to you
-- (parent_sales_user_id = you), regardless of their role. Directors keep
-- company-wide reach over the lead itself (they may hand down a lead that arrived
-- in any director's pool); managers still only hand down leads they own.
-- ════════════════════════════════════════════════════════════════════════════

-- who can I hand a lead to? my direct reports (any role)
CREATE OR REPLACE FUNCTION public.get_assignable_users(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_users jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'name', su.full_name, 'role', su.role, 'mine', true,
    'open_leads', (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.status NOT IN ('won','lost'))
  ) ORDER BY su.full_name), '[]'::jsonb) INTO v_users
  FROM public.sales_users su
  WHERE su.company_id=v_ses.company_id AND su.status='active'
    AND su.parent_sales_user_id = v_ses.sales_user_id;   -- DIRECT reports only

  RETURN jsonb_build_object('success',true,
    'can_assign', (jsonb_array_length(v_users) > 0),
    'assigns_to_label', 'team',
    'users', v_users);
END
$function$;

-- assign one lead → a direct report
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_tparent uuid; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT owner_sales_user_id, company_id INTO v_owner, v_company FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  IF v_companywide AND v_company <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT v_companywide AND v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  -- target must report DIRECTLY to the caller
  SELECT full_name, parent_sales_user_id INTO v_tname, v_tparent
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));
  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END
$function$;

-- assign many leads → a direct report
CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_company := v_ses.company_id;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');

  SELECT full_name, parent_sales_user_id INTO v_tname, v_tparent
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    IF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN
      UPDATE public.leads
         SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
             assigned_at=now(), last_activity_at=now(), updated_at=now()
       WHERE id=v_lead;
      INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (v_lead, v_ses.sales_user_id, p_to_id);
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (v_lead, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'assigned',v_count,'to_name',v_tname,'to_id',p_to_id);
END
$function$;
