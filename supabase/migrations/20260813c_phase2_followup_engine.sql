-- Phase 2 — Member accountability, part 2 of 3: THE ENGINE.
--
-- Depends on 20260813b_phase2_followup_schema.sql.
-- Every RPC replaced here was dumped first to
--   migration_work/provenance/phase2_followup_rpcs_before_20260813.sql
--
-- Single-source rule honoured throughout: the deal is authoritative for the stage.
-- submit_lead_disposition never writes leads.status itself — it calls move_deal_stage
-- and lets the existing mirror trigger update the lead.
--
-- Business dates are Pakistan dates. The database runs UTC, so between 00:00 and
-- 05:00 UTC current_date is still yesterday in Karachi; using it would mis-count
-- overdue every single night.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Schema touch-up: member-level events have no lead
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_followup_events ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.lead_followup_events DROP CONSTRAINT IF EXISTS lead_followup_events_lead_required_chk;
ALTER TABLE public.lead_followup_events ADD CONSTRAINT lead_followup_events_lead_required_chk
  CHECK (lead_id IS NOT NULL OR event IN ('assign_blocked','assign_unblocked'));

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fu_today()
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date $$;

COMMENT ON FUNCTION public._fu_today() IS
  'The business date in Pakistan. Never use current_date for follow-up logic — the DB is UTC.';

