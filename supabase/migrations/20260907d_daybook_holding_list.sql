-- ═══════════════════════════════════════════════════════════════════════════
-- DAYBOOK — the standing hold list
--
-- The report could say what was booked TODAY and what falls away within 48
-- hours, but not the thing the desk is actually asked: which units are off the
-- market right now, who is holding each one, and when it comes back. Those rows
-- were in no part of the payload — `reserved` is that one date, and `expiring`
-- is a 48-hour slice of the same set.
--
-- `holding` is every ACTIVE reservation in the scoped project AS AT THE MOMENT
-- THE REPORT IS RUN — not as at p_date. The distinction is real: a 07 Sep
-- daybook printed on the 10th lists the holds standing on the 10th, and the
-- section is labelled with the generation time so the page says so itself.
-- Holds as they stood on a past date cannot be reconstructed from this schema:
-- reservations carry a current status, not a history, so a row released last
-- week is indistinguishable from one released an hour ago.
--
-- `overdue` is not a mistake in the query. A reservation whose expiry_date has
-- passed but whose status is still 'active' is a unit the sweep has not yet
-- released; it is on nobody's list today. It belongs on this one, marked, and
-- the report is the right place to notice it.
--
-- Additive: every existing key comes back unchanged, so a client that has not
-- been redeployed keeps working. Price obeys _sales_sees_prices exactly as the
-- other sections do. Body copied from pg_get_functiondef() on live, per the rule
-- that the repo is not the source of truth for these bodies.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.status = 'active';

  RETURN jsonb_build_object('success',true,
    'date', v_day, 'header', v_head,
    'reserved', v_reserved, 'sold', v_sold,
    'expiring', v_exp, 'holding', v_hold, 'available', v_avail,
    'generated_at', now(),
    'sees_price', v_sees_price);
END $function$;

COMMIT;
