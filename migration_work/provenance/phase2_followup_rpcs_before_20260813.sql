-- LIVE definitions dumped 2026-08-13, BEFORE any Phase 2 change.
-- These RPCs do not live in the repo. Restore from here if a replace goes wrong.

-- ============ _lead_can_act(p_session_token text, p_lead_id uuid)
CREATE OR REPLACE FUNCTION public._lead_can_act(p_session_token text, p_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_owner uuid; v_co uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT owner_sales_user_id, company_id INTO v_owner, v_co FROM public.leads WHERE id=p_lead_id AND deleted_at IS NULL;
  IF v_owner IS NULL THEN RETURN false; END IF;
  IF v_role IN ('director','admin','cfo') THEN RETURN v_co = v_ses.company_id; END IF;
  RETURN v_owner = v_ses.sales_user_id;
END
$function$
;

-- ============ add_lead_activity(p_session_token text, p_lead_id uuid, p_kind text, p_body text, p_follow_up_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.add_lead_activity(p_session_token text, p_lead_id uuid, p_kind text, p_body text DEFAULT NULL::text, p_follow_up_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_kind NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_kind'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, p_kind, NULLIF(TRIM(COALESCE(p_body,'')),''));
  UPDATE public.leads SET last_activity_at=now(), next_follow_up_at = COALESCE(p_follow_up_at, next_follow_up_at), updated_at=now()
   WHERE id=p_lead_id;
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_tparent uuid; v_companywide boolean; v_lname text; v_trole text;
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
  IF v_trole = 'lead_entry' THEN                                   -- ← F1
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  -- push the new owner (dedupe per lead+owner; quiet hours respected inside)
  PERFORM public._crm_send_push(v_company, p_to_id, 'New lead assigned',
    COALESCE(v_lname,'A new lead')||' was assigned to you.',
    'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id,
    'push:assigned:'||p_lead_id||':'||p_to_id);

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$
;

-- ============ assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;
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
  IF v_trole = 'lead_entry' THEN                                   -- ← F1
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    IF EXISTS (SELECT 1 FROM public.leads l
               JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
              WHERE l.id=v_lead AND ow.role NOT IN ('director','admin','cfo')) THEN
      v_skipped := v_skipped + 1;                 -- already with a team member: leave it alone
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
END
$function$
;

-- ============ bulk_lead_action(p_session_token text, p_lead_ids uuid[], p_action text, p_when timestamp with time zone, p_reason text)
CREATE OR REPLACE FUNCTION public.bulk_lead_action(p_session_token text, p_lead_ids uuid[], p_action text, p_when timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_lead uuid; v_n int := 0; v_skipped int := 0;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_action NOT IN ('seen','followup','lost') THEN RETURN jsonb_build_object('success',false,'error','invalid_action'); END IF;
  IF p_action='followup' AND p_when IS NULL THEN RETURN jsonb_build_object('success',false,'error','date_required'); END IF;
  IF p_action='lost' AND NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','reason_required','message','Add a reason before marking leads lost.'); END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',true,'done',0); END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    IF NOT public._lead_can_act(p_session_token, v_lead) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    IF p_action='seen' THEN
      INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at)
      VALUES (v_lead, v_ses.sales_user_id, now())
      ON CONFLICT (lead_id, sales_user_id) DO NOTHING;

    ELSIF p_action='followup' THEN
      UPDATE public.leads SET next_follow_up_at=p_when, updated_at=now() WHERE id=v_lead;

    ELSE  -- lost: the deal is authoritative for the stage, mirror trigger updates the lead
      UPDATE public.deals SET stage='lost', lost_reason=TRIM(p_reason), last_activity_at=now(), updated_at=now()
       WHERE lead_id=v_lead AND stage NOT IN ('won','lost');
      UPDATE public.leads SET lost_reason=TRIM(p_reason), last_activity_at=now(), updated_at=now() WHERE id=v_lead;
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
      VALUES (v_lead, v_ses.sales_user_id, 'stage', 'Marked lost — '||TRIM(p_reason));
    END IF;

    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success',true,'done',v_n,'skipped',v_skipped);
END; $function$
;

-- ============ cron_followup_reminders()
CREATE OR REPLACE FUNCTION public.cron_followup_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rec record; o record; v_n int := 0; v_url text; v_body text;
BEGIN
  -- Pass A: in-app, per lead (unchanged; guarded by followup_notified_for)
  FOR rec IN
    SELECT id, owner_sales_user_id, next_follow_up_at FROM public.leads
    WHERE next_follow_up_at IS NOT NULL AND status NOT IN ('won','lost') AND owner_sales_user_id IS NOT NULL
      AND next_follow_up_at::date <= current_date
      AND (followup_notified_for IS NULL OR followup_notified_for <> next_follow_up_at::date)
  LOOP
    PERFORM public.send_followup_reminder(rec.owner_sales_user_id, rec.id, 'in_app');
    UPDATE public.leads SET followup_notified_for = rec.next_follow_up_at::date WHERE id=rec.id;
    v_n := v_n + 1;
  END LOOP;

  -- Pass B: WhatsApp + Push, grouped per owner, digest when 3+ due
  FOR o IN
    SELECT l.company_id, l.owner_sales_user_id AS uid, count(*) AS cnt,
           string_agg(l.name, ', ' ORDER BY l.next_follow_up_at) AS names
    FROM public.leads l
    WHERE l.next_follow_up_at IS NOT NULL AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
      AND l.next_follow_up_at::date <= current_date
    GROUP BY l.company_id, l.owner_sales_user_id
  LOOP
    IF o.cnt >= 3 THEN
      v_url  := 'https://rms.nexunova.com/sales-portal.html';
      v_body := 'You have '||o.cnt||' follow-ups due today: '
                ||left(o.names,180)||CASE WHEN length(o.names)>180 THEN '…' ELSE '' END;
      PERFORM public._crm_send_whatsapp(o.company_id, o.uid, v_body||'. Open your CRM: '||v_url,
              'wa:fudigest:'||o.uid||':'||current_date);
      PERFORM public._crm_send_push(o.company_id, o.uid, 'Follow-ups due',
              o.cnt||' follow-ups are due today.', v_url, 'push:fudigest:'||o.uid||':'||current_date);
    ELSE
      FOR rec IN
        SELECT id FROM public.leads
        WHERE company_id=o.company_id AND owner_sales_user_id=o.uid
          AND next_follow_up_at IS NOT NULL AND status NOT IN ('won','lost')
          AND next_follow_up_at::date <= current_date
      LOOP
        PERFORM public.send_followup_reminder(o.uid, rec.id, 'whatsapp');
        PERFORM public.send_followup_reminder(o.uid, rec.id, 'push');
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'notified',v_n,'ran_at',now());
END; $function$
;

-- ============ get_director_board(p_session_token text, p_project_id uuid)
CREATE OR REPLACE FUNCTION public.get_director_board(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

  -- tabs: projects the team's live leads sit in, PLUS every project the team is
  -- tagged to (so an FMH tab exists even when FMH staff hold nothing yet)
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
       AND ( p_project_id IS NULL                                  -- "All" tab: everyone
             OR su.home_project_id = p_project_id                  -- this project's staff
             OR EXISTS (SELECT 1 FROM public.leads l3              -- …or holding its leads anyway
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
    GROUP BY m.id, m.full_name, m.role, m.phone, m.home_project_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.full_name, 'role', a.role, 'phone', a.phone,
      'project_tag', a.project_tag, 'home_project_id', a.home_project_id, 'belongs', a.belongs,
      'given_by_me', a.given_by_me,
      'leads', a.leads, 'pending', a.pending, 'matured', a.matured, 'lost', a.lost,
      'stages', jsonb_build_object('new',a.s_new,'contacted',a.s_contacted,'visit',a.s_visit,
                                   'negotiation',a.s_negotiation,'won',a.matured,'lost',a.lost),
      'not_opened', a.not_opened, 'overdue', a.overdue,
      'touches_today', a.touches_today, 'last_touch', a.last_touch,
      'conversion', CASE WHEN a.leads>0 THEN round(a.matured::numeric*100/a.leads,1) ELSE 0 END
    ) ORDER BY a.belongs DESC, a.full_name), '[]'::jsonb) INTO v_members FROM agg a;

  SELECT jsonb_build_object(
      'members',    jsonb_array_length(v_members),
      'leads',      COALESCE(SUM((m->>'leads')::int),0),
      'pending',    COALESCE(SUM((m->>'pending')::int),0),
      'matured',    COALESCE(SUM((m->>'matured')::int),0),
      'not_opened', COALESCE(SUM((m->>'not_opened')::int),0),
      'overdue',    COALESCE(SUM((m->>'overdue')::int),0),
      'outsiders',  COALESCE(SUM(CASE WHEN (m->>'belongs')::boolean THEN 0 ELSE 1 END),0))
    INTO v_tot FROM jsonb_array_elements(v_members) m;

  RETURN jsonb_build_object('success',true,'project_id',p_project_id,
    'projects',v_projects,'members',v_members,'totals',COALESCE(v_tot,'{}'::jsonb));
END; $function$
;

-- ============ get_lead(p_session_token text, p_id uuid)
CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  WHERE l.id=p_id
    AND ( (v_companywide AND l.company_id=v_ses.company_id)
          OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) );
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'body', a.body, 'created_at', a.created_at
  ) ORDER BY a.created_at ASC), '[]'::jsonb) INTO v_acts
  FROM public.lead_activities a WHERE a.lead_id=p_id;
  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts);
