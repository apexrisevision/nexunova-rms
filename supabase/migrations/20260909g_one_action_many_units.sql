-- ═══════════════════════════════════════════════════════════════════════════
-- ONE ACTION, MANY UNITS.
--
-- Everything in this feature already worked one unit at a time, which is the
-- right shape for "Unit LG-12 reserve kar do" off a WhatsApp group and the
-- wrong shape for the other half of the day: forty units going to the
-- landowner, twenty on pagri, a dealer taking a whole row on the second floor.
-- Doing that today is forty passes over the same three fields.
--
-- The rule this migration holds to is that NOTHING NEW DECIDES ANYTHING. Each
-- of the three functions below is a loop around the single-unit function that
-- already exists, called with the caller's own session, so every check that
-- guards one unit guards all of them: the row lock, the tag allow-list, the
-- one-active-reservation index, the director-only queue, the link's own
-- project. There is no second copy of any rule here to drift out of step.
--
-- WHAT A BATCH IS NOT: it is not all-or-nothing. If unit 7 of 20 was taken a
-- minute ago, the other 19 are still what the operator asked for, and failing
-- all of them would be a worse answer than doing the work and saying which one
-- did not land. So each unit is attempted inside its own subtransaction and
-- every outcome comes back named, in the order it was sent.
--
-- THE TOKEN IS TAKEN ONCE. p_token_amount on a bulk booking is the money that
-- changed hands for the deal, not per unit — stamping PKR 50,000 onto each of
-- twenty reservations would invent a million rupees. It lands on the first
-- unit that books and the rest carry zero, which is also how the daybook adds
-- it up.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── a batch is a name several requests share ──────────────────────────────
-- Nullable, and null is the whole of the old behaviour: one dealer, one unit,
-- one card. A batch_ref only appears when somebody asked for several at once,
-- and it exists so the desk can answer them together instead of tapping
-- Approve twenty times on twenty identical cards.
ALTER TABLE public.availability_requests
  ADD COLUMN IF NOT EXISTS batch_ref text;

