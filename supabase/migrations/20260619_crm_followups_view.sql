-- ════════════════════════════════════════════════════════════════════════
-- CRM — FOLLOW-UPS SURFACING ("who to follow up with, today")
-- Surfaces leads with a next_follow_up_at across the caller's subtree, bucketed
-- overdue / today / upcoming. Powers the Home "Follow up today" section so the
-- next_follow_up_at reminders (Phase 2) become an actionable daily worklist.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_followups(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_today date := current_date;
        v_overdue int; v_today_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ), due AS (
    SELECT l.id, l.name, l.phone, l.status, l.next_follow_up_at,
           (l.owner_sales_user_id=v_uid) AS is_mine,
           ow.full_name AS owner_name,
           CASE WHEN l.next_follow_up_at::date < v_today THEN 'overdue'
                WHEN l.next_follow_up_at::date = v_today THEN 'today'
                ELSE 'upcoming' END AS bucket
    FROM public.leads l
    JOIN sub ON sub.id = l.owner_sales_user_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    WHERE l.next_follow_up_at IS NOT NULL AND l.status NOT IN ('won','lost')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',id,'name',name,'phone',phone,'status',status,
           'next_follow_up_at',next_follow_up_at,'is_mine',is_mine,'owner_name',owner_name,'bucket',bucket
         ) ORDER BY next_follow_up_at ASC), '[]'::jsonb),
         count(*) FILTER (WHERE bucket='overdue'),
         count(*) FILTER (WHERE bucket='today')
    INTO v_rows, v_overdue, v_today_n
  FROM due;

  RETURN jsonb_build_object('success',true,'rows',v_rows,
    'overdue',COALESCE(v_overdue,0),'today',COALESCE(v_today_n,0));
END; $function$;