END $function$
;

-- ============ get_member_leads(p_session_token text, p_member uuid, p_scope text)
CREATE OR REPLACE FUNCTION public.get_member_leads(p_session_token text, p_member uuid, p_scope text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text; v_ok boolean; su public.sales_users; v_ids uuid[]; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  WITH RECURSIVE sub AS (SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id)
  SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_member) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  SELECT * INTO su FROM public.sales_users WHERE id=p_member;
  WITH RECURSIVE inset AS (SELECT p_member AS id
    UNION ALL SELECT s.id FROM public.sales_users s JOIN inset ON s.parent_sales_user_id=inset.id WHERE p_scope='team' AND s.status='active')
  SELECT array_agg(id) INTO v_ids FROM inset;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'status', l.status, 'source', l.source,
    'budget', l.budget, 'owner_name', public._su_label(l.owner_sales_user_id), 'project_name', p.project_name, 'last_activity_at', l.last_activity_at
  ) ORDER BY l.last_activity_at DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.owner_sales_user_id=ANY(v_ids);
  RETURN jsonb_build_object('success',true,'name',public._su_label(p_member),'role',su.role,'scope',p_scope,'leads',v_rows);
END; $function$
;

-- ============ get_my_followups(p_session_token text)
CREATE OR REPLACE FUNCTION public.get_my_followups(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_today date := current_date;
        v_overdue int; v_today_n int; v_upcoming int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ), due AS (
    SELECT l.id, l.name, l.phone, l.status, l.next_follow_up_at,
           (l.owner_sales_user_id=v_uid) AS is_mine, ow.full_name AS owner_name,
           CASE WHEN l.next_follow_up_at::date < v_today THEN 'overdue'
                WHEN l.next_follow_up_at::date = v_today THEN 'today'
                ELSE 'upcoming' END AS bucket,
           la.kind AS last_kind, la.body AS last_note, la.created_at AS last_at
    FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    JOIN sub ON sub.id = l.owner_sales_user_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    LEFT JOIN LATERAL (SELECT kind, body, created_at FROM public.lead_activities a
                       WHERE a.lead_id=l.id ORDER BY a.created_at DESC LIMIT 1) la ON true
    WHERE l.next_follow_up_at IS NOT NULL AND l.status NOT IN ('won','lost')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',id,'name',name,'phone',phone,'status',status,'next_follow_up_at',next_follow_up_at,
           'is_mine',is_mine,'owner_name',owner_name,'bucket',bucket,
           'last_kind',last_kind,'last_note',last_note,'last_at',last_at
         ) ORDER BY next_follow_up_at ASC), '[]'::jsonb),
         count(*) FILTER (WHERE bucket='overdue'),
         count(*) FILTER (WHERE bucket='today'),
         count(*) FILTER (WHERE bucket='upcoming')
    INTO v_rows, v_overdue, v_today_n, v_upcoming
  FROM due;
  RETURN jsonb_build_object('success',true,'rows',v_rows,
    'overdue',COALESCE(v_overdue,0),'today',COALESCE(v_today_n,0),'upcoming',COALESCE(v_upcoming,0));
