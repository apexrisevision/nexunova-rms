-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-06b · Receive Token / Payment: every field of the office's TOKEN slip
--
-- Rashid sent the physical Awami TOKEN receipt: "Is physical receipt ki fields
-- dekho, we need all these fields." Added to link_payment_receipts:
--   kind (token | payment), payer_father (Father / Husband Name), payer_cnic,
--   payer_mobile, basic_price, final_price, valid_upto, bank_name (the
--   account it was paid into, e.g. "BOP"), and 'cheque' as a fourth way paid.
-- Unit Size is the unit's own area and is read, never stored.
--
-- submit_link_payment keeps its first ten parameters, in order, and gains the
-- new ones at the end with defaults - so the link already live keeps working
-- until the page that sends them is deployed. The old 10-argument function is
-- dropped in the same transaction: two overloads would make PostgREST unable
-- to choose between them.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.link_payment_receipts
  ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'token',
  ADD COLUMN IF NOT EXISTS payer_father text,
  ADD COLUMN IF NOT EXISTS payer_cnic   text,
  ADD COLUMN IF NOT EXISTS payer_mobile text,
  ADD COLUMN IF NOT EXISTS basic_price  numeric(14,2),
  ADD COLUMN IF NOT EXISTS final_price  numeric(14,2),
  ADD COLUMN IF NOT EXISTS valid_upto   date,
  ADD COLUMN IF NOT EXISTS bank_name    text;

ALTER TABLE public.link_payment_receipts DROP CONSTRAINT IF EXISTS link_payment_receipts_mode_check;
ALTER TABLE public.link_payment_receipts
  ADD CONSTRAINT link_payment_receipts_mode_check CHECK (mode IN ('cash', 'bank', 'online', 'cheque'));
ALTER TABLE public.link_payment_receipts DROP CONSTRAINT IF EXISTS link_payment_receipts_kind_check;
ALTER TABLE public.link_payment_receipts
  ADD CONSTRAINT link_payment_receipts_kind_check CHECK (kind IN ('token', 'payment'));

