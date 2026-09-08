-- ═══════════════════════════════════════════════════════════════════════════
-- THE REQUEST QUEUE BELONGS TO THE DIRECTOR.
--
-- list_reservation_requests and decide_reservation_request asked only
-- whether the caller may sell. Every sale rep may. So every rep opened the
-- Reserve Desk and found the pending requests from the public link sitting
-- there with Approve and Decline under them, and the tag chips beneath that
-- — and could act on any of them, for anybody's client.
--
-- Measured on the live tenant before fixing: with a real session for each
-- role, sale_rep and marketing_manager both got the full queue back;
-- accounts and general were already refused, but only because they cannot
-- sell at all. A rep sent Rashid a screenshot of a queue that was never
-- meant to reach him.
--
-- Approving books a unit for someone else's client, and the tags it can
-- apply include ones that take a unit off the market for good. It is a
-- director's call, and now it says so. The refusal is 'forbidden', which is
-- the answer the desk's watch already stops polling on, so a rep's browser
-- goes quiet rather than asking every 45 seconds for something it may not
-- have.
--
-- The permanent-tag rule in reserve_unit_desk stays where it is: this is a
-- second lock on a different door, not a replacement for it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
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

CREATE OR REPLACE FUNCTION public.decide_reservation_request(p_session_token text, p_request_id uuid, p_action text, p_unit_status_id uuid DEFAULT NULL::uuid, p_requested_by_agent_id uuid DEFAULT NULL::uuid, p_requested_by_sales_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  /* ── A REFUSAL IS NOT ALWAYS THE UNIT'S FAULT ──────────────────────────
     This used to retire the request whatever went wrong, so a tag this desk
     may not apply, or a permanent tag armed by somebody who is not a
     director, told the dealer "Unit was taken" — which was untrue, nothing
     had happened to the unit — and threw the request away, so it could not
     simply be approved again with the right tag. The dealer had to ask from
     scratch for a unit that was free the whole time.

     Only two answers are about the unit. Everything else leaves the request
     exactly where it was, waiting, and hands back the reason so the desk can
     say it out loud. */
  IF COALESCE(v_res->>'error','') IN ('unit_unavailable','already_reserved') THEN
    UPDATE public.availability_requests
       SET status='stale', decided_by=v_ses.sales_user_id, decided_at=now(),
           decision_note=COALESCE(v_res->>'error','could not book')
     WHERE id = v_req.id;
    RETURN jsonb_build_object('success',false,'error','could_not_book',
      'status','stale','detail',v_res);
  END IF;

  RETURN jsonb_build_object('success',false,'error','could_not_book',
    'status','pending',
    'message', COALESCE(v_res->>'message',
                        'That could not be approved. The request is still waiting.'),
    'detail', v_res);
END $function$;

COMMIT;
