-- ═══════════════════════════════════════════════════════════════════════════
-- A HOLD ENDS WHEN THE UNIT SELLS, NOT ONLY WHEN THE SALE CAME THROUGH IT.
--
-- The daybook decided a unit was no longer held by looking at
-- reservations.converted_sale_id — which is set only by the portal's own
-- submit_sale → approve_sale_submission path. A sale entered in RMS beside a
-- standing hold set nothing, so the hold stayed on "Units on Hold" for good.
--
-- Measured on the live tenant before changing anything, inside a rolled-back
-- transaction: tag a unit with a permanent status, backdate it three days,
-- then enter a sale on that unit the way RMS does. The unit reads sold
-- (_map_unit_state = 'sold') and the reservation is still active and still on
-- the holding list. Nothing today shows it, because there is not one active
-- reservation on any tenant — all 31 are cancelled. The workflow that makes
-- it certain is the new one: mark a unit "Sold - Entry Pending" now, enter
-- the sale next week, and the hold outlives the thing it was standing in for.
--
-- This is not new behaviour introduced by the nature column. It is as old as
-- the daybook; permanent holds only make it permanent and visible.
--
-- The fix is one predicate, and the reason it is a FUNCTION rather than a
-- fifth copy of the same SQL is that "sold as at a date" was already written
-- two different ways inside this one file — a join on converted_sale_id in
-- four places, and a proper point-in-time lateral in the floor table. Two
-- definitions of one fact is how the first version of this bug was born.
-- Both now call _sold_as_at, and the floor table cannot count a unit as held
-- and sold at the same time because it is the same question.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── one definition of "sold, as at a date" ────────────────────────────────
CREATE OR REPLACE FUNCTION public._sold_as_at(p_unit_id uuid, p_at_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /* Point-in-time, not "right now": a sale cancelled in November was still a
     sale in September, and a report for September has to say so. This is the
     predicate the floor table already used; the rest of the daybook now uses
     it too. */
  SELECT EXISTS (
    SELECT 1 FROM public.sales s
     WHERE s.unit_id = p_unit_id
       AND s.sale_date <= p_at_date
       AND (s.status <> 'cancelled'
            OR s.cancellation_date IS NULL
            OR s.cancellation_date::date > p_at_date))
$function$;

/* The date that sale was made, for a hold that ended because of it. */
CREATE OR REPLACE FUNCTION public._sold_on(p_unit_id uuid, p_at_date date)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT min(s.sale_date)
    FROM public.sales s
   WHERE s.unit_id = p_unit_id
     AND s.sale_date <= p_at_date
     AND (s.status <> 'cancelled'
          OR s.cancellation_date IS NULL
          OR s.cancellation_date::date > p_at_date)
$function$;

/* Read through SECURITY DEFINER functions that are already scoped by their
   callers, so they are reachable only from those callers. */
REVOKE ALL ON FUNCTION public._sold_as_at(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sold_on(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sold_as_at(uuid, date) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._sold_on(uuid, date) FROM anon, authenticated;

-- ── the standing hold list ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._daybook_held(p_companies uuid[], p_scope uuid, p_at timestamp with time zone, p_at_date date)
 RETURNS TABLE(unit_id uuid, unit_no text, floor text, rank integer, num integer, area numeric, area_unit text, base_price numeric, requested_by text, agent_code text, booked_by text, client_name text, token_amount numeric, tag text, tag_code text, created_at timestamp with time zone, expiry_date timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id, u.unit_no,
         COALESCE(NULLIF(u.floor_label,''),'-'),
         COALESCE(f.sort_order, u.floor_no, 999)::int,
         COALESCE(NULLIF(regexp_replace(u.unit_no, '\D', '', 'g'),'')::bigint, 0),
         u.area, COALESCE(u.area_unit,'sqft'), u.base_price,
         COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
         ag.agent_code, rb.full_name, r.client_name, r.token_amount,
         COALESCE(rs.status_name, 'Reserved'),
         COALESCE(upper(rs.status_code), 'RESERVED'),
         r.created_at, r.expiry_date
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.sales_users rb ON rb.id = r.reserved_by
    LEFT JOIN public.agents      ag ON ag.id = r.requested_by_agent_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
   WHERE r.company_id = ANY(p_companies)
     AND (p_scope IS NULL OR r.project_id = p_scope)
     AND r.created_at < p_at
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= p_at)
     /* A hold with no expiry never lapses, and NULL >= anything is NULL, so
        without this a permanent hold would simply be absent from the daybook
        — the unit off the market and nothing on the page saying why. */
     AND (r.expiry_date IS NULL OR r.expiry_date >= p_at)
     /* NOT "was this reservation converted into a sale", which only ever
        catches the portal's own submit-and-approve path. A unit sold in RMS
        while a hold stood on it left that hold on this list for good — the
        exact shape of "tag it Sold - Entry Pending now, enter the sale next
        week". The question is about the UNIT: once it is sold, nobody is
        holding it any more, whoever entered the sale and however. */
     AND NOT public._sold_as_at(r.unit_id, p_at_date)
$function$;

-- ── the ledger, the released list and the floor table ─────────────────────
CREATE OR REPLACE FUNCTION public.get_reservation_daybook(p_session_token text, p_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean; v_scope uuid;
        v_sees_price boolean; v_day date;
        v_reserved jsonb; v_sold jsonb; v_exp jsonb; v_avail jsonb; v_head jsonb;
        v_hold jsonb; v_rel jsonb;
        v_from date; v_to date; v_t0 timestamptz; v_t1 timestamptz;
        v_total int;
        v_ho int; v_hc int; v_hadd int;
        v_so int; v_sc int; v_sadd int;
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
  /* THE PERIOD.
     p_date is kept so an un-redeployed client keeps working: one date means a
     one-day period, which is what the daybook always was. p_from/p_to widen it.
     v_day stays as the label the page prints when the period is a single day.

     v_t0 and v_t1 are INSTANTS, not dates: midnight Karachi at the start of
     v_from and midnight Karachi at the start of the day AFTER v_to. Every
     reservation test below is done against those, so a booking made at 23:50
     on the last day of the period is inside it and one made at 00:10 the next
     morning is not — which is the whole point of asking for a range. */
  v_to   := COALESCE(p_to, p_date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_from := COALESCE(p_from, p_date, v_to);
  IF v_from > v_to THEN
    -- a range entered backwards is a slip, not a request for nothing
    v_day := v_from; v_from := v_to; v_to := v_day;
  END IF;
  v_day := v_to;
  v_t0  := (v_from::timestamp AT TIME ZONE 'Asia/Karachi');
  v_t1  := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Karachi');

  SELECT jsonb_build_object(
           'project', pr.project_name, 'project_id', pr.id,
           'company', COALESCE(co.display_name, co.company_name),
           'logo_url', co.logo_url)
    INTO v_head
    FROM public.projects pr JOIN public.companies co ON co.id = pr.company_id
   WHERE pr.id = v_scope;

  /* ── THE LEDGER ───────────────────────────────────────────────────────────
     Rashid asked for opening, movement and closing, and for nothing outside the
     range to appear. That needs a POINT-IN-TIME rule, and this is it:

       a reservation is HELD at instant T when it was created before T, was not
       cancelled before T, had not expired by T, and had not become a sale by T.

     The same four clauses decide the opening balance, the closing balance and
     which rows print. They cannot drift apart, because they are the same text
     three times over rather than three ideas that happen to agree today.

     Removed is deliberately NOT counted directly. It is opening + added −
     closing, so the four figures always reconcile; a released row that some
     query forgot would show up as an arithmetic error rather than disappear.

     units.status_id has no history, so the floor table below is built from the
     same reservation and sale predicates rather than from the unit's current
     status — otherwise a report for last week would be drawn with this week's
     board. `other` is the one exception and is documented where it is used. */

  SELECT count(*) INTO v_total
    FROM public.units u
   WHERE u.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR u.project_id = v_scope);

  SELECT count(*) INTO v_ho
    FROM public.reservations r
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t0
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t0)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t0)
     AND NOT public._sold_as_at(r.unit_id, v_from - 1);

  SELECT count(*) INTO v_hc
    FROM public.reservations r
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t1
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1)
     AND NOT public._sold_as_at(r.unit_id, v_to);

  SELECT count(*) INTO v_hadd
    FROM public.reservations r
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at >= v_t0 AND r.created_at < v_t1;

  SELECT count(*) INTO v_so
    FROM public.sales s
   WHERE s.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR s.project_id = v_scope)
     AND s.sale_date < v_from
     AND (s.status <> 'cancelled' OR s.cancellation_date IS NULL
          OR s.cancellation_date::date >= v_from);

  SELECT count(*) INTO v_sc
    FROM public.sales s
   WHERE s.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR s.project_id = v_scope)
     AND s.sale_date <= v_to
     AND (s.status <> 'cancelled' OR s.cancellation_date IS NULL
          OR s.cancellation_date::date > v_to);

  SELECT count(*) INTO v_sadd
    FROM public.sales s
   WHERE s.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR s.project_id = v_scope)
     AND s.sale_date >= v_from AND s.sale_date <= v_to;

  /* ── 1. taken in this period, and still held at the end of it ───────────── */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', q.unit_no, 'floor', q.floor,
           'area', q.area, 'area_unit', q.area_unit,
           'price', CASE WHEN v_sees_price THEN q.base_price END,
           'requested_by', q.requested_by, 'agent_code', q.agent_code,
           'booked_by', q.booked_by, 'client_name', q.client_name,
           'token_amount', q.token_amount,
           'tag', q.tag, 'tag_code', q.tag_code,
           'reserved_at', q.created_at, 'expiry_date', q.expiry_date,
           /* NULL expiry = permanent. It is never overdue and has no days
              left; sending 0 would read as "expires today", which is the
              opposite of the truth. */
           'overdue', (q.expiry_date IS NOT NULL AND q.expiry_date <= now()),
           'permanent', (q.expiry_date IS NULL),
           'days_left', CASE WHEN q.expiry_date IS NULL THEN NULL ELSE
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (q.expiry_date - now()))/86400.0)::int) END,
           'hours_left', CASE WHEN q.expiry_date IS NULL THEN NULL ELSE
             GREATEST(0, ROUND(EXTRACT(EPOCH FROM (q.expiry_date - now()))/3600.0)::int) END)
         ORDER BY q.rank, q.num, q.unit_no), '[]'::jsonb)
    INTO v_reserved
    FROM (SELECT * FROM public._daybook_held(v_companies, v_scope, v_t1, v_to) x
           WHERE x.created_at >= v_t0) q;

  /* ── 2. held from before the period, still held at the end of it ────────── */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', q.unit_no, 'floor', q.floor,
           'area', q.area, 'area_unit', q.area_unit,
           'price', CASE WHEN v_sees_price THEN q.base_price END,
           'requested_by', q.requested_by, 'agent_code', q.agent_code,
           'booked_by', q.booked_by, 'client_name', q.client_name,
           'tag', q.tag, 'tag_code', q.tag_code,
           'reserved_at', q.created_at, 'expiry_date', q.expiry_date,
           /* NULL expiry = permanent. It is never overdue and has no days
              left; sending 0 would read as "expires today", which is the
              opposite of the truth. */
           'overdue', (q.expiry_date IS NOT NULL AND q.expiry_date <= now()),
           'permanent', (q.expiry_date IS NULL),
           'days_left', CASE WHEN q.expiry_date IS NULL THEN NULL ELSE
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (q.expiry_date - now()))/86400.0)::int) END,
           'hours_left', CASE WHEN q.expiry_date IS NULL THEN NULL ELSE
             GREATEST(0, ROUND(EXTRACT(EPOCH FROM (q.expiry_date - now()))/3600.0)::int) END)
         ORDER BY q.rank, q.num, q.unit_no), '[]'::jsonb)
    INTO v_hold
    FROM (SELECT * FROM public._daybook_held(v_companies, v_scope, v_t1, v_to) x
           WHERE x.created_at < v_t0) q;

  /* ── 3. sold inside the period ─────────────────────────────────────────── */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'sale_number', s.sale_number,
           'client_name', c.full_name,
           'agent',   ag.full_name, 'agent_code', ag.agent_code,
           'amount',  CASE WHEN v_sees_price THEN s.net_amount END,
           'sale_date', s.sale_date)
         ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                  COALESCE(NULLIF(regexp_replace(u.unit_no, '\D', '', 'g'),'')::bigint, 0),
                  u.unit_no), '[]'::jsonb)
    INTO v_sold
    FROM public.sales s
    JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.agents ag ON ag.id = s.agent_id
   WHERE s.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR s.project_id = v_scope)
     AND s.sale_date >= v_from AND s.sale_date <= v_to
     AND (s.status <> 'cancelled' OR s.cancellation_date IS NULL
          OR s.cancellation_date::date > v_to);

  /* ── 4. let go inside the period — the minus line, named ────────────────── */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_no', u.unit_no,
           'floor',   COALESCE(NULLIF(u.floor_label,''),'-'),
           'requested_by', COALESCE(NULLIF(TRIM(r.requested_by_name),''),'-'),
           'agent_code',   ag.agent_code,
           'tag',       COALESCE(rs.status_name, 'Reserved'),
           'tag_code',  COALESCE(rs.status_code, 'RESERVED'),
           'reserved_at', r.created_at,
           /* A hold ends because it was cancelled, because the unit sold, or
              because the clock ran out. "Sold" used to mean only a sale made
              THROUGH the reservation; a unit sold beside it read as 'lapsed',
              which is a different story about the same unit. */
           'went', CASE WHEN r.cancelled_at IS NOT NULL AND r.cancelled_at < v_t1 THEN 'cancelled'
                        WHEN public._sold_as_at(r.unit_id, v_to)                   THEN 'sold'
                        ELSE 'lapsed' END,
           /* A permanent hold has no expiry, so when a sale is what ended it
              the sale's own date is the only honest answer. */
           'went_at', COALESCE(r.cancelled_at, r.expiry_date,
                               public._sold_on(r.unit_id, v_to)::timestamptz))
         ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                  COALESCE(NULLIF(regexp_replace(u.unit_no, '\D', '', 'g'),'')::bigint, 0),
                  u.unit_no), '[]'::jsonb)
    INTO v_rel
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.agents ag ON ag.id = r.requested_by_agent_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     -- it was held at the start of the period or taken during it ...
     AND r.created_at < v_t1
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t0)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t0)
     -- ... and it was not still held at the end of it
     AND NOT (r.created_at < v_t1
              AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
              AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1)
              AND NOT public._sold_as_at(r.unit_id, v_to));

  /* ── 5. floor-wise, AS AT THE END OF THE PERIOD ─────────────────────────
     Built from the same held/sold predicates as the ledger, not from
     units.status_id, so a report for a past period is drawn with that period's
     board rather than today's. `other` is the one figure that cannot be:
     a unit marked Dead has no date on it, so it counts as Dead throughout. It
     is rendered only when non-zero and is documented on the page. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'floor', q.floor, 'rank', q.rank,
           'available', q.available, 'reserved', q.reserved,
           'hold', q.hold, 'booked', q.booked,
           'sold', q.sold, 'other', q.other, 'total', q.total)
         ORDER BY q.rank, q.floor), '[]'::jsonb)
    INTO v_avail
    FROM (
      SELECT COALESCE(NULLIF(u.floor_label,''),'-')       AS floor,
             MIN(COALESCE(f.sort_order, u.floor_no, 999)) AS rank,
             count(*) FILTER (WHERE h.tag_code = 'RESERVED')                    AS reserved,
             count(*) FILTER (WHERE h.tag_code = 'HOLD')                        AS hold,
             count(*) FILTER (WHERE h.tag_code = 'BOOKED')                      AS booked,
             count(*) FILTER (WHERE sl.id IS NOT NULL)                          AS sold,
             count(*) FILTER (WHERE h.unit_id IS NULL AND sl.id IS NULL
                                AND NOT COALESCE(st.is_available,false))        AS other,
             count(*) FILTER (WHERE h.unit_id IS NULL AND sl.id IS NULL
                                AND COALESCE(st.is_available,false))            AS available,
             count(*)                                                           AS total
        FROM public.units u
        LEFT JOIN public.floors f ON f.id = u.floor_id
        LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
        LEFT JOIN LATERAL (
          SELECT r.unit_id, COALESCE(upper(cus.status_code),'RESERVED') AS tag_code
            FROM public.reservations r
            LEFT JOIN public.category_unit_statuses cus ON cus.id = r.unit_status_id
           WHERE r.unit_id = u.id
             AND r.created_at < v_t1
             AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
             AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1)
             AND NOT public._sold_as_at(u.id, v_to)
           LIMIT 1) h ON true
        /* The same question the helper answers, asked the same way, so the
           floor table cannot count a unit as both held and sold. */
        LEFT JOIN LATERAL (
          SELECT 1 AS id WHERE public._sold_as_at(u.id, v_to)
          ) sl ON true
       WHERE u.company_id = ANY(v_companies)
         AND (v_scope IS NULL OR u.project_id = v_scope)
       GROUP BY COALESCE(NULLIF(u.floor_label,''),'-')
    ) q;

  /* Kept so the summary's 48-hour figure still means something. Always measured
     from NOW, never from the period, because it is about what happens next. */
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
     /* Explicit rather than relying on NULL comparisons quietly excluding
        them: this list is "what lapses next", and a permanent hold never
        does. */
     AND r.expiry_date IS NOT NULL
     AND r.expiry_date > now()
     AND r.expiry_date <= now() + interval '48 hours';

  RETURN jsonb_build_object('success',true,
    'date', v_day, 'from', v_from, 'to', v_to,
    'single_day', (v_from = v_to),
    'header', v_head,
    'reserved', v_reserved, 'sold', v_sold,
    'expiring', v_exp, 'holding', v_hold, 'released', v_rel,
    'available', v_avail,
    'ledger', jsonb_build_object(
      'total', v_total,
      'held',      jsonb_build_object('opening', v_ho, 'added', v_hadd,
                                      'removed', v_ho + v_hadd - v_hc, 'closing', v_hc),
      'sold',      jsonb_build_object('opening', v_so, 'added', v_sadd,
                                      'removed', v_so + v_sadd - v_sc, 'closing', v_sc),
      'available', jsonb_build_object('opening', v_total - v_ho - v_so,
                                      'closing', v_total - v_hc - v_sc)),
    'generated_at', now(),
    'sees_price', v_sees_price);
END $function$;

COMMIT;
