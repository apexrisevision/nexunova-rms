-- Phase 2 — Member accountability, part 3 of 3: GUARDS AND READS.
--
-- Six existing RPCs are replaced here. Every one was dumped verbatim first to
--   migration_work/provenance/phase2_followup_rpcs_before_20260813.sql
-- The bodies below are those originals with surgical additions, nothing else
-- rewritten. Each addition is marked -- PHASE2.
--
-- All additions are no-ops while company_followup_policy.is_enabled is false,
-- which it is for every tenant at the time of writing.

BEGIN;

-- ---------------------------------------------------------------------------
-- assign_lead — refuse to hand a lead to a blocked member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_tparent uuid; v_companywide boolean; v_lname text; v_trole text;
        v_block jsonb;                                                    -- PHASE2
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT owner_sales_user_id, company_id, name INTO v_owner, v_company, v_lname FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  IF EXISTS (SELECT 1 FROM public.sales_users su2
              WHERE su2.id = v_owner AND su2.role NOT IN ('director','admin','cfo')) THEN
    RETURN jsonb_build_object('success',false,'error','already_assigned',
      'message','This lead is already with a team member. Pull it back first, then hand it over.');
  END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  IF v_companywide AND v_company <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT v_companywide AND v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

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

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  PERFORM public._crm_send_push(v_company, p_to_id, 'New lead assigned',
    COALESCE(v_lname,'A new lead')||' was assigned to you.',
    'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id,
    'push:assigned:'||p_lead_id||':'||p_to_id);

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;

-- ---------------------------------------------------------------------------
-- assign_leads_bulk — same guard, once, before the loop
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;
        v_block jsonb;                                                    -- PHASE2
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'assigned',v_count,'skipped',v_skipped,
    'message', CASE WHEN v_skipped>0 THEN v_skipped||' already with a team member — pull them back first.' ELSE NULL END,
    'to_name',v_tname,'to_id',p_to_id);
END $function$;

-- ---------------------------------------------------------------------------
-- mark_lead_seen — opening a lead now creates a disposition obligation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_lead_seen(p_session_token text, p_lead_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_ok boolean; v_owner uuid; v_pend boolean := false;  -- PHASE2
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

  -- PHASE2: only the OWNER carries the obligation, and only while the engine is on.
  SELECT owner_sales_user_id INTO v_owner FROM public.leads WHERE id = p_lead_id;
  v_pend := (v_owner = v_ses.sales_user_id) AND public._fu_member_in_scope(v_ses.sales_user_id);

  INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at, disposition_pending_since)
  VALUES (p_lead_id, v_ses.sales_user_id, now(), CASE WHEN v_pend THEN now() END)
  ON CONFLICT (lead_id, sales_user_id) DO UPDATE
    SET disposition_pending_since = CASE
          WHEN v_pend AND public.lead_views.disposition_pending_since IS NULL THEN now()
          ELSE public.lead_views.disposition_pending_since END;

  RETURN jsonb_build_object('success',true,'disposition_required',v_pend);   -- PHASE2
END $function$;

-- ---------------------------------------------------------------------------
-- get_lead — expose lock, overdue and whether a disposition is owed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_lead jsonb; v_acts jsonb;
        v_role text; v_companywide boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', COALESCE(dl.stage, l.status), 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'next_follow_up_at', l.next_follow_up_at,
    'owner_name', ow.full_name, 'is_mine', (l.owner_sales_user_id=v_uid),
    'assigned_from', ab.full_name,
    'created_by_name', cb.full_name,
    'first_contact_at', (SELECT min(a2.created_at) FROM public.lead_activities a2 WHERE a2.lead_id=l.id AND a2.kind IN ('call','whatsapp','visit','meeting')),
    'contact_count', (SELECT count(*) FROM public.lead_activities a3 WHERE a3.lead_id=l.id AND a3.kind IN ('call','whatsapp','visit','meeting')),
    -- PHASE2 accountability block
    'is_locked', (l.followup_locked_at IS NOT NULL),
    'locked_at', l.followup_locked_at,
    'is_overdue', (l.next_follow_up_at IS NOT NULL
                   AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < public._fu_today()
                   AND COALESCE(dl.stage, l.status) NOT IN ('won','lost')),
    'missed_count', l.missed_followup_count,
    'last_disposition_at', l.last_disposition_at,
    'disposition_required', (lv.disposition_pending_since IS NOT NULL
                             AND l.owner_sales_user_id = v_uid
                             AND public._fu_member_in_scope(v_uid)),
    'booking', (
      SELECT jsonb_build_object(
        'reservation_id', r.id, 'unit_no', u2.unit_no, 'reservation_status', r.status,
        'submission_status', sub2.status, 'sale_id', sub2.created_sale_id,
        'sale_number', sl.sale_number, 'sale_status', sl.status)
      FROM public.reservations r
      LEFT JOIN public.units u2 ON u2.id=r.unit_id
      LEFT JOIN LATERAL (SELECT ss.* FROM public.sale_submissions ss WHERE ss.reservation_id=r.id ORDER BY ss.created_at DESC LIMIT 1) sub2 ON true
      LEFT JOIN public.sales sl ON sl.id=sub2.created_sale_id
      WHERE r.id=l.converted_reservation_id
    ),
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) INTO v_lead
  FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
  LEFT JOIN public.deals dl ON dl.lead_id=l.id
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  LEFT JOIN public.sales_users ab ON ab.id=l.assigned_by_sales_user_id
  LEFT JOIN public.sales_users cb ON cb.id=l.created_by_sales_user_id
  LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid   -- PHASE2
  WHERE l.id=p_id
    AND ( (v_companywide AND l.company_id=v_ses.company_id)
          OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) );
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'body', a.body, 'created_at', a.created_at
  ) ORDER BY a.created_at ASC), '[]'::jsonb) INTO v_acts
  FROM public.lead_activities a WHERE a.lead_id=p_id;
  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts,
    'block', public._fu_block_state(v_uid));                                    -- PHASE2
