-- CRM overhaul P6 (part 2): get_sales_performance (funnel/conversion/lost_reasons -> deals.stage)
-- and get_command_center (pipeline stage-distribution + leaderboard conversions + company won
-- -> deals; source/spark/followups/unassigned/response/worst stay lead-operational).
-- Applied via MCP 2026-07-06; reconciled exact vs lead-based (23=23, conversion 0.0, {new:23}).

CREATE OR REPLACE FUNCTION public.get_sales_performance(p_session_token text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid;
        v_total int; v_new int; v_cont int; v_visit int; v_neg int; v_won int; v_lost int;
        v_acts jsonb; v_lost_reasons jsonb; v_sales_n int; v_sales_val numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  ls AS (
    SELECT d.* FROM public.deals d
    WHERE d.owner_sales_user_id IN (SELECT id FROM sub)
      AND (p_from IS NULL OR d.created_at::date >= p_from)
      AND (p_to   IS NULL OR d.created_at::date <= p_to)
  )
  SELECT count(*),
         count(*) FILTER (WHERE stage='new'), count(*) FILTER (WHERE stage='contacted'),
         count(*) FILTER (WHERE stage='visit'), count(*) FILTER (WHERE stage='negotiation'),
         count(*) FILTER (WHERE stage='won'), count(*) FILTER (WHERE stage='lost')
    INTO v_total, v_new, v_cont, v_visit, v_neg, v_won, v_lost FROM ls;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_build_object(
    'call',     count(*) FILTER (WHERE kind='call'),
    'whatsapp', count(*) FILTER (WHERE kind='whatsapp'),
    'visit',    count(*) FILTER (WHERE kind='visit'),
    'meeting',  count(*) FILTER (WHERE kind='meeting'),
    'total',    count(*) FILTER (WHERE kind IN ('call','whatsapp','visit','meeting')))
    INTO v_acts
  FROM public.lead_activities a
  WHERE a.sales_user_id IN (SELECT id FROM sub)
    AND (p_from IS NULL OR a.created_at::date >= p_from)
    AND (p_to   IS NULL OR a.created_at::date <= p_to);
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', COALESCE(lost_reason,'Unspecified'), 'n', n) ORDER BY n DESC), '[]'::jsonb)
    INTO v_lost_reasons
  FROM (
    SELECT COALESCE(NULLIF(TRIM(lost_reason),''),'Unspecified') AS lost_reason, count(*) n
    FROM public.deals
    WHERE owner_sales_user_id IN (SELECT id FROM sub) AND stage='lost'
      AND (p_from IS NULL OR created_at::date >= p_from) AND (p_to IS NULL OR created_at::date <= p_to)
    GROUP BY 1
  ) t;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ), agents AS (SELECT DISTINCT agent_id FROM public.sales_users WHERE id IN (SELECT id FROM sub) AND agent_id IS NOT NULL)
  SELECT count(*), COALESCE(sum(s.net_amount),0) INTO v_sales_n, v_sales_val
  FROM public.sales s
  WHERE s.agent_id IN (SELECT agent_id FROM agents) AND s.company_id=v_ses.company_id AND COALESCE(s.is_active,true)=true
    AND (p_from IS NULL OR s.sale_date >= p_from) AND (p_to IS NULL OR s.sale_date <= p_to);
  RETURN jsonb_build_object('success',true,
    'leads', jsonb_build_object('total',COALESCE(v_total,0),'new',COALESCE(v_new,0),'contacted',COALESCE(v_cont,0),
       'visit',COALESCE(v_visit,0),'negotiation',COALESCE(v_neg,0),'won',COALESCE(v_won,0),'lost',COALESCE(v_lost,0)),
    'conversion', CASE WHEN COALESCE(v_total,0)>0 THEN round(v_won::numeric*100/v_total,1) ELSE 0 END,
    'activities', COALESCE(v_acts,'{}'::jsonb),
    'lost_reasons', v_lost_reasons,
    'sales', jsonb_build_object('count',COALESCE(v_sales_n,0),'value',COALESCE(v_sales_val,0)));
