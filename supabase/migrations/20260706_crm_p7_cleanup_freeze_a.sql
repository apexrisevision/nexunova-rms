-- CRM overhaul P7 (part A): retire the dual-write. deals.stage becomes the SOLE write target
-- for pipeline; lead.status is FROZEN as a read-only mirror (kept accurate by the deal->lead
-- trigger, now also carrying lost_reason). Column NOT dropped this cycle (later release).
-- Applied via MCP 2026-07-06; verified on ZZTEST round-trips (lost via mark_lead_lost + full
-- won cycle, deal/lead + lost_reason mirror-consistent throughout) and byte-identical
-- reconciliation for get_agent_conversion. Fully reversible (freeze = no data destroyed).

-- 1) FREEZE mirror: deal -> lead now also syncs lost_reason (keeps leads a complete accurate mirror)
CREATE OR REPLACE FUNCTION public._lead_sync_from_deal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage OR NEW.lost_reason IS DISTINCT FROM OLD.lost_reason THEN
    UPDATE public.leads SET status=NEW.stage, lost_reason=NEW.lost_reason, updated_at=now()
    WHERE id=NEW.lead_id AND (status IS DISTINCT FROM NEW.stage OR lost_reason IS DISTINCT FROM NEW.lost_reason);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead sync-from-deal failed (deal %): %', NEW.id, SQLERRM;
  RETURN NEW;
END $fn$;

-- 2) RETIRE reverse dual-write: lead -> deal no longer syncs stage/lost_reason on UPDATE
--    (deal-authoritative now). Keeps deal creation on INSERT + identity/booking mirror.
CREATE OR REPLACE FUNCTION public._deal_sync_from_lead() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.deals (company_id, project_id, lead_id, owner_sales_user_id, title, unit_id, unit_type_id,
       value, stage, reservation_id, sale_id, lost_reason, is_test, last_activity_at, created_at, updated_at)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, NEW.owner_sales_user_id, NEW.name, NEW.unit_id, NEW.unit_type_id,
       NEW.budget, COALESCE(NEW.status,'new'), NEW.converted_reservation_id, NEW.converted_sale_id, NEW.lost_reason,
       COALESCE(NEW.is_test,false), COALESCE(NEW.last_activity_at,now()), COALESCE(NEW.created_at,now()), now())
    ON CONFLICT (lead_id) DO NOTHING;
  ELSE
    UPDATE public.deals SET
      company_id=NEW.company_id, project_id=NEW.project_id, owner_sales_user_id=NEW.owner_sales_user_id,
      title=NEW.name, unit_id=NEW.unit_id, unit_type_id=NEW.unit_type_id, value=NEW.budget,
      reservation_id=NEW.converted_reservation_id, sale_id=NEW.converted_sale_id,
      is_test=COALESCE(NEW.is_test,false), last_activity_at=COALESCE(NEW.last_activity_at,now()), updated_at=now()
    WHERE lead_id=NEW.id;   -- NOTE: stage + lost_reason intentionally NOT synced (deal-authoritative)
    IF NOT FOUND THEN
      INSERT INTO public.deals (company_id, project_id, lead_id, owner_sales_user_id, title, unit_id, unit_type_id,
         value, stage, reservation_id, sale_id, lost_reason, is_test, last_activity_at, created_at, updated_at)
      VALUES (NEW.company_id, NEW.project_id, NEW.id, NEW.owner_sales_user_id, NEW.name, NEW.unit_id, NEW.unit_type_id,
         NEW.budget, COALESCE(NEW.status,'new'), NEW.converted_reservation_id, NEW.converted_sale_id, NEW.lost_reason,
         COALESCE(NEW.is_test,false), COALESCE(NEW.last_activity_at,now()), COALESCE(NEW.created_at,now()), now())
      ON CONFLICT (lead_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'deal sync-from-lead failed (lead %): %', NEW.id, SQLERRM;
  RETURN NEW;
END $fn$;

-- 3) mark_lead_lost -> deal-native (writes deals.stage='lost'+lost_reason; mirror updates the lead)
CREATE OR REPLACE FUNCTION public.mark_lead_lost(p_session_token text, p_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_r text; v_cur text; v_deal_id uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT d.id, d.stage INTO v_deal_id, v_cur FROM public.deals d WHERE d.lead_id=p_id;
  IF v_deal_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_cur='won' THEN RETURN jsonb_build_object('success',false,'error','terminal_locked','message','This deal is already Won — reopen it before changing the stage.'); END IF;
  v_r := NULLIF(TRIM(COALESCE(p_reason,'')),'');
  UPDATE public.deals SET stage='lost', lost_reason=v_r, last_activity_at=now(), updated_at=now() WHERE id=v_deal_id;
  UPDATE public.leads SET last_activity_at=now() WHERE id=p_id;
  INSERT INTO public.lead_activities (lead_id, deal_id, sales_user_id, kind, body)
  VALUES (p_id, v_deal_id, v_ses.sales_user_id, 'stage', 'Lost'||CASE WHEN v_r IS NOT NULL THEN ' — '||v_r ELSE '' END);
  RETURN jsonb_build_object('success',true);
END $function$;

-- 4) update_lead_stage: thin alias -> move_deal_stage (retires its direct lead.status write)
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.move_deal_stage(p_session_token, p_id, p_status); $function$;

