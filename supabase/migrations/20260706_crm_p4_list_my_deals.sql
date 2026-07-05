-- CRM overhaul P4: Deal read path. list_my_deals mirrors list_my_leads's shape EXACTLY
-- (so the portal pipeline renders unchanged) but is DEAL-SOURCED: spine = public.deals,
-- joined to leads for the contact fields not on a deal. Read-only, additive, session-gated.
-- Each item keeps id=lead_id (so openLead / update_lead_stage still work via the mirror) and
-- adds deal_id + stage/value. lead.status stays mirrored (P3 triggers). No schema change.
-- Applied via MCP 2026-07-06; verified on real Awami data (23 deals, id=lead_id, deal_id present).
CREATE OR REPLACE FUNCTION public.list_my_deals(p_session_token text, p_stage text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
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
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  mydeals AS (
    SELECT d.id AS deal_id, d.stage AS stage, d.value AS deal_value,
           l.id AS lead_id, l.name, l.phone, l.email, l.source, l.interest, l.notes,
           l.created_by_sales_user_id, l.next_follow_up_at, l.last_activity_at, l.created_at,
           d.owner_sales_user_id AS owner_id,
           (lv.lead_id IS NOT NULL) AS checked, ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name
    FROM public.deals d
    JOIN public.leads l ON l.id=d.lead_id
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
      'unit_no', m.unit_no, 'project_name', m.project_name,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_id=v_uid), 'created_by_me', (m.created_by_sales_user_id=v_uid),
      'checked', m.checked, 'next_follow_up_at', m.next_follow_up_at,
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_stage IS NULL OR m.stage=p_stage)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost'))
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

  RETURN jsonb_build_object('success',true,'deals',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),'unchecked',COALESCE(v_unchecked,0));
END $fn$;
REVOKE ALL ON FUNCTION public.list_my_deals(text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.list_my_deals(text,text) TO anon, authenticated;
