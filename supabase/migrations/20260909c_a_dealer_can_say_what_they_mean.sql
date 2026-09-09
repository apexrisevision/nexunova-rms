-- ═══════════════════════════════════════════════════════════════════════════
-- A DEALER CAN SAY WHAT THEY ARE ASKING FOR.
--
-- The link asked for one thing: a unit, for a number of days, and the desk
-- decided what to call it. Rashid wants the dealer to say which of Reserve,
-- Hold or Sold they mean, with days on the first two and none on the last.
--
-- This reverses a call he made earlier today, and it is safe to reverse
-- because of what has not changed: the dealer still DECIDES nothing. What
-- they pick rides on the request as an ask. The status is applied by a
-- director tapping Approve, under the same director-only gate as before, and
-- the picker on that card can still overrule it. A public link handed to
-- anybody therefore still cannot take a unit off the market.
--
-- WHICH THREE IS NOT WRITTEN IN CODE. A status carries public_choice, set in
-- the same Categories screen where its nature is set, and public_label is the
-- word a dealer sees: "Sold - Entry Pending" is our bookkeeping, "Sold" is
-- what they mean. Only a status the desk can actually apply may be published
-- — one with no nature could be asked for and never granted, which is how
-- SOLD itself stays out of reach while its stand-in does the work.
--
-- Backfilled for Awami as the three he named. Every other tenant and project
-- publishes nothing, so their links behave exactly as they did this morning.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── the two columns ──────────────────────────────────────────────────────
ALTER TABLE public.category_unit_statuses
  ADD COLUMN IF NOT EXISTS public_choice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_label  text;

COMMENT ON COLUMN public.category_unit_statuses.public_choice IS
  'A dealer may ask for this from a public availability link. Only valid on a status with a nature, because only those can be granted.';
COMMENT ON COLUMN public.category_unit_statuses.public_label IS
  'The word a dealer sees on the link. Falls back to status_name.';

ALTER TABLE public.category_unit_statuses DROP CONSTRAINT IF EXISTS cus_public_needs_nature_chk;
ALTER TABLE public.category_unit_statuses
  ADD CONSTRAINT cus_public_needs_nature_chk
    CHECK (NOT public_choice OR nature IS NOT NULL);

-- ── what the request remembers being asked for ───────────────────────────
ALTER TABLE public.availability_requests
  ADD COLUMN IF NOT EXISTS asked_status_id uuid REFERENCES public.category_unit_statuses(id);

COMMENT ON COLUMN public.availability_requests.asked_status_id IS
  'What the dealer asked for. A suggestion: the director applies the tag, and may pick another.';

-- ── the three Rashid named, on Awami only ────────────────────────────────
UPDATE public.category_unit_statuses
   SET public_choice = true,
       public_label = CASE upper(status_code)
                        WHEN 'RESERVED' THEN 'Reserve'
                        WHEN 'HOLD' THEN 'Hold'
                        WHEN 'SOLD_ENTRY_PENDING' THEN 'Sold'
                      END
 WHERE project_id = '59ded55b-9bc2-45b2-a372-49fc31807fa9'
   AND upper(status_code) IN ('RESERVED','HOLD','SOLD_ENTRY_PENDING');