CREATE INDEX IF NOT EXISTS availability_requests_batch_pending_idx
  ON public.availability_requests (batch_ref)
  WHERE status = 'pending' AND batch_ref IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. THE DESK: one tag, many units
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reserve_units_desk(
  p_session_token text,
  p_unit_ids uuid[],
  p_requested_by_agent_id uuid DEFAULT NULL::uuid,
  p_requested_by_sales_user_id uuid DEFAULT NULL::uuid,
  p_requested_by_name text DEFAULT NULL::text,
  p_client_name text DEFAULT NULL::text,
  p_client_phone text DEFAULT NULL::text,
  p_expiry_days integer DEFAULT 7,
  p_token_received boolean DEFAULT false,
  p_token_amount numeric DEFAULT 0,
  p_note text DEFAULT NULL::text,
  p_unit_status_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_id uuid; v_one jsonb; v_rows jsonb := '[]'::jsonb;
        v_done int := 0; v_failed int := 0; v_money_spent boolean := false;
        v_take boolean; v_no text;
BEGIN
  /* The session is not checked here. reserve_unit_desk checks it on the first
     unit and returns session_expired, which travels back in the results array
     like any other refusal — one place that decides, not two. */
  IF p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_units',
      'message', 'Pick at least one unit.');
  END IF;

  /* Deduplicated, order preserved. A pasted list off WhatsApp repeats itself
     more often than not, and the second attempt at the same unit would come
     back "already reserved" — a refusal caused entirely by this function. */
  SELECT array_agg(u ORDER BY ord) INTO v_ids
    FROM (SELECT DISTINCT ON (u) u, ord
            FROM unnest(p_unit_ids) WITH ORDINALITY AS t(u, ord)
           ORDER BY u, ord) d;

  IF array_length(v_ids, 1) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many',
      'message', 'One booking can cover at most 100 units.');
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    /* The token is money that changed hands once. It rides the first unit that
       actually books; if that one is refused the next success carries it. */
    v_take := COALESCE(p_token_received, false) AND NOT v_money_spent;

    BEGIN
      v_one := public.reserve_unit_desk(
                 p_session_token, v_id,
                 p_requested_by_agent_id, p_requested_by_sales_user_id,
                 p_requested_by_name, p_client_name, p_client_phone,
                 p_expiry_days,
                 v_take, CASE WHEN v_take THEN COALESCE(p_token_amount, 0) ELSE 0 END,
                 p_note, p_unit_status_id);
    EXCEPTION WHEN OTHERS THEN
      /* One unit cannot take the batch down with it. The subtransaction rolls
         back only this unit's attempt; everything already booked stands. */
      v_one := jsonb_build_object('success', false, 'error', 'failed',
                                  'message', SQLERRM);
    END;

    IF COALESCE((v_one->>'success')::boolean, false) THEN
      v_done := v_done + 1;
      IF v_take THEN v_money_spent := true; END IF;
    ELSE
      v_failed := v_failed + 1;
    END IF;

    /* The unit's number, even on a refusal — the operator sent ids and reads
       names, and "3 of 20 failed" without saying which three is not an answer. */
    SELECT unit_no INTO v_no FROM public.units WHERE id = v_id;
    v_rows := v_rows || jsonb_build_array(
      v_one || jsonb_build_object('unit_id', v_id,
                                  'unit_no', COALESCE(v_one->>'unit_no', v_no)));
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_done > 0, 'done', v_done, 'failed', v_failed,
    'asked', array_length(v_ids, 1), 'results', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.reserve_units_desk(text, uuid[], uuid, uuid, text, text, text, integer, boolean, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_units_desk(text, uuid[], uuid, uuid, text, text, text, integer, boolean, numeric, text, uuid) TO anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE LINK: a dealer asks for several at once
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_availability_requests(
  p_token text,
  p_unit_nos text[],
  p_days integer DEFAULT 7,
  p_name text DEFAULT NULL::text,
  p_status_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_nos text[]; v_no text;
        v_one jsonb; v_rows jsonb := '[]'::jsonb; v_batch text;
        v_ok int := 0; v_failed int := 0; v_t0 timestamptz := now();
BEGIN
  IF p_unit_nos IS NULL OR array_length(p_unit_nos, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_units');
  END IF;

  SELECT array_agg(n ORDER BY ord) INTO v_nos
    FROM (SELECT DISTINCT ON (upper(TRIM(n))) upper(TRIM(n)) AS n, ord
            FROM unnest(p_unit_nos) WITH ORDINALITY AS t(n, ord)
           WHERE TRIM(COALESCE(n, '')) <> ''
           ORDER BY upper(TRIM(n)), ord) d;

  IF v_nos IS NULL OR array_length(v_nos, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_units');
  END IF;

  /* Lower than the desk's hundred on purpose. This is an anonymous page that
     can be forwarded to anybody, and the queue it writes into is capped at 50
     pending — a bigger ask here would only fill it and fail. */
  IF array_length(v_nos, 1) > 25 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many',
      'message', 'You can ask for at most 25 units at a time.');
  END IF;

  /* Resolved here only so the batch can be stamped on rows this call created
     and on nothing else. Every other decision stays inside the single-unit
     function, including whether this token is a link at all. */
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());

  IF array_length(v_nos, 1) > 1 THEN v_batch := public._request_ref(); END IF;

  FOREACH v_no IN ARRAY v_nos LOOP
    BEGIN
      v_one := public.submit_availability_request(p_token, v_no, p_days, p_name, p_status_id);
    EXCEPTION WHEN OTHERS THEN
      v_one := jsonb_build_object('success', false, 'error', 'failed');
    END;

    IF COALESCE((v_one->>'success')::boolean, false) THEN
      v_ok := v_ok + 1;
      /* NOT when 'already' came back. That ref belongs to a request somebody
         else made earlier; pulling it into this batch would hand this dealer a
         say over another dealer's ask. */
      IF v_batch IS NOT NULL AND NOT COALESCE((v_one->>'already')::boolean, false)
         AND v_link.id IS NOT NULL THEN
        UPDATE public.availability_requests
           SET batch_ref = v_batch
         WHERE ref = (v_one->>'ref') AND link_id = v_link.id
           AND status = 'pending' AND created_at >= v_t0;
      END IF;
    ELSE
      v_failed := v_failed + 1;
    END IF;

    v_rows := v_rows || jsonb_build_array(v_one || jsonb_build_object('unit_no', v_no));
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_ok > 0, 'ok', v_ok, 'failed', v_failed,
    'asked', array_length(v_nos, 1), 'batch', v_batch, 'results', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.submit_availability_requests(text, text[], integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_availability_requests(text, text[], integer, text, uuid) TO anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. THE QUEUE: one decision, several requests
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.decide_reservation_requests(
  p_session_token text,
  p_request_ids uuid[],
  p_action text,
  p_unit_status_id uuid DEFAULT NULL::uuid,
  p_requested_by_agent_id uuid DEFAULT NULL::uuid,
  p_requested_by_sales_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_id uuid; v_one jsonb; v_rows jsonb := '[]'::jsonb;
        v_done int := 0; v_failed int := 0; v_no text;
BEGIN
  IF p_request_ids IS NULL OR array_length(p_request_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_requests');
  END IF;

  SELECT array_agg(r ORDER BY ord) INTO v_ids
    FROM (SELECT DISTINCT ON (r) r, ord
            FROM unnest(p_request_ids) WITH ORDINALITY AS t(r, ord)
           ORDER BY r, ord) d;

  IF array_length(v_ids, 1) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many',
      'message', 'Answer at most 60 requests at a time.');
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      /* The caller's own session again: the director-only gate, the row lock
         and the already-decided check all live in there and all still apply,
         once per request. */
      v_one := public.decide_reservation_request(
                 p_session_token, v_id, p_action, p_unit_status_id,
                 p_requested_by_agent_id, p_requested_by_sales_user_id);
    EXCEPTION WHEN OTHERS THEN
      v_one := jsonb_build_object('success', false, 'error', 'failed',
                                  'message', SQLERRM);
    END;

    IF COALESCE((v_one->>'success')::boolean, false)
      THEN v_done := v_done + 1; ELSE v_failed := v_failed + 1; END IF;

    SELECT unit_no INTO v_no FROM public.availability_requests WHERE id = v_id;
    v_rows := v_rows || jsonb_build_array(
      v_one || jsonb_build_object('request_id', v_id, 'unit_no', v_no));
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_done > 0, 'done', v_done, 'failed', v_failed,
    'asked', array_length(v_ids, 1), 'results', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.decide_reservation_requests(text, uuid[], text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_reservation_requests(text, uuid[], text, uuid, uuid, uuid) TO anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE QUEUE SAYS WHICH ASKS ARRIVED TOGETHER
-- ═══════════════════════════════════════════════════════════════════════════
-- Same signature, same return type, one field added: the desk groups by it so
-- eight units asked for in one breath are answered in one tap.
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
           /* Several units asked for in one breath share this. The desk shows
              them as one card and answers them with one tap; null is a lone
              request and behaves exactly as it always did. */
           'batch_ref', r.batch_ref,
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

COMMIT;
