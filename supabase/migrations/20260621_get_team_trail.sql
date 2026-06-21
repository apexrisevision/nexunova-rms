-- get_team_trail: all of a director's team's location breadcrumbs for one day.
-- 2026-06-21. Powers the Live Map "Replay" (time machine) + "Heatmap" modes.
-- Director-only; day is in Asia/Karachi (PKT); points per member, time-ordered.
CREATE OR REPLACE FUNCTION public.get_team_trail(p_session_token text, p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text;
        v_day date; v_start timestamptz; v_end timestamptz; v_members jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  v_day := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_start := (v_day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Karachi';
  v_end   := v_start + interval '1 day';

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid AND status='active'
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id WHERE su.status='active'
  ),
  mem AS (SELECT id FROM sub UNION SELECT v_uid),
  pts AS (
    SELECT lh.sales_user_id,
           jsonb_agg(jsonb_build_object('lat',lh.lat,'lng',lh.lng,'at',lh.recorded_at) ORDER BY lh.recorded_at) points,
           min(lh.recorded_at) first_at, max(lh.recorded_at) last_at, count(*) n
    FROM public.location_history lh
    WHERE lh.sales_user_id IN (SELECT id FROM mem) AND lh.recorded_at>=v_start AND lh.recorded_at<v_end
    GROUP BY lh.sales_user_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', su.id, 'name', su.full_name, 'role', su.role, 'is_me', (su.id=v_uid),
    'points', p.points, 'count', p.n, 'first_at', p.first_at, 'last_at', p.last_at
  ) ORDER BY su.full_name) INTO v_members
  FROM pts p JOIN public.sales_users su ON su.id=p.sales_user_id;

  RETURN jsonb_build_object('success',true,'day',v_day,'members',COALESCE(v_members,'[]'::jsonb),
    'start', extract(epoch from v_start)*1000, 'end', extract(epoch from v_end)*1000);
END
$function$;
REVOKE ALL ON FUNCTION public.get_team_trail(text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_trail(text,date) TO anon, authenticated;
