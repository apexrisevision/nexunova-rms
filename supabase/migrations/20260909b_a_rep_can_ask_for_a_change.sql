-- ═══════════════════════════════════════════════════════════════════════════
-- A REP CAN ASK FOR A CHANGE, NOT ONLY FOR A UNIT.
--
-- The gap Rashid found: a rep reserves a unit through the link, the deal
-- then matures, and there is no way for them to say so. The link could only
-- ask for a unit that was FREE, so the moment it was theirs it fell out of
-- the only channel they have. They would have to reach somebody by phone.
--
-- A request now has a KIND. 'new' asks for a unit. 'change' asks for a
-- different tag on a unit the dealer already holds — "this one is sold now",
-- "put it on pagri" — and it lands in the same queue, under the same
-- director-only gate, and is answered the same way: he picks the tag.
--
-- The dealer still chooses NOTHING. They say what happened in a note; the
-- status is the desk's to apply, which is the rule everywhere else on this
-- page and the reason a public link can be handed to anybody.
--
-- APPROVING A CHANGE DOES NOT REBOOK. The unit is already held, by this
-- dealer, and the hold carries a history — who asked, when, under which link.
-- Cancelling and re-making it would throw that away and put a release on the
-- daybook that nobody performed. The reservation stays; only its tag moves.
-- The clock restarts on the new tag's own days, because a change of status is
-- a fresh decision rather than a continuation, and a permanent tag has no
-- clock at all.
--
-- One rule, one place: the tag check that reserve_unit_desk did inline is now
-- _desk_tag, and both callers ask it. Two copies of "may this status be
-- applied, and by whom" is exactly how the two would drift.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. what kind of ask is this ───────────────────────────────────────────
ALTER TABLE public.availability_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.availability_requests DROP CONSTRAINT IF EXISTS avr_kind_chk;
ALTER TABLE public.availability_requests
  ADD CONSTRAINT avr_kind_chk CHECK (kind IN ('new','change'));

COMMENT ON COLUMN public.availability_requests.kind IS
  'new = asking for a free unit. change = asking for a different tag on a unit this dealer already holds.';
COMMENT ON COLUMN public.availability_requests.note IS
  'What the dealer said when asking for a change. Never a status: the desk decides that.';

-- ── 2. one answer to "may this tag be applied, and by whom" ───────────────
CREATE OR REPLACE FUNCTION public._desk_tag(p_role text, p_unit_id uuid, p_status_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_unit public.units; v_tag public.category_unit_statuses;
BEGIN
  /* Re-derived against the UNIT's own project every time, because a caller can
     send any uuid it likes and the browser was only ever handed a list. A
     status from another project, an inactive one, a sellable one, or one the
     sales module owns is refused rather than stamped. */
  SELECT * INTO v_unit FROM public.units WHERE id = p_unit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','unit_not_found'); END IF;

  SELECT * INTO v_tag FROM public.category_unit_statuses
   WHERE id = p_status_id
     AND project_id = v_unit.project_id
     AND company_id = v_unit.company_id
     AND is_active
     AND NOT is_available
     AND nature IN ('temporary','permanent');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','bad_status',
      'message','That is not a status this desk can apply to a unit.'); END IF;

  /* PERMANENT NEEDS A DIRECTOR. A temporary hold corrects itself when the
     clock runs out; a permanent one takes the unit off the market and stays,
     so its mistake is the kind somebody has to come back and undo by hand. */
  IF v_tag.nature = 'permanent' AND COALESCE(p_role,'') <> 'director' THEN
    RETURN jsonb_build_object('ok',false,'error','director_only',
      'message','Only a director can take a unit off the market permanently.'); END IF;

  RETURN jsonb_build_object('ok',true,'id',v_tag.id,'nature',v_tag.nature,
    'days',v_tag.hold_days,'name',v_tag.status_name,'code',v_tag.status_code);
END $function$;

