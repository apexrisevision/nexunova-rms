-- ═══════════════════════════════════════════════════════════════════════════
-- A DEALER ASKS, RASHID ANSWERS WITH ONE TAP
--
-- Today a dealer taps Request Reservation, WhatsApp opens, and a message lands
-- in a group that somebody has to read and retype into the desk. This puts the
-- same request in the desk itself, with the unit, the floor, the duration the
-- dealer chose and the name their phone carries, behind a single Approve.
--
-- THIS IS THE FIRST ANON WRITE REACHABLE FROM A PUBLIC LINK, so the shape of it
-- matters more than the feature.
--
--   · SUBMIT RESERVES NOTHING. It writes one row with status 'pending'. No unit
--     status changes, no reservation is created, no lock is taken. There is no
--     branch in this function that can book anything.
--   · APPROVE IS THE ONLY THING THAT BOOKS, and it books by calling
--     reserve_unit_desk with the DECIDING DIRECTOR'S OWN SESSION — so the
--     FOR UPDATE lock, the one-active-reservation-per-unit index, the tag
--     allow-list and the trigger that keeps a hold alive all apply exactly as
--     they do when he types it himself. No booking logic is duplicated here.
--   · The unit is resolved BY NUMBER INSIDE THE LINK'S OWN PROJECT. No id comes
--     from the browser, so a caller cannot name a unit in another tower.
--   · Revoking the link kills submissions the same moment it kills the page.
--   · The only thing that comes back is success and a short ref.
--
-- THE LIMITS ARE ON THE QUEUE, NOT ON THE HOUR. The first draft capped 30
-- requests per link per hour, which would have blocked a real launch day — one
-- link, sixteen agents, two units each is forty — while a script does thousands.
-- What actually hurts is a queue nobody can clear, so that is what is bounded:
--
--     50 pending at once per link   — self-healing; clearing makes room
--     1 pending per unit            — asking twice does not make two rows
--     200 per rolling hour per link — a second belt a real group never reaches
--
-- Pending requests older than 48 hours are retired to 'expired' on the way in,
-- so the queue cannot silently fill with things nobody will ever action.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.availability_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id        uuid NOT NULL REFERENCES public.availability_links(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unit_id        uuid NOT NULL REFERENCES public.units(id)     ON DELETE CASCADE,
  unit_no        text NOT NULL,          -- as it stood when asked, for the record
  days           int  NOT NULL,
  requested_by_name text,                -- what the dealer's phone carries; may be null
  ref            text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',   -- pending | approved | declined | expired | stale
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_requests_link_idx    ON public.availability_requests(link_id, status);
CREATE INDEX IF NOT EXISTS availability_requests_project_idx ON public.availability_requests(project_id, status);
CREATE INDEX IF NOT EXISTS availability_requests_ref_idx     ON public.availability_requests(link_id, ref);

-- Asking for the same unit twice does not make two rows for Rashid to read.
CREATE UNIQUE INDEX IF NOT EXISTS availability_requests_one_pending_per_unit
  ON public.availability_requests(unit_id) WHERE status = 'pending';

-- deny-all: every path in and out goes through the functions below
ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_requests FROM anon, authenticated;

-- ── a short ref a person can read down a phone ─────────────────────────────
-- No O/0 or I/1: this gets typed back into a WhatsApp reply by a human.
CREATE OR REPLACE FUNCTION public._request_ref()
 RETURNS text LANGUAGE sql VOLATILE SET search_path TO 'public'
AS $function$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + floor(random() * 32)::int, 1), '')
    FROM generate_series(1, 6)
$function$;
REVOKE ALL ON FUNCTION public._request_ref() FROM PUBLIC, anon, authenticated;

