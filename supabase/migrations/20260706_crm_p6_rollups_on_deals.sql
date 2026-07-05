-- CRM overhaul P6 (part 1): rollups recompute over deals.stage (pipeline/won/conversion/funnel).
-- 1:1 mirror -> numbers identical to the lead-based versions (verified: Awami pipeline 23=23,
-- won 0, conversion 0.0, command-center pipeline {new:23}). sales/recovery/targets and
-- lead-operational metrics (source, follow-ups, unassigned, response) stay as-is.
-- crm_brief_gather DEFERRED to P7 (mostly lead-operational; migrate with the lead.status retire).
-- Applied via MCP 2026-07-06. Functions: get_my_team, get_org_overview, get_team_performance(text),
-- get_member_performance. (get_sales_performance + get_command_center are in _pt2.)

-- get_my_team: pipeline / won / conversion from deals.stage
CREATE OR REPLACE FUNCTION public.get_my_team(p_session_token text, p_head uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_root uuid; v_rows jsonb; v_n int;
        v_sales_val numeric; v_outstanding numeric; v_pipeline int; v_ok boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  IF p_head IS NOT NULL THEN
    WITH RECURSIVE sub AS (
      SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid
      UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
    ) SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_head) INTO v_ok;
    IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  END IF;
  v_root := COALESCE(p_head, v_uid);
  WITH RECURSIVE tree AS (
    SELECT su.id, su.id AS head, su.agent_id FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_root AND su.company_id=v_co AND su.status='active'
    UNION ALL
    SELECT su.id, t.head, su.agent_id FROM public.sales_users su JOIN tree t ON su.parent_sales_user_id=t.id
    WHERE su.company_id=v_co AND su.status='active'
  ),
  heads AS (
    SELECT su.id, su.full_name, su.role, su.phone FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_root AND su.company_id=v_co AND su.status='active'
  ),
  agg AS (
    SELECT h.id, h.full_name, h.role, h.phone,
      (SELECT count(*) FROM public.sales_users c WHERE c.parent_sales_user_id=h.id AND c.status='active') AS reports,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id)) AS leads_total,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id) AND d.stage NOT IN ('won','lost')) AS pipeline,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id) AND d.stage='won') AS won,
      (SELECT count(*) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)) AS sales_count,
      (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)) AS sales_value,
      (SELECT COALESCE(sum(s.remaining_amount),0) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)) AS outstanding
    FROM heads h
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.full_name, 'role', a.role, 'phone', a.phone, 'reports', a.reports,
           'leads_total', a.leads_total, 'pipeline', a.pipeline, 'won', a.won,
           'sales_count', a.sales_count, 'sales_value', a.sales_value, 'outstanding', a.outstanding,
           'conversion', CASE WHEN a.leads_total>0 THEN round(a.won::numeric*100/a.leads_total,1) ELSE 0 END
         ) ORDER BY a.sales_value DESC, a.full_name), '[]'::jsonb),
         count(*), COALESCE(sum(a.sales_value),0), COALESCE(sum(a.outstanding),0), COALESCE(sum(a.pipeline),0)
    INTO v_rows, v_n, v_sales_val, v_outstanding, v_pipeline
  FROM agg a;
  RETURN jsonb_build_object('success',true,'team',v_rows,'count',COALESCE(v_n,0),
    'totals', jsonb_build_object('sales_value',v_sales_val,'outstanding',v_outstanding,'pipeline',v_pipeline,'agents',COALESCE(v_n,0)));
END; $function$;

-- get_org_overview: pipeline / won from deals.stage
CREATE OR REPLACE FUNCTION public.get_org_overview(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_top jsonb;
        v_sales numeric; v_collect numeric; v_pipeline int; v_members int; v_won int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('admin','cfo','director') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  SELECT COALESCE(sum(net_amount),0), COALESCE(sum(remaining_amount),0)
    INTO v_sales, v_collect FROM public.sales WHERE company_id=v_co AND COALESCE(is_active,true);
  SELECT count(*) INTO v_pipeline FROM public.deals WHERE company_id=v_co AND stage IN ('new','contacted','visit','negotiation');
  SELECT count(*) INTO v_won FROM public.deals WHERE company_id=v_co AND stage='won';
  SELECT count(*) INTO v_members FROM public.sales_users WHERE company_id=v_co AND status='active';
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'value')::numeric DESC), '[]'::jsonb) INTO v_top FROM (
    SELECT jsonb_build_object('name', su.full_name, 'role', su.role,
             'value', COALESCE(s.val,0), 'count', COALESCE(s.cnt,0)) AS t
    FROM public.sales_users su
    LEFT JOIN LATERAL (SELECT sum(net_amount) val, count(*) cnt FROM public.sales x
                       WHERE x.company_id=v_co AND x.agent_id=su.agent_id AND COALESCE(x.is_active,true)) s ON true
    WHERE su.company_id=v_co AND su.status='active' AND su.agent_id IS NOT NULL AND COALESCE(s.val,0)>0
    ORDER BY COALESCE(s.val,0) DESC LIMIT 5
  ) q;
  RETURN jsonb_build_object('success',true,
    'sales_value',v_sales,'to_collect',v_collect,'pipeline',v_pipeline,'won',v_won,'members',v_members,'top',v_top);