-- Is this member outside the engine? Exempt role, inactive, or policy off.
CREATE OR REPLACE FUNCTION public._fu_member_in_scope(p_sales_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE su public.sales_users; pol public.company_followup_policy;
BEGIN
  SELECT * INTO su FROM public.sales_users WHERE id = p_sales_user_id;
  IF NOT FOUND OR su.status <> 'active' THEN RETURN false; END IF;
  SELECT * INTO pol FROM public.company_followup_policy WHERE company_id = su.company_id;
  IF NOT FOUND OR NOT pol.is_enabled THEN RETURN false; END IF;
  RETURN NOT (su.role = ANY (ARRAY(SELECT jsonb_array_elements_text(pol.exempt_roles))));
END $$;

-- The one definition of "overdue", used by the sweep, the counter and the UI.
CREATE OR REPLACE FUNCTION public._fu_overdue_count(p_sales_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT count(*)::int
    FROM public.leads l
    LEFT JOIN public.deals d ON d.lead_id = l.id
   WHERE l.owner_sales_user_id = p_sales_user_id
     AND l.deleted_at IS NULL
     AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
     AND l.next_follow_up_at IS NOT NULL
     AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < public._fu_today()
$$;

-- Public read of a member's block state — the assign RPCs and the UI both use this.
CREATE OR REPLACE FUNCTION public._fu_block_state(p_sales_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE su public.sales_users; pol public.company_followup_policy; v_n int;
BEGIN
  SELECT * INTO su FROM public.sales_users WHERE id = p_sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('blocked',false,'overdue',0,'limit',null); END IF;
  SELECT * INTO pol FROM public.company_followup_policy WHERE company_id = su.company_id;
  IF NOT FOUND OR NOT pol.is_enabled OR NOT public._fu_member_in_scope(p_sales_user_id) THEN
    RETURN jsonb_build_object('blocked',false,'overdue',0,'limit',null,'enforced',false);
  END IF;
  v_n := public._fu_overdue_count(p_sales_user_id);
  RETURN jsonb_build_object(
    'blocked', v_n > pol.max_overdue_before_block,
    'overdue', v_n,
    'limit',   pol.max_overdue_before_block,
    'enforced',true);
END $$;

-- Recompute one member's counter and block flag, writing an event on each flip.
CREATE OR REPLACE FUNCTION public._fu_recount_member(p_sales_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE su public.sales_users; pol public.company_followup_policy; v_n int; v_should boolean;
BEGIN
  SELECT * INTO su FROM public.sales_users WHERE id = p_sales_user_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF NOT public._fu_member_in_scope(p_sales_user_id) THEN
    -- Out of scope: leave no stale state behind.
    UPDATE public.sales_users SET overdue_lead_count = 0, assign_blocked_since = NULL
     WHERE id = p_sales_user_id AND (overdue_lead_count <> 0 OR assign_blocked_since IS NOT NULL);
    RETURN 0;
  END IF;

  SELECT * INTO pol FROM public.company_followup_policy WHERE company_id = su.company_id;
  v_n      := public._fu_overdue_count(p_sales_user_id);
  v_should := v_n > pol.max_overdue_before_block;

  UPDATE public.sales_users SET overdue_lead_count = v_n WHERE id = p_sales_user_id;

  IF v_should AND su.assign_blocked_since IS NULL THEN
    UPDATE public.sales_users SET assign_blocked_since = now() WHERE id = p_sales_user_id;
    INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event, comment, actor_kind)
    VALUES (su.company_id, NULL, p_sales_user_id, 'assign_blocked',
            v_n||' overdue follow-ups (limit '||pol.max_overdue_before_block||')', 'system');
  ELSIF NOT v_should AND su.assign_blocked_since IS NOT NULL THEN
    UPDATE public.sales_users SET assign_blocked_since = NULL WHERE id = p_sales_user_id;
    INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event, comment, actor_kind)
    VALUES (su.company_id, NULL, p_sales_user_id, 'assign_unblocked',
            'cleared down to '||v_n||' overdue', 'system');
  END IF;

  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 2. submit_lead_disposition — the forced modal's save
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_lead_disposition(
  p_session_token     text,
  p_lead_id           uuid,
  p_status            text,
  p_comment           text,
  p_next_follow_up_at timestamptz DEFAULT NULL,
  p_channel           text        DEFAULT 'note')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_lead public.leads; v_stage_before text;
        v_res jsonb; v_comment text; v_next date; v_closing boolean; v_uid uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_uid := v_ses.sales_user_id;
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;

  IF p_channel NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_channel'); END IF;

  v_comment := NULLIF(TRIM(COALESCE(p_comment,'')),'');
  IF v_comment IS NULL OR length(v_comment) < 3 THEN
    RETURN jsonb_build_object('success',false,'error','comment_required',
      'message','Write what happened — at least a few words.'); END IF;

  IF p_status IS NULL OR p_status NOT IN ('new','contacted','visit','negotiation','won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status',
      'message','Pick where this lead now stands.'); END IF;

  v_closing := p_status IN ('won','lost');

  IF NOT v_closing THEN
    IF p_next_follow_up_at IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','followup_required',
        'message','Set the next follow-up date before you close this.'); END IF;
    v_next := (p_next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date;
    IF v_next < public._fu_today() THEN
      RETURN jsonb_build_object('success',false,'error','followup_in_past',
        'message','The next follow-up cannot be in the past.'); END IF;
  END IF;

  -- Stage first, through the single source of truth. The mirror trigger updates the lead.
  SELECT COALESCE(d.stage, v_lead.status) INTO v_stage_before FROM public.deals d WHERE d.lead_id = p_lead_id;
  IF v_stage_before IS DISTINCT FROM p_status THEN
    v_res := public.move_deal_stage(p_session_token, p_lead_id, p_status);
    IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  END IF;

  -- The member's own note stays in the human trail.
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_uid, p_channel, v_comment);

  -- Accountability state clears on a real disposition. missed_followup_count never resets.
  UPDATE public.leads
     SET next_follow_up_at  = CASE WHEN v_closing THEN NULL ELSE p_next_follow_up_at END,
         last_disposition_at = now(),
         overdue_since       = NULL,
         followup_locked_at  = NULL,
         followup_notified_for = NULL,
         last_activity_at    = now(),
         updated_at          = now()
   WHERE id = p_lead_id;

  UPDATE public.lead_views SET disposition_pending_since = NULL
   WHERE lead_id = p_lead_id AND sales_user_id = v_uid;

  INSERT INTO public.lead_followup_events (
    company_id, lead_id, sales_user_id, event, status_before, status_after,
    comment, follow_up_before, follow_up_after, actor_kind)
  VALUES (v_lead.company_id, p_lead_id, v_uid, 'disposition', v_stage_before, p_status,
          v_comment, v_lead.next_follow_up_at,
          CASE WHEN v_closing THEN NULL ELSE p_next_follow_up_at END, 'member');

  PERFORM public._fu_recount_member(v_lead.owner_sales_user_id);

  RETURN jsonb_build_object('success',true,'closed',v_closing,
    'block', public._fu_block_state(v_lead.owner_sales_user_id));
END $$;

COMMENT ON FUNCTION public.submit_lead_disposition(text,uuid,text,text,timestamptz,text) IS
  'Phase 2 forced follow-up. Status + comment + next date in one atomic call. Stage goes '
  'through move_deal_stage so the deal stays the single source of truth.';

-- ---------------------------------------------------------------------------
-- 3. cron_followup_sweep — marks, locks, counts, blocks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_followup_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE pol public.company_followup_policy; m record;
        v_today date := public._fu_today();
        v_sunday boolean := extract(dow FROM public._fu_today()) = 0;
        v_exempt text[]; v_missed int := 0; v_locked int := 0; v_cleared int := 0; v_members int := 0;
        v_tmp int;
BEGIN
  FOR pol IN SELECT * FROM public.company_followup_policy WHERE is_enabled LOOP
    v_exempt := ARRAY(SELECT jsonb_array_elements_text(pol.exempt_roles));

    IF NOT (pol.skip_sundays AND v_sunday) THEN
      -- A. newly overdue → count the miss exactly once per cycle
      WITH ov AS (
        SELECT l.id, l.company_id, l.owner_sales_user_id, l.next_follow_up_at,
               COALESCE(d.stage, l.status) AS stage
          FROM public.leads l
          JOIN public.sales_users su ON su.id = l.owner_sales_user_id AND su.status = 'active'
          LEFT JOIN public.deals d ON d.lead_id = l.id
         WHERE l.company_id = pol.company_id
           AND l.deleted_at IS NULL
           AND l.overdue_since IS NULL
           AND l.next_follow_up_at IS NOT NULL
           AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
           AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
           AND NOT (su.role = ANY (v_exempt))
      ), upd AS (
        UPDATE public.leads l
           SET overdue_since = v_today,
               missed_followup_count = l.missed_followup_count + 1,
               updated_at = now()
          FROM ov WHERE l.id = ov.id
        RETURNING l.id, l.company_id, l.owner_sales_user_id, ov.stage, ov.next_follow_up_at
      )
      INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event,
                                               status_before, follow_up_before, comment, actor_kind)
      SELECT company_id, id, owner_sales_user_id, 'missed', stage, next_follow_up_at,
             'follow-up date passed', 'system' FROM upd;
      GET DIAGNOSTICS v_tmp = ROW_COUNT; v_missed := v_missed + v_tmp;

      -- B. overdue long enough → soft-lock
      WITH lk AS (
        SELECT l.id, l.company_id, l.owner_sales_user_id, l.next_follow_up_at
          FROM public.leads l
          JOIN public.sales_users su ON su.id = l.owner_sales_user_id AND su.status = 'active'
          LEFT JOIN public.deals d ON d.lead_id = l.id
         WHERE l.company_id = pol.company_id
           AND l.deleted_at IS NULL
           AND l.followup_locked_at IS NULL
           AND l.next_follow_up_at IS NOT NULL
           AND (v_today - (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date) >= pol.lock_after_days
           AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
           AND NOT (su.role = ANY (v_exempt))
      ), upd2 AS (
        UPDATE public.leads l SET followup_locked_at = now(), updated_at = now()
          FROM lk WHERE l.id = lk.id
        RETURNING l.id, l.company_id, l.owner_sales_user_id, lk.next_follow_up_at
      )
      INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event,
                                               follow_up_before, comment, actor_kind)
      SELECT company_id, id, owner_sales_user_id, 'locked', next_follow_up_at,
             'locked after '||pol.lock_after_days||' day(s) overdue', 'system' FROM upd2;
      GET DIAGNOSTICS v_tmp = ROW_COUNT; v_locked := v_locked + v_tmp;
    END IF;

    -- C. no longer overdue but state left behind (stage closed elsewhere, date moved, etc.)
    WITH cl AS (
      SELECT l.id, l.company_id, l.owner_sales_user_id, (l.followup_locked_at IS NOT NULL) AS was_locked
        FROM public.leads l
        LEFT JOIN public.deals d ON d.lead_id = l.id
       WHERE l.company_id = pol.company_id
         AND (l.overdue_since IS NOT NULL OR l.followup_locked_at IS NOT NULL)
         AND ( l.deleted_at IS NOT NULL
               OR COALESCE(d.stage, l.status) IN ('won','lost')
               OR l.next_follow_up_at IS NULL
               OR (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date >= v_today )
    ), upd3 AS (
      UPDATE public.leads l SET overdue_since = NULL, followup_locked_at = NULL, updated_at = now()
        FROM cl WHERE l.id = cl.id
      RETURNING l.id, l.company_id, l.owner_sales_user_id, cl.was_locked
    )
    INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event, comment, actor_kind)
    SELECT company_id, id, owner_sales_user_id, 'unlocked', 'no longer overdue', 'system'
      FROM upd3 WHERE was_locked;
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_cleared := v_cleared + v_tmp;

    -- D. recount every member in scope
    FOR m IN SELECT id FROM public.sales_users
              WHERE company_id = pol.company_id AND status = 'active'
                AND NOT (role = ANY (v_exempt)) LOOP
      PERFORM public._fu_recount_member(m.id);
      v_members := v_members + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success',true,'date',v_today,'sunday',v_sunday,
    'missed',v_missed,'locked',v_locked,'cleared',v_cleared,'members',v_members);
