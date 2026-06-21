-- ════════════════════════════════════════════════════════════════════════════
-- Leads inbox: per-user "checked" (read) tracking — email-style unread.
-- 2026-06-21. A lead is "unchecked" until the viewer opens it; the red nav badge
-- counts UNCHECKED leads (not status='new') so it drops as you open them. Tracked
-- per (lead, sales_user) like announcement_receipts. list_my_leads returns
-- `checked` per lead + an `unchecked` count (active = not won/lost).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.lead_views (
  lead_id       uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sales_user_id uuid NOT NULL REFERENCES public.sales_users(id) ON DELETE CASCADE,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, sales_user_id)
);
ALTER TABLE public.lead_views ENABLE ROW LEVEL SECURITY;  -- access via SECURITY DEFINER RPCs only

-- mark a lead checked for the caller (called when they open it)
CREATE OR REPLACE FUNCTION public.mark_lead_seen(p_session_token text, p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_co uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT company_id INTO v_co FROM public.leads WHERE id=p_lead_id;
  IF v_co IS NULL OR v_co <> v_ses.company_id THEN RETURN jsonb_build_object('success',true,'noop',true); END IF;
  INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at)
  VALUES (p_lead_id, v_ses.sales_user_id, now())
  ON CONFLICT (lead_id, sales_user_id) DO NOTHING;
  RETURN jsonb_build_object('success',true);
END
$function$;
GRANT EXECUTE ON FUNCTION public.mark_lead_seen(text,uuid) TO anon, authenticated;

-- list_my_leads: + checked (per caller) + unchecked count
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    SELECT l.*, (lv.lead_id IS NOT NULL) AS checked, ow.full_name AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name
    FROM public.leads l
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
      'unit_no', m.unit_no, 'project_name', m.project_name,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_sales_user_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_sales_user_id=v_uid), 'created_by_me', (m.created_by_sales_user_id = v_uid),
      'checked', m.checked,
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_status IS NULL OR m.status=p_status)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost'))
    INTO v_rows, v_unchecked
  FROM myleads m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM public.leads l
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),'unchecked',COALESCE(v_unchecked,0));
END
$function$;
