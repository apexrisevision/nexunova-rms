-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-06e · Receive Token on the link: the rules, the numbers, the undo,
--               and the whole register
--
-- Rashid, 2026-10-06:
--   1. a token only on a HELD unit (V.Hold / Reserve / Sold ...) - never on an
--      Available one, and never on Sold (P) / Pagri;
--   2. only the dealer who holds the unit may record its token;
--   3. Token only - payments are received later in RMS;
--   4. a wrong Verify must be reversible;
--   5. dealers must not see each other's tokens;
--   6. Token # and Voucher # - the books run on them;
--   7. the whole record, not only pending + the last 3 days.
--
-- "The dealer who holds it": the unit's active reservation, matched to the
-- caller by MOBILE (the hold's agent, its portal user, or the link request it
-- came from) or by NAME (the hold's name, or the same agent through
-- agent_name_aliases). The link has no login - name and mobile are what the
-- dealer typed - so this stops mistakes and casual misuse; the director's
-- Verify remains the real check.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.link_payment_receipts
  ADD COLUMN IF NOT EXISTS token_no      text,
  ADD COLUMN IF NOT EXISTS voucher_no    text,
  ADD COLUMN IF NOT EXISTS reopened_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopened_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by_name text;

-- ── may this caller record a token on this unit? ─────────────────────────────
CREATE OR REPLACE FUNCTION public._link_token_gate(p_unit uuid, p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_u public.units; v_st public.category_unit_statuses; v_r public.reservations;
        v_phone text := public._normalize_pk_mobile(p_phone); v_key text := public._hold_name_key(p_name);
        v_me uuid; v_them uuid; v_ok boolean := false;
BEGIN
  SELECT * INTO v_u FROM public.units WHERE id = p_unit;
  SELECT * INTO v_st FROM public.category_unit_statuses WHERE id = v_u.status_id;
  SELECT * INTO v_r FROM public.reservations
   WHERE unit_id = p_unit AND status = 'active' ORDER BY created_at DESC LIMIT 1;
  /* Pagri first: it is refused for what it is, held or not */
  IF COALESCE(v_st.status_name, '') ~* 'pagri' OR COALESCE(v_st.public_label, '') ~* 'sold \(p\)' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pagri',
      'message', v_u.unit_no || ' is Sold (P) - no token is recorded on a Pagri unit.');
  END IF;
  IF v_r.id IS NULL OR COALESCE(v_st.is_available, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unit_free',
      'message', v_u.unit_no || ' is not held. Mark it first (V.Hold, Reserve or Sold) - a token is recorded only on a held unit.');
  END IF;
  /* EVERY TEST BELOW IS NULL-SAFE. A NULL from "x IN (...)" or "a = b" read
     by IF NOT as unknown would let anybody through. */
  /* by mobile: the hold's agent, its portal user, or the link request it came from */
  IF v_phone IS NOT NULL THEN
    v_ok := COALESCE(v_phone IN (
      SELECT public._normalize_pk_mobile(a.phone) FROM public.agents a WHERE a.id = v_r.requested_by_agent_id
      UNION ALL SELECT public._normalize_pk_mobile(su.phone) FROM public.sales_users su WHERE su.id = v_r.requested_by_sales_user_id
      UNION ALL SELECT public._normalize_pk_mobile(q.requested_by_phone) FROM public.availability_requests q WHERE q.reservation_id = v_r.id), false);
  END IF;
  /* by name: the same written name, or the same agent through its aliases */
  IF NOT v_ok AND v_key IS NOT NULL AND v_key <> '' THEN
    v_ok := COALESCE(v_key = public._hold_name_key(v_r.requested_by_name), false);
    IF NOT v_ok THEN
      v_me := public._requester_agent_for_name(v_u.company_id, p_name);
      v_them := COALESCE(v_r.requested_by_agent_id, public._requester_agent_for_name(v_u.company_id, v_r.requested_by_name));
      v_ok := COALESCE(v_me IS NOT NULL AND v_me = v_them, false);
    END IF;
  END IF;
  v_ok := COALESCE(v_ok, false);
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_yours',
      'message', v_u.unit_no || ' is held for ' || COALESCE(v_r.requested_by_name, 'another dealer')
                 || '. Only the dealer who holds a unit can record its token.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_r.id, 'held_for', v_r.requested_by_name,
                            'status', COALESCE(NULLIF(btrim(v_st.public_label), ''), v_st.status_name));
