-- ═══════════════════════════════════════════════════════════════════════════
-- An untagged team member must never vanish from a project tab
--
-- Reported: a newly added rep (Alyan ali shah) sat correctly under Rashid Manzoor
-- — active, right company, parent_sales_user_id set — and still did not appear on
-- the team, while Iqra, Fawad and Salman did. get_my_team returned him all along;
-- what dropped him was the PROJECT TAB.
--
-- The cause is a drift from what home_project_id was built to be. 20260812c
-- introduced it and says so in its own comment: "Display-only: which project this
-- staff member belongs to. Shown as a tag next to their name. Does NOT scope
-- anything." 20260812n then started filtering the board's member list by it, and
-- the portal's two assign screens did the same. A label became a gate — and a
-- member with no label fell through it. Nobody had said Alyan is not KBH; nobody
-- had said anything at all.
--
-- The rule this settles: NULL means "not stated", not "belongs to no project". An
-- untagged member appears on EVERY project tab, carries untagged=true so the
-- screen can ask for the tag instead of guessing, and is NOT counted as an
-- outsider. Someone tagged to a DIFFERENT project is still filtered out — that
-- part was right, and it is what keeps KBH's tab from listing all of FMH.
--
-- Rebuilt from the live definition, changing only those lines.
-- ═══════════════════════════════════════════════════════════════════════════

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
             OR su.home_project_id IS NULL                          -- NOT STATED — never hidden
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
      (p_project_id IS NULL OR m.home_project_id = p_project_id
         OR m.home_project_id IS NULL) AS belongs,
      (m.home_project_id IS NULL) AS untagged,
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
      'project_tag', a.project_tag, 'home_project_id', a.home_project_id, 'belongs', a.belongs, 'untagged', a.untagged,
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