-- ── and the four that had to learn about it ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_choices jsonb; v_out jsonb; v_floors jsonb;
        v_units text[]; v_unit text;
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
                        'a', u.area
                      )
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

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', v_unit,
    'floors',  COALESCE(v_floors, '[]'::jsonb),
    'choices', COALESCE(v_choices, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.submit_availability_request(p_token text, p_unit_no text, p_days integer DEFAULT 7, p_name text DEFAULT NULL::text, p_status_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units;
        v_days int; v_ref text; v_id uuid; v_pending int; v_hour int; v_state text;
        v_tag public.category_unit_statuses;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- the same flat answer the read side gives: a probe learns nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  /* ANY NUMBER OF DAYS, clamped to the same 1..90 the desk itself allows.
     This used to be a 1/3/7 whitelist, on the reasoning that nothing longer
     should reach the desk from a public page. That was the wrong place to hold
     the line: a dealer asking for 30 days is not a booking, it is a request
     that Rashid reads and answers. The gate is his tap, not this CASE — and a
     silent rewrite of 12 to 7 would have put a number in his queue that nobody
     asked for. Out of range is clamped, never discarded. */
  v_days := GREATEST(1, LEAST(90, COALESCE(p_days, 7)));

  /* Retire what nobody is going to action, so the queue cap measures a real
     backlog rather than a graveyard. */
  UPDATE public.availability_requests
     SET status = 'expired'
   WHERE link_id = v_link.id AND status = 'pending'
     AND created_at < now() - interval '48 hours';

  SELECT count(*) INTO v_pending FROM public.availability_requests
   WHERE link_id = v_link.id AND status = 'pending';
  IF v_pending >= 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'queue_full',
      'message', 'There are already 50 requests waiting on this link. Please try again once some are answered.');
  END IF;

  SELECT count(*) INTO v_hour FROM public.availability_requests
   WHERE link_id = v_link.id AND created_at > now() - interval '1 hour';
  IF v_hour >= 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many',
      'message', 'Too many requests from this link in the last hour. Please try again shortly.');
  END IF;

  /* BY NUMBER, INSIDE THIS LINK'S OWN PROJECT. No unit id crosses the wire, so
     a caller cannot name a unit in another tower — the same reason the desk
     stopped resolving unit numbers across an umbrella group. */
  SELECT * INTO v_unit FROM public.units
   WHERE project_id = v_link.project_id
     AND upper(unit_no) = upper(TRIM(COALESCE(p_unit_no, '')))
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;

  /* The same question the desk will ask when Approve is tapped, asked here
     while the dealer is still looking at the screen. A request accepted for a
     unit reserve_unit_desk would refuse is a promise nobody can keep. */
  IF NOT public._public_unit_is_free(v_unit.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_unavailable',
      'message', 'That unit is no longer available.');
  END IF;

  /* THE DEALER'S ASK, RE-DERIVED HERE RATHER THAN TRUSTED.
     The page was handed a list; a caller can post any uuid. This accepts only
     a status this project has published, and a permanent one takes no days —
     the number is dropped rather than stored and quietly ignored later.

     It is an ASK, not a decision. Nothing is applied until a director taps
     Approve, which is why a public link may carry it at all. */
  IF p_status_id IS NOT NULL THEN
    SELECT * INTO v_tag FROM public.category_unit_statuses
     WHERE id = p_status_id
       AND project_id = v_link.project_id
       AND is_active AND NOT is_available
       AND nature IS NOT NULL
       AND public_choice;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'bad_choice',
        'message', 'That is not something this link can ask for.'); END IF;
    IF v_tag.nature = 'permanent' THEN v_days := NULL; END IF;
  END IF;

  v_ref := public._request_ref();
  BEGIN
    INSERT INTO public.availability_requests
      (link_id, company_id, project_id, unit_id, unit_no, days, requested_by_name, ref,
       asked_status_id)
    VALUES (v_link.id, v_link.company_id, v_link.project_id, v_unit.id, v_unit.unit_no,
            v_days, NULLIF(TRIM(COALESCE(p_name, '')), ''), v_ref, v_tag.id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- somebody already asked for this one; hand back the ref that exists rather
    -- than a failure, because from the dealer's side the request IS in
    SELECT ref INTO v_ref FROM public.availability_requests
     WHERE unit_id = v_unit.id AND status = 'pending';
    RETURN jsonb_build_object('success', true, 'ref', v_ref, 'already', true,
      'message', 'A request for this unit is already waiting.');
  END;

  RETURN jsonb_build_object('success', true, 'ref', v_ref, 'unit_no', v_unit.unit_no,
                            'days', v_days,
                            'asked', COALESCE(NULLIF(TRIM(v_tag.public_label),''), v_tag.status_name));
END $function$;

CREATE OR REPLACE FUNCTION public.list_reservation_requests(p_session_token text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean; v_scope uuid; v_out jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell',
      'message','Your role does not book or sell units.'); END IF;

  /* ── THE QUEUE IS THE DIRECTOR'S, NOT EVERY SELLER'S ───────────────────
     This asked only whether the caller may sell, and every sale rep may.
     So a rep opened the desk and found other people's requests sitting
     there with Approve and Decline under them — and could act on them. A
     rep reported it with a screenshot before anyone here noticed.

     Deciding a request books a unit for somebody else's client, and the
     tags it can apply include ones that take a unit off the market. That
     is a director's call. Refused as 'forbidden', which is also the answer
     the desk's watch stops polling on, so a rep's browser goes quiet
     instead of asking every 45 seconds for something it may not have. */
  IF COALESCE(public._sales_role_of(p_session_token),'') <> 'director' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden',
      'message','Only a director can act on requests from an availability link.'); END IF;


  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;
  v_scope := COALESCE(v_ses.project_id, p_project_id);

  /* Oldest first: a request that has waited longest is the one somebody is
     still staring at their phone about. The area and floor come along so the
     decision does not need a second screen. */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'ref', r.ref,
           /* 'new' asks for a unit; 'change' asks for a different tag on one
              the dealer already holds. The desk has to tell them apart before
              it can answer either. */
           'kind', COALESCE(r.kind,'new'),
           /* What the dealer asked for. A suggestion the director can accept
              with one tap or overrule with two — never applied on its own. */
           'asked_status_id', r.asked_status_id,
           'asked_tag', (SELECT COALESCE(NULLIF(TRIM(a.public_label),''), a.status_name)
                           FROM public.category_unit_statuses a
                          WHERE a.id = r.asked_status_id),
           'asked_nature', (SELECT a.nature FROM public.category_unit_statuses a
                             WHERE a.id = r.asked_status_id),
           'note', r.note,
           'current_tag', (SELECT cus.status_name FROM public.reservations rr
                             LEFT JOIN public.category_unit_statuses cus ON cus.id = rr.unit_status_id
                            WHERE rr.id = r.reservation_id),
           'unit_no', r.unit_no, 'unit_id', r.unit_id,
           'floor', COALESCE(NULLIF(u.floor_label,''),'-'),
           'area', u.area, 'area_unit', COALESCE(u.area_unit,'sqft'),
           'days', r.days,
           'requested_by', r.requested_by_name,
           'at', r.created_at,
           'minutes_waiting', GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - r.created_at))/60.0)::int),
           /* Still bookable? If not, Approve is going to fail and the desk
              should say so before he taps it rather than after. */
           'still_free', (public._map_unit_state(r.unit_id) = 'available'),
           'link_label', l.label)
         /* r.id breaks the tie: several requests can share a created_at to the
            microsecond, and an unstable queue order makes a list jump under the
            thumb that is about to tap Approve. */
         ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_out
    FROM public.availability_requests r
    JOIN public.units u ON u.id = r.unit_id
    LEFT JOIN public.availability_links l ON l.id = r.link_id
   WHERE r.status = 'pending'
     AND r.company_id = ANY(v_companies)
     AND (v_scope IS NULL OR r.project_id = v_scope);

  RETURN jsonb_build_object('success',true,'requests',v_out);
