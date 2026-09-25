-- ═══════════════════════════════════════════════════════════════════════════
-- Holds wait for a director  (2026-09-25)
--
-- Rashid's directors: a hold whose time is over must NOT open by itself.
-- "director login mai aik approval panel banao ... approve ya extend time".
-- And if nobody decides, nothing changes.
--
-- 1. projects.holds_need_decision -- on for Awami only. cron_expire_reservations
--    skips those projects; FMH, KBH and every other tenant keep the hourly sweep.
-- 2. AN OVERDUE HOLD IS STILL A HOLD. Six readers asked "active AND expiry in
--    the future"; with no sweep that would have painted a blocked unit as free
--    on the link, the map, the dealer's request status and the daybook while the
--    one-active-per-unit index still refused to book it. They now ask "active".
--    The daybook's point-in-time test also keeps a director-released hold
--    standing until the moment it was released (cancelled_at).
-- 3. Three password-gated doors for the Directors' Room, the same gate and the
--    same ten-tries lock as release_availability_unit:
--      get_hold_decisions  -- time over (to decide) + ending within 24h
--      decide_holds        -- release | extend N days, many units at once
--      set_hold_contact    -- a phone for a holder, for the WhatsApp message
-- 4. availability_hold_decisions logs every decision; releases also go to
--    availability_releases so the room's "given back" keeps one story.
-- 5. Waqar = Waqar Landlord (Rashid, 2026-09-25): the four spellings merged
--    onto the one agent row, so he gets one card and one message.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS holds_need_decision boolean NOT NULL DEFAULT false;
UPDATE public.projects SET holds_need_decision = true
 WHERE id = '59ded55b-9bc2-45b2-a372-49fc31807fa9';

CREATE TABLE IF NOT EXISTS public.availability_hold_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  project_id     uuid NOT NULL,
  link_id        uuid,
  reservation_id uuid NOT NULL,
  unit_id        uuid NOT NULL,
  unit_no        text,
  held_by        text,
  action         text NOT NULL CHECK (action IN ('release','extend')),
  days           integer,
  expiry_before  timestamptz,
  expiry_after   timestamptz,
  decided_by     text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS availability_hold_decisions_project_idx
  ON public.availability_hold_decisions (project_id, at DESC);

CREATE TABLE IF NOT EXISTS public.availability_hold_contacts (
  project_id uuid NOT NULL,
  name_key   text NOT NULL,
  name       text NOT NULL,
  phone      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name_key));

-- A NEW TABLE ARRIVES WITH RLS OFF AND FULL anon GRANTS. Shut both; only the
-- SECURITY DEFINER functions below read or write these.
ALTER TABLE public.availability_hold_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_hold_contacts  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_hold_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.availability_hold_contacts  FROM PUBLIC, anon, authenticated;

-- one person, one name
UPDATE public.reservations r
   SET requested_by_name = 'Waqar Landlord',
       requested_by_agent_id = '9b1c7cd6-55b4-442e-8219-36be10bff8cd',
       updated_at = now()
  FROM public.units u
 WHERE u.id = r.unit_id
   AND u.project_id = '59ded55b-9bc2-45b2-a372-49fc31807fa9'
   AND lower(trim(r.requested_by_name)) IN ('waqar','waqar landlord','waqar landloard')
   AND (r.requested_by_name <> 'Waqar Landlord' OR r.requested_by_agent_id IS NULL);

CREATE OR REPLACE FUNCTION public.cron_expire_reservations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res public.reservations%ROWTYPE; v_avail uuid; v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT * FROM public.reservations r
    WHERE r.status='active' AND r.expiry_date < now()
      /* a project whose directors decide is left alone: its overdue holds
         wait in the Directors' Room for Release or Extend */
      AND NOT EXISTS (SELECT 1 FROM public.units hu
                        JOIN public.projects hp ON hp.id = hu.project_id
                       WHERE hu.id = r.unit_id AND hp.holds_need_decision)
      AND NOT EXISTS (SELECT 1 FROM public.sale_submissions s
                      WHERE s.reservation_id=r.id AND s.status='pending')
  LOOP
    UPDATE public.reservations SET status='expired', updated_at=now() WHERE id=v_res.id;
    SELECT id INTO v_avail FROM public.category_unit_statuses
     WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND is_available AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_avail IS NOT NULL THEN
      UPDATE public.units SET status_id=v_avail, updated_at=now()
       WHERE id=v_res.unit_id AND company_id=v_res.company_id;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'expired_count',v_count,'ran_at',now());
END; $function$;

