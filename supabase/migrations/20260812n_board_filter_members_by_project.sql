-- 2026-08-12 — the board's project tab filtered the NUMBERS but not the PEOPLE:
-- on the KBH tab every FMH-tagged member (Usman·FMH, Naseer·FMH, Maria·FMH …) was
-- still listed with 0 leads, and vice versa. On a project tab, show that project's
-- staff.
--
-- One deliberate exception: somebody tagged to another project who is CURRENTLY
-- holding leads of this project still appears, flagged with belongs=false — those
-- 10 FMH leads sitting with KBH staff are a real problem and must not disappear
-- from the board just because the tag says otherwise.
CREATE OR REPLACE FUNCTION public.get_director_board(p_session_token text, p_project_id uuid DEFAULT NULL)
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
END; $function$;
