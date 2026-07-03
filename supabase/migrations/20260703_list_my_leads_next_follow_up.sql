-- list_my_leads: also return next_follow_up_at per lead so the portal can offer a
-- "Follow-up due" sort (soonest first, overdue highlighted). NO other change:
-- session-token gate, lead_entry forbid, company-wide (director/admin/cfo) vs
-- subtree scoping, counts and unchecked tally are all identical to the previous body.
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int;
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
  ),
  myleads AS (
    SELECT l.*, (lv.lead_id IS NOT NULL) AS checked, ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name
    FROM public.leads l
    LEFT JOIN public.units u ON u.id=l.unit_id
    LEFT JOIN public.projects p ON p.id=l.project_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.budget,
      'status', m.status, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_sales_user_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_sales_user_id=v_uid), 'created_by_me', (m.created_by_sales_user_id = v_uid),
      'checked', m.checked,
      'next_follow_up_at', m.next_follow_up_at,
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_status IS NULL OR m.status=p_status)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost'))
    INTO v_rows, v_unchecked
  FROM myleads m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM public.leads l
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),'unchecked',COALESCE(v_unchecked,0));
END
$function$;