DROP FUNCTION IF EXISTS public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_link_payment(
  p_token text, p_unit_no text, p_amount numeric, p_mode text, p_reference text,
  p_payer text, p_paid_on date, p_note text, p_name text, p_phone text,
  p_kind text DEFAULT 'token', p_father text DEFAULT NULL, p_cnic text DEFAULT NULL,
  p_payer_mobile text DEFAULT NULL, p_basic_price numeric DEFAULT NULL, p_final_price numeric DEFAULT NULL,
  p_valid_upto date DEFAULT NULL, p_bank text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units; v_code text;
        v_before jsonb; v_no int; v_ref text; v_row public.link_payment_receipts;
        v_phone text; v_mode text; v_kind text; v_hour int; v_dup public.link_payment_receipts;
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
    RETURN jsonb_build_object('success', false, 'error', 'amount', 'message', 'Please enter the amount received.'); END IF;
  v_mode := lower(btrim(COALESCE(p_mode, '')));
  IF v_mode NOT IN ('cash', 'bank', 'online', 'cheque') THEN
    RETURN jsonb_build_object('success', false, 'error', 'mode', 'message', 'Choose Cash, Cheque, Online or Bank.'); END IF;
  v_kind := lower(btrim(COALESCE(p_kind, 'token')));
  IF v_kind NOT IN ('token', 'payment') THEN v_kind := 'token'; END IF;
  IF NULLIF(btrim(COALESCE(p_payer, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'payer', 'message', 'Please enter the customer''s name.'); END IF;
  IF p_paid_on IS NULL OR p_paid_on > v_today OR p_paid_on < v_today - 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'date',
      'message', 'The date must be today or within the last 90 days.'); END IF;
  /* the customer's CNIC and mobile are optional, but never half-right */
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
   WHERE project_id = v_link.project_id
     AND upper(unit_no) = upper(btrim(COALESCE(p_unit_no, '')))
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found',
    'message', 'There is no such unit in this project.'); END IF;

  /* the same entry twice in ten minutes is a second tap, not a second payment */
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
       kind, payer_father, payer_cnic, payer_mobile, basic_price, final_price, valid_upto, bank_name)
    VALUES (v_no, v_ref, v_link.id, v_link.company_id, v_link.project_id, v_unit.id, v_unit.unit_no,
            round(p_amount, 2), v_mode, NULLIF(left(btrim(COALESCE(p_reference, '')), 80), ''),
            left(btrim(p_payer), 80), p_paid_on, NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
            left(btrim(p_name), 80), v_phone,
            v_kind, NULLIF(left(btrim(COALESCE(p_father, '')), 80), ''), v_cnic, v_pmob,
            round(p_basic_price, 2), round(p_final_price, 2), p_valid_upto,
            NULLIF(left(btrim(COALESCE(p_bank, '')), 60), ''))
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('success', true, 'already', v_dup.id IS NOT NULL,
    'ref', v_row.ref, 'serial', v_row.receipt_no, 'kind', v_row.kind,
    'unit_no', v_row.unit_no, 'floor', v_unit.floor_label, 'area', v_unit.area,
    'amount', v_row.amount, 'mode', v_row.mode, 'reference', v_row.reference, 'bank', v_row.bank_name,
    'payer', v_row.payer_name, 'father', v_row.payer_father, 'cnic', v_row.payer_cnic,
    'payer_mobile', v_row.payer_mobile, 'basic_price', v_row.basic_price, 'final_price', v_row.final_price,
    'valid_upto', v_row.valid_upto, 'paid_on', v_row.paid_on, 'note', v_row.note,
    'received_by', v_row.received_by_name, 'received_by_phone', v_row.received_by_phone,
    'status', v_row.status, 'created_at', v_row.created_at,
    'before', CASE WHEN v_dup.id IS NOT NULL
                   THEN jsonb_build_object('recorded_total', (v_before->>'recorded_total')::numeric - v_row.amount,
                                           'recorded_count', (v_before->>'recorded_count')::int - 1,
                                           'hold_token', v_before->'hold_token')
                   ELSE v_before END);
END
$function$;

REVOKE ALL ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text,
  text, text, text, text, numeric, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text,
  text, text, text, text, numeric, numeric, date, text) TO anon, authenticated;

-- the desk sees every field the slip has, and the unit's size
CREATE OR REPLACE FUNCTION public.list_link_payments(p_session_token text)
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
             'unit_no', p.unit_no, 'unit_id', p.unit_id,
             'floor', COALESCE(NULLIF(u.floor_label, ''), '-'), 'area', u.area,
             'amount', p.amount, 'mode', p.mode, 'reference', p.reference, 'bank', p.bank_name,
             'payer', p.payer_name, 'father', p.payer_father, 'cnic', p.payer_cnic, 'payer_mobile', p.payer_mobile,
             'basic_price', p.basic_price, 'final_price', p.final_price, 'valid_upto', p.valid_upto,
             'paid_on', p.paid_on, 'note', p.note,
             'received_by', p.received_by_name, 'received_by_phone', p.received_by_phone,
             'status', p.status, 'decided_by', p.decided_by_name, 'decided_at', p.decided_at,
             'decision_note', p.decision_note, 'created_at', p.created_at,
             'project', pr.project_name)
           ORDER BY (p.status = 'pending') DESC, p.created_at DESC)
      FROM public.link_payment_receipts p
      JOIN public.units u ON u.id = p.unit_id
      JOIN public.projects pr ON pr.id = p.project_id
     WHERE p.company_id = ANY (v_companies)
       AND (v_scope IS NULL OR p.project_id = v_scope)
       AND (p.status = 'pending' OR p.decided_at > now() - interval '3 days')), '[]'::jsonb));
END
$function$;

COMMIT;
