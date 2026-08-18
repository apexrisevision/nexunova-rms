-- ═══════════════════════════════════════════════════════════════════════════
-- Daily activity report — what each member actually did today
--
-- The owner's two questions, which the portal could not answer:
--   1. a rep writes a note on a lead, or moves its status — the director never
--      sees it.
--   2. "what did this person do today?" — how many leads I gave them, who they
--      contacted, what they wrote, how the day went.
--
-- Nothing needed to be recorded that is not already recorded. lead_activities
-- has been capturing kind = assigned / call / note / stage / visit / whatsapp
-- with the note text in `body` all along, and get_team_activity has existed for
-- months — the portal simply never called it and there was no screen. So this
-- adds the one thing missing: a report that reads what is already there.
--
-- One function, two shapes:
--   p_member_id NULL → one line per member for that day (the team at a glance)
--   p_member_id set  → that member's whole day, every entry, in order
--
-- Scope is the caller's own subtree, recursively, exactly like get_team_activity.
-- A rep calling this sees only themselves, which makes it safe to reuse later.
--
-- The day is bounded in Asia/Karachi, not UTC: "today" has to mean the day the
-- person worked, or a 10pm call lands on tomorrow's report.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daily_report(
  p_session_token text,
  p_day date DEFAULT NULL,
  p_member_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_day date;
        v_from timestamptz; v_to timestamptz; v_rows jsonb; v_tot jsonb; v_who jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;

  -- the working day, in the timezone the team actually works in
  v_day  := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_from := (v_day::timestamp AT TIME ZONE 'Asia/Karachi');
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Karachi');

  RETURN (
    WITH RECURSIVE sub AS (
      SELECT id FROM public.sales_users WHERE parent_sales_user_id = v_uid AND status='active'
      UNION
      SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id = sub.id
      WHERE su.status='active'
    ),
    scope AS (
      SELECT id FROM sub
       WHERE p_member_id IS NULL OR id = p_member_id
    ),
    -- everything the member did that day, on leads that are theirs
    act AS (
      SELECT a.id, a.sales_user_id, a.kind, a.body, a.outcome, a.next_step,
             a.created_at, a.lead_id,
             l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
             pr.short_code AS project_tag
        FROM public.lead_activities a
        JOIN public.leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
        LEFT JOIN public.projects pr ON pr.id = l.project_id
       WHERE a.sales_user_id IN (SELECT id FROM scope)
         AND a.created_at >= v_from AND a.created_at < v_to
    ),
    -- leads handed to them that day, and by whom
    given AS (
      SELECT la.to_sales_user_id AS uid, count(DISTINCT la.lead_id) AS n,
             count(DISTINCT la.lead_id) FILTER (WHERE la.from_sales_user_id = v_uid) AS by_me
        FROM public.lead_assignments la
       WHERE la.to_sales_user_id IN (SELECT id FROM scope)
         AND la.assigned_at >= v_from AND la.assigned_at < v_to
       GROUP BY 1
    ),
    -- what they hold right now, and how much of it has never been opened
    holding AS (
      SELECT l.owner_sales_user_id AS uid,
             count(*) AS open_leads,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM public.lead_views v
                WHERE v.lead_id = l.id AND v.sales_user_id = l.owner_sales_user_id)) AS never_opened,
             count(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL
                                AND l.next_follow_up_at < now()) AS overdue
        FROM public.leads l
       WHERE l.owner_sales_user_id IN (SELECT id FROM scope)
         AND l.deleted_at IS NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
       GROUP BY 1
    ),
    per AS (
      SELECT s.id AS uid,
        count(a.id)                                                    AS entries,
        count(DISTINCT a.lead_id) FILTER (WHERE a.kind IN ('call','whatsapp','visit','meeting'))
                                                                       AS contacted,
        count(*) FILTER (WHERE a.kind='call')                          AS calls,
        count(*) FILTER (WHERE a.kind='whatsapp')                      AS whatsapp,
        count(*) FILTER (WHERE a.kind='visit')                         AS visits,
        count(*) FILTER (WHERE a.kind='note')                          AS notes,
        count(*) FILTER (WHERE a.kind='stage')                         AS status_changes,
        count(*) FILTER (WHERE a.kind='stage' AND a.body ILIKE 'won%') AS won,
        count(*) FILTER (WHERE a.kind='stage' AND a.body ILIKE 'lost%')AS lost,
        min(a.created_at)                                              AS first_at,
        max(a.created_at)                                              AS last_at
      FROM scope s LEFT JOIN act a ON a.sales_user_id = s.id
      GROUP BY s.id
    )
    SELECT jsonb_build_object(
      'success', true,
      'day', v_day,
      'member_id', p_member_id,
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', p.uid,
                 'name', public._su_label(p.uid),
                 'role', su.role,
                 'phone', su.phone,
                 'entries', p.entries,
                 'contacted', p.contacted,
                 'calls', p.calls, 'whatsapp', p.whatsapp, 'visits', p.visits,
                 'notes', p.notes, 'status_changes', p.status_changes,
                 'won', p.won, 'lost', p.lost,
                 'given_today', COALESCE(g.n,0), 'given_by_me', COALESCE(g.by_me,0),
                 'open_leads', COALESCE(h.open_leads,0),
                 'never_opened', COALESCE(h.never_opened,0),
                 'overdue', COALESCE(h.overdue,0),
                 'first_at', p.first_at, 'last_at', p.last_at
               ) ORDER BY p.entries DESC, su.full_name)
          FROM per p
          JOIN public.sales_users su ON su.id = p.uid
          LEFT JOIN given g   ON g.uid = p.uid
          LEFT JOIN holding h ON h.uid = p.uid), '[]'::jsonb),
      -- the member's own day, entry by entry — only when one is asked for
      'entries', CASE WHEN p_member_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'at', a.created_at, 'kind', a.kind, 'body', a.body,
                 'outcome', a.outcome, 'next_step', a.next_step,
                 'lead_id', a.lead_id, 'lead', a.lead_name, 'phone', a.lead_phone,
                 'lead_status', a.lead_status, 'project', a.project_tag
               ) ORDER BY a.created_at DESC) FROM act a), '[]'::jsonb) END,
      'totals', (SELECT jsonb_build_object(
                   'members', count(*),
                   'worked',  count(*) FILTER (WHERE p.entries > 0),
                   'silent',  count(*) FILTER (WHERE p.entries = 0),
                   'contacted', COALESCE(sum(p.contacted),0),
                   'calls', COALESCE(sum(p.calls),0),
                   'whatsapp', COALESCE(sum(p.whatsapp),0),
                   'visits', COALESCE(sum(p.visits),0),
                   'notes', COALESCE(sum(p.notes),0),
                   'status_changes', COALESCE(sum(p.status_changes),0),
                   'given_today', COALESCE(sum(COALESCE(g.n,0)),0))
                 FROM per p LEFT JOIN given g ON g.uid = p.uid)
    )
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_daily_report(text, date, uuid) FROM PUBLIC;
-- the sales portal is an anon client that identifies its user with a session
-- token (see 20260818b); the check is inside the function, not the grant
GRANT EXECUTE ON FUNCTION public.get_daily_report(text, date, uuid) TO anon, authenticated;
