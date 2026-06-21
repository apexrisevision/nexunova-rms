-- ════════════════════════════════════════════════════════════════════════════
-- get_lead + get_lead_interactions: company-wide for director/admin/cfo.
-- 2026-06-21. Follow-up to 20260621_directors_see_all_company_leads (which fixed
-- the list). Opening a lead a director could SEE but did not OWN returned
-- "Lead not found" because both detail RPCs still scoped to the caller's subtree.
-- Now mirror the list: director/admin/cfo resolve any lead in their company;
-- marketing_manager/sale_rep keep the subtree scope. (View only.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_lead jsonb; v_acts jsonb;
        v_role text; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'next_follow_up_at', l.next_follow_up_at,
    'owner_name', ow.full_name, 'is_mine', (l.owner_sales_user_id=v_uid),
    'assigned_from', ab.full_name,
    'created_by_name', cb.full_name,
    'first_contact_at', (SELECT min(a2.created_at) FROM public.lead_activities a2 WHERE a2.lead_id=l.id AND a2.kind IN ('call','whatsapp','visit','meeting')),
    'contact_count', (SELECT count(*) FROM public.lead_activities a3 WHERE a3.lead_id=l.id AND a3.kind IN ('call','whatsapp','visit','meeting')),
    'booking', (
      SELECT jsonb_build_object(
        'reservation_id', r.id, 'unit_no', u2.unit_no, 'reservation_status', r.status,
        'submission_status', sub2.status, 'sale_id', sub2.created_sale_id,
        'sale_number', sl.sale_number, 'sale_status', sl.status)
      FROM public.reservations r
      LEFT JOIN public.units u2 ON u2.id=r.unit_id
      LEFT JOIN LATERAL (SELECT ss.* FROM public.sale_submissions ss WHERE ss.reservation_id=r.id ORDER BY ss.created_at DESC LIMIT 1) sub2 ON true
      LEFT JOIN public.sales sl ON sl.id=sub2.created_sale_id
      WHERE r.id=l.converted_reservation_id
    ),
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) INTO v_lead
  FROM public.leads l
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  LEFT JOIN public.sales_users ab ON ab.id=l.assigned_by_sales_user_id
  LEFT JOIN public.sales_users cb ON cb.id=l.created_by_sales_user_id
  WHERE l.id=p_id
    AND ( (v_companywide AND l.company_id=v_ses.company_id)
          OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) );

  IF v_lead IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'body', a.body, 'created_at', a.created_at
  ) ORDER BY a.created_at ASC), '[]'::jsonb) INTO v_acts
  FROM public.lead_activities a WHERE a.lead_id=p_id;

  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_lead_interactions(p_session_token text, p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_ok boolean; v_rows jsonb;
        v_role text; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
  )
  SELECT EXISTS(SELECT 1 FROM public.leads l WHERE l.id=p_lead_id
    AND ( (v_companywide AND l.company_id=v_ses.company_id)
          OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'kind',a.kind,'body',a.body,'outcome',a.outcome,'next_step',a.next_step,
    'actor',su.full_name,'created_at',a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.lead_activities a LEFT JOIN public.sales_users su ON su.id=a.sales_user_id
  WHERE a.lead_id=p_lead_id;
  RETURN jsonb_build_object('success',true,'rows',v_rows);
END
$function$;
