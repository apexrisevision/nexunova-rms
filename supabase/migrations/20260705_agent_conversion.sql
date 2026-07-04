-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — P1-T3: PER-AGENT CONVERSION-RATE METRIC  |  2026-07-05
-- ------------------------------------------------------------------------
-- Completes the Command Center leaderboard with a conversion-rate % per agent
-- (converted = closed-won; conversion goes to the member who currently owns the
-- won lead — i.e. the one who closed it). Two surfaces:
--   • get_command_center leaderboard: adds conv_rate per member + board_avg
--     (company-wide conversion rate for the same period) — director/admin.
--   • get_agent_conversion(token, days): role-aware reporting RPC (director/admin
--     → all reps; team head → own team subtree; member → self) with 7/30/90-day
--     presets, server-testable.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Command Center leaderboard: conv_rate per member + company board_avg -----
CREATE OR REPLACE FUNCTION public.get_command_center(p_session_token text, p_period text DEFAULT 'week'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  SELECT COALESCE(jsonb_object_agg(status, n),'{}'::jsonb) INTO v_pipeline FROM (
    SELECT status, count(*) n FROM public.leads
    WHERE company_id=v_co AND NOT COALESCE(is_test,false) GROUP BY status) p;

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

  -- ── leaderboard (period) — now with conv_rate per member ──
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
        (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=m.id AND l.status='won'
           AND l.updated_at >= v_start AND NOT COALESCE(l.is_test,false)) AS conversions,
        (SELECT round(avg(extract(epoch FROM (fa.first_at - l.created_at))/60))
           FROM public.leads l JOIN fa ON fa.lead_id=l.id
           WHERE l.owner_sales_user_id=m.id AND NOT COALESCE(l.is_test,false)
             AND COALESCE(l.assigned_at,l.created_at) >= v_start) AS avg_response_min
      FROM public.sales_users m
      WHERE m.company_id=v_co AND m.status='active' AND m.role IN ('sale_rep','marketing_manager')
    ) x
  ) y;

  -- company average conversion for the same period (reference row)
  SELECT count(*) INTO v_co_recv FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND COALESCE(assigned_at,created_at) >= v_start;
  SELECT count(*) INTO v_co_won FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND status='won' AND updated_at >= v_start;
  v_co_rate := CASE WHEN v_co_recv>0 THEN round(v_co_won*100.0/v_co_recv) ELSE NULL END;
  v_board_avg := jsonb_build_object('leads_received',v_co_recv,'conversions',v_co_won,'conv_rate',v_co_rate);

  RETURN jsonb_build_object('success',true,'period',p_period,'today',v_today,
    'snapshot', jsonb_build_object('new_by_source',v_new_src,'spark',COALESCE(v_spark,'[]'::jsonb),
                                   'followups',v_fu,'unassigned',v_unassigned,'unassigned_list',v_unlist),
    'pipeline', v_pipeline,
    'response', jsonb_build_object('company_avg_min', v_avg, 'worst', v_worst),
    'leaderboard', v_board, 'board_avg', v_board_avg);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_command_center(text, text) TO anon, authenticated;

-- 2) Role-aware conversion report (director all / team head team / member self) --
CREATE OR REPLACE FUNCTION public.get_agent_conversion(p_session_token text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_uid uuid;
        v_days int; v_start timestamptz; v_agents jsonb;
        v_co_recv int; v_co_won int; v_co_rate numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_days  := CASE WHEN p_days IN (7,30,90) THEN p_days ELSE 30 END;
  v_start := now() - make_interval(days => v_days);

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
  ),
  visible AS (
    SELECT m.id, m.full_name AS name, m.role FROM public.sales_users m
    WHERE m.company_id=v_co AND m.status='active'
      AND (
        (v_role IN ('director','admin') AND m.role IN ('sale_rep','marketing_manager'))
        OR (v_role='marketing_manager' AND m.role IN ('sale_rep','marketing_manager') AND m.id IN (SELECT id FROM sub))
        OR (v_role NOT IN ('director','admin','marketing_manager') AND m.id=v_uid)
      )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(w)::jsonb ORDER BY w.conv_rate DESC NULLS LAST, w.conversions DESC, w.leads_received DESC),'[]'::jsonb)
    INTO v_agents FROM (
    SELECT z.*, CASE WHEN z.leads_received>0 THEN round(z.conversions*100.0/z.leads_received) ELSE NULL END AS conv_rate
    FROM (
      SELECT vv.id, vv.name, vv.role,
        (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=vv.id AND NOT COALESCE(l.is_test,false)
           AND COALESCE(l.assigned_at,l.created_at) >= v_start) AS leads_received,
        (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=vv.id AND l.status='won'
           AND l.updated_at >= v_start AND NOT COALESCE(l.is_test,false)) AS conversions
      FROM visible vv
    ) z
  ) w;

  SELECT count(*) INTO v_co_recv FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND COALESCE(assigned_at,created_at) >= v_start;
  SELECT count(*) INTO v_co_won FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND status='won' AND updated_at >= v_start;
  v_co_rate := CASE WHEN v_co_recv>0 THEN round(v_co_won*100.0/v_co_recv) ELSE NULL END;

  RETURN jsonb_build_object('success',true,'days',v_days,'agents',v_agents,
    'company_avg', jsonb_build_object('leads_received',v_co_recv,'conversions',v_co_won,'conv_rate',v_co_rate));
END $function$;
GRANT EXECUTE ON FUNCTION public.get_agent_conversion(text, integer) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPS: git push (frontend on Vercel) for the Conversion % column.
-- DB migration applied = RPCs live. No edge fn change.
-- ════════════════════════════════════════════════════════════════════════
