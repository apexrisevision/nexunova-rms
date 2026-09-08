-- ═══════════════════════════════════════════════════════════════════════════
-- THE PAGE AND THE DESK AGREE ON WHAT "AVAILABLE" MEANS
--
-- The public page decided availability with _map_unit_state — no active sale,
-- no active reservation. The desk decides it with is_available on the unit's
-- own status row. Those are two different questions, and they can disagree:
-- a unit whose status says Reserved but which has no reservation behind it
-- reads FREE to a dealer and is REFUSED by reserve_unit_desk.
--
-- Found by the round-trip test, not by reading: a dealer's request was accepted,
-- it reached the queue, and Approve came back `unit_unavailable`. The dealer
-- waits, the director taps, and nothing happens.
--
-- Measured before changing anything:
--
--     Awami, FMH, KBH          0 units disagree
--     ZZ Map Tower (scratch)   3 units the page offers and the desk refuses
--
-- So this changes nothing any real dealer sees today. It closes the hole for the
-- day one of those statuses drifts on a live tower — which is not a hypothetical,
-- because 67 units already carry a status set by hand somewhere in this database.
--
-- BOTH conditions now, in BOTH places:
--   · get_public_availability — a unit is offered only if it can be bought
--   · submit_availability_request — a request is accepted only for a unit the
--     desk will actually be able to book, so Approve cannot fail on a state the
--     page could have known about
--
-- The stricter direction is deliberate. Hiding a unit that cannot be sold costs
-- one sale that was never available; offering one that cannot be booked costs a
-- dealer's time, a director's tap, and the credibility of the whole link.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── one definition, named once ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._public_unit_is_free(p_unit_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._map_unit_state(u.id) = 'available'
     AND COALESCE(st.is_available, false)
    FROM public.units u
    LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
   WHERE u.id = p_unit_id
$function$;

REVOKE ALL ON FUNCTION public._public_unit_is_free(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._public_unit_is_free(uuid) IS
  'Can a dealer be offered this unit AND can the desk then book it? Both halves, because the page and the desk disagreeing costs a dealer a wasted request and a director a tap that does nothing.';


-- ── both readers now ask it ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb; v_floors jsonb;
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

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', v_unit,
    'floors',  COALESCE(v_floors, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.submit_availability_request(p_token text, p_unit_no text, p_days integer DEFAULT 7, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units;
        v_days int; v_ref text; v_id uuid; v_pending int; v_hour int; v_state text;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- the same flat answer the read side gives: a probe learns nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  -- 1, 3 or 7. Nothing longer reaches the desk from a public page.
  v_days := CASE WHEN COALESCE(p_days, 7) IN (1, 3, 7) THEN p_days ELSE 7 END;

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

  v_ref := public._request_ref();
  BEGIN
    INSERT INTO public.availability_requests
      (link_id, company_id, project_id, unit_id, unit_no, days, requested_by_name, ref)
    VALUES (v_link.id, v_link.company_id, v_link.project_id, v_unit.id, v_unit.unit_no,
            v_days, NULLIF(TRIM(COALESCE(p_name, '')), ''), v_ref)
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
                            'days', v_days);
END $function$
;

COMMIT;