CREATE OR REPLACE FUNCTION public._map_unit_state(p_unit_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN u.id IS NULL THEN 'unknown'
    WHEN s.status_name = 'Dead / Cancelled' THEN 'retired'
    WHEN EXISTS (SELECT 1 FROM public.sales sl
                  WHERE sl.unit_id = u.id AND sl.status = 'active')            THEN 'sold'
    WHEN EXISTS (SELECT 1 FROM public.reservations r
                  WHERE r.unit_id = u.id AND r.status = 'active')             THEN 'reserved'
    ELSE 'available'
  END
  FROM public.units u
  LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
  WHERE u.id = p_unit_id
$function$;

CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_choices jsonb; v_out jsonb; v_floors jsonb;
        v_units text[]; v_unit text; v_lapsing jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- missing, revoked and expired answer identically: probing teaches nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  UPDATE public.availability_links
     SET views = views + 1, last_viewed_at = now()
   WHERE id = v_link.id;

  /* ONE UNIT OF MEASURE, OR NONE.
     area_unit is sent once for the whole project rather than on every unit —
     1,467 copies of 'sqft' is 20 KB of nothing. That is only safe while the
     project really does have one. If it ever has two, this raises: a page that
     labels half its units in the wrong unit is worse than a page that does not
     load, and the person who mixed them needs to hear about it. */
  SELECT array_agg(DISTINCT COALESCE(u.area_unit, 'sqft'))
    INTO v_units
    FROM public.units u
   WHERE u.project_id = v_link.project_id
     AND public._map_unit_state(u.id) <> 'retired';

  IF v_units IS NOT NULL AND array_length(v_units, 1) > 1 THEN
    RAISE EXCEPTION
      'project % mixes area units (%) — the public availability page cannot label them',
      v_link.project_id, array_to_string(v_units, ', ')
      USING ERRCODE = 'data_exception';
  END IF;
  v_unit := COALESCE(v_units[1], 'sqft');

  SELECT jsonb_agg(f ORDER BY (f->>'floor_no')::int, f->>'floor_label') INTO v_floors
  FROM (
    SELECT jsonb_build_object(
             'floor_no', u.floor_no,
             'floor_label', COALESCE(u.floor_label, '—'),
             /* Counted here so the browser never walks 1,467 rows to put a
                number on a floor chip. */
             'available', count(*) FILTER (WHERE st.state = 'available'
                                             AND COALESCE(cs.is_available,false)),
             'total',     count(*),
             'units', jsonb_agg(jsonb_build_object(
                        'n', u.unit_no,
                        /* TWO states, and neither of them says who has it.
                           reserved and sold are the same answer to a dealer:
                           you cannot have this one. */
                        /* BOTH halves. st.state is "nobody has bought or held
                           it"; is_available is "the desk will let it be
                           booked". Offering a unit that answers yes to the
                           first and no to the second is a request that cannot
                           be approved. */
                        's', CASE WHEN st.state = 'available' AND COALESCE(cs.is_available,false)
                                  THEN 'available' ELSE 'not_available' END,
                        'a', u.area,
                        /* WHAT THE THING IS. The plan prints "SHOP" under the
                           number and a dealer reads the two together; the list
                           can say it in full. Public either way — a type is on
                           the printed sheet the office hands out. */
                        't', ut.type_name
                      )
                      /* WHAT KIND OF HOLD, AND ON WHOSE WORD — see the
                         migration this came from. Nothing is added to a unit
                         that is free: a dealer reading the wire learns only
                         about the ones already gone. */
                      || CASE WHEN st.state = 'available' AND COALESCE(cs.is_available,false)
                              THEN '{}'::jsonb
                              ELSE jsonb_strip_nulls(jsonb_build_object(
                                     'k', CASE WHEN COALESCE(cs.is_available, true)
                                               THEN CASE st.state
                                                      WHEN 'sold'     THEN 'Sold'
                                                      WHEN 'reserved' THEN 'Reserved'
                                                      ELSE 'Not available' END
                                               ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''),
                                                             cs.status_name) END,
                                     'w', NULLIF(TRIM(rq.requested_by_name), '')))
                         END
                      || CASE WHEN (SELECT p2.public_show_price
                                        FROM public.projects p2
                                       WHERE p2.id = v_link.project_id)
                                THEN jsonb_build_object('v', u.base_price)
                                ELSE '{}'::jsonb END
                      /* Unit-wise, not alphabetical. A plain ORDER BY unit_no
                         puts SF-100 immediately after SF-10, so a dealer
                         scanning for SF-15 walks through a hundred others to
                         reach it. Read every digit in the code as one number and
                         fall back to the code for ties, which is the same rule
                         the daybook uses — they must not disagree about the
                         order of the same building. */
                      ORDER BY COALESCE(NULLIF(regexp_replace(u.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0),
                               u.unit_no)
           ) AS f
      FROM public.units u
      LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
      LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
      LEFT JOIN LATERAL (
        SELECT r.requested_by_name
          FROM public.reservations r
         WHERE r.unit_id = u.id
           AND r.status = 'active'
         ORDER BY r.created_at DESC
         LIMIT 1
      ) rq ON true
      CROSS JOIN LATERAL (SELECT public._map_unit_state(u.id) AS state) st
     WHERE u.project_id = v_link.project_id
       AND st.state <> 'retired'
     GROUP BY u.floor_no, COALESCE(u.floor_label, '—')
  ) q;

  /* WHAT A DEALER MAY ASK FOR, decided by the tenant and not by the browser.
     Only statuses this project has flagged public_choice, which in turn can
     only be set on something the desk can actually apply (a nature). The
     label is the tenant's public wording: "Sold - Entry Pending" is our
     bookkeeping and "Sold" is what a dealer means.

     A permanent choice carries no days, and the page must not offer any. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'label', COALESCE(NULLIF(TRIM(q.public_label),''), q.status_name),
           'nature', q.nature,
           'days', q.hold_days)
         ORDER BY q.sort_order), '[]'::jsonb)
    INTO v_choices
    FROM public.category_unit_statuses q
   WHERE q.project_id = v_link.project_id
     AND q.is_active
     AND NOT q.is_available
     AND q.nature IS NOT NULL
     AND q.public_choice;

  /* WHAT LAPSES IN THE NEXT TWO DAYS. Rashid: "jo unit release honay wala ho
     2 din jis mai reh jain wo ... dashboard pe batana shuru ho jai" -- so the
     person whose word a hold is on hears it is about to go back on the shelf
     while there is still time to turn it into a sale.

     Its own list, NOT a key on the unit: the unit keys are locked at
     a,k,n,s,t,v,w. Three facts per hold -- the unit, on whose word (the same
     requested_by_name the unit already carries as w) and when it lapses.
     Only holds with a date: a permanent tag has expiry_date NULL and never
     lapses, so it is left out on purpose. Rows already past are left out
     too; the cron retires them. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'n', x.unit_no,
           'w', NULLIF(TRIM(x.requested_by_name), ''),
           'x', x.expiry_date)
         ORDER BY x.expiry_date,
                  COALESCE(NULLIF(regexp_replace(x.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0),
                  x.unit_no), '[]'::jsonb)
    INTO v_lapsing
    FROM (
      SELECT DISTINCT ON (u.id) u.unit_no, r.requested_by_name, r.expiry_date
        FROM public.reservations r
        JOIN public.units u ON u.id = r.unit_id
       WHERE u.project_id = v_link.project_id
         AND r.status = 'active'
         AND r.expiry_date IS NOT NULL
         AND r.expiry_date >  now()
         AND r.expiry_date <= now() + interval '2 days'
       ORDER BY u.id, r.created_at DESC
    ) x;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', v_unit,
    'show_price', COALESCE(pr.public_show_price, false),
    'floors',  COALESCE(v_floors, '[]'::jsonb),
    'choices', COALESCE(v_choices, '[]'::jsonb),
    'lapsing', COALESCE(v_lapsing, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_request_status(p_token text, p_refs text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ref', r.ref, 'unit_no', r.unit_no, 'status', r.status,
           'kind', COALESCE(r.kind,'new'), 'note', r.note,
           /* The word the dealer chose, so a row that carries no number of
              days still says what it is about. */
           'asked', (SELECT COALESCE(NULLIF(TRIM(k.public_label),''), k.status_name)
                       FROM public.category_unit_statuses k
                      WHERE k.id = r.asked_status_id),
           /* WHAT WAS ACTUALLY GRANTED, which is not always what was asked for:
              a dealer asks for Hold and the desk may answer Pagri. Only ever
              sent for a hold that is still standing — on an ended one it would
              be a label for something that is no longer true. Without it the
              dealer's own summary could only count what they requested, which
              is the one number they already know. */
           'tag', CASE
             WHEN r.status = 'approved' AND rv.id IS NOT NULL
              AND rv.status = 'active'
              /* overdue still stands until a director decides */
             THEN to_jsonb(COALESCE(NULLIF(TRIM(cus.public_label),''), cus.status_name, 'Reserved'))
             ELSE 'null'::jsonb
           END,
           'days', r.days, 'at', r.created_at, 'decided_at', r.decided_at,
           /* DERIVED, EVERY TIME IT IS ASKED. An approved request whose
              reservation is no longer standing is not a hold any more, and
              the phone that is showing it has no other way to find out. */
           'state', CASE
             WHEN r.status <> 'approved' THEN r.status
             WHEN rv.id IS NOT NULL
              AND rv.status = 'active'
              /* overdue still stands until a director decides */ THEN 'held'
             ELSE 'ended'
           END,
           /* Only when it is genuinely still held. A date on an ended hold
              reads like a promise. */
           'held_until', CASE
             WHEN r.status = 'approved' AND rv.id IS NOT NULL
              AND rv.status = 'active'
              /* overdue still stands until a director decides */
             THEN to_jsonb(rv.expiry_date)
             ELSE 'null'::jsonb
           END)), '[]'::jsonb)
    INTO v_out
    FROM public.availability_requests r
    LEFT JOIN public.reservations rv ON rv.id = r.reservation_id
    LEFT JOIN public.category_unit_statuses cus ON cus.id = rv.unit_status_id
   WHERE r.link_id = v_link.id
     AND r.ref = ANY(COALESCE(p_refs, ARRAY[]::text[]));

  RETURN jsonb_build_object('success', true, 'requests', v_out);
