-- ═══════════════════════════════════════════════════════════════════════════
-- Alerts: the lead tells the person holding it that it needs them
--
-- Asked for: a member should be alerted when a lead is handed to them, when it
-- goes overdue, when it has been sitting untouched too long.
--
-- Two of those already half-existed, and finding out which is the whole design:
--
--   · assign_lead (one lead, one click) DOES notify. assign_leads_bulk does NOT
--     — it writes the assignment, the activity, and nothing else. The director
--     assigns in bulk. That is how 211 leads went out to six people this month
--     without a single alert.
--
--   · cron_followup_reminders has run hourly for months and is good, but its
--     first line is `WHERE next_follow_up_at IS NOT NULL`. A lead that was given
--     and never touched has no follow-up date, so it can never be due, so it is
--     never mentioned — for ever. That is exactly the 56 leads nobody opened.
--     The reminder engine was only ever reminding about leads someone had
--     already engaged with.
--
-- So this adds the alerts that could not exist before, and reuses everything
-- that already works: _crm_send_push (which honours the company switch, the
-- member's own preference, quiet hours and its own dedupe), push_subscriptions,
-- reminder_deliveries.
--
-- Anti-flood, deliberately: an alert is a nudge, not a log. Per member, per
-- kind, per day, at most ONE row — naming the lead when there is one, and
-- counting them when there are several. A member with 31 unopened leads gets a
-- single "31 leads you have not opened yet", not 31 notifications. The screen
-- they land on already lists all of them.
--
-- OFF by default. alert_settings.enabled is false for every company until it is
-- turned on one at a time; ZZTEST is turned on at the end of this file.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.alert_settings (
  company_id        uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT false,
  push              boolean NOT NULL DEFAULT true,
  hours_not_opened  int     NOT NULL DEFAULT 24,   -- given this long ago, still unopened
  hours_no_contact  int     NOT NULL DEFAULT 48,   -- opened this long ago, still not rung
  days_stale        int     NOT NULL DEFAULT 5,    -- nothing recorded on it for this long
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_user_id  uuid NOT NULL REFERENCES public.sales_users(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  title          text NOT NULL,
  body           text,
  n              int  NOT NULL DEFAULT 1,          -- how many leads this one alert stands for
  dedup_key      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  seen_at        timestamptz,
  CONSTRAINT lead_alerts_kind_ck CHECK (kind IN ('assigned','not_opened','no_contact','stale','followup_due')),
  CONSTRAINT lead_alerts_dedup_uk UNIQUE (company_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS lead_alerts_inbox_ix
  ON public.lead_alerts (sales_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_alerts_unseen_ix
  ON public.lead_alerts (sales_user_id) WHERE seen_at IS NULL;

-- The portal reaches these through SECURITY DEFINER functions that check the
-- session token themselves, so the tables stay shut to every direct client.
ALTER TABLE public.alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_alerts    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_settings FROM anon, authenticated;
REVOKE ALL ON public.lead_alerts    FROM anon, authenticated;


-- ── one place that raises an alert ─────────────────────────────────────────
-- Returns true only when a NEW row was written, so callers can count what they
-- actually did rather than what they attempted.
CREATE OR REPLACE FUNCTION public._alert_raise(
  p_company uuid, p_uid uuid, p_lead uuid, p_kind text,
  p_title text, p_body text, p_n int, p_dedup text, p_push boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_push boolean;
BEGIN
  IF p_uid IS NULL OR p_company IS NULL THEN RETURN false; END IF;

  INSERT INTO public.lead_alerts (company_id, sales_user_id, lead_id, kind, title, body, n, dedup_key)
  VALUES (p_company, p_uid, p_lead, p_kind, p_title, p_body, GREATEST(COALESCE(p_n,1),1), p_dedup)
  ON CONFLICT (company_id, dedup_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;          -- already told them today

  SELECT COALESCE(push, true) INTO v_push FROM public.alert_settings WHERE company_id = p_company;
  IF p_push AND COALESCE(v_push, true) THEN
    -- _crm_send_push already honours the company switch, the member's own
    -- preference, quiet hours, and keeps its own dedupe row. Nothing to repeat.
    PERFORM public._crm_send_push(p_company, p_uid, p_title, COALESCE(p_body, p_title),
              'https://rms.nexunova.com/sales-portal.html?tab=alerts', 'alert:' || p_dedup);
  END IF;
  RETURN true;
END $function$;


-- ── the sweep ──────────────────────────────────────────────────────────────
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

    /* ── given, and still not opened ──────────────────────────────────────
       "You have not even opened it." Read from the owner's OWN view row, not
       the caller's — the whole reason this was invisible for so long. */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n, (array_agg(l.id   ORDER BY l.assigned_at))[1] AS lead,
             (array_agg(l.name ORDER BY l.assigned_at))[1] AS nm
        FROM public.leads l
       WHERE l.company_id = s.company_id AND l.deleted_at IS NULL
         AND l.owner_sales_user_id IS NOT NULL
         AND COALESCE(l.status,'new') NOT IN ('won','lost')
         AND l.assigned_at IS NOT NULL
         AND l.assigned_at < now() - make_interval(hours => s.hours_not_opened)
         AND NOT EXISTS (SELECT 1 FROM public.lead_views v
                          WHERE v.lead_id = l.id AND v.sales_user_id = l.owner_sales_user_id)
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

    /* ── opened, never rung ───────────────────────────────────────────────── */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n, (array_agg(l.id   ORDER BY v.seen_at))[1] AS lead,
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

    /* ── gone quiet ───────────────────────────────────────────────────────
       Once a week per member, not once a day: a lead that has been quiet for
       nine days is not news on the tenth, and a daily repeat is how people
       learn to ignore alerts. */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n, (array_agg(l.id   ORDER BY l.last_activity_at))[1] AS lead,
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

    /* ── follow-up due or overdue ─────────────────────────────────────────
       cron_followup_reminders already pushes for these, and has for months.
       Raising the push again here would send the same person the same sentence
       twice, so this writes the in-app row ONLY and lets the older engine keep
       the phone. */
    FOR r IN
      SELECT l.owner_sales_user_id AS uid, count(*)::int AS n, (array_agg(l.id   ORDER BY l.next_follow_up_at))[1] AS lead,
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


-- ── handing leads over stops being silent ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;
        v_block jsonb;                                                    -- PHASE2
        v_from text; v_last uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_company := v_ses.company_id;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');

  SELECT full_name, parent_sales_user_id, role INTO v_tname, v_tparent, v_trole
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  v_block := public._fu_block_state(p_to_id);                             -- PHASE2
  IF COALESCE((v_block->>'blocked')::boolean, false) THEN                 -- PHASE2
    RETURN jsonb_build_object('success',false,'error','assign_blocked','block',v_block,
      'message', v_tname||' has '||(v_block->>'overdue')||' overdue follow-ups. '
                 ||'They must clear these before taking new leads.');
  END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    IF EXISTS (SELECT 1 FROM public.leads l
               JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
              WHERE l.id=v_lead AND ow.role NOT IN ('director','admin','cfo')) THEN
      v_skipped := v_skipped + 1;
    ELSIF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN
      UPDATE public.leads
         SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
             assigned_at=now(), last_activity_at=now(), updated_at=now()
       WHERE id=v_lead;
      INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (v_lead, v_ses.sales_user_id, p_to_id);
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (v_lead, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));
      v_count := v_count + 1;
      v_last := v_lead;
    END IF;
  END LOOP;

  /* Handing work over without telling anybody is how 211 leads reached six
     people in silence. One alert per batch, not one per lead — forty-five
     notifications in a row is not information, it is noise. */
  IF v_count > 0 THEN
    SELECT full_name INTO v_from FROM public.sales_users WHERE id = v_ses.sales_user_id;
    PERFORM public._alert_raise(v_company, p_to_id,
      CASE WHEN v_count = 1 THEN v_last END, 'assigned',
      CASE WHEN v_count = 1 THEN 'A new lead is yours'
           ELSE v_count || ' new leads are yours' END,
      COALESCE(v_from, 'Your manager') || ' just assigned ' ||
      CASE WHEN v_count = 1 THEN 'a lead' ELSE v_count || ' leads' END || ' to you.',
      v_count,
      'assigned:' || p_to_id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  END IF;

  RETURN jsonb_build_object('success',true,'assigned',v_count,'skipped',v_skipped,
    'message', CASE WHEN v_skipped>0 THEN v_skipped||' already with a team member — pull them back first.' ELSE NULL END,
    'to_name',v_tname,'to_id',p_to_id);
END $function$;


-- ── what a member reads ────────────────────────────────────────────────────
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
    SELECT jsonb_build_object(
      'success', true,
      'enabled', COALESCE((SELECT enabled FROM public.alert_settings WHERE company_id=v_ses.company_id), false),
      'unseen', (SELECT count(*) FROM public.lead_alerts
                  WHERE sales_user_id=v_ses.sales_user_id AND seen_at IS NULL),
      'alerts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
                 'n', a.n, 'lead_id', a.lead_id, 'lead', l.name,
                 'at', a.created_at, 'seen', (a.seen_at IS NOT NULL))
               ORDER BY a.created_at DESC)
          FROM (SELECT * FROM public.lead_alerts
                 WHERE sales_user_id=v_ses.sales_user_id
                 ORDER BY created_at DESC
                 LIMIT GREATEST(LEAST(COALESCE(p_limit,50), 200), 1)) a
          LEFT JOIN public.leads l ON l.id = a.lead_id), '[]'::jsonb)
    )
  );
END $function$;

CREATE OR REPLACE FUNCTION public.mark_alerts_seen(p_session_token text, p_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  UPDATE public.lead_alerts SET seen_at = now()
   WHERE sales_user_id = v_ses.sales_user_id AND seen_at IS NULL
     AND (p_id IS NULL OR id = p_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', v_n);
END $function$;

-- the portal is an anon client identified by its session token (see 20260818b)
REVOKE ALL ON FUNCTION public.get_my_alerts(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_alerts_seen(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_alerts(text, int)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_alerts_seen(text, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_lead_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._alert_raise(uuid, uuid, uuid, text, text, text, int, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- ── on for the scratch tenant only; every real company stays off until asked ──
INSERT INTO public.alert_settings (company_id, enabled)
VALUES ('a2915ce7-c01c-463b-ba50-b144b2240337', true)
ON CONFLICT (company_id) DO UPDATE SET enabled = true, updated_at = now();

COMMENT ON TABLE public.lead_alerts IS
  'One nudge per member per kind per day. Raised by cron_lead_alerts and by assign_leads_bulk; read by get_my_alerts.';
COMMENT ON TABLE public.alert_settings IS
  'Per-company switch for the alert engine. OFF by default — turn a company on deliberately, one at a time.';

-- ── hourly, offset from the other jobs so they do not all land together ─────
SELECT cron.schedule('lead-alerts', '40 * * * *',
                     $$SET search_path=public; SELECT public.cron_lead_alerts();$$);