END
$function$;
REVOKE ALL ON FUNCTION public._link_token_gate(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── the link: the unit's earlier total, only for the dealer who holds it ─────
DROP FUNCTION IF EXISTS public.get_link_unit_receipts(text, text);
CREATE OR REPLACE FUNCTION public.get_link_unit_receipts(p_token text, p_unit_no text, p_name text DEFAULT NULL, p_phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units; v_gate jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;
  SELECT * INTO v_unit FROM public.units
   WHERE project_id = v_link.project_id AND upper(unit_no) = upper(btrim(COALESCE(p_unit_no, ''))) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found',
    'message', 'There is no such unit in this project.'); END IF;
  v_gate := public._link_token_gate(v_unit.id, p_name, p_phone);
  IF NOT (v_gate->>'ok')::boolean THEN
    RETURN jsonb_build_object('success', false, 'unit_no', v_unit.unit_no) || (v_gate - 'ok');
  END IF;
  RETURN jsonb_build_object('success', true, 'unit_no', v_unit.unit_no, 'held_for', v_gate->'held_for',
                            'status', v_gate->'status')
         || public._link_unit_money(v_unit.id);
END
$function$;

-- ── the link: record a token (token only; held unit; the holder only) ────────
DROP FUNCTION IF EXISTS public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text,
  text, text, text, text, numeric, numeric, date, text);