END $function$;

CREATE OR REPLACE FUNCTION public.release_availability_unit(p_token text, p_password text, p_unit_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_co uuid; v_hash text; v_tries int;
  v_unit public.units; v_was text; v_who text; v_avail uuid;
  v_res int; v_free boolean;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id; v_co := v_link.company_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;

  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_secret_hash(v_pr, p_password));

  IF v_hash IS NULL OR v_hash <>
     public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  SELECT u.* INTO v_unit FROM public.units u
   WHERE u.project_id = v_pr
     AND upper(regexp_replace(COALESCE(u.unit_no,''), '[^A-Za-z0-9]', '', 'g'))
       = upper(regexp_replace(COALESCE(p_unit_no,''), '[^A-Za-z0-9]', '', 'g'))
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;

  SELECT COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name),
         COALESCE(cs.is_available, true)
    INTO v_was, v_free
    FROM public.category_unit_statuses cs WHERE cs.id = v_unit.status_id;
  IF v_unit.status_id IS NULL OR v_free THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_free',
                              'unit', v_unit.unit_no); END IF;

  SELECT r.requested_by_name INTO v_who FROM public.reservations r
   WHERE r.unit_id = v_unit.id AND r.status = 'active'
   ORDER BY r.created_at DESC LIMIT 1;

  SELECT count(*)::int INTO v_res FROM public.reservations
   WHERE unit_id = v_unit.id AND status = 'active';

  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id = v_co AND project_id = v_pr AND is_available AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_avail IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_available_status'); END IF;

  UPDATE public.units SET status_id = v_avail, updated_at = now()
   WHERE id = v_unit.id AND project_id = v_pr;

  INSERT INTO public.availability_releases
    (company_id, project_id, link_id, unit_id, unit_no, floor_label,
     was_status, was_held_by, freed_reservation)
  VALUES (v_co, v_pr, v_link.id, v_unit.id, v_unit.unit_no, v_unit.floor_label,
          v_was, v_who, v_res > 0);

  RETURN jsonb_build_object('success', true, 'unit', v_unit.unit_no,
                            'was', v_was, 'who', v_who,
                            'freed_reservation', v_res > 0);
