-- Phase 2 — the forced sheet asks ONCE PER DAY per lead, not on every open.
--
-- Owner decision 2026-08-14: accountability stays, the daily nagging goes. A member
-- who already recorded where a lead stands today can reopen it to check a phone
-- number without filling the form again. Tomorrow it asks again.
--
-- One definition, used by both the gate (mark_lead_seen) and the read (get_lead),
-- so the sheet can never appear in one and be denied by the other.
--
-- Also fixed here: a won/lost lead no longer demands a disposition at all. There is
-- no "next follow-up" for a closed deal, so asking was always wrong.

BEGIN;

CREATE OR REPLACE FUNCTION public._fu_owes_disposition(p_lead_id uuid, p_sales_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public._fu_member_in_scope(p_sales_user_id)
     AND EXISTS (
       SELECT 1
         FROM public.leads l
         LEFT JOIN public.deals d ON d.lead_id = l.id
        WHERE l.id = p_lead_id
          AND l.deleted_at IS NULL
          AND l.owner_sales_user_id = p_sales_user_id
          AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
          AND ( l.last_disposition_at IS NULL
                OR (l.last_disposition_at AT TIME ZONE 'Asia/Karachi')::date < public._fu_today() )
     )
$$;

COMMENT ON FUNCTION public._fu_owes_disposition(uuid,uuid) IS
  'Does this member owe a disposition on this lead right now? True once per Pakistan '
  'day per lead, and never for a closed deal. The single source for the forced sheet.';

-- ── mark_lead_seen: the gate ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_lead_seen(p_session_token text, p_lead_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_ok boolean; v_pend boolean := false;
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

  v_pend := public._fu_owes_disposition(p_lead_id, v_ses.sales_user_id);   -- PHASE2 (once per day)

  INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at, disposition_pending_since)
  VALUES (p_lead_id, v_ses.sales_user_id, now(), CASE WHEN v_pend THEN now() END)
  ON CONFLICT (lead_id, sales_user_id) DO UPDATE
    SET disposition_pending_since = CASE
          WHEN v_pend AND public.lead_views.disposition_pending_since IS NULL THEN now()
          WHEN NOT v_pend THEN NULL
          ELSE public.lead_views.disposition_pending_since END;

  RETURN jsonb_build_object('success',true,'disposition_required',v_pend);
END $function$;

-- ── get_lead: the read must agree with the gate ─────────────────────────────
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
    'is_locked', (l.followup_locked_at IS NOT NULL),
    'locked_at', l.followup_locked_at,
    'is_overdue', (l.next_follow_up_at IS NOT NULL
                   AND (l.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < public._fu_today()
                   AND COALESCE(dl.stage, l.status) NOT IN ('won','lost')),
    'missed_count', l.missed_followup_count,
    'last_disposition_at', l.last_disposition_at,
    'disposition_required', public._fu_owes_disposition(l.id, v_uid),          -- PHASE2 (once per day)
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
  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts,
    'block', public._fu_block_state(v_uid));
END $function$;

COMMIT;