END; $function$;

-- get_team_performance(text): new_leads from deals (created_at mirrors)
CREATE OR REPLACE FUNCTION public.get_team_performance(p_session_token text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_from date; v_to date; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid:=v_ses.sales_user_id; v_co:=v_ses.company_id;
  v_from := COALESCE(NULLIF(p_from,'')::date, '-infinity'::date);
  v_to   := COALESCE(NULLIF(p_to,'')::date, 'infinity'::date);
  WITH RECURSIVE tree AS (
    SELECT su.id, su.id AS head, su.agent_id FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_uid AND su.company_id=v_co AND su.status='active'
    UNION ALL
    SELECT su.id, t.head, su.agent_id FROM public.sales_users su JOIN tree t ON su.parent_sales_user_id=t.id
    WHERE su.company_id=v_co AND su.status='active'
  ),
  heads AS (
    SELECT su.id, su.full_name FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_uid AND su.company_id=v_co AND su.status='active'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.full_name,
    'sales_count', (SELECT count(*) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.sale_date>=v_from AND s.sale_date<=v_to AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)),
    'sales_value', (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.sale_date>=v_from AND s.sale_date<=v_to AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)),
    'new_leads', (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id) AND d.created_at>=v_from AND d.created_at<(v_to+1)),
    'calls',    (SELECT count(*) FROM public.lead_activities a WHERE a.kind='call'     AND a.created_at>=v_from AND a.created_at<(v_to+1) AND a.sales_user_id IN (SELECT id FROM tree WHERE head=h.id)),
    'whatsapp', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='whatsapp' AND a.created_at>=v_from AND a.created_at<(v_to+1) AND a.sales_user_id IN (SELECT id FROM tree WHERE head=h.id)),
    'visits',   (SELECT count(*) FROM public.lead_activities a WHERE a.kind='visit'    AND a.created_at>=v_from AND a.created_at<(v_to+1) AND a.sales_user_id IN (SELECT id FROM tree WHERE head=h.id))
  ) ORDER BY (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.sale_date>=v_from AND s.sale_date<=v_to AND s.agent_id IN (SELECT agent_id FROM tree WHERE head=h.id AND agent_id IS NOT NULL)) DESC, h.full_name), '[]'::jsonb) INTO v_rows
  FROM heads h;
  RETURN jsonb_build_object('success',true,'agents',v_rows);
END; $function$;

-- get_member_performance: funnel / conversion from deals.stage
CREATE OR REPLACE FUNCTION public.get_member_performance(p_session_token text, p_member uuid, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_scope text DEFAULT 'self'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text; v_co uuid; v_ok boolean;
        v_from date; v_to date; su public.sales_users; v_ids uuid[]; v_agents uuid[];
        v_total int; v_won int; v_lost int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  WITH RECURSIVE sub AS (SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id)
  SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_member) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  v_from := COALESCE(NULLIF(p_from,'')::date,'-infinity'::date);
  v_to   := COALESCE(NULLIF(p_to,'')::date,'infinity'::date);
  SELECT * INTO su FROM public.sales_users WHERE id=p_member;
  WITH RECURSIVE inset AS (
    SELECT p_member AS id
    UNION ALL SELECT s.id FROM public.sales_users s JOIN inset ON s.parent_sales_user_id=inset.id WHERE p_scope='team' AND s.status='active'
  )
  SELECT array_agg(id) INTO v_ids FROM inset;
  SELECT array_agg(agent_id) INTO v_agents FROM public.sales_users WHERE id=ANY(v_ids) AND agent_id IS NOT NULL;
  SELECT count(*), count(*) FILTER (WHERE stage='won'), count(*) FILTER (WHERE stage='lost')
    INTO v_total, v_won, v_lost FROM public.deals WHERE owner_sales_user_id=ANY(v_ids);
  RETURN jsonb_build_object('success',true,'name',su.full_name,'role',su.role,'scope',p_scope,
    'leads', jsonb_build_object(
      'total', v_total,
      'new', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='new'),
      'contacted', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='contacted'),
      'visit', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='visit'),
      'negotiation', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='negotiation'),
      'won', v_won, 'lost', v_lost),
    'conversion', CASE WHEN v_total>0 THEN round(v_won::numeric*100/v_total,1) ELSE 0 END,
    'sales', jsonb_build_object(
      'count', COALESCE((SELECT count(*) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.sale_date BETWEEN v_from AND v_to AND s.agent_id=ANY(v_agents)),0),
      'value', COALESCE((SELECT sum(net_amount) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.sale_date BETWEEN v_from AND v_to AND s.agent_id=ANY(v_agents)),0)),
    'outstanding', COALESCE((SELECT sum(remaining_amount) FROM public.sales s WHERE s.company_id=v_co AND COALESCE(s.is_active,true) AND s.agent_id=ANY(v_agents)),0),
    'activity', jsonb_build_object(
      'call', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='call' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'whatsapp', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='whatsapp' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'visit', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='visit' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'meeting', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='meeting' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1))));
END; $function$;
