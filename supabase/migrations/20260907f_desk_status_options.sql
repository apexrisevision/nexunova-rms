-- ═══════════════════════════════════════════════════════════════════════════
-- THE DESK SAYS WHICH KIND OF HOLD, AND THE DAYBOOK STOPS LYING ABOUT UNDO
--
-- Two defects, one migration, because both live in the same functions.
--
-- 1. UNDO. cancel_reservation is correct: it sets status='cancelled' and puts
--    the unit back to the project's available status. Measured on live —
--    LG-02 booked 14:24, released 21:46, unit_status_now = AVAILABLE. The
--    DAYBOOK was the liar. Its first section selected every reservation created
--    on p_date with NO filter on status, so the released unit still printed as
--    that day's reservation, with a days-left figure computed from an expiry
--    that no longer meant anything, in amber, indistinguishable from a live
--    hold. The row is not deleted — a booking made and undone IS an event of
--    that day, and the desk still lists it under "Booked today" — but it now
--    carries `status`, `cancelled_at` and its tag, so the page can say so.
--
-- 2. ONE KIND OF HOLD. reserve_unit_desk looked up the project's 'reserved'
--    status and hard-wired it. Awami has eleven statuses configured; three of
--    them are inventory holds.
--
--    THE DESK OFFERS HOLD, RESERVED AND BOOKED. IT DOES NOT OFFER SOLD, AND
--    THAT IS DELIBERATE. Measured across every tenant: 428 units carry SOLD and
--    428 of them have an active row in public.sales — no exceptions, in any
--    company. A sale here is a sale_number, a client, a payment schedule and a
--    commission, and this desk creates none of those. A unit stamped SOLD from
--    the desk would be the first sale-less SOLD unit in the database: the floor
--    table would count it sold while "Sales Today" — which reads public.sales —
--    stayed empty, and the money would exist nowhere. The seven remaining
--    statuses (On Installment, Mortgaged, Under Transfer, Possession Given,
--    Under Sale Review, Dead) all describe a unit that ALREADY has a sale, so a
--    desk that writes no sale cannot apply those either. Selling stays on the
--    convert-to-sale path that already exists.
--
-- Bodies are PATCHED FROM pg_get_functiondef() ON LIVE, never retyped. The
-- first draft of this migration wrote get_reserve_desk out by hand and silently
-- replaced its entire typed-against unit index — the payload the desk matches
-- unit numbers against — with an invented shape that dropped the holder block,
-- the floor sort and _sales_sees_sold_price. Caught by diffing against the dump.
-- Every existing payload key is preserved; every addition is additive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the reservation records WHICH tag it applied ────────────────────────
-- Nullable by design: rows written before today have no answer of their own.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS unit_status_id uuid REFERENCES public.category_unit_statuses(id);

COMMENT ON COLUMN public.reservations.unit_status_id IS
  'The category_unit_statuses row this reservation stamped on the unit (On Hold / Reserved / Booked). NULL on rows written before 2026-09-07; those were all Reserved, which is the only thing the desk could produce.';

-- Backfill. Not a guess: Reserved is the only status the old desk could apply,
-- so this states the old behaviour rather than inventing history.
UPDATE public.reservations r
   SET unit_status_id = cus.id
  FROM public.category_unit_statuses cus
 WHERE r.unit_status_id IS NULL
   AND cus.company_id = r.company_id
   AND cus.project_id = r.project_id
   AND LOWER(cus.status_code) = 'reserved'
   AND cus.is_active;