-- ── THE ANON WRITE ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_availability_request(
  p_token text, p_unit_no text, p_days int DEFAULT 7, p_name text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
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

  v_state := public._map_unit_state(v_unit.id);
  IF v_state <> 'available' THEN
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
END $function$;

REVOKE ALL ON FUNCTION public.submit_availability_request(text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_availability_request(text, text, int, text)
  TO anon, authenticated, service_role;

-- ── what the dealer's page may read back ───────────────────────────────────
-- Only refs it already holds, and only through the link that made them. It says
-- what happened and nothing about who decided or why beyond the standing line.
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
           'days', r.days, 'at', r.created_at, 'decided_at', r.decided_at)), '[]'::jsonb)
    INTO v_out
    FROM public.availability_requests r
   WHERE r.link_id = v_link.id
     AND r.ref = ANY(COALESCE(p_refs, ARRAY[]::text[]));

  RETURN jsonb_build_object('success', true, 'requests', v_out);
END $function$;

REVOKE ALL ON FUNCTION public.get_request_status(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_request_status(text, text[])
  TO anon, authenticated, service_role;

-- ── the queue, for whoever runs the desk ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_reservation_requests(
  p_session_token text, p_project_id uuid DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.list_reservation_requests(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_reservation_requests(text, uuid)
  TO anon, authenticated, service_role;

-- ── one tap ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_reservation_request(
  p_session_token text, p_request_id uuid, p_action text,
  p_unit_status_id uuid DEFAULT NULL,
  p_requested_by_agent_id uuid DEFAULT NULL,
  p_requested_by_sales_user_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean;
        v_req public.availability_requests; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  /* Locked, because two people looking at the same queue is the whole point of
     a queue. The second tap finds it already decided and says so. */
  SELECT * INTO v_req FROM public.availability_requests
   WHERE id = p_request_id AND company_id = ANY(v_companies)
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','already_decided',
      'status', v_req.status,
      'message','That request has already been ' || v_req.status || '.'); END IF;

  IF LOWER(COALESCE(p_action,'')) = 'decline' THEN
    UPDATE public.availability_requests
       SET status='declined', decided_by=v_ses.sales_user_id, decided_at=now(),
           decision_note='Declined by Management'
     WHERE id = v_req.id;
    RETURN jsonb_build_object('success',true,'status','declined');
  END IF;

  IF LOWER(COALESCE(p_action,'')) <> 'approve' THEN
    RETURN jsonb_build_object('success',false,'error','bad_action'); END IF;

  /* THE BOOKING IS NOT WRITTEN HERE. reserve_unit_desk is called with the
     DECIDING USER'S OWN SESSION, so the reservation is theirs, the lock is
     taken, the tag is re-validated against the unit's project and the
     one-active-per-unit index applies — exactly as when he types it. Copying
     any of that logic into this function would be a second place for it to
     drift. */
  v_res := public.reserve_unit_desk(
             p_session_token, v_req.unit_id,
             p_requested_by_agent_id, p_requested_by_sales_user_id,
             v_req.requested_by_name,
             NULL, NULL,                       -- no buyer details from a public request
             v_req.days, false, 0,
             'From availability link request ' || v_req.ref,
             p_unit_status_id);

  IF COALESCE((v_res->>'success')::boolean, false) THEN
    UPDATE public.availability_requests
       SET status='approved', decided_by=v_ses.sales_user_id, decided_at=now(),
           reservation_id=(v_res->>'reservation_id')::uuid
     WHERE id = v_req.id;
    RETURN jsonb_build_object('success',true,'status','approved','booking',v_res);
  END IF;

  /* The unit went between the ask and the tap. Say so, and retire the request
     rather than leaving it pending for a unit that can never be booked. */
  UPDATE public.availability_requests
     SET status='stale', decided_by=v_ses.sales_user_id, decided_at=now(),
         decision_note=COALESCE(v_res->>'error','could not book')
   WHERE id = v_req.id;
  RETURN jsonb_build_object('success',false,'error','could_not_book',
    'status','stale','detail',v_res);
END $function$;

REVOKE ALL ON FUNCTION public.decide_reservation_request(text, uuid, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_reservation_request(text, uuid, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

COMMIT;
