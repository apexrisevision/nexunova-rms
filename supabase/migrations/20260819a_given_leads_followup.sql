-- ═══════════════════════════════════════════════════════════════════════════
-- "I gave you this lead — what happened to it?"
--
-- The owner's words: after he assigns a lead he wants the whole chain back, so he
-- can go and ask — "you never even opened it", or "you opened it and never said
-- what the client told you". Today he has no screen that answers either sentence,
-- and the pieces live in three tables nobody joins.
--
-- The chain a lead walks after it is handed over, and the exact complaint each
-- broken link produces:
--
--   given → NOT OPENED            "you have not even opened it"
--         → opened, NO CONTACT    "you opened it and never rang"
--         → contacted, NO UPDATE  "you rang and never told me what he said"
--         → updated               here is what the client said
--
-- Two things this does NOT do, on purpose:
--
--   · it does not invent an 'opened' pipeline status. new / contacted / visit /
--     negotiation / won / lost is what the funnel counts, and if opening a lead
--     flipped it to contacted then every contacted number in the business would
--     become a lie — which is the exact opposite of what is being asked for.
--     Opening is a FACT WITH A TIME (lead_views.seen_at), and it is returned as
--     one, so a screen can show "Opened" without the funnel moving.
--   · it does not guess. Every link is read from what was actually recorded: the
--     assignment row, the owner's own view row, the owner's own activities.
--
-- Also fixed here: mark_lead_seen's ON CONFLICT never refreshed seen_at, so the
-- first open was recorded and every later one was lost. "Last opened" was stale
-- by design without meaning to be.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_lead_seen(p_session_token text, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_ok boolean; v_pend boolean := false; v_first boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  v_ok := public._lead_can_act(p_session_token, p_lead_id);
  IF NOT v_ok THEN
    SELECT EXISTS (
      SELECT 1 FROM public.leads l
       JOIN public.sales_users su ON su.id = v_ses.sales_user_id
      WHERE l.id = p_lead_id
        AND l.company_id = v_ses.company_id
        AND su.role IN ('director','admin','cfo')
    ) INTO v_ok;
  END IF;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',true,'noop',true); END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.lead_views v
                      WHERE v.lead_id=p_lead_id AND v.sales_user_id=v_ses.sales_user_id) INTO v_first;

  v_pend := public._fu_owes_disposition(p_lead_id, v_ses.sales_user_id);   -- PHASE2 (once per day)

  INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at, disposition_pending_since)
  VALUES (p_lead_id, v_ses.sales_user_id, now(), CASE WHEN v_pend THEN now() END)
  ON CONFLICT (lead_id, sales_user_id) DO UPDATE
    -- the old version left seen_at at the FIRST open forever, so "last opened"
    -- silently aged. It is a last-seen column; keep it last-seen.
    SET seen_at = now(),
        disposition_pending_since = CASE
          WHEN v_pend AND public.lead_views.disposition_pending_since IS NULL THEN now()
          WHEN NOT v_pend THEN NULL
          ELSE public.lead_views.disposition_pending_since END;

  RETURN jsonb_build_object('success',true,'disposition_required',v_pend,'first_open',v_first);
END $function$;


-- ── the chain, per lead this director handed over ──────────────────────────
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
    WITH given AS (
      -- what I handed over in this window, and to whom
      SELECT DISTINCT ON (la.lead_id)
             la.lead_id, la.to_sales_user_id AS uid, la.assigned_at
        FROM public.lead_assignments la
        JOIN public.leads l ON l.id = la.lead_id AND l.deleted_at IS NULL
       WHERE la.from_sales_user_id = v_uid
         AND la.assigned_at >= v_start AND la.assigned_at < v_end
         AND (p_member_id IS NULL OR la.to_sales_user_id = p_member_id)
         AND (CASE WHEN v_none THEN l.project_id IS NULL
                   WHEN p_project_id IS NULL THEN true
                   ELSE l.project_id = p_project_id END)
       ORDER BY la.lead_id, la.assigned_at DESC
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
