-- ═══════════════════════════════════════════════════════════════════════════
-- "I HAVE opened them" — and she had
--
-- IQRA's complaint: the alert kept telling her she had leads she had not opened,
-- and she had. She was right and the alert was wrong. Her two leads:
--
--   Shoaib Nawaz Wazir   status contacted   9 activities by her (call, WhatsApp)   0 views
--   Qafid Muhammad       status contacted  11 activities by her (call, WhatsApp)   0 views
--
-- She rang them and messaged them. What she never did was tap into the lead's
-- detail screen — because she did not have to. The Leads list carries one-tap
-- Call and WhatsApp buttons, and those write an activity without ever calling
-- mark_lead_seen. Only openLead() records a view.
--
-- So the alert was asking "did you open the screen?" while believing it had
-- asked "have you done anything with this lead?" Calling somebody is stronger
-- evidence of engagement than looking at a page, and any rule that says
-- otherwise is measuring the instrument instead of the work.
--
-- Fixed in three places, because one of them alone would leave a hole:
--
--   1. THE WRITE. Logging any interaction now records the view too. You cannot
--      ring a lead you have not seen. This is the root fix — every reader,
--      present and future, gets it right without knowing about this problem.
--   2. THE READ. Existing rows are already wrong, and rewriting history to
--      invent a "seen" timestamp that never happened would be worse. So the
--      alert and the given-leads chain treat the owner's own activity as
--      engagement in its own right: opened = a view OR something they did.
--   3. THE STALE ALERT. Her second complaint, and the sharper one: an alert
--      raised at 00:40 kept saying "2 leads you have not opened" all day even
--      after she opened them, because the row is a snapshot and the screen reads
--      it as a live status. get_my_alerts now recomputes the count and says when
--      the thing has been dealt with, so acting on an alert can clear it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. THE WRITE ───────────────────────────────────────────────────────────
-- one helper, called by both writers: you cannot act on a lead you have not seen
CREATE OR REPLACE FUNCTION public._lead_touch_view(p_lead uuid, p_uid uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.lead_views (lead_id, sales_user_id, seen_at)
  VALUES (p_lead, p_uid, now())
  ON CONFLICT (lead_id, sales_user_id) DO UPDATE SET seen_at = now();
$function$;

COMMENT ON FUNCTION public._lead_touch_view(uuid, uuid) IS
  'Recording that someone worked a lead also records that they saw it. The Leads list has one-tap Call/WhatsApp buttons that never open the detail screen.';

CREATE OR REPLACE FUNCTION public.log_lead_interaction(
  p_session_token text, p_lead_id uuid, p_channel text,
  p_outcome text DEFAULT NULL, p_note text DEFAULT NULL,
  p_next_step text DEFAULT NULL, p_next_step_date timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_prev text; v_moved boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_channel NOT IN ('call','whatsapp','sms','visit','meeting','note') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_channel'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- the status BEFORE the write; RETURNING would hand back the one after it,
  -- and a lead already at contacted would then claim it had just moved
  SELECT status INTO v_prev FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, outcome, next_step)
  VALUES (p_lead_id, v_ses.sales_user_id, p_channel,
          NULLIF(TRIM(COALESCE(p_note,'')),''), NULLIF(TRIM(COALESCE(p_outcome,'')),''), NULLIF(TRIM(COALESCE(p_next_step,'')),''));

  -- working it IS seeing it — the list's Call/WhatsApp buttons never open the detail
  PERFORM public._lead_touch_view(p_lead_id, v_ses.sales_user_id);

  UPDATE public.leads
     SET last_activity_at = now(),
         next_follow_up_at = COALESCE(p_next_step_date, next_follow_up_at),
         -- reaching someone is what "contacted" means; only new ever moves
         status = CASE WHEN status = 'new' AND public._lead_contact_channel(p_channel)
                       THEN 'contacted' ELSE status END,
         updated_at = now()
   WHERE id = p_lead_id;

  v_moved := (v_prev = 'new' AND public._lead_contact_channel(p_channel));

  IF v_moved THEN
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT p_lead_id, v_ses.sales_user_id, 'stage', 'Moved to contacted'
     WHERE NOT EXISTS (SELECT 1 FROM public.lead_activities a
                        WHERE a.lead_id = p_lead_id AND a.kind = 'stage'
                          AND a.body = 'Moved to contacted');
  END IF;

  RETURN jsonb_build_object('success',true,'moved_to_contacted', v_moved);
END $function$;

CREATE OR REPLACE FUNCTION public.add_lead_activity(
  p_session_token text, p_lead_id uuid, p_kind text,
  p_body text DEFAULT NULL, p_follow_up_at timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_prev text; v_moved boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_kind NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_kind'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT status INTO v_prev FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, p_kind, NULLIF(TRIM(COALESCE(p_body,'')),''));

  PERFORM public._lead_touch_view(p_lead_id, v_ses.sales_user_id);

  UPDATE public.leads
     SET last_activity_at = now(),
         next_follow_up_at = COALESCE(p_follow_up_at, next_follow_up_at),
         status = CASE WHEN status = 'new' AND public._lead_contact_channel(p_kind)
                       THEN 'contacted' ELSE status END,
         updated_at = now()
   WHERE id = p_lead_id;

  v_moved := (v_prev = 'new' AND public._lead_contact_channel(p_kind));

  IF v_moved THEN
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT p_lead_id, v_ses.sales_user_id, 'stage', 'Moved to contacted'
     WHERE NOT EXISTS (SELECT 1 FROM public.lead_activities a
                        WHERE a.lead_id = p_lead_id AND a.kind = 'stage'
                          AND a.body = 'Moved to contacted');
  END IF;

  RETURN jsonb_build_object('success',true,'moved_to_contacted', v_moved);
END $function$;


-- ── 2. THE READ ────────────────────────────────────────────────────────────
-- "have they engaged with this lead at all", asked once, in one place
CREATE OR REPLACE FUNCTION public._lead_untouched(p_lead uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.lead_views v
                      WHERE v.lead_id = p_lead AND v.sales_user_id = p_owner)
     AND NOT EXISTS (SELECT 1 FROM public.lead_activities a
                      WHERE a.lead_id = p_lead AND a.sales_user_id = p_owner
                        AND a.kind IN ('call','whatsapp','sms','visit','meeting','note','stage'));
$function$;

COMMENT ON FUNCTION public._lead_untouched(uuid, uuid) IS
  'True only when the owner has neither viewed the lead nor done anything to it. Ringing a client is stronger evidence of engagement than opening a screen.';

-- how many leads of this kind are STILL a problem for this member, right now
CREATE OR REPLACE FUNCTION public._alert_live_count(p_uid uuid, p_kind text)
 RETURNS int
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.alert_settings; v_co uuid; v_n int := 0; v_today date;
BEGIN
  SELECT company_id INTO v_co FROM public.sales_users WHERE id = p_uid;
  SELECT * INTO s FROM public.alert_settings WHERE company_id = v_co;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_today := (now() AT TIME ZONE 'Asia/Karachi')::date;

  IF p_kind = 'not_opened' THEN
    SELECT count(*) INTO v_n FROM public.leads l
     WHERE l.owner_sales_user_id = p_uid AND l.deleted_at IS NULL
       AND COALESCE(l.status,'new') NOT IN ('won','lost')
       AND l.assigned_at IS NOT NULL
       AND l.assigned_at < now() - make_interval(hours => s.hours_not_opened)
       AND public._lead_untouched(l.id, l.owner_sales_user_id);
  ELSIF p_kind = 'no_contact' THEN
    SELECT count(*) INTO v_n FROM public.leads l
      JOIN public.lead_views v ON v.lead_id = l.id AND v.sales_user_id = l.owner_sales_user_id
     WHERE l.owner_sales_user_id = p_uid AND l.deleted_at IS NULL
       AND COALESCE(l.status,'new') NOT IN ('won','lost')
       AND v.seen_at < now() - make_interval(hours => s.hours_no_contact)
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a
                        WHERE a.lead_id = l.id AND a.sales_user_id = l.owner_sales_user_id
                          AND public._lead_contact_channel(a.kind));
  ELSIF p_kind = 'stale' THEN
    SELECT count(*) INTO v_n FROM public.leads l
     WHERE l.owner_sales_user_id = p_uid AND l.deleted_at IS NULL
       AND COALESCE(l.status,'new') NOT IN ('won','lost')
       AND l.last_activity_at < now() - make_interval(days => s.days_stale)
       AND EXISTS (SELECT 1 FROM public.lead_activities a
                    WHERE a.lead_id = l.id AND public._lead_contact_channel(a.kind));
  ELSIF p_kind = 'followup_due' THEN
    SELECT count(*) INTO v_n FROM public.leads l
     WHERE l.owner_sales_user_id = p_uid AND l.deleted_at IS NULL
       AND COALESCE(l.status,'new') NOT IN ('won','lost')
       AND l.next_follow_up_at IS NOT NULL
       AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date <= v_today;
  ELSE
    RETURN -1;                      -- 'assigned' has nothing to resolve; it is news
  END IF;
  RETURN v_n;
END $function$;

-- the sweep now asks the same question the fixed way
CREATE OR REPLACE FUNCTION public.cron_lead_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; r record; v_made int := 0; v_today date; v_one uuid; v_title text; v_body text;
BEGIN
  FOR s IN SELECT * FROM public.alert_settings WHERE enabled LOOP
    v_today := (now() AT TIME ZONE 'Asia/Karachi')::date;

    /* given, and genuinely untouched — not merely "the detail screen was never
       opened". She rang them from the list; that is not "not opened". */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n,
             (array_agg(l.id   ORDER BY l.assigned_at))[1] AS lead,
             (array_agg(l.name ORDER BY l.assigned_at))[1] AS nm
        FROM public.leads l
       WHERE l.company_id = s.company_id AND l.deleted_at IS NULL
         AND l.owner_sales_user_id IS NOT NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND l.assigned_at IS NOT NULL
         AND l.assigned_at < now() - make_interval(hours => s.hours_not_opened)
         AND public._lead_untouched(l.id, l.owner_sales_user_id)
       GROUP BY 1
    LOOP
      IF r.n = 1 THEN
        v_title := 'You have not opened this lead yet';
        v_body  := r.nm || ' has been with you for over ' || s.hours_not_opened || ' hours.';
        v_one   := r.lead;
      ELSE
        v_title := r.n || ' leads you have not opened yet';
        v_body  := 'They have been with you for over ' || s.hours_not_opened || ' hours. Start with ' || r.nm || '.';
        v_one   := NULL;
      END IF;
      IF public._alert_raise(s.company_id, r.uid, v_one, 'not_opened', v_title, v_body, r.n,
           'notopen:' || r.uid || ':' || v_today) THEN v_made := v_made + 1; END IF;
    END LOOP;

    /* opened, never rung */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n,
             (array_agg(l.id   ORDER BY v.seen_at))[1] AS lead,
             (array_agg(l.name ORDER BY v.seen_at))[1] AS nm
        FROM public.leads l
        JOIN public.lead_views v ON v.lead_id = l.id AND v.sales_user_id = l.owner_sales_user_id
       WHERE l.company_id = s.company_id AND l.deleted_at IS NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND v.seen_at < now() - make_interval(hours => s.hours_no_contact)
         AND NOT EXISTS (SELECT 1 FROM public.lead_activities a
                          WHERE a.lead_id = l.id AND a.sales_user_id = l.owner_sales_user_id
                            AND public._lead_contact_channel(a.kind))
       GROUP BY 1
    LOOP
      IF r.n = 1 THEN
        v_title := 'You opened this lead but never called';
        v_body  := r.nm || ' — opened over ' || s.hours_no_contact || ' hours ago, no call or message yet.';
        v_one   := r.lead;
      ELSE
        v_title := r.n || ' leads opened but never contacted';
        v_body  := 'You looked at them over ' || s.hours_no_contact || ' hours ago and have not called anybody. Start with ' || r.nm || '.';
        v_one   := NULL;
      END IF;
      IF public._alert_raise(s.company_id, r.uid, v_one, 'no_contact', v_title, v_body, r.n,
           'nocontact:' || r.uid || ':' || v_today) THEN v_made := v_made + 1; END IF;
    END LOOP;

    /* gone quiet — weekly, not daily: a lead quiet for nine days is not news on
       the tenth, and a daily repeat is how people learn to ignore alerts */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n,
             (array_agg(l.id   ORDER BY l.last_activity_at))[1] AS lead,
             (array_agg(l.name ORDER BY l.last_activity_at))[1] AS nm
        FROM public.leads l
       WHERE l.company_id = s.company_id AND l.deleted_at IS NULL
         AND l.owner_sales_user_id IS NOT NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND l.last_activity_at IS NOT NULL
         AND l.last_activity_at < now() - make_interval(days => s.days_stale)
         AND EXISTS (SELECT 1 FROM public.lead_activities a
                      WHERE a.lead_id = l.id AND public._lead_contact_channel(a.kind))
       GROUP BY 1
    LOOP
      IF r.n = 1 THEN
        v_title := 'This lead has gone quiet';
        v_body  := r.nm || ' — nothing recorded for ' || s.days_stale || ' days.';
        v_one   := r.lead;
      ELSE
        v_title := r.n || ' leads have gone quiet';
        v_body  := 'Nothing recorded on them for ' || s.days_stale || ' days or more. ' || r.nm || ' has waited the longest.';
        v_one   := NULL;
      END IF;
      IF public._alert_raise(s.company_id, r.uid, v_one, 'stale', v_title, v_body, r.n,
           'stale:' || r.uid || ':' || to_char(v_today, 'IYYY-IW')) THEN v_made := v_made + 1; END IF;
    END LOOP;

    /* follow-up due — in-app only; cron_followup_reminders already owns the phone */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n,
             (array_agg(l.id   ORDER BY l.next_follow_up_at))[1] AS lead,
             (array_agg(l.name ORDER BY l.next_follow_up_at))[1] AS nm,
             count(*) FILTER (WHERE (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today)::int AS late
        FROM public.leads l
       WHERE l.company_id = s.company_id AND l.deleted_at IS NULL
         AND l.owner_sales_user_id IS NOT NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND l.next_follow_up_at IS NOT NULL
         AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date <= v_today
       GROUP BY 1
    LOOP
      IF r.n = 1 THEN
        v_title := CASE WHEN r.late > 0 THEN 'Follow-up is overdue' ELSE 'Follow-up due today' END;
        v_body  := r.nm || CASE WHEN r.late > 0 THEN ' — the date you set has passed.' ELSE ' — you set today.' END;
        v_one   := r.lead;
      ELSE
        v_title := r.n || ' follow-ups due' || CASE WHEN r.late > 0 THEN ', ' || r.late || ' overdue' ELSE ' today' END;
        v_body  := 'These are dates you set yourself. ' || r.nm || ' is the first one due.';
        v_one   := NULL;
      END IF;
      IF public._alert_raise(s.company_id, r.uid, v_one, 'followup_due', v_title, v_body, r.n,
           'fudue:' || r.uid || ':' || v_today, false) THEN v_made := v_made + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'raised', v_made, 'ran_at', now());
END $function$;


-- ── 3. AN ALERT YOU HAVE DEALT WITH SHOULD SAY SO ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_alerts(p_session_token text, p_limit int DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  RETURN (
    WITH rows AS (
      SELECT a.*, public._alert_live_count(a.sales_user_id, a.kind) AS live
        FROM public.lead_alerts a
       WHERE a.sales_user_id = v_ses.sales_user_id
       ORDER BY a.created_at DESC
       LIMIT GREATEST(LEAST(COALESCE(p_limit,50), 200), 1)
    )
    SELECT jsonb_build_object(
      'success', true,
      'enabled', COALESCE((SELECT enabled FROM public.alert_settings WHERE company_id=v_ses.company_id), false),
      /* An alert they have already dealt with must not keep counting against
         them — that is the badge crying wolf.

         Counted over ALL their alerts, never over the page. The sidebar badge
         calls this with p_limit=1, so a count taken from the limited rows could
         never report more than one, and the badge would quietly under-report
         for ever. */
      'unseen', (SELECT count(*) FROM public.lead_alerts a2
                  WHERE a2.sales_user_id = v_ses.sales_user_id
                    AND a2.seen_at IS NULL
                    AND public._alert_live_count(a2.sales_user_id, a2.kind) <> 0),
      'alerts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'kind', r.kind, 'title', r.title, 'body', r.body,
                 'n', r.n, 'live', r.live, 'done', (r.live = 0),
                 'lead_id', r.lead_id, 'lead', l.name,
                 'at', r.created_at, 'seen', (r.seen_at IS NOT NULL))
               ORDER BY (r.live = 0), r.created_at DESC)
          FROM rows r LEFT JOIN public.leads l ON l.id = r.lead_id), '[]'::jsonb)
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_my_alerts(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_alerts(text, int) TO anon, authenticated;
REVOKE ALL ON FUNCTION public._alert_live_count(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lead_touch_view(uuid, uuid)  FROM PUBLIC, anon, authenticated;


-- ── the same mistake lives in the director's chain ─────────────────────────
-- get_given_leads called it 'not_opened' whenever there was no view row, so the
-- director was being told "they have not even opened it" about a lead the rep
-- had rung twice. opened_at now falls back to the first thing they actually did.
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
             /* a view row if there is one — otherwise the first thing they did,
                because ringing a client is not "never opened it" */
             COALESCE(
               (SELECT v.seen_at FROM public.lead_views v
                 WHERE v.lead_id = g.lead_id AND v.sales_user_id = g.uid),
               (SELECT min(a.created_at) FROM public.lead_activities a
                 WHERE a.lead_id = g.lead_id AND a.sales_user_id = g.uid
                   AND a.kind IN ('call','whatsapp','sms','visit','meeting','note','stage'))
             ) AS opened_at,
             (SELECT min(a.created_at) FROM public.lead_activities a
               WHERE a.lead_id = g.lead_id AND a.sales_user_id = g.uid
                 AND public._lead_contact_channel(a.kind)
                 AND a.created_at >= g.assigned_at) AS contacted_at,
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
                 'stuck_hours', round(EXTRACT(EPOCH FROM (now() - COALESCE(t.last_touch, t.assigned_at))) / 3600)
               ) ORDER BY
                 CASE t.state WHEN 'not_opened' THEN 0 WHEN 'opened_no_contact' THEN 1
                              WHEN 'contacted_no_update' THEN 2 ELSE 3 END,
                 t.assigned_at)
          FROM tagged t
         WHERE p_state IS NULL OR t.state = p_state), '[]'::jsonb),
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
GRANT EXECUTE ON FUNCTION public.get_given_leads(text, date, date, uuid, uuid, text) TO anon, authenticated;
