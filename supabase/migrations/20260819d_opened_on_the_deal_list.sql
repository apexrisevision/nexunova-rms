-- ═══════════════════════════════════════════════════════════════════════════
-- The Leads screen reads list_my_deals, not list_my_leads
--
-- 20260819b added owner_opened to list_my_leads and the chip still said "New",
-- because the pipeline is DEAL-sourced: sales-portal.html calls list_my_deals
-- and renders whatever that returns. The right field on the wrong function is
-- worth nothing — the harness caught it by reading the chip in a real browser
-- rather than trusting the migration.
--
-- Same field, same meaning, on the function the screen actually calls:
--
--   owner_opened      the person it belongs to has opened it
--   owner_opened_at   when they last did
--
-- `checked` stays as it is — that is the CALLER's read-state and it drives the
-- unread dot. Two different questions, two fields.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_my_deals(p_session_token text, p_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int; v_today date := public._fu_today();  -- PHASE2
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
           u.unit_no, p.project_name, l.project_id,
           l.fb_page_name, l.fb_page_id,                                          -- NEW
           l.followup_locked_at,                                                   -- PHASE2
           ov.seen_at AS owner_opened_at                                           -- did the OWNER open it
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
    WHERE ( (v_companywide AND d.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND d.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.lead_id, 'deal_id', m.deal_id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.deal_value, 'value', m.deal_value,
      'status', m.stage, 'stage', m.stage, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,
      'fb_page_name', m.fb_page_name, 'fb_page_id', m.fb_page_id,                 -- NEW
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_id=v_uid), 'created_by_me', (m.created_by_sales_user_id=v_uid),
      'checked', m.checked,
      'owner_opened', (m.owner_opened_at IS NOT NULL),
      'owner_opened_at', m.owner_opened_at,
      'next_follow_up_at', m.next_follow_up_at,
      'is_locked', (m.followup_locked_at IS NOT NULL),                              -- PHASE2
      'is_overdue', (m.next_follow_up_at IS NOT NULL                                -- PHASE2
                     AND (m.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
                     AND m.stage NOT IN ('won','lost')),
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

  RETURN jsonb_build_object('success',true,'deals',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),
    'unchecked',COALESCE(v_unchecked,0),
    'block', public._fu_block_state(v_uid));                                        -- PHASE2
END $function$;

COMMENT ON FUNCTION public.list_my_deals(text, text) IS
  'The pipeline the Leads screen renders. `checked` = has the CALLER opened it (unread dot); `owner_opened` = has the person it belongs to opened it, and when.';