END $function$;

CREATE OR REPLACE FUNCTION public.get_availability_report(p_token text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_hash text; v_tries int;
  v_out jsonb; v_totals jsonb; v_status jsonb; v_floors jsonb; v_people jsonb; v_ins jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many');
  END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;

  /* written down before it is judged */
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
            public._availability_secret_hash(v_pr, p_password));

  IF v_hash IS NULL OR v_hash <>
       public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;

  /* ── THE BUILDING, ONCE ────────────────────────────────────────────────
     Every unit that is not retired, with the hold on it if there is one. The
     kind is the tenant's public wording, the same word the dealer's screen
     shows, so the two can never disagree about what "Sold" means. */
  CREATE TEMP TABLE _rep ON COMMIT DROP AS
  SELECT u.id, u.unit_no, u.floor_no, COALESCE(u.floor_label, '—') AS floor_label,
         COALESCE(u.base_price, 0)::numeric AS price,
         COALESCE(u.area, 0)::numeric       AS area,
         COALESCE(cs.is_available, false)   AS free,
         CASE WHEN COALESCE(cs.is_available, false) THEN NULL
              ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name,
                            'Not available') END AS kind,
         NULLIF(TRIM(r.requested_by_name), '') AS who,
         r.created_at AS held_at, r.expiry_date
    FROM public.units u
    LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
    LEFT JOIN LATERAL (
      SELECT r2.requested_by_name, r2.created_at, r2.expiry_date
        FROM public.reservations r2
       WHERE r2.unit_id = u.id AND r2.status = 'active'
         /* an overdue hold still stands */
       ORDER BY r2.created_at DESC LIMIT 1) r ON true
   WHERE u.project_id = v_pr
     AND public._map_unit_state(u.id) <> 'retired';

  SELECT jsonb_build_object(
    'units',      count(*),
    'available',  count(*) FILTER (WHERE free),
    'held',       count(*) FILTER (WHERE NOT free),
    'value',      COALESCE(sum(price), 0),
    'value_free', COALESCE(sum(price) FILTER (WHERE free), 0),
    'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),
    'area',       COALESCE(sum(area), 0),
    'holders',    count(DISTINCT who))
    INTO v_totals FROM _rep;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'units')::int DESC), '[]'::jsonb) INTO v_status
    FROM (SELECT jsonb_build_object('kind', kind, 'units', count(*),
                                    'value', COALESCE(sum(price), 0),
                                    'area',  COALESCE(sum(area), 0)) AS x
            FROM _rep WHERE NOT free GROUP BY kind) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'floor_no')::int), '[]'::jsonb) INTO v_floors
    FROM (SELECT jsonb_build_object(
                   'floor_no', floor_no, 'label', floor_label,
                   'units', count(*),
                   'available', count(*) FILTER (WHERE free),
                   'held', count(*) FILTER (WHERE NOT free),
                   'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),
                   /* WHAT THE FLOOR IS WORTH, whole and in parts. The rate
                      below is derived from these two, so they travel
                      together and cannot fall out of step. */
                   'value', COALESCE(sum(price), 0),
                   'value_free', COALESCE(sum(price) FILTER (WHERE free), 0),
                   'area', COALESCE(sum(area), 0),
                   'area_free', COALESCE(sum(area) FILTER (WHERE free), 0),
                   /* the going rate on this floor, from the register itself */
                   'rate', CASE WHEN COALESCE(sum(area),0) > 0
                                THEN round(sum(price) / sum(area)) ELSE NULL END,
                   'by', COALESCE((SELECT jsonb_object_agg(k, n)
                                     FROM (SELECT kind k, count(*) n FROM _rep b
                                            WHERE b.floor_no = a.floor_no AND NOT b.free
                                            GROUP BY kind) z), '{}'::jsonb)) AS x
            FROM _rep a GROUP BY floor_no, floor_label) q;

  /* ── WHO IS HOLDING WHAT ───────────────────────────────────────────────
     The heart of it. Per name: how many of each kind, what it is worth, when
     they started and when they last took one, how many floors they are spread
     across, the oldest hold still standing, and what is about to lapse. */
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'units')::int DESC, x->>'who'), '[]'::jsonb)
    INTO v_people
    FROM (SELECT jsonb_build_object(
                   'who', COALESCE(a.who, '(not recorded)'),
                   'units', count(*),
                   'value', COALESCE(sum(a.price), 0),
                   'area',  COALESCE(sum(a.area), 0),
                   'floors', count(DISTINCT a.floor_no),
                   'first', min(a.held_at), 'last', max(a.held_at),
                   'oldest_days', CASE WHEN min(a.held_at) IS NULL THEN NULL
                                       ELSE floor(extract(epoch FROM now() - min(a.held_at)) / 86400) END,
                   'expiring', count(*) FILTER (WHERE a.expiry_date IS NOT NULL
                                                  AND a.expiry_date < now() + interval '7 days'),
                   'by', COALESCE((SELECT jsonb_object_agg(k, n)
                                     FROM (SELECT kind k, count(*) n FROM _rep b
                                            WHERE b.who IS NOT DISTINCT FROM a.who AND NOT b.free
                                            GROUP BY kind) z), '{}'::jsonb)) AS x
            FROM _rep a WHERE NOT a.free GROUP BY a.who) q;

  SELECT jsonb_build_object(
    'concentration', (SELECT jsonb_build_object(
                        'top', who, 'units', n,
                        'share', CASE WHEN t.held > 0 THEN round(n * 100.0 / t.held, 1) ELSE 0 END)
                       FROM (SELECT COALESCE(who,'(not recorded)') who, count(*) n
                               FROM _rep WHERE NOT free GROUP BY who
                              ORDER BY 2 DESC LIMIT 1) c,
                            (SELECT count(*) FILTER (WHERE NOT free) held FROM _rep) t),
    'ageing', (SELECT jsonb_build_object(
                 'd0_7',   count(*) FILTER (WHERE held_at > now() - interval '7 days'),
                 'd8_30',  count(*) FILTER (WHERE held_at <= now() - interval '7 days'
                                              AND held_at > now() - interval '30 days'),
                 'd31_60', count(*) FILTER (WHERE held_at <= now() - interval '30 days'
                                              AND held_at > now() - interval '60 days'),
                 'd60',    count(*) FILTER (WHERE held_at <= now() - interval '60 days'),
                 'value_over_30', COALESCE(sum(price) FILTER (
                                    WHERE held_at <= now() - interval '30 days'), 0),
                 'oldest_days', CASE WHEN min(held_at) IS NULL THEN NULL
                                     ELSE floor(extract(epoch FROM now() - min(held_at)) / 86400) END)
                FROM _rep WHERE NOT free),
    'lapsing', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'unit', unit_no, 'who', COALESCE(who,'(not recorded)'),
                         'kind', kind, 'on', expiry_date, 'value', price)
                       ORDER BY expiry_date), '[]'::jsonb)
                  FROM _rep WHERE NOT free AND expiry_date IS NOT NULL
                    AND expiry_date < now() + interval '7 days'),
    'pace', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week', w, 'taken', n) ORDER BY w), '[]'::jsonb)
               FROM (SELECT date_trunc('week', r.created_at)::date w, count(*) n
                       FROM public.reservations r
                      WHERE r.project_id = v_pr
                        AND r.created_at > now() - interval '8 weeks'
                      GROUP BY 1) p),
    'given_back', (SELECT jsonb_build_object(
                     'units', count(*),
                     'names', count(DISTINCT NULLIF(TRIM(requested_by_name),'')))
                     FROM public.reservations
                    WHERE project_id = v_pr AND status = 'cancelled'),
    'floors_fast', (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'share')::numeric DESC), '[]'::jsonb)
                      FROM (SELECT jsonb_build_object('label', floor_label,
                              'share', round(count(*) FILTER (WHERE NOT free) * 100.0 / count(*), 1),
                              'held', count(*) FILTER (WHERE NOT free), 'units', count(*)) AS x
                              FROM _rep GROUP BY floor_label
                             ORDER BY count(*) FILTER (WHERE NOT free) * 1.0 / count(*) DESC
                             LIMIT 3) q2)
  ) INTO v_ins;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    /* which tenant this is, so the Reserve Desk on this link can sign a
       director in without asking them for a code they do not carry */
    'company_code', c.company_code,
    'area_unit', COALESCE((SELECT u.area_unit FROM public.units u
                            WHERE u.project_id = v_pr AND u.area_unit IS NOT NULL LIMIT 1), 'sqft'),
    'as_of', now(),
    'totals', v_totals, 'by_status', v_status, 'by_floor', v_floors,
    'by_person', v_people, 'insights', v_ins,
    /* every unit that is gone, so the pages behind this one are a slice of
       what is already in hand rather than another trip to the server */
    'units', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'n', unit_no, 'f', floor_label, 'k', kind,
                       'w', COALESCE(who, ''), 'a', area, 'v', price,
                       'e', expiry_date, 'h', held_at)
                     ORDER BY floor_no,
                              COALESCE(NULLIF(regexp_replace(unit_no,'[^0-9]','','g'),'')::bigint, 0),
                              unit_no), '[]'::jsonb)
                FROM _rep WHERE NOT free))
    INTO v_out
    FROM public.projects pr JOIN public.companies c ON c.id = pr.company_id
   WHERE pr.id = v_pr;

  DROP TABLE IF EXISTS _rep;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public._daybook_held(p_companies uuid[], p_scope uuid, p_at timestamp with time zone, p_at_date date)
 RETURNS TABLE(res_id uuid, unit_id uuid, unit_no text, floor text, rank integer, num integer, area numeric, area_unit text, base_price numeric, requested_by text, agent_code text, booked_by text, client_name text, token_amount numeric, tag text, tag_code text, created_at timestamp with time zone, expiry_date timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /* The reservation's own id comes first. Without it the standing hold list
     was a report you could read and not a thing you could act on: every row
     named a unit and none of them named the hold. */
  SELECT r.id, u.id, u.unit_no,
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
     AND (r.expiry_date IS NULL OR r.expiry_date >= p_at OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
     /* NOT "was this reservation converted into a sale", which only ever
        catches the portal's own submit-and-approve path. A unit sold in RMS
        while a hold stood on it left that hold on this list for good — the
        exact shape of "tag it Sold - Entry Pending now, enter the sale next
        week". The question is about the UNIT: once it is sold, nobody is
        holding it any more, whoever entered the sale and however. */
     AND NOT public._sold_as_at(r.unit_id, p_at_date)
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
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t0
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t0)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t0 OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
     AND NOT public._sold_as_at(r.unit_id, v_from - 1);

  SELECT count(*) INTO v_hc
    FROM public.reservations r
   WHERE r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope)
     AND r.created_at < v_t1
     AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1 OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
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
           'res_id', q.res_id,
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
           'res_id', q.res_id,
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
           'went', CASE WHEN r.status = 'expired' AND r.cancelled_at IS NOT NULL
                         AND r.cancelled_at < v_t1                            THEN 'lapsed'
                        WHEN r.cancelled_at IS NOT NULL AND r.cancelled_at < v_t1 THEN 'cancelled'
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
     AND (r.expiry_date IS NULL OR r.expiry_date >= v_t0 OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
     -- ... and it was not still held at the end of it
     AND NOT (r.created_at < v_t1
              AND (r.cancelled_at IS NULL OR r.cancelled_at >= v_t1)
              AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1 OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
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
             /* OFF THE MARKET FOR ANY OTHER REASON, and there are two shapes
                of it. The second was the bug: a unit HELD under a tag this
                project invented - Pagri, Landowner, Sold - Entry Pending -
                matched none of the three named holds and was refused here for
                having a reservation, so it landed in no column at all and the
                floor table stopped adding up to its own total. */
             count(*) FILTER (WHERE sl.id IS NULL
                                AND ( (h.unit_id IS NOT NULL
                                       AND h.tag_code NOT IN ('RESERVED','HOLD','BOOKED'))
                                   OR (h.unit_id IS NULL
                                       AND NOT COALESCE(st.is_available,false)) )) AS other,
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
             AND (r.expiry_date IS NULL OR r.expiry_date >= v_t1 OR r.status = 'active'
          OR (r.status = 'expired' AND r.cancelled_at IS NOT NULL))
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

CREATE OR REPLACE FUNCTION public._hold_name_key(p text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$ SELECT lower(regexp_replace(trim(COALESCE(p, '')), '\s+', ' ', 'g')) $function$;

/* WHAT THE ROOM HAS TO DECIDE, AND WHAT IS ABOUT TO NEED DECIDING.
   due  -- active dated holds whose time is over: they wait here, unchanged,
           until a director presses Release or Extend.
   soon -- active dated holds ending within 24 hours: nothing to decide yet,
           but the holder can be told, and an early Extend is allowed.
   A permanent tag (expiry NULL) never appears. The phone is the one saved in
   this room, else the agent's or the portal member's own. */
CREATE OR REPLACE FUNCTION public.get_hold_decisions(p_token text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_co uuid; v_hash text; v_tries int;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id; v_co := v_link.company_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_secret_hash(v_pr, p_password));
  IF v_hash IS NULL OR v_hash <>
     public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',    x.id,
           'n',     x.unit_no,
           'f',     x.floor_label,
           'k',     x.kind,
           'w',     x.who,
           'x',     x.expiry_date,
           'due',   x.expiry_date <= now(),
           'phone', x.phone)
         ORDER BY x.expiry_date,
                  COALESCE(NULLIF(regexp_replace(x.unit_no, '[^0-9]', '', 'g'), '')::bigint, 0),
                  x.unit_no), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT r.id, u.unit_no, COALESCE(u.floor_label, '—') AS floor_label,
             COALESCE(NULLIF(TRIM(ts.public_label), ''), ts.status_name, 'Reserved') AS kind,
             NULLIF(TRIM(r.requested_by_name), '') AS who, r.expiry_date,
             COALESCE(NULLIF(hc.phone, ''), NULLIF(TRIM(ag.phone), ''),
                      NULLIF(TRIM(su.phone), '')) AS phone
        FROM public.reservations r
        JOIN public.units u ON u.id = r.unit_id
        LEFT JOIN public.category_unit_statuses ts ON ts.id = r.unit_status_id
        LEFT JOIN public.agents ag ON ag.id = r.requested_by_agent_id
        LEFT JOIN public.sales_users su ON su.id = r.requested_by_sales_user_id
        LEFT JOIN public.availability_hold_contacts hc
               ON hc.project_id = v_pr
              AND hc.name_key = public._hold_name_key(r.requested_by_name)
       WHERE u.project_id = v_pr
         AND r.status = 'active'
         AND r.expiry_date IS NOT NULL
         AND r.expiry_date <= now() + interval '24 hours'
    ) x;

  RETURN jsonb_build_object('success', true, 'now', now(), 'holds', v_rows);