REVOKE ALL ON FUNCTION public._desk_tag(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._desk_tag(text, uuid, uuid) FROM anon, authenticated;

-- ── 3. the dealer asks, and chooses nothing ───────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_change_request(
  p_token text, p_ref text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_src public.availability_requests;
        v_hold public.reservations; v_ref text; v_id uuid; v_pending int; v_hour int;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;

  /* OWNERSHIP, WITHOUT AN ACCOUNT. There is no login here; the dealer is a
     name typed on a phone. What CAN be proved is that this link issued that
     ref, that it was approved, and that the hold it produced is still
     standing. Anything else is somebody quoting a number they overheard. */
  SELECT * INTO v_src FROM public.availability_requests
   WHERE link_id = v_link.id AND ref = UPPER(TRIM(COALESCE(p_ref,'')))
     AND status = 'approved';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_yours',
      'message','That reference is not an approved request from this link.'); END IF;

  SELECT * INTO v_hold FROM public.reservations
   WHERE id = v_src.reservation_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','hold_gone',
      'message','That unit is no longer held, so there is nothing to change.'); END IF;

  /* One pending ask per unit, the same cap a new request lives under, so a
     dealer tapping twice does not put two questions on the desk. */
  IF EXISTS (SELECT 1 FROM public.availability_requests
              WHERE unit_id = v_src.unit_id AND status = 'pending') THEN
    RETURN jsonb_build_object('success',false,'error','already_pending',
      'message','A request for this unit is already waiting.'); END IF;

  SELECT count(*) INTO v_pending FROM public.availability_requests
   WHERE link_id = v_link.id AND status = 'pending';
  IF v_pending >= 50 THEN
    RETURN jsonb_build_object('success',false,'error','queue_full',
      'message','There are already 50 requests waiting on this link. Please try again once some are answered.'); END IF;
  SELECT count(*) INTO v_hour FROM public.availability_requests
   WHERE link_id = v_link.id AND created_at > now() - interval '1 hour';
  IF v_hour >= 200 THEN
    RETURN jsonb_build_object('success',false,'error','too_many',
      'message','Too many requests from this link in the last hour. Please try again shortly.'); END IF;

  v_ref := public._request_ref();
  INSERT INTO public.availability_requests
    (link_id, company_id, project_id, unit_id, unit_no, days, requested_by_name,
     ref, kind, note, reservation_id)
  VALUES
    (v_link.id, v_link.company_id, v_link.project_id, v_src.unit_id, v_src.unit_no,
     v_src.days, v_src.requested_by_name, v_ref, 'change',
     NULLIF(TRIM(COALESCE(p_note,'')),''), v_hold.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'ref',v_ref,'unit_no',v_src.unit_no);
END $function$;