CREATE OR REPLACE FUNCTION public.submit_link_payment(
  p_token text, p_unit_no text, p_amount numeric, p_mode text, p_reference text,
  p_payer text, p_paid_on date, p_note text, p_name text, p_phone text,
  p_kind text DEFAULT 'token', p_father text DEFAULT NULL, p_cnic text DEFAULT NULL,
  p_payer_mobile text DEFAULT NULL, p_basic_price numeric DEFAULT NULL, p_final_price numeric DEFAULT NULL,
  p_valid_upto date DEFAULT NULL, p_bank text DEFAULT NULL,
  p_token_no text DEFAULT NULL, p_voucher_no text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units; v_code text; v_gate jsonb;
        v_before jsonb; v_no int; v_ref text; v_row public.link_payment_receipts;
        v_phone text; v_mode text; v_hour int; v_dup public.link_payment_receipts;
        v_cnic text; v_pmob text; v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  PERFORM public._rms_actor(COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), 'Dealer on the link'), 'link');
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required', 'message', 'Please enter your name.'); END IF;
  v_phone := public._normalize_pk_mobile(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_required',
      'message', 'Please enter your 11-digit mobile number, e.g. 03001234567.'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount', 'message', 'Please enter the token amount.'); END IF;
  v_mode := lower(btrim(COALESCE(p_mode, '')));
  IF v_mode NOT IN ('cash', 'bank', 'online', 'cheque') THEN
    RETURN jsonb_build_object('success', false, 'error', 'mode', 'message', 'Choose Cash, Cheque, Online or Bank.'); END IF;
  IF NULLIF(btrim(COALESCE(p_payer, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'payer', 'message', 'Please enter the customer''s name.'); END IF;
  IF p_paid_on IS NULL OR p_paid_on > v_today OR p_paid_on < v_today - 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'date',
      'message', 'The date must be today or within the last 90 days.'); END IF;
  IF NULLIF(btrim(COALESCE(p_cnic, '')), '') IS NOT NULL THEN
    v_cnic := regexp_replace(p_cnic, '\D', '', 'g');
    IF length(v_cnic) <> 13 THEN
      RETURN jsonb_build_object('success', false, 'error', 'cnic', 'message', 'The CNIC must have 13 digits.'); END IF;
    v_cnic := substr(v_cnic, 1, 5) || '-' || substr(v_cnic, 6, 7) || '-' || substr(v_cnic, 13, 1);
  END IF;
  IF NULLIF(btrim(COALESCE(p_payer_mobile, '')), '') IS NOT NULL THEN
    v_pmob := public._normalize_pk_mobile(p_payer_mobile);
    IF v_pmob IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'payer_mobile',
        'message', 'The customer''s mobile must be 11 digits, e.g. 03001234567.'); END IF;
  END IF;
  IF COALESCE(p_basic_price, 0) < 0 OR COALESCE(p_basic_price, 0) > 10000000000
     OR COALESCE(p_final_price, 0) < 0 OR COALESCE(p_final_price, 0) > 10000000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'price', 'message', 'The price does not look right.'); END IF;
  IF p_valid_upto IS NOT NULL AND (p_valid_upto < p_paid_on OR p_valid_upto > v_today + 366) THEN
    RETURN jsonb_build_object('success', false, 'error', 'valid_upto',
      'message', 'Valid upto must be after the date received, within a year.'); END IF;

  SELECT count(*) INTO v_hour FROM public.link_payment_receipts
   WHERE link_id = v_link.id AND created_at > now() - interval '1 hour';
  IF v_hour >= 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many',
      'message', 'Too many entries from this link in the last hour. Please try again shortly.'); END IF;

  SELECT * INTO v_unit FROM public.units
   WHERE project_id = v_link.project_id AND upper(unit_no) = upper(btrim(COALESCE(p_unit_no, ''))) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found',
    'message', 'There is no such unit in this project.'); END IF;

  /* a held unit, not Pagri, and the caller's own */
  v_gate := public._link_token_gate(v_unit.id, p_name, p_phone);
  IF NOT (v_gate->>'ok')::boolean THEN
    RETURN jsonb_build_object('success', false) || (v_gate - 'ok');
  END IF;

  SELECT * INTO v_dup FROM public.link_payment_receipts
   WHERE unit_id = v_unit.id AND amount = round(p_amount, 2) AND mode = v_mode
     AND lower(payer_name) = lower(btrim(p_payer)) AND received_by_phone = v_phone
     AND created_at > now() - interval '10 minutes'
   ORDER BY created_at DESC LIMIT 1;

  PERFORM pg_advisory_xact_lock(hashtext('link_payment_receipts:' || v_link.project_id::text));
  v_before := public._link_unit_money(v_unit.id);

  IF v_dup.id IS NOT NULL THEN
    v_row := v_dup;
  ELSE
    SELECT COALESCE(max(receipt_no), 1000) + 1 INTO v_no
      FROM public.link_payment_receipts WHERE project_id = v_link.project_id;
    SELECT COALESCE(NULLIF(btrim(project_code), ''), NULLIF(btrim(short_code), ''), 'RCV') INTO v_code
      FROM public.projects WHERE id = v_link.project_id;
    v_ref := upper(v_code) || '-RCV-' || v_no;
    INSERT INTO public.link_payment_receipts
      (receipt_no, ref, link_id, company_id, project_id, unit_id, unit_no, amount, mode, reference,
       payer_name, paid_on, note, received_by_name, received_by_phone,
       kind, payer_father, payer_cnic, payer_mobile, basic_price, final_price, valid_upto, bank_name,
       token_no, voucher_no)
    VALUES (v_no, v_ref, v_link.id, v_link.company_id, v_link.project_id, v_unit.id, v_unit.unit_no,
            round(p_amount, 2), v_mode, NULLIF(left(btrim(COALESCE(p_reference, '')), 80), ''),
            left(btrim(p_payer), 80), p_paid_on, NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
            left(btrim(p_name), 80), v_phone,
            'token', NULLIF(left(btrim(COALESCE(p_father, '')), 80), ''), v_cnic, v_pmob,
            round(p_basic_price, 2), round(p_final_price, 2), p_valid_upto,
            NULLIF(left(btrim(COALESCE(p_bank, '')), 60), ''),
            NULLIF(left(btrim(COALESCE(p_token_no, '')), 30), ''), NULLIF(left(btrim(COALESCE(p_voucher_no, '')), 30), ''))
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('success', true, 'already', v_dup.id IS NOT NULL,
    'ref', v_row.ref, 'serial', v_row.receipt_no, 'kind', v_row.kind,
    'token_no', v_row.token_no, 'voucher_no', v_row.voucher_no,
    'unit_no', v_row.unit_no, 'floor', v_unit.floor_label, 'area', v_unit.area,
    'amount', v_row.amount, 'mode', v_row.mode, 'reference', v_row.reference, 'bank', v_row.bank_name,
    'payer', v_row.payer_name, 'father', v_row.payer_father, 'cnic', v_row.payer_cnic,
    'payer_mobile', v_row.payer_mobile, 'basic_price', v_row.basic_price, 'final_price', v_row.final_price,
    'valid_upto', v_row.valid_upto, 'paid_on', v_row.paid_on, 'note', v_row.note,
    'received_by', v_row.received_by_name, 'received_by_phone', v_row.received_by_phone,
    'status', v_row.status, 'created_at', v_row.created_at, 'held_for', v_gate->'held_for',
    'before', CASE WHEN v_dup.id IS NOT NULL
                   THEN jsonb_build_object('recorded_total', (v_before->>'recorded_total')::numeric - v_row.amount,
                                           'recorded_count', (v_before->>'recorded_count')::int - 1,
                                           'hold_token', v_before->'hold_token')
                   ELSE v_before END);
