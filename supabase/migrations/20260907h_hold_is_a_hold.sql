-- ═══════════════════════════════════════════════════════════════════════════
-- A TRIGGER WAS CANCELLING THE BOOKINGS AS FAST AS THE DESK MADE THEM
--
-- Rashid booked LG-12 for Kabeer and tagged it Booked. It appeared in neither
-- the daybook nor the PDF. The row was there:
--
--     created_at  2026-09-07 17:34:03.736509
--     cancelled_at 2026-09-07 17:34:03.736509      <- the same microsecond
--     cancelled_by NULL                            <- nobody pressed anything
--
-- public._sync_reservation_on_unit_status, an AFTER UPDATE OF status_id trigger
-- on units, cancels every active reservation on a unit whose new status is not
-- one of RESERVED, SOLD, SALE_REVIEW. reserve_unit_desk inserts the reservation
-- and THEN stamps the unit, so tagging a unit On Hold or Booked cancelled the
-- reservation inside the same transaction — and left the unit stamped, with no
-- reservation behind it and no way to book it again, because reserve_unit_desk
-- refuses a unit that is not available.
--
-- THIS WAS MINE. 20260907f gave the desk two new tags without checking what
-- else keys on units.status_id. category_unit_statuses was checked, public.sales
-- was checked, pg_trigger was not.
--
-- The trigger is right to exist: moving a unit back to Available, or to Dead,
-- should release whoever was holding it. It was wrong only in believing that
-- RESERVED is the only kind of hold. On Hold and Booked are holds too.
--
-- Blast radius measured before repairing: exactly one unit, Awami LG-12, with
-- no sale and no active reservation behind it. Repaired below by REVIVING the
-- reservation rather than freeing the unit, because Rashid did book it, the
-- expiry it was given (14 Sep) is still in the future, and the unit already
-- carries the tag he chose. The repair is written to match only rows bearing
-- the trigger's signature — cancelled_at equal to created_at, cancelled_by
-- NULL — so it cannot revive anything a person actually cancelled.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. a hold is a hold, whatever it is called ─────────────────────────────
CREATE OR REPLACE FUNCTION public._sync_reservation_on_unit_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_code text;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT upper(status_code) INTO v_code FROM public.category_unit_statuses WHERE id=NEW.status_id;
    /* HOLD and BOOKED join RESERVED here because they mean the same thing about
       the unit: it is off the market and somebody is holding it. They are the
       two tags reserve_unit_desk can apply besides RESERVED, and this list must
       stay in step with the allow-list in that function — if a fourth tag is
       ever added there, it belongs here too, or the desk will silently cancel
       its own bookings again. Everything else still releases the hold: moving a
       unit back to Available, or to Dead, should let go of whoever was on it. */
    IF COALESCE(v_code,'') NOT IN ('RESERVED','SOLD','SALE_REVIEW','HOLD','BOOKED') THEN
      UPDATE public.reservations SET status='cancelled', cancelled_at=now(), updated_at=now()
      WHERE unit_id=NEW.id AND status='active';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- ── 2. give back the booking the trigger took ──────────────────────────────
-- Narrow on purpose. cancelled_at = created_at to the microsecond with a NULL
-- cancelled_by is the trigger's fingerprint and nothing else produces it:
-- cancel_reservation always records who cancelled and always runs later than
-- the insert. The unit must still carry the tag and still have no other active
-- reservation, so this cannot resurrect a hold on a unit that has moved on.
UPDATE public.reservations r
   SET status = 'active', cancelled_at = NULL, updated_at = now()
  FROM public.units u
  JOIN public.category_unit_statuses cus ON cus.id = u.status_id
 WHERE u.id = r.unit_id
   AND r.status = 'cancelled'
   AND r.cancelled_by IS NULL
   AND r.cancelled_at = r.created_at
   AND upper(cus.status_code) IN ('HOLD','BOOKED')
   AND r.expiry_date > now()
   AND NOT EXISTS (SELECT 1 FROM public.reservations x
                    WHERE x.unit_id = r.unit_id AND x.status = 'active')
   AND NOT EXISTS (SELECT 1 FROM public.sales s
                    WHERE s.unit_id = r.unit_id AND s.status = 'active');

-- ── 3. the floor table stops losing units ──────────────────────────────────
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

  /* 1. booked on the day, AND STILL STANDING.

     This had no filter on status, so a booking made at 19:24 and undone at
     21:46 kept printing as that day's reservation. The first fix marked those
     rows instead of dropping them — struck-through tag, release time, RELEASED
     pill — on the reasoning that a booking made and undone is an event of the
     day. Rashid looked at it and said no: the daybook is what stands, and a
     unit he cancelled has no business on it in any form. His call, and it is
     the right one for what this page is for — he reads it and pastes it to the
     group, where every line is taken as a unit that is off the board.

     The record is not lost. reservations keeps the cancelled row with its
     cancelled_at, and the DESK still lists it under "Booked today" with its
     status, which is the operator's own working list and is where he checked.
     What changes is only what the REPORT claims.

     Filtered here rather than in the browser so that all three surfaces — the
     PDF, the on-screen daybook and the WhatsApp text — are fixed by one line
     and none of them can forget. */
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
     AND (r.created_at AT TIME ZONE 'Asia/Karachi')::date = v_day
     AND r.status = 'active';

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

  /* 4. floor-wise position.

     This counted three states out of the eleven a project can configure:
     available, RESERVED and SOLD. Everything else sat in Total and in no
     column — so the moment the desk could stamp On Hold or Booked, a unit
     could vanish from the breakdown while still being counted in the total.
     Awami showed 1,467 total against 0+0+1,466 the evening this was found.

     On Hold and Booked now have their own columns. `other` is what is left
     over — Dead, Mortgaged, Under Transfer, Possession Given and the rest —
     and exists so the six numbers ALWAYS add up to the total. The page only
     draws that column when something is actually in it, but the arithmetic is
     closed either way, which is the point: a unit must never be able to fall
     out of this table again. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'floor', q.floor, 'rank', q.rank,
           'available', q.available, 'reserved', q.reserved,
           'hold', q.hold, 'booked', q.booked,
           'sold', q.sold, 'other', q.other, 'total', q.total)
         ORDER BY q.rank, q.floor), '[]'::jsonb)
    INTO v_avail
    FROM (
      SELECT COALESCE(NULLIF(u.floor_label,''),'-')            AS floor,
             MIN(COALESCE(f.sort_order, u.floor_no, 999))      AS rank,
             count(*) FILTER (WHERE st.is_available)           AS available,
             count(*) FILTER (WHERE upper(st.status_code)='RESERVED') AS reserved,
             count(*) FILTER (WHERE upper(st.status_code)='HOLD')     AS hold,
             count(*) FILTER (WHERE upper(st.status_code)='BOOKED')   AS booked,
             count(*) FILTER (WHERE upper(st.status_code)='SOLD')     AS sold,
             count(*) FILTER (WHERE NOT COALESCE(st.is_available,false)
                                AND COALESCE(upper(st.status_code),'') NOT IN
                                    ('RESERVED','HOLD','BOOKED','SOLD'))          AS other,
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