END; $function$
;

-- ============ list_my_leads(p_session_token text, p_status text)
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int;
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
           u.unit_no, p.project_name
    FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    LEFT JOIN public.units u ON u.id=l.unit_id
    LEFT JOIN public.projects p ON p.id=l.project_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
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

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),'unchecked',COALESCE(v_unchecked,0));
END
$function$
;

-- ============ log_lead_interaction(p_session_token text, p_lead_id uuid, p_channel text, p_outcome text, p_note text, p_next_step text, p_next_step_date timestamp with time zone)
CREATE OR REPLACE FUNCTION public.log_lead_interaction(p_session_token text, p_lead_id uuid, p_channel text, p_outcome text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_next_step_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_channel NOT IN ('call','whatsapp','sms','visit','meeting','note') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_channel'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, outcome, next_step)
  VALUES (p_lead_id, v_ses.sales_user_id, p_channel,
          NULLIF(TRIM(COALESCE(p_note,'')),''), NULLIF(TRIM(COALESCE(p_outcome,'')),''), NULLIF(TRIM(COALESCE(p_next_step,'')),''));
  UPDATE public.leads SET last_activity_at=now(), next_follow_up_at = COALESCE(p_next_step_date, next_follow_up_at), updated_at=now()
   WHERE id=p_lead_id;
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ mark_lead_seen(p_session_token text, p_lead_id uuid)
CREATE OR REPLACE FUNCTION public.mark_lead_seen(p_session_token text, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_ok boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  -- owner (or director/admin/cfo) only. Company-wide roles keep working on the
  -- unassigned pool, where _lead_can_act is false because there is no owner yet.
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

  INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at)
  VALUES (p_lead_id, v_ses.sales_user_id, now())
  ON CONFLICT (lead_id, sales_user_id) DO NOTHING;
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ pullback_lead(p_session_token text, p_lead_id uuid)
CREATE OR REPLACE FUNCTION public.pullback_lead(p_session_token text, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_owner uuid; v_co uuid; v_role text; v_name text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid:=v_ses.sales_user_id;
  SELECT owner_sales_user_id, company_id INTO v_owner, v_co FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_owner = v_uid THEN RETURN jsonb_build_object('success',false,'error','already_yours','message','This lead is already with you.'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role IN ('director','admin','cfo') THEN
    IF v_co <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  ELSE
    IF NOT EXISTS(
      WITH RECURSIVE sub AS (
        SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid
        UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
      ) SELECT 1 FROM sub WHERE id=v_owner
    ) THEN RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only pull back your own team''s leads.'); END IF;
  END IF;
  UPDATE public.leads SET owner_sales_user_id=v_uid, assigned_by_sales_user_id=v_uid, assigned_at=now(), last_activity_at=now(), updated_at=now() WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_owner, v_uid);
  SELECT full_name INTO v_name FROM public.sales_users WHERE id=v_owner;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_uid, 'assigned', 'Pulled back from '||COALESCE(v_name,'agent'));
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ send_followup_reminder(p_sales_user_id uuid, p_lead_id uuid, p_channel text)
CREATE OR REPLACE FUNCTION public.send_followup_reminder(p_sales_user_id uuid, p_lead_id uuid, p_channel text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead public.leads; v_overdue boolean; v_title text; v_body text; v_url text; v_dedup text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_overdue := v_lead.next_follow_up_at::date < current_date;
  v_title := CASE WHEN v_overdue THEN 'Overdue follow-up' ELSE 'Follow-up due today' END;
  v_body  := 'Follow up with '||COALESCE(v_lead.name,'your lead')
             ||CASE WHEN v_lead.phone IS NOT NULL THEN ' ('||v_lead.phone||')' ELSE '' END
             ||CASE WHEN v_overdue THEN ' — was due '||to_char(v_lead.next_follow_up_at,'DD Mon') ELSE ' — due today' END||'.';
  v_url   := 'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id;
  v_dedup := 'fu:'||p_lead_id||':'||v_lead.next_follow_up_at::date;

  IF p_channel='in_app' THEN
    INSERT INTO public.sales_announcements (company_id, sales_user_id, title, body, is_important, is_active, attachments)
    VALUES (v_lead.company_id, p_sales_user_id, v_title, v_body, v_overdue, true, '[]'::jsonb);
    RETURN true;
  ELSIF p_channel='whatsapp' THEN
    RETURN public._crm_send_whatsapp(v_lead.company_id, p_sales_user_id, v_body||' Open: '||v_url, 'wa:'||v_dedup);
  ELSIF p_channel='push' THEN
    RETURN public._crm_send_push(v_lead.company_id, p_sales_user_id, v_title, v_body, v_url, 'push:'||v_dedup);
  END IF;
  RETURN false;
END; $function$
;

-- ============ set_lead_followup(p_session_token text, p_id uuid, p_when timestamp with time zone)
CREATE OR REPLACE FUNCTION public.set_lead_followup(p_session_token text, p_id uuid, p_when timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET next_follow_up_at=p_when, updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ update_lead(p_session_token text, p_id uuid, p_payload jsonb)
CREATE OR REPLACE FUNCTION public.update_lead(p_session_token text, p_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET
    name     = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'name','')),''), name),
    phone    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''), phone),
    email    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), email),
    source   = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'source','')),''), source),
    interest = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''), interest),
    budget   = COALESCE(NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric, budget),
    notes    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'notes','')),''), notes),
    updated_at = now()
  WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END
