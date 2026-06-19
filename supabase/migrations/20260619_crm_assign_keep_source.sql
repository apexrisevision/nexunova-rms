-- ════════════════════════════════════════════════════════════════════════
-- FIX: assign_lead was overwriting source='assigned', erasing the lead's true
-- origin (Facebook/Manual/Walk-in). The handoff is already captured by
-- assigned_by + the 'assigned' activity + lead_assignments trail, so keep the
-- ORIGINAL source intact for the trail's "where it came from".
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_to_role text; v_trole text; v_tname text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT owner_sales_user_id, company_id INTO v_owner, v_company FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','cannot_assign','message','Your role does not hand leads down.'); END IF;

  SELECT role, full_name INTO v_trole, v_tname FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_trole IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole <> v_to_role THEN
    RETURN jsonb_build_object('success',false,'error','wrong_target_role','message','You can only assign to a '||public._lead_role_label(v_to_role)||'.'); END IF;

  UPDATE public.sales_users SET parent_sales_user_id=v_ses.sales_user_id, updated_at=now()
   WHERE id=p_to_id AND parent_sales_user_id IS NULL;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;

  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id)
  VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;
