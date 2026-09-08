-- ═══════════════════════════════════════════════════════════════════════════
-- A REFUSED APPROVAL IS NOT ALWAYS THE UNIT'S FAULT.
--
-- decide_reservation_request retired the dealer's request whenever the
-- booking failed, for any reason at all. So arming a tag this desk may not
-- apply, or a permanent tag while not being a director, marked the request
-- stale — and the dealer's phone read "Unit was taken".
--
-- Both halves of that were wrong. Nothing had happened to the unit, and the
-- request was gone, so it could not simply be approved again with the right
-- tag: the dealer had to ask from scratch for a unit that was free the whole
-- time. Seen on live, in a rolled-back transaction: approving with SOLD came
-- back {error: could_not_book, status: stale} with the real reason buried in
-- detail, and the request left as stale.
--
-- Only unit_unavailable and already_reserved are about the unit. Everything
-- else now leaves the request waiting exactly where it was, and hands the
-- reason back so the desk can say it in words instead of guessing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
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