$function$
;

-- ============ update_lead_stage(p_session_token text, p_id uuid, p_status text)
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.move_deal_stage(p_session_token, p_id, p_status); $function$
;

-- ============ list_my_deals(p_session_token text, p_stage text)  [dumped later, during Phase 2 UI verification]
CREATE OR REPLACE FUNCTION public.list_my_deals(p_session_token text, p_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int;
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
  ),
  mydeals AS (
    SELECT d.id AS deal_id, d.stage AS stage, d.value AS deal_value,
           l.id AS lead_id, l.name, l.phone, l.email, l.source, l.interest, l.notes,
           l.created_by_sales_user_id, l.next_follow_up_at, l.last_activity_at, l.created_at,
           d.owner_sales_user_id AS owner_id,
           (lv.lead_id IS NOT NULL) AS checked, ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name, l.project_id
    FROM public.deals d
    JOIN (SELECT * FROM public.leads WHERE deleted_at IS NULL) l ON l.id=d.lead_id
    LEFT JOIN public.units u ON u.id=d.unit_id
    LEFT JOIN public.projects p ON p.id=d.project_id
    LEFT JOIN public.sales_users ow ON ow.id=d.owner_sales_user_id
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    WHERE ( (v_companywide AND d.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND d.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.lead_id, 'deal_id', m.deal_id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.deal_value, 'value', m.deal_value,
      'status', m.stage, 'stage', m.stage, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_id=v_uid), 'created_by_me', (m.created_by_sales_user_id=v_uid),
      'checked', m.checked, 'next_follow_up_at', m.next_follow_up_at,
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_stage IS NULL OR m.stage=p_stage)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost') AND m.owner_id = v_uid)
    INTO v_rows, v_unchecked FROM mydeals m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(stage, n) INTO v_counts FROM (
    SELECT d.stage, count(*) n FROM public.deals d
    WHERE ( (v_companywide AND d.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND d.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY d.stage
  ) t;

  RETURN jsonb_build_object('success',true,'deals',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),'unchecked',COALESCE(v_unchecked,0));
END $function$
;