END $function$;

/* RELEASE OR EXTEND, for the holds the director ticked.
   release -- the hold is closed as expired (cancelled_at = now, so the daybook
              knows exactly when it stopped standing), the unit goes to this
              project's own Available status, and the release is written where
              the room's other releases are.
   extend  -- the hold keeps its tag and its holder; its expiry moves p_days on
              from whichever is later, now or the old expiry, so an overdue
              hold is never extended into the past.
   Every hold is re-checked here: this project's, still active, dated.
   Anything else comes back as skipped, never guessed at. */
CREATE OR REPLACE FUNCTION public.decide_holds(p_token text, p_password text,
  p_ids uuid[], p_action text, p_days integer DEFAULT NULL, p_by text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_co uuid; v_hash text; v_tries int;
  v_by text := NULLIF(TRIM(COALESCE(p_by, '')), '');
  v_avail uuid; v_r record; v_new timestamptz; v_st text; v_ex timestamptz;
  v_done jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id; v_co := v_link.company_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_secret_hash(v_pr, p_password));
  IF v_hash IS NULL OR v_hash <>
     public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  IF p_action IS NULL OR p_action NOT IN ('release', 'extend') THEN
    RETURN jsonb_build_object('success', false, 'error', 'action'); END IF;
  IF v_by IS NULL OR length(v_by) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'by'); END IF;
  IF p_action = 'extend' AND (p_days IS NULL OR p_days < 1 OR p_days > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'days'); END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'none'); END IF;

  IF p_action = 'release' THEN
    SELECT id INTO v_avail FROM public.category_unit_statuses
     WHERE company_id = v_co AND project_id = v_pr AND is_available AND is_active
     ORDER BY sort_order LIMIT 1;
    IF v_avail IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_available_status'); END IF;
  END IF;

  FOR v_r IN
    SELECT want.id AS asked, r.id, r.unit_id, r.status, r.expiry_date, r.requested_by_name,
           u.unit_no, u.floor_label, u.project_id,
           COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name) AS was
      FROM unnest(p_ids) AS want(id)
      LEFT JOIN public.reservations r ON r.id = want.id
      LEFT JOIN public.units u ON u.id = r.unit_id
      LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
  LOOP
    /* taken under lock and re-read, so two directors pressing at once cannot
       both act on the same hold */
    PERFORM 1 FROM public.reservations WHERE id = v_r.id FOR UPDATE;
    SELECT status, expiry_date INTO v_st, v_ex
      FROM public.reservations WHERE id = v_r.id;

    IF v_r.id IS NULL OR v_r.project_id IS DISTINCT FROM v_pr
       OR v_st IS DISTINCT FROM 'active' OR v_ex IS NULL THEN
      v_skip := v_skip || jsonb_build_object('n', v_r.unit_no, 'why',
                  CASE WHEN v_r.id IS NULL OR v_r.project_id IS DISTINCT FROM v_pr THEN 'not_here'
                       WHEN v_ex IS NULL THEN 'permanent'
                       ELSE 'not_active' END);
      CONTINUE;
    END IF;

    IF p_action = 'release' THEN
      /* closed first, so the unit-status trigger finds nothing active to cancel */
      UPDATE public.reservations
         SET status = 'expired', cancelled_at = now(), updated_at = now()
       WHERE id = v_r.id;
      UPDATE public.units SET status_id = v_avail, updated_at = now()
       WHERE id = v_r.unit_id AND project_id = v_pr;
      INSERT INTO public.availability_releases
        (company_id, project_id, link_id, unit_id, unit_no, floor_label,
         was_status, was_held_by, freed_reservation)
      VALUES (v_co, v_pr, v_link.id, v_r.unit_id, v_r.unit_no, v_r.floor_label,
              v_r.was, v_r.requested_by_name, true);
      v_new := NULL;
    ELSE
      v_new := GREATEST(v_ex, now()) + make_interval(days => p_days);
      UPDATE public.reservations SET expiry_date = v_new, updated_at = now()
       WHERE id = v_r.id;
    END IF;

    INSERT INTO public.availability_hold_decisions
      (company_id, project_id, link_id, reservation_id, unit_id, unit_no, held_by,
       action, days, expiry_before, expiry_after, decided_by)
    VALUES (v_co, v_pr, v_link.id, v_r.id, v_r.unit_id, v_r.unit_no,
            v_r.requested_by_name, p_action,
            CASE WHEN p_action = 'extend' THEN p_days END,
            v_ex, v_new, v_by);

    v_done := v_done || jsonb_build_object('n', v_r.unit_no, 'w', v_r.requested_by_name,
                                           'x', v_new);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'action', p_action,
                            'done', v_done, 'skipped', v_skip);