REVOKE ALL ON FUNCTION public.submit_change_request(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_change_request(text, text, text)
  TO anon, authenticated, service_role;

-- ── 4. and the four that had to learn about it ────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_unit_desk(p_session_token text, p_unit_id uuid, p_requested_by_agent_id uuid DEFAULT NULL::uuid, p_requested_by_sales_user_id uuid DEFAULT NULL::uuid, p_requested_by_name text DEFAULT NULL::text, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_expiry_days integer DEFAULT 7, p_token_received boolean DEFAULT false, p_token_amount numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_unit_status_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_unit public.units;
        v_group uuid; v_companies uuid[]; v_span boolean;
        v_reserved_status uuid; v_days int; v_res_id uuid; v_expiry timestamptz;
        v_agent public.agents; v_ruser public.sales_users; v_rname text; v_chk jsonb;
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
    /* Asked of _desk_tag rather than re-derived here, because the change
       requests added alongside this need exactly the same answer and two
       copies of one rule is how they come apart. */
    v_chk := public._desk_tag(v_su.role, p_unit_id, p_unit_status_id);
    IF NOT COALESCE((v_chk->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object('success',false,
        'error', v_chk->>'error', 'message', v_chk->>'message'); END IF;
    SELECT * INTO v_tag FROM public.category_unit_statuses WHERE id = p_unit_status_id;
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

CREATE OR REPLACE FUNCTION public.decide_reservation_request(p_session_token text, p_request_id uuid, p_action text, p_unit_status_id uuid DEFAULT NULL::uuid, p_requested_by_agent_id uuid DEFAULT NULL::uuid, p_requested_by_sales_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_hold public.reservations; v_chk jsonb; v_su public.sales_users;
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

  /* ── A CHANGE IS NOT A BOOKING ──────────────────────────────────────────
     The unit is already held, by this same dealer, and the hold has a
     history: who asked, when, and under which link. Cancelling it and making
     a fresh one would throw all of that away and put a release on the daybook
     that nobody performed. So the reservation stays and only its tag moves.

     The clock restarts on the new tag's own days, because a change of status
     is a fresh decision and not a continuation of the old one — and a
     permanent tag has no clock at all. */
  IF COALESCE(v_req.kind,'new') = 'change' THEN
    SELECT * INTO v_hold FROM public.reservations
     WHERE id = v_req.reservation_id AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.availability_requests
         SET status='stale', decided_by=v_ses.sales_user_id, decided_at=now(),
             decision_note='the hold had already gone'
       WHERE id = v_req.id;
      RETURN jsonb_build_object('success',false,'error','hold_gone','status','stale',
        'message','That hold is no longer standing, so there is nothing to change.');
    END IF;

    v_chk := public._desk_tag(v_su.role, v_hold.unit_id, p_unit_status_id);
    IF NOT COALESCE((v_chk->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object('success',false,'error','could_not_book','status','pending',
        'message', COALESCE(v_chk->>'message','That status cannot be applied here.'),
        'detail', v_chk);
    END IF;

    UPDATE public.reservations
       SET unit_status_id = (v_chk->>'id')::uuid,
           expiry_date = CASE WHEN v_chk->>'nature' = 'permanent' THEN NULL
                              ELSE now() + (COALESCE((v_chk->>'days')::int, v_req.days, 7)
                                            || ' days')::interval END,
           updated_at = now()
     WHERE id = v_hold.id;
    UPDATE public.units SET status_id = (v_chk->>'id')::uuid, updated_at = now()
     WHERE id = v_hold.unit_id;

    UPDATE public.availability_requests
       SET status='approved', decided_by=v_ses.sales_user_id, decided_at=now(),
           reservation_id = v_hold.id
     WHERE id = v_req.id;
    RETURN jsonb_build_object('success',true,'status','approved',
      'booking', jsonb_build_object('unit_no', v_req.unit_no,
        'tag', v_chk->>'name', 'tag_code', v_chk->>'code', 'nature', v_chk->>'nature',
        'requested_by', v_req.requested_by_name,
        'expiry_days', CASE WHEN v_chk->>'nature' = 'permanent' THEN NULL
                            ELSE COALESCE((v_chk->>'days')::int, v_req.days, 7) END,
        'reservation_id', v_hold.id));
  END IF;

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
           'days', r.days, 'at', r.created_at, 'decided_at', r.decided_at,
           /* DERIVED, EVERY TIME IT IS ASKED. An approved request whose
              reservation is no longer standing is not a hold any more, and
              the phone that is showing it has no other way to find out. */
           'state', CASE
             WHEN r.status <> 'approved' THEN r.status
             WHEN rv.id IS NOT NULL
              AND rv.status = 'active'
              AND (rv.expiry_date IS NULL OR rv.expiry_date > now()) THEN 'held'
             ELSE 'ended'
           END,
           /* Only when it is genuinely still held. A date on an ended hold
              reads like a promise. */
           'held_until', CASE
             WHEN r.status = 'approved' AND rv.id IS NOT NULL
              AND rv.status = 'active'
              AND (rv.expiry_date IS NULL OR rv.expiry_date > now())
             THEN to_jsonb(rv.expiry_date)
             ELSE 'null'::jsonb
           END)), '[]'::jsonb)
    INTO v_out
    FROM public.availability_requests r
    LEFT JOIN public.reservations rv ON rv.id = r.reservation_id
   WHERE r.link_id = v_link.id
     AND r.ref = ANY(COALESCE(p_refs, ARRAY[]::text[]));

  RETURN jsonb_build_object('success', true, 'requests', v_out);
END $function$;

COMMIT;
