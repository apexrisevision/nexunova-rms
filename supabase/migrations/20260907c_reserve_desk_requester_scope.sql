-- ═══════════════════════════════════════════════════════════════════════════
-- RESERVE DESK — the requester picker stops offering the whole dealer group
--
-- Measured on Awami before this: the picker carried 123 agent entries for 93
-- real people, because an umbrella session spans Awami + FMH + Fourteen Group
-- and each person holds one agent row per tenant. 21 display names repeated;
-- 17 of those were the SAME person in another tenant — same name, same code,
-- same phone — so no amount of decorating the label could separate them.
--
-- A requester is the person who asked for THIS unit. Booking an Awami unit and
-- being offered an FMH agent row is not a display problem, it is an attribution
-- one: reserve_unit_desk validates the agent against the whole group, so the
-- booking succeeds and requested_by_agent_id quietly points at another tenant's
-- row. Dealer-wise reporting for the project then joins the wrong side.
--
-- TWO CHANGES, both to the requester list only:
--   1. AGENTS are scoped to the company that owns the project being booked.
--      Units and the board keep the umbrella scope — an umbrella dealer must
--      still SEE and BOOK the whole group's inventory. Only who can be credited
--      narrows, and it narrows to the tenant whose books will carry the sale.
--   2. company_name is returned, so the client can break a tie that survives
--      the name + code + phone label. It is a label, nothing more.
--
-- PORTAL MEMBERS are deliberately NOT scoped the same way. sales_users live in
-- the umbrella HOME company (Awami holds all 26); scoping them to the unit's
-- company would empty that half of the list for every FMH or KBH unit. They
-- stay on the session's own company, which is where they actually exist.
--
-- Nothing else changes: same session gate, same _sales_may_sell, same
-- lead_entry block, same _sales_sees_prices / _sales_sees_sold_price, same unit
-- index, same today list. No write path, no permission change.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_reserve_desk(
  p_session_token text, p_project_id uuid DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.get_reserve_desk(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reserve_desk(text,uuid) TO anon, authenticated;

COMMIT;