END; $function$;

CREATE OR REPLACE FUNCTION public.get_command_center(p_session_token text, p_period text DEFAULT 'week'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ses public.sales_sessions; v_role text; v_co uuid; v_tz text := 'Asia/Karachi';
  v_today date; v_start timestamptz;
  v_new_src jsonb; v_spark jsonb; v_fu jsonb; v_unassigned int;
  v_pipeline jsonb; v_avg numeric; v_worst jsonb; v_board jsonb; v_unlist jsonb;
  v_co_recv int; v_co_won int; v_co_rate numeric; v_board_avg jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  IF p_period NOT IN ('week','month') THEN p_period := 'week'; END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_start := (CASE p_period WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE v_tz)
                            ELSE date_trunc('week',  now() AT TIME ZONE v_tz) END) AT TIME ZONE v_tz;
  SELECT COALESCE(jsonb_object_agg(source, n),'{}'::jsonb) INTO v_new_src FROM (
    SELECT source, count(*) n FROM public.leads
    WHERE company_id=v_co AND NOT COALESCE(is_test,false)
      AND (created_at AT TIME ZONE v_tz)::date = v_today GROUP BY source) t;
  SELECT jsonb_agg(jsonb_build_object('d', g::date, 'n', COALESCE(c.n,0)) ORDER BY g) INTO v_spark
  FROM generate_series((v_today-6)::timestamp, v_today::timestamp, interval '1 day') g
  LEFT JOIN (
    SELECT (created_at AT TIME ZONE v_tz)::date dd, count(*) n FROM public.leads
    WHERE company_id=v_co AND NOT COALESCE(is_test,false)
      AND (created_at AT TIME ZONE v_tz)::date >= v_today-6 GROUP BY 1) c ON c.dd = g::date;
  SELECT jsonb_build_object(
      'done',    count(*) FILTER (WHERE act_today),
      'pending', count(*) FILTER (WHERE NOT act_today AND due = v_today),
      'overdue', count(*) FILTER (WHERE NOT act_today AND due < v_today)
    ) INTO v_fu
  FROM (
    SELECT (l.next_follow_up_at AT TIME ZONE v_tz)::date AS due,
           EXISTS (SELECT 1 FROM public.lead_activities a
                   WHERE a.lead_id=l.id AND (a.created_at AT TIME ZONE v_tz)::date = v_today
                     AND a.kind IN ('call','whatsapp','visit','meeting','note','stage')) AS act_today
    FROM public.leads l
    WHERE l.company_id=v_co AND NOT COALESCE(l.is_test,false)
      AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
      AND l.next_follow_up_at IS NOT NULL
      AND (l.next_follow_up_at AT TIME ZONE v_tz)::date <= v_today
  ) f;
  SELECT count(*) INTO v_unassigned FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false)
     AND owner_sales_user_id IS NULL AND status NOT IN ('won','lost');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'source',source,
           'hours', round(extract(epoch from (now()-created_at))/3600)) ORDER BY created_at),'[]'::jsonb)
    INTO v_unlist FROM (
    SELECT id,name,source,created_at FROM public.leads
    WHERE company_id=v_co AND NOT COALESCE(is_test,false)
      AND owner_sales_user_id IS NULL AND status NOT IN ('won','lost')
    ORDER BY created_at LIMIT 10) u;
  -- PIPELINE stage distribution -> deals.stage
  SELECT COALESCE(jsonb_object_agg(stage, n),'{}'::jsonb) INTO v_pipeline FROM (
    SELECT stage, count(*) n FROM public.deals
    WHERE company_id=v_co AND NOT COALESCE(is_test,false) GROUP BY stage) p;
  SELECT round(avg(extract(epoch FROM (fa.first_at - l.created_at))/60)) INTO v_avg
  FROM public.leads l
  JOIN (SELECT lead_id, min(created_at) first_at FROM public.lead_activities
        WHERE kind IN ('call','whatsapp','visit','meeting','note','stage') GROUP BY lead_id) fa
    ON fa.lead_id=l.id
  WHERE l.company_id=v_co AND NOT COALESCE(l.is_test,false)
    AND l.created_at >= now()-interval '30 days';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', w.id, 'name', w.name, 'source', w.source, 'owner_name', w.owner_name,
      'hours', round(extract(epoch FROM (now()-w.created_at))/3600)) ORDER BY w.created_at),'[]'::jsonb)
    INTO v_worst
  FROM (
    SELECT l.id, l.name, l.source, l.created_at, ow.full_name AS owner_name
    FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    WHERE l.company_id=v_co AND NOT COALESCE(l.is_test,false)
      AND l.status NOT IN ('won','lost')
      AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id=l.id
                      AND a.kind IN ('call','whatsapp','visit','meeting','note','stage'))
    ORDER BY l.created_at LIMIT 5) w;
  -- leaderboard: conversions (won) -> deals.stage; leads_received uses assigned_at (lead-only) unchanged
  WITH fa AS (SELECT lead_id, min(created_at) first_at FROM public.lead_activities
              WHERE kind IN ('call','whatsapp','visit','meeting','note','stage') GROUP BY lead_id)
  SELECT COALESCE(jsonb_agg(row_to_json(y)::jsonb ORDER BY y.conversions DESC, y.followups DESC, y.leads_received DESC),'[]'::jsonb)
    INTO v_board FROM (
    SELECT x.*, CASE WHEN x.leads_received>0 THEN round(x.conversions*100.0/x.leads_received) ELSE NULL END AS conv_rate
    FROM (
      SELECT m.id, m.full_name AS name, m.role,
        (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=m.id AND NOT COALESCE(l.is_test,false)
           AND COALESCE(l.assigned_at,l.created_at) >= v_start) AS leads_received,
        (SELECT count(*) FROM public.lead_activities a WHERE a.sales_user_id=m.id
           AND a.kind IN ('call','whatsapp','visit','meeting','note') AND a.created_at >= v_start) AS followups,
        (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id=m.id AND d.stage='won'
           AND d.updated_at >= v_start AND NOT COALESCE(d.is_test,false)) AS conversions,
        (SELECT round(avg(extract(epoch FROM (fa.first_at - l.created_at))/60))
           FROM public.leads l JOIN fa ON fa.lead_id=l.id
           WHERE l.owner_sales_user_id=m.id AND NOT COALESCE(l.is_test,false)
             AND COALESCE(l.assigned_at,l.created_at) >= v_start) AS avg_response_min
      FROM public.sales_users m
      WHERE m.company_id=v_co AND m.status='active' AND m.role IN ('sale_rep','marketing_manager')
    ) x
  ) y;
  SELECT count(*) INTO v_co_recv FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND COALESCE(assigned_at,created_at) >= v_start;
  SELECT count(*) INTO v_co_won FROM public.deals
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND stage='won' AND updated_at >= v_start;
  v_co_rate := CASE WHEN v_co_recv>0 THEN round(v_co_won*100.0/v_co_recv) ELSE NULL END;
  v_board_avg := jsonb_build_object('leads_received',v_co_recv,'conversions',v_co_won,'conv_rate',v_co_rate);
  RETURN jsonb_build_object('success',true,'period',p_period,'today',v_today,
    'snapshot', jsonb_build_object('new_by_source',v_new_src,'spark',COALESCE(v_spark,'[]'::jsonb),
                                   'followups',v_fu,'unassigned',v_unassigned,'unassigned_list',v_unlist),
    'pipeline', v_pipeline,
    'response', jsonb_build_object('company_avg_min', v_avg, 'worst', v_worst),
    'leaderboard', v_board, 'board_avg', v_board_avg);
END; $function$;
