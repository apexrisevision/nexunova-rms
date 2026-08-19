-- ═══════════════════════════════════════════════════════════════════════════
-- The "Leads I gave" screen needs its own project tabs
--
-- get_given_leads already filters by project; it just never said WHICH projects
-- exist, so the screen had nothing to draw tabs from. Same rule the Team report
-- uses: the tabs are built from the leads that actually exist in the window, so
-- an Awami tab appears the day there is an Awami lead and disappears when there
-- is not — nothing hardcoded, nothing stale.
--
-- The counts on the tabs are taken BEFORE the project filter is applied, or every
-- tab but the selected one would read zero.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_given_leads(
  p_session_token text,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_member_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_state text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_from date; v_to date;
        v_start timestamptz; v_end timestamptz; v_none boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;

  v_to   := COALESCE(p_to,   (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_from := COALESCE(p_from, v_to);
  IF v_from > v_to THEN SELECT v_to, v_from INTO v_from, v_to; END IF;
  IF v_to - v_from > 400 THEN v_from := v_to - 400; END IF;
  v_start := (v_from::timestamp AT TIME ZONE 'Asia/Karachi');
  v_end   := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Karachi');
  v_none  := (p_project_id = '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_none THEN p_project_id := NULL; END IF;

  RETURN (
    WITH given_all AS (
      -- everything I handed over in this window, before any project filter —
      -- the tabs are counted off this, or every tab but one would read zero
      SELECT DISTINCT ON (la.lead_id)
             la.lead_id, la.to_sales_user_id AS uid, la.assigned_at, l.project_id
        FROM public.lead_assignments la
        JOIN public.leads l ON l.id = la.lead_id AND l.deleted_at IS NULL
       WHERE la.from_sales_user_id = v_uid
         AND la.assigned_at >= v_start AND la.assigned_at < v_end
         AND (p_member_id IS NULL OR la.to_sales_user_id = p_member_id)
       ORDER BY la.lead_id, la.assigned_at DESC
    ),
    given AS (
      SELECT g.lead_id, g.uid, g.assigned_at
        FROM given_all g
       WHERE (CASE WHEN v_none THEN g.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE g.project_id = p_project_id END)
    ),
    chain AS (
      SELECT g.lead_id, g.uid, g.assigned_at,
             l.name, l.phone, l.status, l.next_follow_up_at,
             COALESCE(pr.short_code, pr.project_name) AS project,
             -- did the PERSON IT WAS GIVEN TO open it? not "did I"
             (SELECT v.seen_at FROM public.lead_views v
               WHERE v.lead_id = g.lead_id AND v.sales_user_id = g.uid) AS opened_at,
             -- their first real contact after it was handed over
             (SELECT min(a.created_at) FROM public.lead_activities a
               WHERE a.lead_id = g.lead_id AND a.sales_user_id = g.uid
                 AND public._lead_contact_channel(a.kind)
                 AND a.created_at >= g.assigned_at) AS contacted_at,
             -- the last thing they SAID about it: a note, or a status move
             (SELECT jsonb_build_object('at', a.created_at, 'kind', a.kind, 'body', a.body)
                FROM public.lead_activities a
               WHERE a.lead_id = g.lead_id AND a.sales_user_id = g.uid
                 AND a.kind IN ('note','stage')
                 AND a.created_at >= g.assigned_at
               ORDER BY a.created_at DESC LIMIT 1) AS last_said,
             (SELECT max(a.created_at) FROM public.lead_activities a
               WHERE a.lead_id = g.lead_id AND a.sales_user_id = g.uid
                 AND a.created_at >= g.assigned_at) AS last_touch
        FROM given g
        JOIN public.leads l ON l.id = g.lead_id
        LEFT JOIN public.projects pr ON pr.id = l.project_id
    ),
    tagged AS (
      SELECT c.*,
             CASE WHEN c.opened_at IS NULL              THEN 'not_opened'
                  WHEN c.contacted_at IS NULL           THEN 'opened_no_contact'
                  WHEN c.last_said IS NULL              THEN 'contacted_no_update'
                  ELSE 'updated' END AS state
        FROM chain c
    )
    SELECT jsonb_build_object(
      'success', true,
      'from', v_from, 'to', v_to, 'days', (v_to - v_from) + 1,
      'state', p_state,
      'counts', (SELECT jsonb_build_object(
                   'total', count(*),
                   'not_opened',          count(*) FILTER (WHERE state='not_opened'),
                   'opened_no_contact',   count(*) FILTER (WHERE state='opened_no_contact'),
                   'contacted_no_update', count(*) FILTER (WHERE state='contacted_no_update'),
                   'updated',             count(*) FILTER (WHERE state='updated')) FROM tagged),
      'projects', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'leads')::int DESC)
          FROM (SELECT jsonb_build_object(
                  'id', pr.id,
                  'tag', COALESCE(pr.short_code, pr.project_name),
                  'leads', count(*)) AS x
                  FROM given_all g JOIN public.projects pr ON pr.id = g.project_id
                 GROUP BY pr.id, pr.short_code, pr.project_name) q), '[]'::jsonb),
      'untagged_leads', (SELECT count(*) FROM given_all WHERE project_id IS NULL),
      'leads', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'lead_id', t.lead_id, 'name', t.name, 'phone', t.phone,
                 'status', t.status, 'project', t.project,
                 'to_id', t.uid, 'to', public._su_label(t.uid),
                 'given_at', t.assigned_at,
                 'opened_at', t.opened_at,
                 'contacted_at', t.contacted_at,
                 'last_touch', t.last_touch,
                 'last_said', t.last_said,
                 'next_follow_up_at', t.next_follow_up_at,
                 'state', t.state,
                 -- how long it has been stuck at this link, in hours
                 'stuck_hours', round(EXTRACT(EPOCH FROM (now() - COALESCE(t.last_touch, t.assigned_at))) / 3600)
               ) ORDER BY
                 CASE t.state WHEN 'not_opened' THEN 0 WHEN 'opened_no_contact' THEN 1
                              WHEN 'contacted_no_update' THEN 2 ELSE 3 END,
                 t.assigned_at)
          FROM tagged t
         WHERE p_state IS NULL OR t.state = p_state), '[]'::jsonb),
      -- one line per member, so a director can see who the pile belongs to
      'by_member', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'not_opened')::int DESC, x->>'name')
          FROM (SELECT jsonb_build_object(
                  'id', t.uid, 'name', public._su_label(t.uid),
                  'given', count(*),
                  'not_opened',          count(*) FILTER (WHERE t.state='not_opened'),
                  'opened_no_contact',   count(*) FILTER (WHERE t.state='opened_no_contact'),
                  'contacted_no_update', count(*) FILTER (WHERE t.state='contacted_no_update'),
                  'updated',             count(*) FILTER (WHERE t.state='updated')) AS x
                  FROM tagged t GROUP BY t.uid) q), '[]'::jsonb)
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_given_leads(text, date, date, uuid, uuid, text) FROM PUBLIC;
-- the portal is an anon client identified by its session token (see 20260818b)
GRANT EXECUTE ON FUNCTION public.get_given_leads(text, date, date, uuid, uuid, text) TO anon, authenticated;
