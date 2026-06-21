-- ════════════════════════════════════════════════════════════════════════════
-- DIRECTORS: full action on every company lead. 2026-06-21.
-- Owner ask: "Director ko har company lead pe poora action assign karo."
-- The per-lead action RPCs all gated on owner = caller, so a director could see
-- a company lead (after the view fixes) but couldn't act on one they didn't own.
-- New helper _lead_can_act(): director/admin/cfo may act on ANY lead in their
-- company; everyone else still only on leads they own. assign/distribute is also
-- widened for directors (any company lead → any active recipient of the role-flow
-- target role, not just direct reports). Role-flow itself is unchanged
-- (director→marketing_manager→sale_rep).
-- ════════════════════════════════════════════════════════════════════════════

-- scope helper: can the caller act on this lead?
CREATE OR REPLACE FUNCTION public._lead_can_act(p_session_token text, p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_owner uuid; v_co uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT owner_sales_user_id, company_id INTO v_owner, v_co FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN false; END IF;
  IF v_role IN ('director','admin','cfo') THEN RETURN v_co = v_ses.company_id; END IF;
  RETURN v_owner = v_ses.sales_user_id;
END
$function$;

-- 1) stage change
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_cur text; v_link uuid; v_owner uuid; v_n int;
        v_rank jsonb := '{"new":1,"contacted":2,"visit":3,"negotiation":4,"won":5}'::jsonb;
        v_rf int; v_rt int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_status NOT IN ('new','contacted','visit','negotiation','won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status'); END IF;
  SELECT status, converted_reservation_id INTO v_cur, v_link FROM public.leads WHERE id=p_id;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_cur = p_status THEN RETURN jsonb_build_object('success',true,'status',p_status,'noop',true); END IF;
  IF v_cur IN ('won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','terminal_locked',
      'message','This lead is already '||initcap(v_cur)||'. Reopen it before changing the stage.'); END IF;
  IF p_status='won' AND v_link IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','link_required',
      'message','Link a reservation or sale before marking this lead Won.'); END IF;
  IF p_status <> 'lost' THEN
    v_rf := (v_rank->>v_cur)::int; v_rt := (v_rank->>p_status)::int;
    IF v_rt < v_rf - 1 THEN
      RETURN jsonb_build_object('success',false,'error','bad_transition',
        'message','Can''t jump back from '||initcap(v_cur)||' to '||initcap(p_status)||'. Move one step at a time.'); END IF;
  END IF;
  UPDATE public.leads SET status=p_status, last_activity_at=now(), updated_at=now() WHERE id=p_id;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_id, v_ses.sales_user_id, 'stage', 'Moved to '||p_status);
  RETURN jsonb_build_object('success',true,'status',p_status);
END
$function$;

-- 2) add activity (call/whatsapp/visit/meeting/note)
CREATE OR REPLACE FUNCTION public.add_lead_activity(p_session_token text, p_lead_id uuid, p_kind text, p_body text DEFAULT NULL::text, p_follow_up_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_kind NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_kind'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, p_kind, NULLIF(TRIM(COALESCE(p_body,'')),''));
  UPDATE public.leads SET last_activity_at=now(), next_follow_up_at = COALESCE(p_follow_up_at, next_follow_up_at), updated_at=now()
   WHERE id=p_lead_id;
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 3) set follow-up
CREATE OR REPLACE FUNCTION public.set_lead_followup(p_session_token text, p_id uuid, p_when timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET next_follow_up_at=p_when, updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 4) edit lead details
CREATE OR REPLACE FUNCTION public.update_lead(p_session_token text, p_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET
    name     = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'name','')),''), name),
    phone    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''), phone),
    email    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), email),
    source   = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'source','')),''), source),
    interest = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''), interest),
    budget   = COALESCE(NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric, budget),
    notes    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'notes','')),''), notes),
    updated_at = now()
  WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 5) mark lost