END $$;

COMMENT ON FUNCTION public.cron_followup_sweep() IS
  'Hourly. Marks newly-overdue leads (once per cycle), soft-locks them after '
  'policy.lock_after_days, clears stale state, and recomputes every member''s counter '
  'and assign block. Inert for tenants whose policy is off.';

-- ---------------------------------------------------------------------------
-- 4. cron_followup_morning_list — "aaj ki follow-up list"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_followup_morning_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE pol public.company_followup_policy; m record;
        v_today date := public._fu_today(); v_hour int; v_sent int := 0; v_exempt text[];
        v_title text; v_body text; v_url text := 'https://rms.nexunova.com/sales-portal.html#followups';
BEGIN
  v_hour := extract(hour FROM (now() AT TIME ZONE 'Asia/Karachi'))::int;

  FOR pol IN SELECT * FROM public.company_followup_policy WHERE is_enabled LOOP
    CONTINUE WHEN v_hour <> pol.morning_list_hour_pkt;
    v_exempt := ARRAY(SELECT jsonb_array_elements_text(pol.exempt_roles));

    FOR m IN
      SELECT su.id, su.full_name,
             count(*) FILTER (WHERE (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date = v_today) AS due_today,
             count(*) FILTER (WHERE (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today) AS overdue
        FROM public.sales_users su
        JOIN public.leads l ON l.owner_sales_user_id = su.id AND l.deleted_at IS NULL
        LEFT JOIN public.deals d ON d.lead_id = l.id
       WHERE su.company_id = pol.company_id AND su.status = 'active'
         AND NOT (su.role = ANY (v_exempt))
         AND l.next_follow_up_at IS NOT NULL
         AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
         AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date <= v_today
       GROUP BY su.id, su.full_name
    LOOP
      v_title := 'Today: '||m.due_today||' follow-up'||CASE WHEN m.due_today = 1 THEN '' ELSE 's' END;
      v_body  := CASE WHEN m.overdue > 0
                      THEN m.due_today||' due today and '||m.overdue||' overdue. Clear the overdue ones first.'
                      ELSE m.due_today||' to call today.' END;
      PERFORM public._crm_send_push(pol.company_id, m.id, v_title, v_body, v_url,
                                    'push:fulist:'||m.id||':'||v_today);
      PERFORM public._crm_send_whatsapp(pol.company_id, m.id, v_title||' — '||v_body||' '||v_url,
                                    'wa:fulist:'||m.id||':'||v_today);
      v_sent := v_sent + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success',true,'date',v_today,'hour_pkt',v_hour,'sent',v_sent);
END $$;

COMMIT;
