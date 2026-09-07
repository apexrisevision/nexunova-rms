-- ═══════════════════════════════════════════════════════════════════════════
-- RESERVE DESK — STAGE 1 (additive only)
--
-- The Awami Market handover: one person takes reservation requests off a
-- WhatsApp group ("Unit LG-12 reserve kar do") and books them himself, at
-- volume. 1,467 units on 7 floors, all Available today. Browsing a board of
-- 1,467 tiles is the wrong instrument for that job; typing the unit number is
-- the right one. This file is the data side of that desk.
--
-- WHAT THIS FILE DOES NOT DO — on purpose:
--   · it does not touch reserve_unit(). The portal board and the unit map both
--     call it, cron_expire_reservations depends on what it writes, and its LIVE
--     body carries three things the repo copy does not (_sales_may_sell, the
--     lead_entry block, the is_umbrella group span). reserve_unit_desk() is a
--     sibling, not a replacement, so none of that can be lost by accident.
--   · it does not change get_availability_board() or get_my_reservations().
--     Both need the new requester to surface properly, but both are read by
--     every tenant, so they are Stage 2 and separately approved.
--   · it creates no sale. The daybook READS public.sales and never writes it.
--
-- THE RECORD THIS ADDS. Until now a reservation could only say who CLICKED it
-- (reservations.reserved_by). When one person books for the whole team that
-- column is the same name 1,467 times and the useful fact — whose customer this
-- is — was nowhere. Three columns fix that, in the order identity should be
-- resolved:
--     requested_by_agent_id       → the agents master, the canonical identity
--                                   (20260617_sale_agent_link_phase1 established
--                                   it, deduped by CNIC; dealer-wise reporting
--                                   fragments on anything else)
--     requested_by_sales_user_id  → a portal member with no agent record yet
--     requested_by_name           → free text, the fallback, never the default
-- The name column is always written, even when an id is present, so a report
-- never has to join to render a row and a deleted agent does not erase history.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS requested_by_name          text,
  ADD COLUMN IF NOT EXISTS requested_by_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_agent_id      uuid REFERENCES public.agents(id)      ON DELETE SET NULL;

-- client_name was NOT NULL from Phase 1, when the only way to reserve was a
-- salesperson standing in front of their own customer. On this desk the buyer is
-- usually not known yet — only who asked for the unit. Keeping the constraint
-- would force an invented name, and that invented name rides
-- convert_reservation_prefill straight into the real sale's client. Widening the
-- column is the smaller risk by a wide margin.
--
-- Safe in both directions: no existing row is NULL (checked before running), so
-- re-adding NOT NULL needs no backfill. Readers must tolerate NULL — the two
-- that surface it (get_my_reservations, get_reservations_admin) already pass it
-- through as jsonb null, and the screens that print it are guarded in Stage 3.
ALTER TABLE public.reservations ALTER COLUMN client_name DROP NOT NULL;

COMMENT ON COLUMN public.reservations.client_name IS
  'The buyer, when known. NULL is legitimate for a desk booking taken on a requester''s word before the buyer is named.';

COMMENT ON COLUMN public.reservations.requested_by_agent_id IS
  'Who asked for this unit, as an agents-master row. Preferred identity: dealer-wise reporting groups on this. NULL when the requester has no agent record.';
COMMENT ON COLUMN public.reservations.requested_by_sales_user_id IS
  'Who asked for this unit, as a portal member, when they have no agents row. Second choice after requested_by_agent_id.';
COMMENT ON COLUMN public.reservations.requested_by_name IS
  'The requester''s name as stored at the time of booking. Always written, even when an id is present, so a report never needs a join and a later delete cannot erase who asked.';

-- dealer-wise daybook reads; partial because most rows carry no agent
CREATE INDEX IF NOT EXISTS reservations_requested_agent_idx
  ON public.reservations (requested_by_agent_id) WHERE requested_by_agent_id IS NOT NULL;
-- the daybook's own lookup: one company, one day
CREATE INDEX IF NOT EXISTS reservations_company_created_idx
  ON public.reservations (company_id, created_at);