CREATE OR REPLACE FUNCTION public.mark_lead_lost(p_session_token text, p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_r text; v_cur text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT status INTO v_cur FROM public.leads WHERE id=p_id;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_cur='won' THEN RETURN jsonb_build_object('success',false,'error','terminal_locked','message','This lead is already Won — reopen it before changing the stage.'); END IF;
  v_r := NULLIF(TRIM(COALESCE(p_reason,'')),'');
  UPDATE public.leads SET status='lost', lost_reason=v_r, last_activity_at=now(), updated_at=now() WHERE id=p_id;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_id, v_ses.sales_user_id, 'stage', 'Lost'||CASE WHEN v_r IS NOT NULL THEN ' — '||v_r ELSE '' END);
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 6) log interaction (with outcome/next step)
CREATE OR REPLACE FUNCTION public.log_lead_interaction(p_session_token text, p_lead_id uuid, p_channel text, p_outcome text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_next_step_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_channel NOT IN ('call','whatsapp','sms','visit','meeting','note') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_channel'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, outcome, next_step)
  VALUES (p_lead_id, v_ses.sales_user_id, p_channel,
          NULLIF(TRIM(COALESCE(p_note,'')),''), NULLIF(TRIM(COALESCE(p_outcome,'')),''), NULLIF(TRIM(COALESCE(p_next_step,'')),''));
  UPDATE public.leads SET last_activity_at=now(), next_follow_up_at = COALESCE(p_next_step_date, next_follow_up_at), updated_at=now()
   WHERE id=p_lead_id;
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 7) link reservation
CREATE OR REPLACE FUNCTION public.link_lead_reservation(p_session_token text, p_lead_id uuid, p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET converted_reservation_id=p_reservation_id, updated_at=now() WHERE id=p_lead_id;
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 8) pullback (take a lead to yourself) — director: any company lead; else own team
CREATE OR REPLACE FUNCTION public.pullback_lead(p_session_token text, p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_owner uuid; v_co uuid; v_role text; v_name text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid:=v_ses.sales_user_id;
  SELECT owner_sales_user_id, company_id INTO v_owner, v_co FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_owner = v_uid THEN RETURN jsonb_build_object('success',false,'error','already_yours','message','This lead is already with you.'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role IN ('director','admin','cfo') THEN
    IF v_co <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  ELSE
    IF NOT EXISTS(
      WITH RECURSIVE sub AS (
        SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid
        UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
      ) SELECT 1 FROM sub WHERE id=v_owner
    ) THEN RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only pull back your own team''s leads.'); END IF;
  END IF;
  UPDATE public.leads SET owner_sales_user_id=v_uid, assigned_by_sales_user_id=v_uid, assigned_at=now(), last_activity_at=now(), updated_at=now() WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_owner, v_uid);
  SELECT full_name INTO v_name FROM public.sales_users WHERE id=v_owner;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_uid, 'assigned', 'Pulled back from '||COALESCE(v_name,'agent'));
  RETURN jsonb_build_object('success',true);
END
$function$;

-- 9) assign one — director: any company lead → any active recipient of the target role
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_to_role text; v_trole text; v_tname text; v_tparent uuid; v_companywide boolean;
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

  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','cannot_assign','message','Your role does not hand leads down.'); END IF;

  SELECT role, full_name, parent_sales_user_id INTO v_trole, v_tname, v_tparent
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_trole IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole <> v_to_role THEN
    RETURN jsonb_build_object('success',false,'error','wrong_target_role','message','You can only assign to a '||public._lead_role_label(v_to_role)||'.'); END IF;
  IF NOT v_companywide AND v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
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

-- 10) assign many
CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_to_role text; v_trole text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_company := v_ses.company_id;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','cannot_assign','message','Your role does not hand leads down.'); END IF;

  SELECT role, full_name, parent_sales_user_id INTO v_trole, v_tname, v_tparent
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_trole IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole <> v_to_role THEN
    RETURN jsonb_build_object('success',false,'error','wrong_target_role','message','You can only assign to a '||public._lead_role_label(v_to_role)||'.'); END IF;
  IF NOT v_companywide AND v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
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

-- 11) assignable-users picker — director sees every company recipient of the target role
CREATE OR REPLACE FUNCTION public.get_assignable_users(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_to_role text; v_users jsonb; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN
    RETURN jsonb_build_object('success',true,'can_assign',false,'users','[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'name', su.full_name, 'role', su.role, 'mine', (su.parent_sales_user_id = v_ses.sales_user_id),
    'open_leads', (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.status NOT IN ('won','lost'))
  ) ORDER BY su.full_name), '[]'::jsonb) INTO v_users
  FROM public.sales_users su
  WHERE su.company_id=v_ses.company_id AND su.role=v_to_role
    AND su.status='active' AND su.id<>v_ses.sales_user_id
    AND (v_companywide OR su.parent_sales_user_id = v_ses.sales_user_id);

  RETURN jsonb_build_object('success',true,'can_assign',true,
    'assigns_to_role', v_to_role,
    'assigns_to_label', public._lead_role_label(v_to_role),
    'users', v_users);
END
$function$;
