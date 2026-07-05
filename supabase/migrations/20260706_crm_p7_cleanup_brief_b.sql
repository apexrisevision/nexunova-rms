-- CRM overhaul P7 (part B): crm_brief_gather's 3 stage metrics -> deals.stage
-- (pipeline_open, won_yesterday, hot_leads). All lead-operational metrics unchanged.
-- Applied via MCP 2026-07-06; reconciled BYTE-IDENTICAL before/after (pipeline_open {new:23},
-- won_yesterday 0, hot_leads []).
CREATE OR REPLACE FUNCTION public.crm_brief_gather(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := 'Asia/Karachi'; v_today date; v_yest date;
  v_kinds text[] := ARRAY['call','whatsapp','visit','meeting','note','stage'];
  v_fu    text[] := ARRAY['call','whatsapp','visit','meeting','note'];
  v_chan  text[] := ARRAY['facebook','instagram','whatsapp','website'];
  v_coname text;
  v_yest_src jsonb; v_today_src jsonb; v_pipeline jsonb;
  v_hot jsonb; v_overdue jsonb; v_overdue_n int; v_unassigned int;
  v_new_yest int; v_new_today int; v_won_yest int;
  v_worst jsonb; v_inactive jsonb; v_drought jsonb;
  v_parked_by jsonb; v_parked_total int; v_untop jsonb; v_untot int;
  v_streak int; v_i int;
BEGIN
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_yest  := v_today - 1;
  SELECT company_name INTO v_coname FROM public.companies WHERE id=p_company_id;

  SELECT COALESCE(jsonb_object_agg(source, n),'{}'::jsonb) INTO v_yest_src FROM (
    SELECT source, count(*) n FROM public.leads
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND (created_at AT TIME ZONE v_tz)::date = v_yest GROUP BY source) a;
  SELECT COALESCE(sum(v),0) INTO v_new_yest FROM (SELECT (value)::int v FROM jsonb_each_text(v_yest_src)) z;

  SELECT COALESCE(jsonb_object_agg(source, n),'{}'::jsonb) INTO v_today_src FROM (
    SELECT source, count(*) n FROM public.leads
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND (created_at AT TIME ZONE v_tz)::date = v_today GROUP BY source) b;
  SELECT COALESCE(sum(v),0) INTO v_new_today FROM (SELECT (value)::int v FROM jsonb_each_text(v_today_src)) z;

  -- won yesterday -> deals.stage
  SELECT count(*) INTO v_won_yest FROM public.deals
   WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
     AND stage='won' AND (updated_at AT TIME ZONE v_tz)::date = v_yest;

  -- open pipeline stage distribution -> deals.stage
  SELECT COALESCE(jsonb_object_agg(status, n),'{}'::jsonb) INTO v_pipeline FROM (
    SELECT stage AS status, count(*) n FROM public.deals
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND stage NOT IN ('won','lost') GROUP BY stage) c;

  -- hot leads (stage in negotiation/visit) -> deals.stage; lead attributes kept lead-level
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead', split_part(COALESCE(h.name,'Lead'),' ',1), 'stage', h.status,
           'owner', CASE WHEN h.owner_name IS NULL THEN NULL ELSE split_part(h.owner_name,' ',1) END,
           'source', h.source) ORDER BY h.last_activity_at DESC NULLS LAST),'[]'::jsonb)
    INTO v_hot FROM (
    SELECT l.name, d.stage AS status, l.source, l.last_activity_at, ow.full_name AS owner_name
      FROM public.leads l
      JOIN public.deals d ON d.lead_id=l.id
      LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND d.stage IN ('negotiation','visit')
     ORDER BY l.last_activity_at DESC NULLS LAST LIMIT 5) h;

  SELECT count(*) INTO v_overdue_n FROM public.leads l
   WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
     AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
     AND l.next_follow_up_at IS NOT NULL
     AND (l.next_follow_up_at AT TIME ZONE v_tz)::date < v_today;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead', split_part(COALESCE(o.name,'Lead'),' ',1),
           'owner', split_part(COALESCE(o.owner_name,'—'),' ',1),
           'days_overdue', o.dd) ORDER BY o.dd DESC),'[]'::jsonb)
    INTO v_overdue FROM (
    SELECT l.name, ow.full_name AS owner_name,
           (v_today - (l.next_follow_up_at AT TIME ZONE v_tz)::date) AS dd
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
       AND l.next_follow_up_at IS NOT NULL
       AND (l.next_follow_up_at AT TIME ZONE v_tz)::date < v_today
     ORDER BY (l.next_follow_up_at AT TIME ZONE v_tz)::date ASC LIMIT 8) o;

  SELECT count(*) INTO v_unassigned FROM public.leads
   WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
     AND owner_sales_user_id IS NULL AND status NOT IN ('won','lost');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('owner',owner,'count',c) ORDER BY c DESC),'[]'::jsonb),
         COALESCE(sum(c),0)
    INTO v_parked_by, v_parked_total FROM (
    SELECT split_part(ow.full_name,' ',1) AS owner, count(*) c
      FROM public.leads l JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status NOT IN ('won','lost') AND ow.role IN ('director','admin')
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id=l.id AND a.kind = ANY(v_kinds))
     GROUP BY split_part(ow.full_name,' ',1)) g;

  SELECT count(*) INTO v_untot FROM public.leads l
   WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
     AND l.status NOT IN ('won','lost')
     AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id=l.id AND a.kind = ANY(v_kinds));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('lead',lead,'hours',hours,'owner',owner) ORDER BY hours DESC),'[]'::jsonb)
    INTO v_untop FROM (
    SELECT split_part(COALESCE(l.name,'Lead'),' ',1) lead,
           round(extract(epoch FROM (now()-l.created_at))/3600) hours,
           CASE WHEN ow.full_name IS NULL THEN NULL ELSE split_part(ow.full_name,' ',1) END owner
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status NOT IN ('won','lost')
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id=l.id AND a.kind = ANY(v_kinds))
     ORDER BY l.created_at ASC LIMIT 3) u;
  v_worst := COALESCE(v_untop->0, 'null'::jsonb);

  SELECT COALESCE(jsonb_agg(split_part(full_name,' ',1) ORDER BY full_name),'[]'::jsonb) INTO v_inactive FROM (
    SELECT m.full_name FROM public.sales_users m
     WHERE m.company_id=p_company_id AND m.status='active' AND m.role IN ('sale_rep','marketing_manager')
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.owner_sales_user_id=m.id
                    AND l.status NOT IN ('won','lost') AND NOT COALESCE(l.is_test,false))
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.sales_user_id=m.id
                    AND a.kind = ANY(v_fu) AND a.created_at >= now()-interval '7 days')
     LIMIT 5) q;

  SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) INTO v_drought FROM unnest(v_chan) s
   WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
                  AND l.source=s AND l.created_at >= now()-interval '30 days')
     AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
                  AND l.source=s AND (l.created_at AT TIME ZONE v_tz)::date > v_today-3);

  v_streak := 0;
  FOR v_i IN 0..29 LOOP
    IF EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
                AND (l.created_at AT TIME ZONE v_tz)::date = v_yest - v_i) THEN EXIT;
    ELSE v_streak := v_streak + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'company', v_coname, 'today', v_today, 'yesterday', v_yest,
    'new_yesterday', v_new_yest, 'yesterday_by_source', v_yest_src,
    'new_today_so_far', v_new_today, 'today_by_source', v_today_src,
    'won_yesterday', v_won_yest, 'pipeline_open', v_pipeline,
    'hot_leads', v_hot, 'overdue_followups', v_overdue, 'overdue_total', v_overdue_n,
    'pool_unassigned', v_unassigned, 'unassigned_open', v_unassigned,
    'parked', jsonb_build_object('total', v_parked_total, 'by_owner', v_parked_by),
    'untouched_total', v_untot, 'untouched_top', v_untop, 'worst_untouched', v_worst,
    'inactive_agents', v_inactive, 'source_drought', v_drought,
    'zero_new_streak', v_streak);
END $function$;