END $function$;

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
  v_nature text; v_days int; v_avail boolean; v_code text; v_pub boolean;
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

  /* PUBLISHED TO THE LINK, and only ever something the desk can apply. A
     status with no nature cannot be asked for, because it could not then be
     granted — which is how SOLD stays out of a dealer's reach while
     "Sold - Entry Pending" stands in its place. */
  v_pub := COALESCE((p_data->>'public_choice')::bool, false);
  IF v_pub AND v_nature IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_desk_tag',
      'message', 'Only a status the desk can apply may be offered on a link.');
  END IF;

  v_days := NULLIF(p_data->>'hold_days','')::int;
  IF v_nature = 'permanent' THEN
    v_days := NULL;                      -- permanent asks for no number of days
  ELSIF v_days IS NOT NULL AND (v_days < 1 OR v_days > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_hold_days',
      'message', 'A hold runs between 1 and 90 days.');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available, nature, hold_days, public_choice, public_label)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'status_code', p_data->>'status_name',
            COALESCE(p_data->>'color_hex','#6b7280'), COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), COALESCE((p_data->>'is_available')::bool, false),
            v_nature, v_days, v_pub, NULLIF(TRIM(COALESCE(p_data->>'public_label','')),''))
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
      public_choice = CASE WHEN p_data ? 'public_choice' THEN v_pub ELSE public_choice END,
      public_label  = CASE WHEN p_data ? 'public_label'
                          THEN NULLIF(TRIM(COALESCE(p_data->>'public_label','')),'')
                          ELSE public_label END,
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

/* The four-argument form is gone: the fifth has a default, so a client that
   has not been redeployed still resolves to this one and simply asks for
   nothing. Two overloads would have been a coin toss over which ran. */
DROP FUNCTION IF EXISTS public.submit_availability_request(text, text, integer, text);

/* A NEW SIGNATURE IS A NEW FUNCTION, and a new function is granted to PUBLIC
   unless somebody says otherwise. The four-argument form carried anon so the
   link could call it; the five-argument form has to be given the same reach
   deliberately, and nothing more. */
REVOKE ALL ON FUNCTION public.submit_availability_request(text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_availability_request(text, text, integer, text, uuid)
  TO anon, authenticated, service_role;

COMMIT;