-- 5) get_agent_conversion: conversions (won) -> deals.stage; leads_received stays lead-level (assigned_at)
CREATE OR REPLACE FUNCTION public.get_agent_conversion(p_session_token text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_uid uuid;
        v_days int; v_start timestamptz; v_agents jsonb;
        v_co_recv int; v_co_won int; v_co_rate numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_days  := CASE WHEN p_days IN (7,30,90) THEN p_days ELSE 30 END;
  v_start := now() - make_interval(days => v_days);
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
  ),
  visible AS (
    SELECT m.id, m.full_name AS name, m.role FROM public.sales_users m
    WHERE m.company_id=v_co AND m.status='active'
      AND (
        (v_role IN ('director','admin') AND m.role IN ('sale_rep','marketing_manager'))
        OR (v_role='marketing_manager' AND m.role IN ('sale_rep','marketing_manager') AND m.id IN (SELECT id FROM sub))
        OR (v_role NOT IN ('director','admin','marketing_manager') AND m.id=v_uid)
      )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(w)::jsonb ORDER BY w.conv_rate DESC NULLS LAST, w.conversions DESC, w.leads_received DESC),'[]'::jsonb)
    INTO v_agents FROM (
    SELECT z.*, CASE WHEN z.leads_received>0 THEN round(z.conversions*100.0/z.leads_received) ELSE NULL END AS conv_rate
    FROM (
      SELECT vv.id, vv.name, vv.role,
        (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=vv.id AND NOT COALESCE(l.is_test,false)
           AND COALESCE(l.assigned_at,l.created_at) >= v_start) AS leads_received,
        (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id=vv.id AND d.stage='won'
           AND d.updated_at >= v_start AND NOT COALESCE(d.is_test,false)) AS conversions
      FROM visible vv
    ) z
  ) w;
  SELECT count(*) INTO v_co_recv FROM public.leads
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND COALESCE(assigned_at,created_at) >= v_start;
  SELECT count(*) INTO v_co_won FROM public.deals
   WHERE company_id=v_co AND NOT COALESCE(is_test,false) AND stage='won' AND updated_at >= v_start;
  v_co_rate := CASE WHEN v_co_recv>0 THEN round(v_co_won*100.0/v_co_recv) ELSE NULL END;
  RETURN jsonb_build_object('success',true,'days',v_days,'agents',v_agents,
    'company_avg', jsonb_build_object('leads_received',v_co_recv,'conversions',v_co_won,'conv_rate',v_co_rate));
END $function$;

-- 6) get_lead: 'status' now sourced from deals.stage (output-compatible; source of truth = deals)
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
  FROM public.leads l
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
END $function$;

-- 7) mark leads.status as legacy read-only mirror
COMMENT ON COLUMN public.leads.status IS 'LEGACY (P7 freeze): read-only mirror of deals.stage; source of truth is deals.stage. Drop candidate in a later release.';
