-- ═══════════════════════════════════════════════════════════════════════════
-- A manager sees what he was given and what he passed on
-- ───────────────────────────────────────────────────────────────────────────
-- The Khushal Bagh manager opened his leads screen and found 280 of them. His
-- own were sixteen. The other 264 were sitting with his seven reps, handed to
-- them by the director months before this manager existed — work he had no part
-- in and no business counting. The stage totals across the top counted all 280
-- too, so the screen was mostly a tally of somebody else's allocation.
--
-- list_my_deals scoped a non-director to their whole SUBTREE. For a rep that is
-- exactly right — a rep has no subtree, so it means "mine". It only starts
-- saying something else the moment somebody has people under them, and until
-- 2026-09-03 nobody in this system did.
--
-- The scope is now what a manager would actually claim as his: the deals he
-- HOLDS, plus the ones he HANDED ON. The second half is not a guess — every
-- hand-over already writes a row to lead_assignments, so "I passed this one to
-- Iqra" is a fact on record and not an inference from who owns it now. That
-- matters: a lead he forwards must stay in his sight or he cannot follow what
-- he distributed, which is the whole of the job.
--
-- Nothing changes for anybody else. A director is companywide and untouched. A
-- sale_rep has no reports, so `owner = me OR I handed it on` is the same set as
-- `owner IN (my subtree)` was — and there is exactly one marketing_manager in
-- the system, checked before this ran.
--
-- The counts use the same condition as the list, so the totals across the top
-- describe what is below them rather than the team's whole allocation.
--
-- NOT touched here: the team board still shows per-member figures from
-- get_my_team. That is a different screen and a different question — this one
-- is about the leads list.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_my_deals(p_session_token text, p_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb; v_role text;
        v_companywide boolean; v_unchecked int; v_today date := public._fu_today();
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH mydeals AS (
    SELECT d.id AS deal_id, d.stage AS stage, d.value AS deal_value,
           l.id AS lead_id, l.name, l.phone, l.email, l.source, l.interest, l.notes,
           l.created_by_sales_user_id, l.next_follow_up_at, l.last_activity_at, l.created_at,
           d.owner_sales_user_id AS owner_id,
           (lv.lead_id IS NOT NULL) AS checked,
           ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name, l.project_id, l.fb_page_name, l.fb_page_id,
           l.followup_locked_at,
           ov.seen_at AS owner_opened_at   -- did the OWNER open it
    FROM public.deals d
    JOIN (SELECT * FROM public.leads WHERE deleted_at IS NULL) l ON l.id=d.lead_id
    LEFT JOIN public.units u ON u.id=d.unit_id
    LEFT JOIN public.projects p ON p.id=d.project_id
    LEFT JOIN public.sales_users ow ON ow.id=d.owner_sales_user_id
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    -- the caller's read-state above; the OWNER's below. A director looking at a
    -- lead he handed over wants the second one — the first only ever told him
    -- whether HE had opened it, which he never asked.
    LEFT JOIN public.lead_views ov ON ov.lead_id=l.id AND ov.sales_user_id=d.owner_sales_user_id
    WHERE (
      (v_companywide AND d.company_id=v_ses.company_id)
      -- mine, or one I handed on. lead_assignments already records every
      -- hand-over, so this is a fact rather than an inference.
      OR ((NOT v_companywide) AND (
            d.owner_sales_user_id = v_uid
            OR EXISTS (SELECT 1 FROM public.lead_assignments la
                        WHERE la.lead_id = d.lead_id AND la.from_sales_user_id = v_uid)
          ))
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.lead_id, 'deal_id', m.deal_id, 'name', m.name, 'phone', m.phone, 'email', m.email,
    'source', m.source, 'interest', m.interest, 'budget', m.deal_value, 'value', m.deal_value,
    'status', m.stage, 'stage', m.stage, 'notes', m.notes, 'unit_no', m.unit_no,
    'project_name', m.project_name, 'project_id', m.project_id,
    'fb_page_name', m.fb_page_name, 'fb_page_id', m.fb_page_id,
    'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_id, 'owner_role', m.owner_role,
    'is_mine', (m.owner_id=v_uid), 'created_by_me', (m.created_by_sales_user_id=v_uid),
    'checked', m.checked,
    'owner_opened', (m.owner_opened_at IS NOT NULL), 'owner_opened_at', m.owner_opened_at,
    'next_follow_up_at', m.next_follow_up_at,
    'is_locked', (m.followup_locked_at IS NOT NULL),
    'is_overdue', (m.next_follow_up_at IS NOT NULL
                   AND (m.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
                   AND m.stage NOT IN ('won','lost')),
    'last_activity_at', m.last_activity_at, 'created_at', m.created_at
  ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_stage IS NULL OR m.stage=p_stage)), '[]'::jsonb),
         count(*) FILTER (WHERE NOT m.checked AND m.stage NOT IN ('won','lost') AND m.owner_id = v_uid)
    INTO v_rows, v_unchecked
    FROM mydeals m;

  -- the same condition, so the totals describe the list under them
  SELECT jsonb_object_agg(stage, n) INTO v_counts FROM (
    SELECT d.stage, count(*) n FROM public.deals d
     WHERE (
       (v_companywide AND d.company_id=v_ses.company_id)
       OR ((NOT v_companywide) AND (
             d.owner_sales_user_id = v_uid
             OR EXISTS (SELECT 1 FROM public.lead_assignments la
                         WHERE la.lead_id = d.lead_id AND la.from_sales_user_id = v_uid)
           ))
     )
     GROUP BY d.stage) t;

  RETURN jsonb_build_object('success',true,'deals',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),
    'unchecked',COALESCE(v_unchecked,0), 'block', public._fu_block_state(v_uid));
END $function$;