-- ── 2. get_reserve_desk — everything the desk needs, in one call ────────────
-- The unit index is deliberately short-keyed. 1,467 units go over the wire once
-- per session and are matched in the browser, so typing a unit number costs no
-- round trip at all. Long keys would roughly double a payload that exists only
-- to be typed against.
--
-- Reserved units carry their holder inline (h). That is the answer to "who has
-- LG-12?" arriving in the group while the operator is still typing — without it
-- they would have to leave the desk to find out.
--
-- Price obeys _sales_sees_prices / _sales_sees_sold_price exactly as
-- get_availability_board does. A faster screen is not a reason to show a number
-- the role is not allowed to see.
CREATE OR REPLACE FUNCTION public.get_reserve_desk(
  p_session_token text, p_project_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_scope uuid; v_group uuid; v_companies uuid[]; v_span boolean;
        v_sees_price boolean; v_sees_sold boolean;
        v_units jsonb; v_req jsonb; v_today jsonb; v_projects jsonb; v_pk_today date;
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
  v_sees_sold  := public._sales_sees_sold_price(p_session_token);
  v_pk_today   := (now() AT TIME ZONE 'Asia/Karachi')::date;

  -- projects the desk may switch between
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.project_name, 'company', co.company_name)
         ORDER BY co.company_name, p.project_name), '[]'::jsonb)
    INTO v_projects
    FROM public.projects p
    JOIN public.companies co ON co.id = p.company_id
   WHERE p.company_id = ANY(v_companies);

  -- the typed-against index
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
           -- who holds it, for an instant answer in the group
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

  -- requester picker: the agents master first, then portal members who have no
  -- agent row yet. A member WITH an agent row is deliberately omitted here — she
  -- already appears as her agent, and offering both would let the same person be
  -- recorded two different ways, which is the exact fragmentation this avoids.
  --
  -- Portal members are filtered to the roles that carry customers, read from
  -- lead_role_config.can_have_leads — the SAME row _sales_may_sell() reads, so
  -- there is one definition of "handles customers" and not a second list here to
  -- drift out of step with it. Accounts, HR, reception, engineers and general
  -- staff never ask for a unit, and on a picker used dozens of times a day their
  -- names are noise between the operator and the name they want.
  -- NOTE: this definition includes lead_entry, which does handle customers even
  -- though it may not book. Excluding it is one added predicate, not a redesign.
  -- Agents are NOT filtered: an agent row is not a portal role.
  -- agents FIRST, explicitly. Ordering on the kind string would sort 'user'
  -- above 'agent' and quietly invert the whole point of resolving against the
  -- master: the first name the operator sees is the one they will pick.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'kind' = 'agent') DESC, x->>'name'), '[]'::jsonb)
    INTO v_req
    FROM (
      SELECT jsonb_build_object('kind','agent','id',a.id,'name',a.full_name,
               'code',a.agent_code,'phone',a.phone) AS x
        FROM public.agents a
       WHERE a.company_id = ANY(v_companies) AND a.status = 'active'
      UNION ALL
      SELECT jsonb_build_object('kind','user','id',s.id,'name',s.full_name,
               'code',NULL,'phone',s.phone)
        FROM public.sales_users s
        JOIN public.lead_role_config lrc ON lrc.role = s.role
       WHERE s.company_id = ANY(v_companies) AND s.is_active
         AND COALESCE(s.status,'active') = 'active'
         AND s.agent_id IS NULL
         AND lrc.can_have_leads
    ) q;

  -- what this operator has already booked today (Pakistan day, not UTC)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no,
           'floor', COALESCE(NULLIF(u.floor_label,''),'-'),
           'by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'client_name', r.client_name,
           'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at)
         ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_today
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
   WHERE r.company_id = ANY(v_companies)
     AND r.reserved_by = v_ses.sales_user_id
     AND (now() AT TIME ZONE 'Asia/Karachi')::date = (r.created_at AT TIME ZONE 'Asia/Karachi')::date;

  RETURN jsonb_build_object('success',true,
    'scope_project_id', v_ses.project_id, 'projects', v_projects,
    'units', v_units, 'requesters', v_req, 'today', v_today,
    'pk_today', v_pk_today, 'sees_price', v_sees_price);
END $function$;