END $function$;

-- ---------------------------------------------------------------------------
-- list_my_leads — a locked lead must look locked in the list too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int; v_today date := public._fu_today();
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  myleads AS (
    SELECT l.*, (lv.lead_id IS NOT NULL) AS checked, public._su_label(l.owner_sales_user_id) AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name, d.stage AS deal_stage                       -- PHASE2
    FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    LEFT JOIN public.units u ON u.id=l.unit_id
    LEFT JOIN public.projects p ON p.id=l.project_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    LEFT JOIN public.deals d ON d.lead_id=l.id                                    -- PHASE2
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.budget,
      'status', m.status, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_sales_user_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_sales_user_id=v_uid), 'created_by_me', (m.created_by_sales_user_id = v_uid),
      'checked', m.checked,
      'next_follow_up_at', m.next_follow_up_at,
      'is_locked', (m.followup_locked_at IS NOT NULL),                            -- PHASE2
      'is_overdue', (m.next_follow_up_at IS NOT NULL                              -- PHASE2
                     AND (m.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
                     AND COALESCE(m.deal_stage, m.status) NOT IN ('won','lost')),
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_status IS NULL OR m.status=p_status)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost') AND m.owner_sales_user_id = v_uid)
    INTO v_rows, v_unchecked
  FROM myleads m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),
    'unchecked',COALESCE(v_unchecked,0),
    'block', public._fu_block_state(v_uid));                                      -- PHASE2
END $function$;

