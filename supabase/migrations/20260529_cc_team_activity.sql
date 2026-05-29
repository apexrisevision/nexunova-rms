-- ════════════════════════════════════════════════════════════
-- Command Center — Team Activity (per-user, TODAY in Pakistan time)
-- (applied 2026-05-29; PKT + activity-span revision)
-- ════════════════════════════════════════════════════════════
-- Per active (non-super-admin) user: today's first login, minutes on system,
-- actions (audit_logs), contacts + call minutes (contact_logs).
-- "Today" = Asia/Karachi day. "minutes_today" = span of ALL of today's activity
-- (login + audit + contacts + session touches), so it is meaningful even without
-- a user_sessions heartbeat. contact_logs.created_by is TEXT; recovery_agent_id uuid.

CREATE OR REPLACE FUNCTION public.cc_team_activity(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi';
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'minutes_today')::int DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'id',             u.id,
      'name',           COALESCE(u.full_name, u.username, 'User'),
      'role',           u.role,
      'login_today',    COALESCE(act.first_login, act.first_ts),
      'online',         ( (act.last_ts IS NOT NULL AND act.last_ts > now() - interval '10 minutes')
                          OR EXISTS (SELECT 1 FROM user_sessions se WHERE se.user_id = u.id
                                      AND se.revoked_at IS NULL AND se.expires_at > now()
                                      AND se.last_seen_at > now() - interval '15 minutes') ),
      'minutes_today',  COALESCE(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (act.last_ts - act.first_ts)) / 60))::int, 0),
      'actions_today',  COALESCE(act.actions, 0),
      'contacts_today', COALESCE(ct.cnt, 0),
      'call_minutes',   COALESCE(ct.mins, 0)
    ) AS row
    FROM app_users u
    LEFT JOIN LATERAL (
      SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts,
             MIN(ts) FILTER (WHERE kind = 'login') AS first_login,
             COUNT(*) FILTER (WHERE kind = 'action') AS actions
      FROM (
        SELECT ae.created_at AS ts, 'login'  AS kind FROM auth_events ae
          WHERE ae.user_id = u.id AND ae.event_type ILIKE '%login%' AND ae.created_at >= v_start
        UNION ALL
        SELECT al.changed_at, 'action' FROM audit_logs al
          WHERE al.company_id = p_company_id AND al.changed_by_name = COALESCE(u.full_name, u.username) AND al.changed_at >= v_start
        UNION ALL
        SELECT se.created_at, 'session' FROM user_sessions se WHERE se.user_id = u.id AND se.created_at >= v_start
        UNION ALL
        SELECT se.last_seen_at, 'seen' FROM user_sessions se WHERE se.user_id = u.id AND se.last_seen_at >= v_start
        UNION ALL
        SELECT c.created_at, 'contact' FROM contact_logs c
          WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.created_at >= v_start
      ) e
    ) act ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(c.duration_minutes), 0) AS mins
      FROM contact_logs c
      WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.contact_date = v_today
    ) ct ON true
    WHERE u.company_id = p_company_id
      AND COALESCE(u.status, 'active') NOT IN ('inactive','suspended','deleted')
      AND COALESCE(u.is_super_admin, false) = false
  ) q;
  RETURN v;
END
$function$;

-- Per-user contact drill-down (TODAY, Pakistan day): which clients a user contacted.
CREATE OR REPLACE FUNCTION public.cc_user_contacts(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client',  COALESCE(c.client_name, '—'),
    'channel', c.channel,
    'time',    COALESCE(c.contact_time::text, to_char(c.created_at AT TIME ZONE 'Asia/Karachi', 'HH24:MI')),
    'status',  COALESCE(c.call_status, c.status_tag, c.response_type),
    'minutes', c.duration_minutes,
    'promise', c.promise_amount,
    'next',    c.next_action
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  FROM contact_logs c
  WHERE c.company_id = p_company_id
    AND (c.created_by = p_user_id::text OR c.recovery_agent_id = p_user_id)
    AND c.contact_date = (now() AT TIME ZONE 'Asia/Karachi')::date;
$function$;

GRANT EXECUTE ON FUNCTION public.cc_team_activity(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_user_contacts(uuid, uuid) TO anon, authenticated;
