-- ═══════════════════════════════════════════════════════════════════════════
-- A STATUS NOW SAYS WHAT KIND OF THING IT IS.
--
-- The desk could apply exactly three tags — Hold, Reserved, Booked — because
-- those three codes were written into reserve_unit_desk, into
-- get_reserve_desk, and into the trigger that keeps units and reservations in
-- step. Adding a fourth meant editing all three in the same breath, and the
-- comment on that trigger said so in as many words. "Verbally Hold" and
-- "Landowner" turn those three lists into one column.
--
--   nature = 'temporary'   holds the unit for a number of days and lapses on
--                          its own, exactly as Hold/Reserved/Booked do today
--   nature = 'permanent'   takes the unit off the market with NO expiry and
--                          stays until somebody releases it by hand
--   nature = NULL          not a desk tag at all
--
-- NULL is the important one. Sold, On Installment, Possession Given, Under
-- Transfer, Mortgaged and Under Sale Review all describe a unit that already
-- has a SALE, and this desk writes no sale. Measured before deciding: 428 of
-- 428 SOLD units on the live tenants have an active sale behind them. If the
-- desk could stamp Sold, the sales register, the receivables and the
-- commission report would each tell a different story about the same unit.
-- They keep nature NULL and stay out of the desk's reach, and a check below
-- makes that structural rather than a matter of remembering.
--
-- PERMANENT IS A MISSING DATE, not a date far in the future. expiry_date
-- becomes nullable, and the two functions that decide whether a hold still
-- stands already read NULL correctly:
--   _map_unit_state           'reserved' WHEN expiry_date IS NULL OR > now()
--   cron_expire_reservations  sweeps only WHERE expiry_date < now()
-- A sentinel date in 9999 would have every report computing days-left in the
-- millions. What NULL does NOT survive is every "expiry_date >= x" filter,
-- because NULL >= anything is NULL: seven of them in the daybook would have
-- silently dropped permanent holds off the page, leaving a unit off the
-- market with nothing anywhere saying why. All seven are fixed here, and the
-- 48-hour "expiring next" list now excludes them on purpose rather than by
-- accident of a NULL comparison.
--
-- Additive: every existing status keeps behaving exactly as it does, because
-- the backfill gives Hold, Reserved and Booked the nature they already had
-- in practice.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the column ──────────────────────────────────────────────────────────
ALTER TABLE public.category_unit_statuses
  ADD COLUMN IF NOT EXISTS nature    text,
  ADD COLUMN IF NOT EXISTS hold_days int;

COMMENT ON COLUMN public.category_unit_statuses.nature IS
  'NULL = not a desk tag. temporary = held for hold_days and lapses on its own. permanent = off the market with no expiry until released by hand.';
COMMENT ON COLUMN public.category_unit_statuses.hold_days IS
  'Default days offered at the desk for a temporary status. NULL falls back to the desk default.';

ALTER TABLE public.category_unit_statuses
  DROP CONSTRAINT IF EXISTS cus_nature_chk,
  DROP CONSTRAINT IF EXISTS cus_hold_days_chk,
  DROP CONSTRAINT IF EXISTS cus_nature_not_sellable_chk;

ALTER TABLE public.category_unit_statuses
  ADD CONSTRAINT cus_nature_chk
    CHECK (nature IS NULL OR nature IN ('temporary','permanent')),
  ADD CONSTRAINT cus_hold_days_chk
    CHECK (hold_days IS NULL OR hold_days BETWEEN 1 AND 90),
  /* A status that is bookable cannot also be a way of taking a unit off the
     market. Without this, one careless edit turns Available into a desk tag
     and the desk starts "holding" units by marking them free. */
  ADD CONSTRAINT cus_nature_not_sellable_chk
    CHECK (nature IS NULL OR NOT is_available);

-- ── 2. the backfill: exactly the three the desk could already apply ───────
UPDATE public.category_unit_statuses
   SET nature = 'temporary'
 WHERE nature IS NULL
   AND is_active
   AND NOT is_available
   AND LOWER(status_code) IN ('hold','reserved','booked');

-- ── 3. a hold may now have no end ─────────────────────────────────────────
ALTER TABLE public.reservations ALTER COLUMN expiry_date DROP NOT NULL;

COMMENT ON COLUMN public.reservations.expiry_date IS
  'NULL means the hold does not expire: a permanent status. cron_expire_reservations skips it and _map_unit_state keeps the unit reserved.';

