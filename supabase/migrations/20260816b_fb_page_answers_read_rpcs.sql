-- ════════════════════════════════════════════════════════════════════════════
-- FB LEADS — surface the new provenance columns through the two read RPCs.
-- ADDITIVE ONLY: same signatures, same scoping, same ordering; only new keys.
--   list_my_deals → + fb_page_name, fb_page_id   (list chip + page filter)
--   get_lead      → + fb_page_name, fb_page_id, fb_form_id, fb_answers (detail Q/A)
-- Both bodies are the live definitions verbatim; nothing else changed.
-- CREATE OR REPLACE preserves existing EXECUTE grants, so none are re-issued.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_my_deals(p_session_token text, p_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int; v_today date := public._fu_today();  -- PHASE2
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  mydeals AS (
    SELECT d.id AS deal_id, d.stage AS stage, d.value AS deal_value,
           l.id AS lead_id, l.name, l.phone, l.email, l.source, l.interest, l.notes,
           l.created_by_sales_user_id, l.next_follow_up_at, l.last_activity_at, l.created_at,
           d.owner_sales_user_id AS owner_id,
           (lv.lead_id IS NOT NULL) AS checked, ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name, l.project_id,
           l.fb_page_name, l.fb_page_id,                                          -- NEW
           l.followup_locked_at                                                    -- PHASE2
    FROM public.deals d
    JOIN (SELECT * FROM public.leads WHERE deleted_at IS NULL) l ON l.id=d.lead_id
    LEFT JOIN public.units u ON u.id=d.unit_id
    LEFT JOIN public.projects p ON p.id=d.project_id
    LEFT JOIN public.sales_users ow ON ow.id=d.owner_sales_user_id
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    WHERE ( (v_companywide AND d.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND d.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.lead_id, 'deal_id', m.deal_id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.deal_value, 'value', m.deal_value,
      'status', m.stage, 'stage', m.stage, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,
      'fb_page_name', m.fb_page_name, 'fb_page_id', m.fb_page_id,                 -- NEW
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_id=v_uid), 'created_by_me', (m.created_by_sales_user_id=v_uid),
      'checked', m.checked, 'next_follow_up_at', m.next_follow_up_at,
      'is_locked', (m.followup_locked_at IS NOT NULL),                              -- PHASE2
      'is_overdue', (m.next_follow_up_at IS NOT NULL                                -- PHASE2
                     AND (m.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
                     AND m.stage NOT IN ('won','lost')),
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_stage IS NULL OR m.stage=p_stage)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost') AND m.owner_id = v_uid)
    INTO v_rows, v_unchecked FROM mydeals m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(stage, n) INTO v_counts FROM (
    SELECT d.stage, count(*) n FROM public.deals d
    WHERE ( (v_companywide AND d.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND d.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY d.stage
  ) t;

  RETURN jsonb_build_object('success',true,'deals',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),
    'unchecked',COALESCE(v_unchecked,0),
    'block', public._fu_block_state(v_uid));                                        -- PHASE2
END $function$;


CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'fb_page_name', l.fb_page_name, 'fb_page_id', l.fb_page_id,                   -- NEW
    'fb_form_id', l.fb_form_id, 'fb_answers', l.fb_answers,                       -- NEW
    'status', COALESCE(dl.stage, l.status), 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'next_follow_up_at', l.next_follow_up_at,
    'owner_name', ow.full_name, 'is_mine', (l.owner_sales_user_id=v_uid),
    'assigned_from', ab.full_name,
    'created_by_name', cb.full_name,
    'first_contact_at', (SELECT min(a2.created_at) FROM public.lead_activities a2 WHERE a2.lead_id=l.id AND a2.kind IN ('call','whatsapp','visit','meeting')),
    'contact_count', (SELECT count(*) FROM public.lead_activities a3 WHERE a3.lead_id=l.id AND a3.kind IN ('call','whatsapp','visit','meeting')),
    'is_locked', (l.followup_locked_at IS NOT NULL),
    'locked_at', l.followup_locked_at,
    'is_overdue', (l.next_follow_up_at IS NOT NULL
                   AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < public._fu_today()
                   AND COALESCE(dl.stage, l.status) NOT IN ('won','lost')),
    'missed_count', l.missed_followup_count,
    'last_disposition_at', l.last_disposition_at,
    'disposition_required', public._fu_owes_disposition(l.id, v_uid),          -- PHASE2 (once per day)
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
  FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
  LEFT JOIN public.deals dl ON dl.lead_id=l.id
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
  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts,
    'block', public._fu_block_state(v_uid));
END $function$;