CREATE OR REPLACE FUNCTION public.get_reserve_desk(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_scope uuid; v_group uuid; v_companies uuid[]; v_span boolean;
        v_req_companies uuid[];
        v_sees_price boolean; v_sees_sold boolean;
        v_units jsonb; v_req jsonb; v_today jsonb; v_projects jsonb; v_pk_today date;
        v_statuses jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell',
      'message','Your role does not book or sell units.'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  /* THE DESK IS ALWAYS ONE TOWER.
     With no project argument this used to fall through to the whole umbrella
     group: 2,244 units across three towers, 250 unit numbers appearing more
     than once, and "LG-12" matching TWO different units in two different
     projects. The desk indexes by unit number, so one silently won — a typed
     LG-12 could have booked the wrong tower's flat. The screen only ever shows
     one project, so the payload must only ever be one project. An umbrella
     dealer still switches towers with the picker, which refetches. */
  v_scope := COALESCE(v_ses.project_id, p_project_id);
  IF v_scope IS NULL THEN
    SELECT p.id INTO v_scope
      FROM public.projects p
     WHERE p.company_id = v_ses.company_id
     ORDER BY p.project_name
     LIMIT 1;
  END IF;

  v_sees_price := public._sales_sees_prices(p_session_token);
  v_sees_sold  := public._sales_sees_sold_price(p_session_token);
  v_pk_today   := (now() AT TIME ZONE 'Asia/Karachi')::date;

  -- who may be credited: the owner of the project being booked. With no project
  -- chosen there is nothing to narrow to, so the group stands.
  IF v_scope IS NOT NULL THEN
    SELECT ARRAY[company_id] INTO v_req_companies FROM public.projects WHERE id = v_scope;
  END IF;
  IF v_req_companies IS NULL THEN v_req_companies := v_companies; END IF;

  -- projects the desk may switch between
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.project_name, 'company', co.company_name)
         ORDER BY co.company_name, p.project_name), '[]'::jsonb)
    INTO v_projects
    FROM public.projects p
    JOIN public.companies co ON co.id = p.company_id
   WHERE p.company_id = ANY(v_companies);

  /* THE TAGS THIS DESK MAY APPLY.
     Read from the project's own configuration, never hardcoded in the browser,
     so a project that has not configured On Hold simply offers fewer buttons.
     The allow-list stops at three codes: everything else in this table
     describes a unit that ALREADY has a sale, and this desk writes no sale.
     Ordered by rising commitment - hold, reserve, book - which is not
     sort_order (that has Booked above Reserved above Hold). */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'code', q.status_code, 'name', q.status_name)
         ORDER BY q.rank), '[]'::jsonb)
    INTO v_statuses
    FROM (
      SELECT cus.id, cus.status_code, cus.status_name,
             CASE LOWER(cus.status_code) WHEN 'hold' THEN 1
                                         WHEN 'reserved' THEN 2
                                         ELSE 3 END AS rank
        FROM public.category_unit_statuses cus
       WHERE cus.project_id = v_scope
         AND cus.is_active
         AND NOT cus.is_available
         AND LOWER(cus.status_code) IN ('hold','reserved','booked')
    ) q;

  -- the typed-against index (umbrella scope, unchanged)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'n',  u.unit_no,
           'f',  COALESCE(NULLIF(u.floor_label,''), 'Floor '||COALESCE(u.floor_no::text,'-')),
           'r',  COALESCE(f.sort_order, u.floor_no, 999),
           'a',  u.area,
           'u',  COALESCE(u.area_unit,'sqft'),
           'p',  CASE WHEN v_sees_price
                       AND (COALESCE(st.status_code,'') <> 'SOLD' OR v_sees_sold)
                      THEN u.base_price END,
           's',  CASE WHEN COALESCE(st.is_available,false) THEN 'available'
                      WHEN st.status_code = 'SOLD'         THEN 'sold'
                      WHEN st.status_code = 'RESERVED'     THEN 'reserved'
                      ELSE lower(COALESCE(st.status_code,'unknown')) END,
           'sn', st.status_name,
           'h',  CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
                        'by',     COALESCE(NULLIF(TRIM(r.requested_by_name),''), su.full_name),
                        'code',   ag.agent_code,
                        'booked', rb.full_name,
                        'exp',    r.expiry_date)
                 ELSE NULL END)
         ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                  COALESCE(NULLIF(substring(u.unit_no FROM '(\d+)$'),'')::int, 0),
                  u.unit_no), '[]'::jsonb)
    INTO v_units
    FROM public.units u
    JOIN public.projects p ON p.id = u.project_id
    LEFT JOIN public.floors f  ON f.id  = u.floor_id
    LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
    LEFT JOIN public.reservations r ON r.unit_id = u.id AND r.status = 'active'
    LEFT JOIN public.sales_users  su ON su.id = r.requested_by_sales_user_id
    LEFT JOIN public.sales_users  rb ON rb.id = r.reserved_by
    LEFT JOIN public.agents       ag ON ag.id = r.requested_by_agent_id
   WHERE u.company_id = ANY(v_companies)
     AND p.company_id = u.company_id
     AND (v_scope IS NULL OR u.project_id = v_scope);

  -- requester picker. Agents first (the canonical identity), scoped to the
  -- project's own company; then portal members who have no agent row yet,
  -- scoped to the session's company because that is where they exist.
  -- Portal members are filtered on lead_role_config.can_have_leads — the same
  -- row _sales_may_sell reads, so "handles customers" has one definition — and
  -- lead_entry is excluded on top, because booking refuses it separately and a
  -- name that can be picked and then fails explains nothing.
  -- company is returned for the label only; it breaks a tie that name + code +
  -- phone cannot, and carries no authority of its own.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'kind' = 'agent') DESC, x->>'name'), '[]'::jsonb)
    INTO v_req
    FROM (
      SELECT jsonb_build_object('kind','agent','id',a.id,'name',a.full_name,
               'code',a.agent_code,'phone',a.phone,'company',co.company_name) AS x
        FROM public.agents a
        JOIN public.companies co ON co.id = a.company_id
       WHERE a.company_id = ANY(v_req_companies) AND a.status = 'active'
      UNION ALL
      SELECT jsonb_build_object('kind','user','id',s.id,'name',s.full_name,
               'code',NULL,'phone',s.phone,'company',co.company_name)
        FROM public.sales_users s
        JOIN public.companies co ON co.id = s.company_id
        JOIN public.lead_role_config lrc ON lrc.role = s.role
       WHERE s.company_id = v_ses.company_id AND s.is_active
         AND COALESCE(s.status,'active') = 'active'
         AND s.agent_id IS NULL
         AND lrc.can_have_leads
         AND s.role <> 'lead_entry'
    ) q;

  -- what this operator has already booked today (Pakistan day, not UTC)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no,
           'floor', COALESCE(NULLIF(u.floor_label,''),'-'),
           'by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'client_name', r.client_name,
           'tag', COALESCE(rs.status_name, 'Reserved'),
           'tag_code', COALESCE(rs.status_code, 'RESERVED'),
           'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at)
         ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_today
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
   WHERE r.company_id = ANY(v_companies)
     AND r.reserved_by = v_ses.sales_user_id
     AND (now() AT TIME ZONE 'Asia/Karachi')::date = (r.created_at AT TIME ZONE 'Asia/Karachi')::date;

  RETURN jsonb_build_object('success',true,
    'scope_project_id', v_ses.project_id, 'projects', v_projects,
    'units', v_units, 'requesters', v_req, 'today', v_today,
    'statuses', v_statuses,
    'pk_today', v_pk_today, 'sees_price', v_sees_price);
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_unit_desk(p_session_token text, p_unit_id uuid, p_requested_by_agent_id uuid DEFAULT NULL::uuid, p_requested_by_sales_user_id uuid DEFAULT NULL::uuid, p_requested_by_name text DEFAULT NULL::text, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_expiry_days integer DEFAULT 7, p_token_received boolean DEFAULT false, p_token_amount numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_unit_status_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_unit public.units;
        v_group uuid; v_companies uuid[]; v_span boolean;
        v_reserved_status uuid; v_days int; v_res_id uuid; v_expiry timestamptz;
        v_agent public.agents; v_ruser public.sales_users; v_rname text;
        v_tag public.category_unit_statuses;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell',
      'message','Your role does not book or sell units.'); END IF;

  v_days := GREATEST(1, LEAST(90, COALESCE(p_expiry_days, 7)));

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  -- ── requester: agents master first, then a portal member, then free text ──
  IF p_requested_by_agent_id IS NOT NULL THEN
    SELECT * INTO v_agent FROM public.agents
     WHERE id = p_requested_by_agent_id AND company_id = ANY(v_companies);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','requester_not_found',
        'message','That agent is not in this company.'); END IF;
    v_rname := v_agent.full_name;
  ELSIF p_requested_by_sales_user_id IS NOT NULL THEN
    SELECT * INTO v_ruser FROM public.sales_users
     WHERE id = p_requested_by_sales_user_id AND company_id = ANY(v_companies);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','requester_not_found',
        'message','That person is not in this company.'); END IF;
    v_rname := v_ruser.full_name;
  ELSE
    v_rname := NULLIF(TRIM(COALESCE(p_requested_by_name,'')), '');
  END IF;

  IF v_rname IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','requester_required',
      'message','Record who asked for this unit.'); END IF;

  -- ���─ THE LOCK ──────────────────────────────────────────────────────────────
  SELECT * INTO v_unit FROM public.units
   WHERE id = p_unit_id AND company_id = ANY(v_companies)
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;

  IF NOT v_span AND v_ses.project_id IS NOT NULL AND v_unit.project_id <> v_ses.project_id THEN
    RETURN jsonb_build_object('success',false,'error','out_of_scope'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.category_unit_statuses st
                  WHERE st.id = v_unit.status_id AND st.is_available) THEN
    RETURN jsonb_build_object('success',false,'error','unit_unavailable',
      'message','This unit is no longer available - it may have just been reserved or sold.'); END IF;

  IF EXISTS (SELECT 1 FROM public.reservations
              WHERE unit_id = p_unit_id AND status = 'active') THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.'); END IF;

  /* THE TAG IS RE-VALIDATED HERE, NOT TRUSTED FROM THE CALLER.
     The browser was handed a list, but a caller can send any uuid it likes.
     This re-derives the same allow-list against the UNIT's own project, so a
     status belonging to another project, an inactive one, an is_available one,
     or SOLD is refused rather than stamped. Without this re-check the new
     parameter would be a way to set any unit to any status from the portal. */
  IF p_unit_status_id IS NOT NULL THEN
    SELECT * INTO v_tag FROM public.category_unit_statuses
     WHERE id = p_unit_status_id
       AND project_id = v_unit.project_id
       AND company_id = v_unit.company_id
       AND is_active
       AND NOT is_available
       AND LOWER(status_code) IN ('hold','reserved','booked');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','bad_status',
        'message','That is not a status this desk can apply to a unit.'); END IF;
    v_reserved_status := v_tag.id;
  ELSE
    -- unchanged default, so a client that has not been redeployed behaves exactly as before
    SELECT id INTO v_reserved_status FROM public.category_unit_statuses
     WHERE company_id = v_unit.company_id AND project_id = v_unit.project_id
       AND (LOWER(status_code) = 'reserved' OR status_name ILIKE '%reserved%')
       AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_reserved_status IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','no_reserved_status',
        'message','This project has no Reserved status configured.'); END IF;
    SELECT * INTO v_tag FROM public.category_unit_statuses WHERE id = v_reserved_status;
  END IF;

  v_expiry := now() + (v_days || ' days')::interval;

  INSERT INTO public.reservations
    (company_id, project_id, unit_id, reserved_by,
     requested_by_agent_id, requested_by_sales_user_id, requested_by_name,
     client_name, client_phone, expiry_date,
     token_received, token_amount, note, status, unit_status_id)
  VALUES
    (v_unit.company_id, v_unit.project_id, p_unit_id, v_ses.sales_user_id,
     p_requested_by_agent_id, p_requested_by_sales_user_id, v_rname,
     NULLIF(TRIM(COALESCE(p_client_name,'')),''),
     NULLIF(TRIM(COALESCE(p_client_phone,'')),''),
     v_expiry,
     COALESCE(p_token_received,false), COALESCE(p_token_amount,0),
     NULLIF(TRIM(COALESCE(p_note,'')),''), 'active', v_reserved_status)
  RETURNING id INTO v_res_id;

  UPDATE public.units SET status_id = v_reserved_status, updated_at = now()
   WHERE id = p_unit_id AND company_id = v_unit.company_id;

  RETURN jsonb_build_object('success',true,
    'reservation_id', v_res_id, 'unit_no', v_unit.unit_no,
    'requested_by', v_rname, 'expiry_date', v_expiry, 'expiry_days', v_days,
    'tag', v_tag.status_name, 'tag_code', v_tag.status_code);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.');
