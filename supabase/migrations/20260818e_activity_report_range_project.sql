-- ═══════════════════════════════════════════════════════════════════════════
-- Activity report — any date range, any project, and one member's full history
--
-- The daily report answered "today". The owner needs the rest of it: a whole
-- month or any from–to window, split by project (KBH / FMH / Awami), and for one
-- member the complete story — how many leads they were given in that period,
-- what they did with them, and how it ended.
--
-- This REPLACES get_daily_report's job rather than sitting beside it: one day is
-- just the range from = to. Keeping two functions would mean two places to fix
-- the next time a number is wrong. get_daily_report stays as a thin wrapper so
-- nothing that already calls it breaks.
--
-- Three shapes, chosen by what you pass:
--   member NULL            → one line per member for the window
--   member set             → that member's totals, a per-DAY rollup, and the
--                            entries themselves (capped, newest first)
--   project set (either)   → everything above, restricted to leads of that project
--
-- Windows are bounded in Asia/Karachi. A month means the month the team worked,
-- not a UTC month that starts at 5am on the 1st.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_activity_report(
  p_session_token text,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_member_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_limit int DEFAULT 400)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid;
        v_from date; v_to date; v_start timestamptz; v_end timestamptz; v_cap int;
        v_none boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;

  v_to   := COALESCE(p_to,   (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_from := COALESCE(p_from, v_to);
  IF v_from > v_to THEN SELECT v_to, v_from INTO v_from, v_to; END IF;
  -- a window nobody asked for is a query nobody wants to wait for
  IF v_to - v_from > 400 THEN v_from := v_to - 400; END IF;
  v_start := (v_from::timestamp AT TIME ZONE 'Asia/Karachi');
  v_end   := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Karachi');
  v_cap   := GREATEST(50, LEAST(COALESCE(p_limit, 400), 1000));
  -- the all-zero uuid is the "leads with no project" tab. NULL already means
  -- "every project", so a filter for the untagged ones needs its own value.
  v_none  := (p_project_id = '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_none THEN p_project_id := NULL; END IF;

  RETURN (
    WITH RECURSIVE sub AS (
      SELECT id FROM public.sales_users
       WHERE parent_sales_user_id = v_uid AND status='active'
      UNION
      SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id = sub.id
       WHERE su.status='active'
    ),
    scope AS (
      SELECT id FROM sub WHERE p_member_id IS NULL OR id = p_member_id
    ),
    act AS (
      SELECT a.sales_user_id, a.kind, a.body, a.outcome, a.created_at, a.lead_id,
             l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
             l.project_id, pr.short_code AS project_tag,
             (a.created_at AT TIME ZONE 'Asia/Karachi')::date AS day
        FROM public.lead_activities a
        JOIN public.leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
        LEFT JOIN public.projects pr ON pr.id = l.project_id
       WHERE a.sales_user_id IN (SELECT id FROM scope)
         AND a.created_at >= v_start AND a.created_at < v_end
         AND (CASE WHEN v_none THEN l.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE l.project_id = p_project_id END)
    ),
    -- leads handed to them inside the window
    given AS (
      SELECT la.to_sales_user_id AS uid,
             count(DISTINCT la.lead_id) AS n,
             count(DISTINCT la.lead_id) FILTER (WHERE la.from_sales_user_id = v_uid) AS by_me
        FROM public.lead_assignments la
        JOIN public.leads l ON l.id = la.lead_id AND l.deleted_at IS NULL
       WHERE la.to_sales_user_id IN (SELECT id FROM scope)
         AND la.assigned_at >= v_start AND la.assigned_at < v_end
         AND (CASE WHEN v_none THEN l.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE l.project_id = p_project_id END)
       GROUP BY 1
    ),
    -- how those handed-over leads stand TODAY: the honest outcome of the period
    outcome AS (
      SELECT la.to_sales_user_id AS uid,
             count(DISTINCT la.lead_id) FILTER (WHERE l.status='won')  AS won_of_given,
             count(DISTINCT la.lead_id) FILTER (WHERE l.status='lost') AS lost_of_given,
             count(DISTINCT la.lead_id) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM public.lead_views v
                WHERE v.lead_id = l.id AND v.sales_user_id = la.to_sales_user_id))
                                                                       AS never_opened_of_given
        FROM public.lead_assignments la
        JOIN public.leads l ON l.id = la.lead_id AND l.deleted_at IS NULL
       WHERE la.to_sales_user_id IN (SELECT id FROM scope)
         AND la.assigned_at >= v_start AND la.assigned_at < v_end
         AND (CASE WHEN v_none THEN l.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE l.project_id = p_project_id END)
       GROUP BY 1
    ),
    -- what they are holding right now (not window-bound: it is a standing figure)
    holding AS (
      SELECT l.owner_sales_user_id AS uid,
             count(*) AS open_leads,
             count(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL
                                AND l.next_follow_up_at < now()) AS overdue
        FROM public.leads l
       WHERE l.owner_sales_user_id IN (SELECT id FROM scope)
         AND l.deleted_at IS NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND (CASE WHEN v_none THEN l.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE l.project_id = p_project_id END)
       GROUP BY 1
    ),
    per AS (
      SELECT s.id AS uid,
        count(a.*)                                                       AS entries,
        count(DISTINCT a.lead_id)                                        AS leads_touched,
        count(DISTINCT a.lead_id) FILTER (WHERE a.kind IN ('call','whatsapp','visit','meeting'))
                                                                         AS contacted,
        count(DISTINCT a.day) FILTER (WHERE a.kind IS NOT NULL)          AS active_days,
        count(*) FILTER (WHERE a.kind='call')                            AS calls,
        count(*) FILTER (WHERE a.kind='whatsapp')                        AS whatsapp,
        count(*) FILTER (WHERE a.kind='visit')                           AS visits,
        count(*) FILTER (WHERE a.kind='note')                            AS notes,
        count(*) FILTER (WHERE a.kind='stage')                           AS status_changes,
        count(*) FILTER (WHERE a.kind='stage' AND a.body ILIKE 'won%')   AS won,
        count(*) FILTER (WHERE a.kind='stage' AND a.body ILIKE 'lost%')  AS lost,
        max(a.created_at)                                                AS last_at
      FROM scope s LEFT JOIN act a ON a.sales_user_id = s.id
      GROUP BY s.id
    )
    SELECT jsonb_build_object(
      'success', true,
      'from', v_from, 'to', v_to, 'days', (v_to - v_from) + 1,
      'member_id', p_member_id,
      'project_id', CASE WHEN v_none THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE p_project_id END,

      -- the projects this director's team actually has leads in, for the tabs
      'projects', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pr.id,
                 'tag', COALESCE(pr.short_code, pr.project_name),
                 'name', pr.project_name,
                 'leads', (SELECT count(*) FROM public.leads l2
                            WHERE l2.owner_sales_user_id IN (SELECT id FROM sub)
                              AND l2.deleted_at IS NULL AND l2.project_id = pr.id))
                 ORDER BY COALESCE(pr.short_code, pr.project_name)), '[]'::jsonb)
          FROM public.projects pr
         WHERE pr.id IN (SELECT DISTINCT l.project_id FROM public.leads l
                          WHERE l.owner_sales_user_id IN (SELECT id FROM sub)
                            AND l.deleted_at IS NULL AND l.project_id IS NOT NULL)),
      -- leads nobody tagged to a project still exist and still get worked; the
      -- screen offers them as their own tab rather than losing them between tabs
      'untagged_leads', (SELECT count(*) FROM public.leads l
                          WHERE l.owner_sales_user_id IN (SELECT id FROM sub)
                            AND l.deleted_at IS NULL AND l.project_id IS NULL),

      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', p.uid, 'name', public._su_label(p.uid), 'role', su.role, 'phone', su.phone,
                 'entries', p.entries, 'leads_touched', p.leads_touched, 'contacted', p.contacted,
                 'active_days', p.active_days,
                 'calls', p.calls, 'whatsapp', p.whatsapp, 'visits', p.visits,
                 'notes', p.notes, 'status_changes', p.status_changes,
                 'won', p.won, 'lost', p.lost,
                 'given', COALESCE(g.n,0), 'given_by_me', COALESCE(g.by_me,0),
                 'won_of_given', COALESCE(o.won_of_given,0),
                 'lost_of_given', COALESCE(o.lost_of_given,0),
                 'never_opened_of_given', COALESCE(o.never_opened_of_given,0),
                 'open_leads', COALESCE(h.open_leads,0), 'overdue', COALESCE(h.overdue,0),
                 'conversion', CASE WHEN COALESCE(g.n,0) > 0
                                    THEN round(COALESCE(o.won_of_given,0)::numeric*100/g.n, 1) ELSE 0 END,
                 'last_at', p.last_at
               ) ORDER BY p.entries DESC, su.full_name)
          FROM per p
          JOIN public.sales_users su ON su.id = p.uid
          LEFT JOIN given g   ON g.uid = p.uid
          LEFT JOIN outcome o ON o.uid = p.uid
          LEFT JOIN holding h ON h.uid = p.uid), '[]'::jsonb),

      -- one member: how the period ran, day by day
      'by_day', CASE WHEN p_member_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'day', d.day, 'entries', d.entries, 'contacted', d.contacted,
                 'calls', d.calls, 'whatsapp', d.whatsapp, 'visits', d.visits,
                 'notes', d.notes, 'status_changes', d.status_changes) ORDER BY d.day DESC)
          FROM (SELECT a.day,
                       count(*) AS entries,
                       count(DISTINCT a.lead_id) FILTER (WHERE a.kind IN ('call','whatsapp','visit','meeting')) AS contacted,
                       count(*) FILTER (WHERE a.kind='call') AS calls,
                       count(*) FILTER (WHERE a.kind='whatsapp') AS whatsapp,
                       count(*) FILTER (WHERE a.kind='visit') AS visits,
                       count(*) FILTER (WHERE a.kind='note') AS notes,
                       count(*) FILTER (WHERE a.kind='stage') AS status_changes
                  FROM act a GROUP BY a.day) d), '[]'::jsonb) END,

      -- and the entries themselves, newest first, capped
      'entries', CASE WHEN p_member_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'at', e.created_at, 'kind', e.kind, 'body', e.body, 'outcome', e.outcome,
                 'lead_id', e.lead_id, 'lead', e.lead_name, 'phone', e.lead_phone,
                 'lead_status', e.lead_status, 'project', e.project_tag) ORDER BY e.created_at DESC)
          FROM (SELECT * FROM act ORDER BY created_at DESC LIMIT v_cap) e), '[]'::jsonb) END,
      'entries_capped', CASE WHEN p_member_id IS NULL THEN false
                             ELSE (SELECT count(*) FROM act) > v_cap END,
      'entries_total',  CASE WHEN p_member_id IS NULL THEN 0 ELSE (SELECT count(*) FROM act) END,

      'totals', (SELECT jsonb_build_object(
                   'members', count(*),
                   'worked',  count(*) FILTER (WHERE p.entries > 0),
                   'silent',  count(*) FILTER (WHERE p.entries = 0),
                   'entries', COALESCE(sum(p.entries),0),
                   'contacted', COALESCE(sum(p.contacted),0),
                   'calls', COALESCE(sum(p.calls),0),
                   'whatsapp', COALESCE(sum(p.whatsapp),0),
                   'visits', COALESCE(sum(p.visits),0),
                   'notes', COALESCE(sum(p.notes),0),
                   'status_changes', COALESCE(sum(p.status_changes),0),
                   'given', COALESCE(sum(COALESCE(g.n,0)),0),
                   'won_of_given', COALESCE(sum(COALESCE(o.won_of_given,0)),0))
                 FROM per p
                 LEFT JOIN given g   ON g.uid = p.uid
                 LEFT JOIN outcome o ON o.uid = p.uid)
    )
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_activity_report(text, date, date, uuid, uuid, int) FROM PUBLIC;
-- the portal is an anon client identified by its session token (see 20260818b)
GRANT EXECUTE ON FUNCTION public.get_activity_report(text, date, date, uuid, uuid, int) TO anon, authenticated;

-- ── get_daily_report becomes what its comment already claimed: a wrapper ────
-- One day is just the range from = to. Leaving two implementations behind would
-- mean two places to fix the next time a number is wrong, so the older function
-- now delegates and keeps its own key shape for anything still calling it.
CREATE OR REPLACE FUNCTION public.get_daily_report(
  p_session_token text,
  p_day date DEFAULT NULL,
  p_member_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (r->>'success')::boolean IS NOT TRUE THEN r
    ELSE r || jsonb_build_object('day', r->'from')
  END
  FROM (SELECT public.get_activity_report(
          p_session_token,
          COALESCE(p_day, (now() AT TIME ZONE 'Asia/Karachi')::date),
          COALESCE(p_day, (now() AT TIME ZONE 'Asia/Karachi')::date),
          p_member_id, NULL, 400) AS r) q
$function$;

REVOKE ALL ON FUNCTION public.get_daily_report(text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_report(text, date, uuid) TO anon, authenticated;