-- ── 3. reserve_unit_desk — the booking itself ──────────────────────────────
-- A sibling of reserve_unit(), not a replacement. It keeps every safety
-- property of the original, deliberately and identically:
--   · SELECT … FOR UPDATE on the unit, so a concurrent booking BLOCKS here
--   · availability re-read INSIDE that lock, never trusted from the caller
--   · the active-reservation check inside the lock, plus
--     EXCEPTION WHEN unique_violation as the backstop that makes a second
--     active reservation on one unit a database-level impossibility
--   · the same RESERVED status flip, so cron_expire_reservations, the unit map
--     and the availability board keep working on what this writes
--
-- Three things differ, and only these three:
--   1. the REQUESTER is required and the CLIENT is optional. On this desk the
--      buyer's name usually is not known yet — only who asked. Forcing a client
--      name would mean inventing one, and that invented name would ride
--      convert_reservation_prefill straight into the eventual sale.
--   2. expiry is 1–90 days instead of the hardcoded {3,7}.
--   3. the requester's name is resolved SERVER-SIDE from the id. What the
--      browser typed is never what gets stored when an id is present.
CREATE OR REPLACE FUNCTION public.reserve_unit_desk(
  p_session_token   text,
  p_unit_id         uuid,
  p_requested_by_agent_id      uuid    DEFAULT NULL,
  p_requested_by_sales_user_id uuid    DEFAULT NULL,
  p_requested_by_name          text    DEFAULT NULL,
  p_client_name     text    DEFAULT NULL,
  p_client_phone    text    DEFAULT NULL,
  p_expiry_days     integer DEFAULT 7,
  p_token_received  boolean DEFAULT false,
  p_token_amount    numeric DEFAULT 0,
  p_note            text    DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_unit public.units;
        v_group uuid; v_companies uuid[]; v_span boolean;
        v_reserved_status uuid; v_days int; v_res_id uuid; v_expiry timestamptz;
        v_agent public.agents; v_ruser public.sales_users; v_rname text;
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

  -- ── THE LOCK ──────────────────────────────────────────────────────────────
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

  SELECT id INTO v_reserved_status FROM public.category_unit_statuses
   WHERE company_id = v_unit.company_id AND project_id = v_unit.project_id
     AND (LOWER(status_code) = 'reserved' OR status_name ILIKE '%reserved%')
     AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_reserved_status IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_reserved_status',
      'message','This project has no Reserved status configured.'); END IF;

  v_expiry := now() + (v_days || ' days')::interval;

  INSERT INTO public.reservations
    (company_id, project_id, unit_id, reserved_by,
     requested_by_agent_id, requested_by_sales_user_id, requested_by_name,
     client_name, client_phone, expiry_date,
     token_received, token_amount, note, status)
  VALUES
    (v_unit.company_id, v_unit.project_id, p_unit_id, v_ses.sales_user_id,
     p_requested_by_agent_id, p_requested_by_sales_user_id, v_rname,
     NULLIF(TRIM(COALESCE(p_client_name,'')),''),
     NULLIF(TRIM(COALESCE(p_client_phone,'')),''),
     v_expiry,
     COALESCE(p_token_received,false), COALESCE(p_token_amount,0),
     NULLIF(TRIM(COALESCE(p_note,'')),''), 'active')
  RETURNING id INTO v_res_id;

  UPDATE public.units SET status_id = v_reserved_status, updated_at = now()
   WHERE id = p_unit_id AND company_id = v_unit.company_id;

  RETURN jsonb_build_object('success',true,
    'reservation_id', v_res_id, 'unit_no', v_unit.unit_no,
    'requested_by', v_rname, 'expiry_date', v_expiry, 'expiry_days', v_days);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.');
END $function$;

-- ── 4. get_reservation_daybook — the day, as a document ────────────────────
-- Four sections, because four different questions get asked at the end of a day:
--   reserved   what did we book today, and who asked for it
--   sold       what actually sold today — READ ONLY from public.sales. This
--              function never writes a sale and never calls the sale flow.
--   expiring   what falls back into stock within 48h, so it can be chased
--              before it is lost rather than after
--   available  floor-wise counts, which is the number the group actually wants
--
-- p_date is a Pakistan calendar day, not a UTC one. At 02:00 PKT those differ,
-- and a day book that silently ends at 05:00 local is worse than no day book.
CREATE OR REPLACE FUNCTION public.get_reservation_daybook(
  p_session_token text, p_date date DEFAULT NULL, p_project_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean; v_scope uuid;
        v_sees_price boolean; v_day date;
        v_reserved jsonb; v_sold jsonb; v_exp jsonb; v_avail jsonb; v_head jsonb;
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

  -- 1. booked on the day
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
           'status',  r.status, 'expiry_date', r.expiry_date, 'at', r.created_at)
         ORDER BY r.created_at), '[]'::jsonb)
    INTO v_reserved
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.sales_users rb ON rb.id = r.reserved_by
    LEFT JOIN public.agents      ag ON ag.id = r.requested_by_agent_id
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

  RETURN jsonb_build_object('success',true,
    'date', v_day, 'header', v_head,
    'reserved', v_reserved, 'sold', v_sold,
    'expiring', v_exp, 'available', v_avail,
    'sees_price', v_sees_price);
END $function$;

-- ── 5. Grants — the session token is the gate, exactly as the module does ───
REVOKE ALL ON FUNCTION public.get_reserve_desk(text,uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reservation_daybook(text,date,uuid)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_reserve_desk(text,uuid)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reservation_daybook(text,date,uuid)   TO anon, authenticated;

COMMIT;
