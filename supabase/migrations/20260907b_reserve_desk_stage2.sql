-- ═══════════════════════════════════════════════════════════════════════════
-- RESERVE DESK — STAGE 2: the requester becomes visible
--
-- Stage 1 recorded who asked for a unit. Nothing reads it yet. These four
-- functions are where it has to surface, and three of them are read by EVERY
-- tenant — so each body below was taken from pg_get_functiondef() on the live
-- database, not from this repo, and only the named lines were changed. The
-- repo's copies of these are stale by several migrations: reserve_unit's live
-- body alone carries _sales_may_sell, the lead_entry block and the is_umbrella
-- group span that the repo has never seen. Preserved here verbatim:
-- _sales_may_sell, _sales_role_of, is_umbrella / v_span, _sales_sees_prices,
-- _sales_sees_sold_price.
--
-- 1. get_availability_board   + requested_by_name beside reserved_by_name
-- 2. get_my_reservations      also mine when I asked for it, not only booked it
-- 3. convert_reservation_prefill + requested_by_name, so the convert banner can
--                             name a person when the buyer is not named yet
-- 4. get_reserve_desk         lead_entry out of the requester picker
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. get_availability_board ──────────────────────────────────────────────
-- ONE line differs from live: the 'reservation' object gains requested_by_name.
--
-- Why it matters more than it looks. reserved_by_name is whoever pressed the
-- button. On the Awami desk that is the same person 1,467 times, so every card
-- in the tower would read "RESERVED by Rashid Manzoor" and no rep would ever
-- find their own unit on the shared board. requested_by_name is the fact the
-- board is actually being read for.
--
-- It stays inside the existing privacy line: reserved_by_name and sold_by are
-- already staff names on this board, and the CLIENT is still not returned here
-- (that is admin-only, and deliberately so — anti client-poaching, R2).
-- NULL on every pre-Stage-1 row, which the UI renders as the old text.
CREATE OR REPLACE FUNCTION public.get_availability_board(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_scope uuid; v_group uuid; v_companies uuid[]; v_span boolean; v_result jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_scope := COALESCE(v_ses.project_id, p_project_id);
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id=v_group AND status='active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  SELECT jsonb_build_object('success',true,'scope_project_id',v_ses.project_id,'grouped',v_span,
           'projects', COALESCE(jsonb_agg(proj ORDER BY proj->>'company_name', proj->>'project_name'), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name, 'company_id', p.company_id, 'company_name', co.company_name,
      'counts', jsonb_build_object('available', count(*) FILTER (WHERE st.is_available),
        'reserved', count(*) FILTER (WHERE st.status_code='RESERVED'),
        'sold', count(*) FILTER (WHERE st.status_code='SOLD'), 'total', count(*)),
      'units', COALESCE(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'unit_no', u.unit_no, 'area', u.area, 'area_unit', COALESCE(u.area_unit,'sqft'),
        'base_price', CASE WHEN public._sales_sees_prices(p_session_token) AND (st.status_code <> 'SOLD' OR public._sales_sees_sold_price(p_session_token)) THEN u.base_price END,
        'floor_label', COALESCE(NULLIF(u.floor_label,''), 'Floor '||COALESCE(u.floor_no::text,'-')),
        'floor_no', COALESCE(u.floor_no, 0), 'floor_rank', COALESCE(f.sort_order, u.floor_no, 999),
        'status_code', st.status_code, 'status_name', st.status_name, 'color_hex', st.color_hex,
        'is_available', COALESCE(st.is_available,false),
        'reservation', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('reserved_by_name', su.full_name, 'requested_by_name', r.requested_by_name, 'expiry_date', r.expiry_date) ELSE NULL END,
        'sold_by', CASE WHEN st.status_code='SOLD' THEN COALESCE(ag.full_name, seller.full_name) ELSE NULL END
      ) ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                 COALESCE(NULLIF(substring(u.unit_no FROM '(\d+)$'),'')::int, 0), u.unit_no), '[]'::jsonb)
    ) AS proj
    FROM public.projects p
    JOIN public.companies co ON co.id=p.company_id
    JOIN public.units u ON u.project_id=p.id AND u.company_id=p.company_id
    LEFT JOIN public.floors f ON f.id=u.floor_id
    LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
    LEFT JOIN public.reservations r ON r.unit_id=u.id AND r.status='active'
    LEFT JOIN public.sales_users su ON su.id=r.reserved_by
    LEFT JOIN LATERAL (SELECT s.agent_id FROM public.sales s WHERE s.unit_id=u.id AND s.company_id=p.company_id AND s.status='active' ORDER BY s.sale_date DESC NULLS LAST LIMIT 1) sale ON true
    LEFT JOIN public.agents ag ON ag.id=sale.agent_id
    LEFT JOIN LATERAL (SELECT su2.full_name FROM public.reservations r2 JOIN public.sales_users su2 ON su2.id=r2.reserved_by WHERE r2.unit_id=u.id AND r2.status='converted' ORDER BY r2.updated_at DESC LIMIT 1) seller ON true
    WHERE p.company_id = ANY(v_companies) AND (v_scope IS NULL OR p.id=v_scope)
    GROUP BY p.id, p.project_name, p.company_id, co.company_name
  ) q;
  RETURN v_result;