END
$function$;

-- ── the link: status of the entries THIS mobile sent, and no one else's ──────
DROP FUNCTION IF EXISTS public.get_link_payment_status(text, text[]);
CREATE OR REPLACE FUNCTION public.get_link_payment_status(p_token text, p_refs text[], p_phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_phone text := public._normalize_pk_mobile(p_phone);
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;
  IF v_phone IS NULL OR p_refs IS NULL OR cardinality(p_refs) = 0 THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('ref', ref, 'unit_no', unit_no, 'amount', amount,
                                        'status', status, 'decided_at', decided_at,
                                        'token_no', token_no, 'voucher_no', voucher_no) ORDER BY created_at DESC)
      FROM public.link_payment_receipts
     WHERE link_id = v_link.id AND received_by_phone = v_phone AND ref = ANY (p_refs[1:50])), '[]'::jsonb));
END
$function$;

-- ── the desk: the waiting list, or the whole register ────────────────────────
DROP FUNCTION IF EXISTS public.list_link_payments(text);
CREATE OR REPLACE FUNCTION public.list_link_payments(p_session_token text, p_all boolean DEFAULT false,
                                                     p_from date DEFAULT NULL, p_to date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean; v_scope uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella, false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;
  v_scope := v_ses.project_id;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'ref', p.ref, 'serial', p.receipt_no, 'kind', p.kind,
             'token_no', p.token_no, 'voucher_no', p.voucher_no,
             'unit_no', p.unit_no, 'unit_id', p.unit_id,
             'floor', COALESCE(NULLIF(u.floor_label, ''), '-'), 'area', u.area,
             'amount', p.amount, 'mode', p.mode, 'reference', p.reference, 'bank', p.bank_name,
             'payer', p.payer_name, 'father', p.payer_father, 'cnic', p.payer_cnic, 'payer_mobile', p.payer_mobile,
             'basic_price', p.basic_price, 'final_price', p.final_price, 'valid_upto', p.valid_upto,
             'paid_on', p.paid_on, 'note', p.note,
             'received_by', p.received_by_name, 'received_by_phone', p.received_by_phone,
             'status', p.status, 'decided_by', p.decided_by_name, 'decided_at', p.decided_at,
             'decision_note', p.decision_note, 'created_at', p.created_at,
             'applied', p.applied_reservation_id IS NOT NULL, 'applied_amount', p.applied_amount,
             'reopened_count', p.reopened_count, 'reopened_at', p.reopened_at, 'reopened_by', p.reopened_by_name,
             'project', pr.project_name)
           ORDER BY (p.status = 'pending') DESC, p.created_at DESC)
      FROM public.link_payment_receipts p
      JOIN public.units u ON u.id = p.unit_id
      JOIN public.projects pr ON pr.id = p.project_id
     WHERE p.company_id = ANY (v_companies)
       AND (v_scope IS NULL OR p.project_id = v_scope)
       AND CASE WHEN p_all
                THEN (p_from IS NULL OR p.paid_on >= p_from) AND (p_to IS NULL OR p.paid_on <= p_to)
                ELSE (p.status = 'pending' OR p.decided_at > now() - interval '3 days') END), '[]'::jsonb));
END
$function$;