-- ---------------------------------------------------------------------------
-- get_director_board — the red flag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_director_board(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_role text;
        v_members jsonb; v_projects jsonb; v_tot jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role NOT IN ('director','admin','cfo','marketing_manager') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'leads')::int DESC, x->>'tag'), '[]'::jsonb) INTO v_projects FROM (
    SELECT jsonb_build_object('id', pr.id, 'name', pr.project_name,
             'tag', COALESCE(pr.short_code, pr.project_name),
             'leads', (SELECT count(*) FROM public.leads l2
                        JOIN public.sales_users o2 ON o2.id=l2.owner_sales_user_id
                       WHERE l2.company_id=v_co AND l2.deleted_at IS NULL
                         AND o2.parent_sales_user_id=v_uid AND l2.project_id=pr.id)) AS x
      FROM public.projects pr
     WHERE pr.id IN (
        SELECT l.project_id FROM public.leads l
          JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
         WHERE l.company_id=v_co AND l.deleted_at IS NULL AND ow.parent_sales_user_id=v_uid
           AND l.project_id IS NOT NULL
        UNION
        SELECT su.home_project_id FROM public.sales_users su
         WHERE su.company_id=v_co AND su.status='active' AND su.parent_sales_user_id=v_uid
           AND su.home_project_id IS NOT NULL)) t;

  WITH mem AS (
    SELECT su.* FROM public.sales_users su
     WHERE su.company_id = v_co AND su.status='active'
       AND su.parent_sales_user_id = v_uid
       AND su.role <> 'lead_entry'
       AND ( p_project_id IS NULL
             OR su.home_project_id = p_project_id
             OR EXISTS (SELECT 1 FROM public.leads l3
                         WHERE l3.owner_sales_user_id = su.id
                           AND l3.deleted_at IS NULL
                           AND l3.project_id = p_project_id) )
  ),
  ld AS (
    SELECT l.*, d.stage
      FROM public.leads l
      LEFT JOIN public.deals d ON d.lead_id = l.id
     WHERE l.company_id = v_co AND l.deleted_at IS NULL
       AND (p_project_id IS NULL OR l.project_id = p_project_id)
  ),
  agg AS (
    SELECT m.id, m.full_name, m.role, m.phone, m.home_project_id,
      (SELECT COALESCE(pp.short_code, pp.project_name) FROM public.projects pp WHERE pp.id=m.home_project_id) AS project_tag,
      (p_project_id IS NULL OR m.home_project_id = p_project_id) AS belongs,
      (SELECT count(DISTINCT la.lead_id) FROM public.lead_assignments la
        WHERE la.to_sales_user_id = m.id AND la.from_sales_user_id = v_uid) AS given_by_me,
      m.overdue_lead_count                                                 AS overdue_counter,   -- PHASE2
      (m.assign_blocked_since IS NOT NULL)                                 AS assign_blocked,    -- PHASE2
      m.assign_blocked_since                                               AS blocked_since,     -- PHASE2
      count(*) FILTER (WHERE l.followup_locked_at IS NOT NULL)             AS locked,            -- PHASE2
      count(l.id)                                                          AS leads,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='new')             AS s_new,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='contacted')       AS s_contacted,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='visit')           AS s_visit,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='negotiation')     AS s_negotiation,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='won')             AS matured,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status)='lost')            AS lost,
      count(*) FILTER (WHERE COALESCE(l.stage,l.status) NOT IN ('won','lost')) AS pending,
      count(*) FILTER (WHERE l.id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.lead_views v WHERE v.lead_id=l.id AND v.sales_user_id=m.id)) AS not_opened,
      count(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now()
                         AND COALESCE(l.stage,l.status) NOT IN ('won','lost'))              AS overdue,
      max(l.last_activity_at)                                              AS last_touch,
      (SELECT count(*) FROM public.lead_activities a
        WHERE a.sales_user_id=m.id AND a.created_at >= date_trunc('day', now())
          AND a.kind IN ('call','whatsapp','visit','meeting'))             AS touches_today
    FROM mem m LEFT JOIN ld l ON l.owner_sales_user_id = m.id
    GROUP BY m.id, m.full_name, m.role, m.phone, m.home_project_id,
             m.overdue_lead_count, m.assign_blocked_since
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.full_name, 'role', a.role, 'phone', a.phone,
      'project_tag', a.project_tag, 'home_project_id', a.home_project_id, 'belongs', a.belongs,
      'given_by_me', a.given_by_me,
      'leads', a.leads, 'pending', a.pending, 'matured', a.matured, 'lost', a.lost,
      'stages', jsonb_build_object('new',a.s_new,'contacted',a.s_contacted,'visit',a.s_visit,
                                   'negotiation',a.s_negotiation,'won',a.matured,'lost',a.lost),
      'not_opened', a.not_opened, 'overdue', a.overdue,
      'overdue_counter', a.overdue_counter,                                -- PHASE2
      'assign_blocked', a.assign_blocked,                                  -- PHASE2
      'blocked_since', a.blocked_since,                                    -- PHASE2
      'locked', a.locked,                                                  -- PHASE2
      'touches_today', a.touches_today, 'last_touch', a.last_touch,
      'conversion', CASE WHEN a.leads>0 THEN round(a.matured::numeric*100/a.leads,1) ELSE 0 END
    ) ORDER BY a.assign_blocked DESC, a.belongs DESC, a.full_name), '[]'::jsonb) INTO v_members FROM agg a;

  SELECT jsonb_build_object(
      'members',    jsonb_array_length(v_members),
      'leads',      COALESCE(SUM((m->>'leads')::int),0),
      'pending',    COALESCE(SUM((m->>'pending')::int),0),
      'matured',    COALESCE(SUM((m->>'matured')::int),0),
      'not_opened', COALESCE(SUM((m->>'not_opened')::int),0),
      'overdue',    COALESCE(SUM((m->>'overdue')::int),0),
      'locked',     COALESCE(SUM((m->>'locked')::int),0),                            -- PHASE2
      'blocked',    COALESCE(SUM(CASE WHEN (m->>'assign_blocked')::boolean THEN 1 ELSE 0 END),0), -- PHASE2
      'outsiders',  COALESCE(SUM(CASE WHEN (m->>'belongs')::boolean THEN 0 ELSE 1 END),0))
    INTO v_tot FROM jsonb_array_elements(v_members) m;

  RETURN jsonb_build_object('success',true,'project_id',p_project_id,
    'projects',v_projects,'members',v_members,'totals',COALESCE(v_tot,'{}'::jsonb));
END; $function$;

COMMIT;