-- ── 4. the trigger stops naming codes ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sync_reservation_on_unit_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_st public.category_unit_statuses;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT * INTO v_st FROM public.category_unit_statuses WHERE id = NEW.status_id;
    /* THIS WAS A LIST OF FIVE STATUS CODES, and it had to be edited in step
       with reserve_unit_desk every time a tag was added — which is exactly
       the bug that cancelled a booking inside its own transaction when HOLD
       and BOOKED were introduced. It asks a question about the new status
       instead: is this unit back on the market, or retired? Then, and only
       then, does nobody hold it any more. Every other status — including any
       a tenant invents — leaves the hold standing.

       A unit with no status at all counts as back on the market: nothing is
       claiming it. */
    IF COALESCE(v_st.is_available, true)
       OR upper(COALESCE(v_st.status_code,'')) = 'DEAD' THEN
      UPDATE public.reservations SET status='cancelled', cancelled_at=now(), updated_at=now()
      WHERE unit_id=NEW.id AND status='active';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- ── 5. the admin app can set a nature ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_unit_status(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
  v_nature text; v_days int; v_avail boolean; v_code text;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.category_unit_statuses
    WHERE id = p_id AND company_id = p_company_id;
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  /* ── THE NATURE, CHECKED HERE AND NOT ONLY IN THE BROWSER ───────────────
     The browser draws three choices; a caller can send any JSON it likes.
     "none" arrives as a string from a <select> and means the same as absent. */
  v_nature := NULLIF(NULLIF(TRIM(COALESCE(p_data->>'nature','')), ''), 'none');
  IF v_nature IS NOT NULL AND v_nature NOT IN ('temporary','permanent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_nature',
      'message', 'A status is either temporary, permanent, or neither.');
  END IF;

  v_avail := COALESCE((p_data->>'is_available')::bool,
                      (SELECT is_available FROM public.category_unit_statuses WHERE id = p_id),
                      false);
  IF v_nature IS NOT NULL AND v_avail THEN
    RETURN jsonb_build_object('success', false, 'error', 'sellable_has_no_nature',
      'message', 'A sellable status cannot also hold a unit off the market.');
  END IF;

  /* Sale-driven statuses are produced by the sales module and read by the
     register, the receivables and the commission report. Letting the desk
     stamp one would put a unit in a state that no sale explains. */
  v_code := upper(COALESCE(p_data->>'status_code',
                  (SELECT status_code FROM public.category_unit_statuses WHERE id = p_id), ''));
  IF v_nature IS NOT NULL AND v_code IN
     ('SOLD','INSTALLMENT','POSSESSION','TRANSFER','MORTGAGED','SALE_REVIEW','DEAD','AVAILABLE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'reserved_code',
      'message', v_code || ' is produced by the sales module, so the desk cannot apply it.');
  END IF;

  v_days := NULLIF(p_data->>'hold_days','')::int;
  IF v_nature = 'permanent' THEN
    v_days := NULL;                      -- permanent asks for no number of days
  ELSIF v_days IS NOT NULL AND (v_days < 1 OR v_days > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_hold_days',
      'message', 'A hold runs between 1 and 90 days.');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available, nature, hold_days)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'status_code', p_data->>'status_name',
            COALESCE(p_data->>'color_hex','#6b7280'), COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), COALESCE((p_data->>'is_available')::bool, false),
            v_nature, v_days)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.category_unit_statuses SET
      status_code = COALESCE(p_data->>'status_code', status_code),
      status_name = COALESCE(p_data->>'status_name', status_name),
      color_hex = COALESCE(p_data->>'color_hex', color_hex),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      is_available = COALESCE((p_data->>'is_available')::bool, is_available),
      /* Sent on every save, so choosing "none" clears it rather than being
         swallowed by a COALESCE that reads absence as "leave it alone". */
      nature = CASE WHEN p_data ? 'nature' THEN v_nature ELSE nature END,
      hold_days = CASE WHEN p_data ? 'nature' OR p_data ? 'hold_days' THEN v_days ELSE hold_days END,
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 6. the desk offers what the table declares ────────────────────────────
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
  /* THE LIST IS NO LONGER THREE HARD-CODED CODES.
     A status now declares its own NATURE, and that is what makes it a desk
     tag: 'temporary' holds the unit for a number of days and lapses on its
     own, 'permanent' takes it off the market and stays until somebody
     releases it by hand. A status with no nature is not a desk tag at all,
     which is how Sold, On Installment, Possession and Under Transfer stay
     out: those describe a unit that already has a SALE, and this desk
     writes no sale. Nothing here can invent one.

     Permanent is offered to directors only. A temporary hold corrects
     itself when the clock runs out; a permanent one does not, so the
     mistake it makes is the kind somebody has to come back and undo. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'code', q.status_code, 'name', q.status_name,
           'nature', q.nature, 'days', q.hold_days)
         ORDER BY q.rank, q.sort_order), '[]'::jsonb)
    INTO v_statuses
    FROM (
      SELECT cus.id, cus.status_code, cus.status_name, cus.nature,
             cus.hold_days, cus.sort_order,
             /* rising commitment, and permanent last because it is the one
                that does not undo itself */
             CASE WHEN cus.nature = 'permanent' THEN 9
                  WHEN LOWER(cus.status_code) = 'hold' THEN 1
                  WHEN LOWER(cus.status_code) = 'reserved' THEN 2
                  WHEN LOWER(cus.status_code) = 'booked' THEN 3
                  ELSE 4 END AS rank
        FROM public.category_unit_statuses cus
       WHERE cus.project_id = v_scope
         AND cus.is_active
         AND NOT cus.is_available
         AND cus.nature IN ('temporary','permanent')
         AND (cus.nature = 'temporary' OR v_su.role = 'director')
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
END $function$;