-- ── the desk: Verify (with the books' Token # and Voucher #), Reject, or Undo ──
DROP FUNCTION IF EXISTS public.decide_link_payment(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.decide_link_payment(p_session_token text, p_id uuid, p_action text,
  p_note text DEFAULT NULL, p_token_no text DEFAULT NULL, p_voucher_no text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_group uuid; v_companies uuid[];
        v_span boolean; v_row public.link_payment_receipts; v_act text;
        v_hold public.reservations; v_before numeric; v_after numeric; v_was text;
BEGIN
  PERFORM public._rms_actor_session(p_session_token);
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'Only a director can decide a token from the link.'); END IF;
  v_act := lower(btrim(COALESCE(p_action, '')));
  IF v_act NOT IN ('verify', 'reject', 'reopen') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_action'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella, false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  SELECT * INTO v_row FROM public.link_payment_receipts
   WHERE id = p_id AND company_id = ANY (v_companies) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  /* UNDO: a decision taken back. A verified token that went onto a hold comes
     off it again; the entry returns to pending, to be decided afresh. */
  IF v_act = 'reopen' THEN
    IF v_row.status = 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'not_decided', 'message', 'That entry is still pending.'); END IF;
    v_was := v_row.status;
    IF v_row.applied_reservation_id IS NOT NULL THEN
      SELECT * INTO v_hold FROM public.reservations WHERE id = v_row.applied_reservation_id FOR UPDATE;
      IF FOUND THEN
        v_before := COALESCE(v_hold.token_amount, 0);
        v_after  := greatest(0, v_before - COALESCE(v_row.applied_amount, 0));
        UPDATE public.reservations
           SET token_amount = v_after, token_received = (v_after > 0), updated_at = now()
         WHERE id = v_hold.id;
      END IF;
    END IF;
    UPDATE public.link_payment_receipts
       SET status = 'pending', decided_by = NULL, decided_by_name = NULL, decided_at = NULL,
           decision_note = NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
           applied_reservation_id = NULL, applied_amount = NULL,
           reopened_count = reopened_count + 1, reopened_at = now(), reopened_by_name = v_su.full_name
     WHERE id = v_row.id
     RETURNING * INTO v_row;
    RETURN jsonb_build_object('success', true, 'status', 'pending', 'was', v_was, 'ref', v_row.ref,
                              'hold_updated', v_hold.id IS NOT NULL,
                              'hold_token_before', v_before, 'hold_token_after', v_after,
                              'held_by', v_hold.requested_by_name);
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_decided', 'status', v_row.status,
      'message', 'That entry has already been ' || v_row.status || '.'); END IF;

  IF v_act = 'verify' THEN
    SELECT * INTO v_hold FROM public.reservations
     WHERE unit_id = v_row.unit_id AND status = 'active'
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      v_before := COALESCE(v_hold.token_amount, 0);
      v_after  := v_before + v_row.amount;
      UPDATE public.reservations
         SET token_received = true, token_amount = v_after, updated_at = now()
       WHERE id = v_hold.id;
    END IF;
  END IF;

  UPDATE public.link_payment_receipts
     SET status = CASE v_act WHEN 'verify' THEN 'verified' ELSE 'rejected' END,
         decided_by = v_ses.sales_user_id, decided_by_name = v_su.full_name, decided_at = now(),
         decision_note = NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
         token_no = COALESCE(NULLIF(left(btrim(COALESCE(p_token_no, '')), 30), ''), token_no),
         voucher_no = COALESCE(NULLIF(left(btrim(COALESCE(p_voucher_no, '')), 30), ''), voucher_no),
         applied_reservation_id = CASE WHEN v_hold.id IS NOT NULL THEN v_hold.id ELSE NULL END,
         applied_amount = CASE WHEN v_hold.id IS NOT NULL THEN v_row.amount ELSE NULL END
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('success', true, 'status', v_row.status, 'ref', v_row.ref,
                            'decided_by', v_row.decided_by_name, 'decided_at', v_row.decided_at,
                            'token_no', v_row.token_no, 'voucher_no', v_row.voucher_no,
                            'hold_updated', v_hold.id IS NOT NULL,
                            'hold_token_before', v_before, 'hold_token_after', v_after,
                            'held_by', v_hold.requested_by_name);
END
$function$;

REVOKE ALL ON FUNCTION public.get_link_unit_receipts(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text,
  text, text, text, text, numeric, numeric, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_link_payment_status(text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_link_payments(text, boolean, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_link_payment(text, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_unit_receipts(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text,
  text, text, text, text, numeric, numeric, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_link_payment_status(text, text[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_link_payments(text, boolean, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_link_payment(text, uuid, text, text, text, text) TO anon, authenticated;

COMMIT;