END $function$;

/* A NUMBER FOR A HOLDER, kept per project by name, so the WhatsApp message
   goes straight to them next time. Pakistani mobiles only: 03xxxxxxxxx or
   923xxxxxxxxx, stored as 923xxxxxxxxx. An empty phone forgets it. */
CREATE OR REPLACE FUNCTION public.set_hold_contact(p_token text, p_password text,
  p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_co uuid; v_hash text; v_tries int;
  v_key text := public._hold_name_key(p_name);
  v_d text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id; v_co := v_link.company_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_secret_hash(v_pr, p_password));
  IF v_hash IS NULL OR v_hash <>
     public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  IF v_key = '' OR length(v_key) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'name'); END IF;
  IF v_d = '' THEN
    DELETE FROM public.availability_hold_contacts WHERE project_id = v_pr AND name_key = v_key;
    RETURN jsonb_build_object('success', true, 'phone', NULL);
  END IF;
  IF v_d ~ '^03[0-9]{9}$' THEN v_d := '92' || substr(v_d, 2); END IF;
  IF v_d !~ '^923[0-9]{9}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone'); END IF;
  INSERT INTO public.availability_hold_contacts (project_id, name_key, name, phone, updated_at)
  VALUES (v_pr, v_key, TRIM(p_name), v_d, now())
  ON CONFLICT (project_id, name_key)
  DO UPDATE SET phone = EXCLUDED.phone, name = EXCLUDED.name, updated_at = now();
  RETURN jsonb_build_object('success', true, 'phone', v_d);
END $function$;

REVOKE ALL ON FUNCTION public.get_hold_decisions(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_holds(text, text, uuid[], text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_hold_contact(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._hold_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hold_decisions(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_holds(text, text, uuid[], text, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_hold_contact(text, text, text, text) TO anon, authenticated;