END; $function$;

-- ── 2. get_my_reservations ─────────────────────────────────────────────────
-- "My Bookings" meant "rows where I pressed the button". With one operator
-- booking for the whole team that gave the operator everything and every rep
-- nothing.
--
-- THE THIRD ARM IS NOT DECORATION. Rule 2 as first stated matched only
-- requested_by_sales_user_id. But the picker resolves against the agents master
-- FIRST — by design — so when the operator picks a rep who has an agent row,
-- requested_by_sales_user_id is NULL and requested_by_agent_id carries the
-- identity. Measured on Awami before writing this: 14 of 16 active agents are
-- also portal members, so a two-arm test would have missed the ordinary case
-- and matched only the exception. sales_users.agent_id is the link back
-- (20260617_sale_agent_link_phase1: "Sale Agent = Sale User = ONE identity"),
-- so the third arm is what makes the second one mean anything.
CREATE OR REPLACE FUNCTION public.get_my_reservations(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF; IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'company_name', co.company_name,
    'area', u.area, 'area_unit', u.area_unit, 'base_price', u.base_price,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at,
    'requested_by_name', r.requested_by_name,
    -- lets the screen separate "I booked this" from "I asked for this", which
    -- are now two different things for the same person
    'booked_by_me', (r.reserved_by = v_ses.sales_user_id)
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.reservations r
  JOIN public.units u ON u.id=r.unit_id
  LEFT JOIN public.projects p ON p.id=r.project_id
  LEFT JOIN public.companies co ON co.id=r.company_id
  WHERE r.reserved_by=v_ses.sales_user_id
     OR r.requested_by_sales_user_id=v_ses.sales_user_id
     OR (v_su.agent_id IS NOT NULL AND r.requested_by_agent_id=v_su.agent_id);
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $function$;

-- ── 3. convert_reservation_prefill ─────────────────────────────────────────
-- The convert banner reads client_name. On a desk booking that is NULL, so it
-- rendered "Converting the reservation for <strong></strong>" — an empty name
-- where the one useful fact belongs. Returning the requester lets it say
-- "Converting LG-12 — requested by Fawad khan, buyer not named yet".
--
-- Additive only: every existing key is still returned in place, so a client
-- that has not been redeployed behaves exactly as before. The admin gate
-- (_rms_caller + _rms_is_admin), the not_active guard and the already_sold
-- guard are untouched.
CREATE OR REPLACE FUNCTION public.convert_reservation_prefill(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_res public.reservations; v_unit public.units;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_res.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'error','not_active','message','This reservation is '||v_res.status||' and can no longer be converted.'); END IF;
  SELECT * INTO v_unit FROM public.units WHERE id=v_res.unit_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE unit_id=v_res.unit_id AND company_id=v_me.company_id AND status='active') THEN
    RETURN jsonb_build_object('success',false,'error','already_sold','message','This unit already has an active sale — release this reservation instead.'); END IF;
  RETURN jsonb_build_object('success',true,'reservation', jsonb_build_object(
    'reservation_id', v_res.id, 'unit_id', v_res.unit_id, 'unit_no', v_unit.unit_no,
    'project_id', v_res.project_id, 'client_id', v_res.client_id,
    'client_name', v_res.client_name, 'client_phone', v_res.client_phone,
    'token_received', v_res.token_received, 'token_amount', v_res.token_amount,
    'requested_by_name', v_res.requested_by_name,
    'requested_by_agent_code', (SELECT a.agent_code FROM public.agents a WHERE a.id = v_res.requested_by_agent_id)));
END; $function$;

-- ── 4. get_reserve_desk ────────────────────────────────────────────────────
-- lead_entry leaves the requester picker. can_have_leads is true for it, so the
-- Stage 1 filter let it through — but reserve_unit and reserve_unit_desk both
-- refuse lead_entry by a separate check, and a name that can be picked and then
-- fails with role_cannot_sell teaches the operator nothing. A picker should
-- only offer what works.
--
-- Everything else is Stage 1 verbatim.
CREATE OR REPLACE FUNCTION public.get_reserve_desk(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
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
  -- lead_entry is excluded on top of that: booking refuses it by a separate
  -- check, and offering a name that always fails is worse than not offering it.
  -- Agents are NOT filtered: an agent row is not a portal role.
  --
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
         AND s.role <> 'lead_entry'
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

-- ── Grants: unchanged posture, restated because CREATE OR REPLACE does not
--    alter them and an explicit line is cheaper than trusting memory. ────────
REVOKE ALL ON FUNCTION public.get_availability_board(text,uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_reservations(text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reserve_desk(text,uuid)              FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_board(text,uuid)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_reservations(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reserve_desk(text,uuid)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_reservation_prefill(uuid)     TO anon, authenticated;

COMMIT;
