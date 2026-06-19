-- ════════════════════════════════════════════════════════════════════════
-- Sale-person REPORTS — "My Performance": lead funnel + conversion + activity
-- + lost-reasons + sales, for a period. Subtree-scoped (rep=own, manager=team).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_sales_performance(p_session_token text, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid;
        v_total int; v_new int; v_cont int; v_visit int; v_neg int; v_won int; v_lost int;
        v_acts jsonb; v_lost_reasons jsonb; v_sales_n int; v_sales_val numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  ls AS (
    SELECT l.* FROM public.leads l
    WHERE l.owner_sales_user_id IN (SELECT id FROM sub)
      AND (p_from IS NULL OR l.created_at::date >= p_from)
      AND (p_to   IS NULL OR l.created_at::date <= p_to)
  )
  SELECT count(*),
         count(*) FILTER (WHERE status='new'), count(*) FILTER (WHERE status='contacted'),
         count(*) FILTER (WHERE status='visit'), count(*) FILTER (WHERE status='negotiation'),
         count(*) FILTER (WHERE status='won'), count(*) FILTER (WHERE status='lost')
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
    FROM public.leads
    WHERE owner_sales_user_id IN (SELECT id FROM sub) AND status='lost'
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
