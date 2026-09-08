-- ═══════════════════════════════════════════════════════════════════════════
-- A DEALER MAY ASK FOR ANY NUMBER OF DAYS
--
-- The public page offered 1, 3 or 7 and the RPC enforced that whitelist,
-- rewriting anything else to 7. Rashid wants a rep to be able to type a number.
--
-- The whitelist was guarding the wrong thing. A request is not a booking: it
-- sits in his queue with the number on it and he answers yes or no. The gate is
-- the tap, not this CASE. And silently rewriting 12 to 7 was the worse half of
-- it — a number would have appeared in the queue that nobody had asked for, and
-- the dealer's WhatsApp message would have said something different again.
--
-- Now clamped to 1..90, which is exactly the range reserve_unit_desk itself
-- allows, so the public page can never ask for something the desk could not
-- grant. Out of range is clamped, never discarded.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