-- ── 7. the desk applies it, and permanent means no expiry ─────────────────
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
       AND nature IN ('temporary','permanent');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','bad_status',
        'message','That is not a status this desk can apply to a unit.'); END IF;
    /* PERMANENT NEEDS A DIRECTOR.
       A temporary hold corrects itself when the clock runs out. A permanent
       one takes the unit off the market and stays there, so the mistake it
       makes is the kind somebody has to come back and undo by hand. The
       screen only offers these to a director; this is why that is true and
       not merely displayed. */
    IF v_tag.nature = 'permanent' AND COALESCE(v_su.role,'') <> 'director' THEN
      RETURN jsonb_build_object('success',false,'error','director_only',
        'message','Only a director can take a unit off the market permanently.'); END IF;
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

  /* NO EXPIRY IS THE WHOLE POINT OF PERMANENT, and it needs no new machinery:
     cron_expire_reservations only sweeps rows whose expiry_date < now(), and
     _map_unit_state counts a NULL expiry as still reserved. Both already do
     the right thing with NULL, which is why permanent is a missing date
     rather than a date in the year 9999 — a far-future date would have
     every report cheerfully computing 2,913,000 days left. */
  IF COALESCE(v_tag.nature,'') = 'permanent' THEN
    v_expiry := NULL; v_days := NULL;
  ELSE
    v_expiry := now() + (v_days || ' days')::interval;
  END IF;

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
    'nature', COALESCE(v_tag.nature,'temporary'),
    'tag', v_tag.status_name, 'tag_code', v_tag.status_code);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.');
END $function$;

-- ── 8. the daybook stops dropping what never expires ──────────────────────
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
    LEFT JOIN public.sales cs ON cs.id = r.converted_sale_id
   WHERE r.company_id = ANY(p_companies)
     AND (p_scope IS NULL OR r.project_id = p_scope)
     AND r.created_at < p_at
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= p_at)
     /* A hold with no expiry never lapses, and NULL >= anything is NULL, so
        without this a permanent hold would simply be absent from the daybook
        — the unit off the market and nothing on the page saying why. */
     AND (r.expiry_date IS NULL OR r.expiry_date >= p_at)
     AND (cs.id IS NULL OR cs.sale_date > p_at_date)
$function$;

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
    LEFT JOIN public.sales cs ON cs.id = r.converted_sale_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t0
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t0)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t0)
     AND (cs.id IS NULL OR cs.sale_date >= v_from);

  SELECT count(*) INTO v_hc
    FROM public.reservations r
    LEFT JOIN public.sales cs ON cs.id = r.converted_sale_id
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t1
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1)
     AND (cs.id IS NULL OR cs.sale_date > v_to);

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
           'went', CASE WHEN r.cancelled_at IS NOT NULL AND r.cancelled_at < v_t1 THEN 'cancelled'
                        WHEN r.converted_sale_id IS NOT NULL                      THEN 'sold'
                        ELSE 'lapsed' END,
           'went_at', COALESCE(r.cancelled_at, r.expiry_date))
         ORDER BY COALESCE(f.sort_order, u.floor_no, 999),
                  COALESCE(NULLIF(regexp_replace(u.unit_no, '\D', '', 'g'),'')::bigint, 0),
                  u.unit_no), '[]'::jsonb)
    INTO v_rel
    FROM public.reservations r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.agents ag ON ag.id = r.requested_by_agent_id
    LEFT JOIN public.category_unit_statuses rs ON rs.id = r.unit_status_id
    LEFT JOIN public.sales cs ON cs.id = r.converted_sale_id
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
              AND (cs.id IS NULL OR cs.sale_date > v_to));

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
            LEFT JOIN public.sales cs2 ON cs2.id = r.converted_sale_id
           WHERE r.unit_id = u.id
             AND r.created_at < v_t1
             AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
             AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1)
             AND (cs2.id IS NULL OR cs2.sale_date > v_to)
           LIMIT 1) h ON true
        LEFT JOIN LATERAL (
          SELECT s2.id FROM public.sales s2
           WHERE s2.unit_id = u.id AND s2.sale_date <= v_to
             AND (s2.status <> 'cancelled' OR s2.cancellation_date IS NULL
                  OR s2.cancellation_date::date > v_to)
           LIMIT 1) sl ON true
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