END $function$
;

CREATE OR REPLACE FUNCTION public.get_reservation_daybook(p_session_token text, p_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean; v_scope uuid;
        v_sees_price boolean; v_day date;
        v_reserved jsonb; v_sold jsonb; v_exp jsonb; v_avail jsonb; v_head jsonb;
        v_hold jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell',
      'message','Your role does not book or sell units.'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  v_scope      := COALESCE(v_ses.project_id, p_project_id);
  v_sees_price := public._sales_sees_prices(p_session_token);
  v_day        := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Karachi')::date);

  SELECT jsonb_build_object(
           'project', pr.project_name, 'project_id', pr.id,
           'company', COALESCE(co.display_name, co.company_name),
           'logo_url', co.logo_url)
    INTO v_head
    FROM public.projects pr JOIN public.companies co ON co.id = pr.company_id
   WHERE pr.id = v_scope;

  /* 1. booked on the day - INCLUDING the ones released again before the day
        ended. This had no filter on status at all, so a booking made at 14:24
        and undone at 21:46 still printed as that day's reservation, carrying a
        days-left figure from an expiry that no longer meant anything. The row
        is NOT dropped: a booking made and undone is an event of that day, and
        the desk still lists it under "Booked today", so hiding it here would
        make the two disagree. `status` and `cancelled_at` travel with the row
        so the page can mark it for what it is. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'area',    u.area, 'area_unit', COALESCE(u.area_unit,'sqft'),
           'price',   CASE WHEN v_sees_price THEN u.base_price END,
           'requested_by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'agent_code',   ag.agent_code,
           'booked_by',    rb.full_name,
           'client_name',  r.client_name,
           'token_amount', r.token_amount,
           'tag',       COALESCE(rs.status_name, 'Reserved'),
           'tag_code',  COALESCE(rs.status_code, 'RESERVED'),
           'cancelled_at', r.cancelled_at,
           'status',  r.status, 'expiry_date', r.expiry_date, 'at', r.created_at)
         ORDER BY r.created_at), '[]'::jsonb)
    INTO v_reserved
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.sales_users rb ON rb.id = r.reserved_by
    LEFT JOIN public.agents      ag ON ag.id = r.requested_by_agent_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND (r.created_at AT TIME ZONE 'Asia/Karachi')::date = v_day;

  -- 2. sold on the day — read only, from the sales the sale flow wrote
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'sale_number', s.sale_number,
           'client_name', c.full_name,
           'agent',   ag.full_name, 'agent_code', ag.agent_code,
           'amount',  CASE WHEN v_sees_price THEN s.net_amount END,
           'sale_date', s.sale_date)
         ORDER BY u.unit_no), '[]'::jsonb)
    INTO v_sold
    FROM public.sales s
    JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.agents ag ON ag.id = s.agent_id
   WHERE s.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR s.project_id = v_scope)
     AND s.status = 'active'
     AND s.sale_date = v_day;

  -- 3. falling back into stock within 48h
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'requested_by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'client_name',  r.client_name,
           'expiry_date',  r.expiry_date,
           'hours_left',   GREATEST(0, ROUND(EXTRACT(EPOCH FROM (r.expiry_date - now()))/3600.0)::int))
         ORDER BY r.expiry_date), '[]'::jsonb)
    INTO v_exp
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.status = 'active'
     AND r.expiry_date > now()
     AND r.expiry_date <= now() + interval '48 hours';

  -- 4. floor-wise available
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'floor', q.floor, 'rank', q.rank,
           'available', q.available, 'reserved', q.reserved,
           'sold', q.sold, 'total', q.total)
         ORDER BY q.rank, q.floor), '[]'::jsonb)
    INTO v_avail
    FROM (
      SELECT COALESCE(NULLIF(u.floor_label,''),'-')            AS floor,
             MIN(COALESCE(f.sort_order, u.floor_no, 999))      AS rank,
             count(*) FILTER (WHERE st.is_available)           AS available,
             count(*) FILTER (WHERE st.status_code='RESERVED') AS reserved,
             count(*) FILTER (WHERE st.status_code='SOLD')     AS sold,
             count(*)                                          AS total
        FROM public.units u
        LEFT JOIN public.floors f ON f.id = u.floor_id
        LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
       WHERE u.company_id = ANY(v_companies)
         AND (v_scope IS NULL OR u.project_id = v_scope)
       GROUP BY COALESCE(NULLIF(u.floor_label,''),'-')
    ) q;

  -- 5. every unit standing on hold right now, whoever is holding it.
  --    Ordered by the moment it comes back, because that is the order the list
  --    is acted on: the top of it is what has to be chased today.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'area',    u.area, 'area_unit', COALESCE(u.area_unit,'sqft'),
           'price',   CASE WHEN v_sees_price THEN u.base_price END,
           'requested_by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'agent_code',   ag.agent_code,
           'booked_by',    rb.full_name,
           'client_name',  r.client_name,
           'tag',       COALESCE(rs.status_name, 'Reserved'),
           'tag_code',  COALESCE(rs.status_code, 'RESERVED'),
           'reserved_at',  r.created_at,
           'expiry_date',  r.expiry_date,
           'overdue',      (r.expiry_date <= now()),
           'days_left',    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.expiry_date - now()))/86400.0)::int),
           'hours_left',   GREATEST(0, ROUND(EXTRACT(EPOCH FROM (r.expiry_date - now()))/3600.0)::int))
         ORDER BY r.expiry_date, u.unit_no), '[]'::jsonb)
    INTO v_hold
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.sales_users rb ON rb.id = r.reserved_by
    LEFT JOIN public.agents      ag ON ag.id = r.requested_by_agent_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.status = 'active';

  RETURN jsonb_build_object('success',true,
    'date', v_day, 'header', v_head,
    'reserved', v_reserved, 'sold', v_sold,
    'expiring', v_exp, 'holding', v_hold, 'available', v_avail,
    'generated_at', now(),
    'sees_price', v_sees_price);
END $function$
;

COMMIT;
