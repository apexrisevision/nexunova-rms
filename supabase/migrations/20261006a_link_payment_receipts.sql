-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-06a · Receive Token / Payment on the availability link
--
-- Rashid: "hamaray sale rep amount receive kar laitay hain different loogo se
-- phir unhe bhool jata hai ... send karnay pe entry director panel mai pending
-- aa jai aur sath mai whatsapp image ban jai proper receipt ki" (CRV-style).
--
-- A rep on the link records money they collected against a unit: amount,
-- Cash / Bank / Online, reference, from whom, on which date. It lands PENDING
-- on the Reserve Desk; a director Verifies or Rejects it. Decisions taken with
-- Rashid on 2026-10-06:
--   · the link shows only a unit's earlier TOTAL and COUNT, never the rows;
--   · Verify is a mark only - it touches no reservation, no token flag, no
--     NexuFinance entry (Accounts stays separate);
--   · the director's side lives on the Reserve Desk (CRM session).
--
-- THE TABLE IS CLOSED: RLS on, and every grant revoked from anon /
-- authenticated / PUBLIC (a new table here otherwise ships wide open - see
-- the "new table = RLS off + full anon grants" finding). Everything goes
-- through the SECURITY DEFINER functions below.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.link_payment_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no         integer NOT NULL,                  -- per project, from 1001
  ref                text NOT NULL UNIQUE,              -- e.g. AM-RCV-1001
  link_id            uuid NOT NULL REFERENCES public.availability_links(id),
  company_id         uuid NOT NULL,
  project_id         uuid NOT NULL,
  unit_id            uuid NOT NULL REFERENCES public.units(id),
  unit_no            text NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  mode               text NOT NULL CHECK (mode IN ('cash', 'bank', 'online')),
  reference          text,
  payer_name         text NOT NULL,
  paid_on            date NOT NULL,
  note               text,
  received_by_name   text NOT NULL,
  received_by_phone  text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS link_payment_receipts_project_status_idx
  ON public.link_payment_receipts (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS link_payment_receipts_unit_idx
  ON public.link_payment_receipts (unit_id);
CREATE INDEX IF NOT EXISTS link_payment_receipts_link_idx
  ON public.link_payment_receipts (link_id, created_at DESC);

ALTER TABLE public.link_payment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.link_payment_receipts FROM PUBLIC, anon, authenticated;

-- the same audit every hold and request carries, so the unit trail can see it
DROP TRIGGER IF EXISTS _trg_audit ON public.link_payment_receipts;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.link_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- ── what the link may say about a unit's earlier money: a total and a count ──
CREATE OR REPLACE FUNCTION public._link_unit_money(p_unit uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'recorded_total', COALESCE((SELECT sum(amount) FROM public.link_payment_receipts
                                 WHERE unit_id = p_unit AND status <> 'rejected'), 0),
    'recorded_count', (SELECT count(*) FROM public.link_payment_receipts
                        WHERE unit_id = p_unit AND status <> 'rejected'),
    'hold_token', COALESCE((SELECT r.token_amount FROM public.reservations r
                             WHERE r.unit_id = p_unit AND r.status = 'active'
                               AND r.token_received AND COALESCE(r.token_amount, 0) > 0
                             ORDER BY r.created_at DESC LIMIT 1), 0));
$function$;
REVOKE ALL ON FUNCTION public._link_unit_money(uuid) FROM PUBLIC, anon, authenticated;

-- ── the link: a unit's earlier total, before the form is filled ──────────────
CREATE OR REPLACE FUNCTION public.get_link_unit_receipts(p_token text, p_unit_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;
  SELECT * INTO v_unit FROM public.units
   WHERE project_id = v_link.project_id
     AND upper(unit_no) = upper(btrim(COALESCE(p_unit_no, '')))
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'unit_no', v_unit.unit_no)
         || public._link_unit_money(v_unit.id);
END
$function$;

-- ── the link: record money received ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_link_payment(
  p_token text, p_unit_no text, p_amount numeric, p_mode text, p_reference text,
  p_payer text, p_paid_on date, p_note text, p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_unit public.units; v_code text;
        v_before jsonb; v_no int; v_ref text; v_row public.link_payment_receipts;
        v_phone text; v_mode text; v_hour int; v_dup public.link_payment_receipts;
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
  IF v_mode NOT IN ('cash', 'bank', 'online') THEN
    RETURN jsonb_build_object('success', false, 'error', 'mode', 'message', 'Choose Cash, Bank or Online.'); END IF;
  IF NULLIF(btrim(COALESCE(p_payer, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'payer', 'message', 'Please enter who paid.'); END IF;
  IF p_paid_on IS NULL OR p_paid_on > (now() AT TIME ZONE 'Asia/Karachi')::date
     OR p_paid_on < (now() AT TIME ZONE 'Asia/Karachi')::date - 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'date',
      'message', 'The date must be today or within the last 90 days.'); END IF;

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

  /* serialise numbering per project; the earlier total is read inside the same lock */
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
       payer_name, paid_on, note, received_by_name, received_by_phone)
    VALUES (v_no, v_ref, v_link.id, v_link.company_id, v_link.project_id, v_unit.id, v_unit.unit_no,
            round(p_amount, 2), v_mode, NULLIF(left(btrim(COALESCE(p_reference, '')), 80), ''),
            left(btrim(p_payer), 80), p_paid_on, NULLIF(left(btrim(COALESCE(p_note, '')), 300), ''),
            left(btrim(p_name), 80), v_phone)
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('success', true, 'already', v_dup.id IS NOT NULL,
    'ref', v_row.ref, 'unit_no', v_row.unit_no, 'floor', v_unit.floor_label,
    'amount', v_row.amount, 'mode', v_row.mode, 'reference', v_row.reference,
    'payer', v_row.payer_name, 'paid_on', v_row.paid_on, 'note', v_row.note,
    'received_by', v_row.received_by_name, 'received_by_phone', v_row.received_by_phone,
    'status', v_row.status, 'created_at', v_row.created_at,
    /* what was recorded before this one - the total and the count, no rows */
    'before', CASE WHEN v_dup.id IS NOT NULL
                   THEN jsonb_build_object('recorded_total', (v_before->>'recorded_total')::numeric - v_row.amount,
                                           'recorded_count', (v_before->>'recorded_count')::int - 1,
                                           'hold_token', v_before->'hold_token')
                   ELSE v_before END);
END
$function$;

-- ── the link: what became of the entries this phone sent ─────────────────────
CREATE OR REPLACE FUNCTION public.get_link_payment_status(p_token text, p_refs text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;
  IF p_refs IS NULL OR cardinality(p_refs) = 0 THEN RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('ref', ref, 'unit_no', unit_no, 'amount', amount,
                                        'status', status, 'decided_at', decided_at) ORDER BY created_at DESC)
      FROM public.link_payment_receipts
     WHERE link_id = v_link.id AND ref = ANY (p_refs[1:50])), '[]'::jsonb));
END
$function$;

-- ── the desk: what is waiting, and what was decided lately ───────────────────
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
             'id', p.id, 'ref', p.ref, 'unit_no', p.unit_no, 'unit_id', p.unit_id,
             'floor', COALESCE(NULLIF(u.floor_label, ''), '-'),
             'amount', p.amount, 'mode', p.mode, 'reference', p.reference,
             'payer', p.payer_name, 'paid_on', p.paid_on, 'note', p.note,
             'received_by', p.received_by_name, 'received_by_phone', p.received_by_phone,
             'status', p.status, 'decided_by', p.decided_by_name, 'decided_at', p.decided_at,
             'decision_note', p.decision_note, 'created_at', p.created_at)
           ORDER BY (p.status = 'pending') DESC, p.created_at DESC)
      FROM public.link_payment_receipts p
      JOIN public.units u ON u.id = p.unit_id
     WHERE p.company_id = ANY (v_companies)
       AND (v_scope IS NULL OR p.project_id = v_scope)
       AND (p.status = 'pending' OR p.decided_at > now() - interval '3 days')), '[]'::jsonb));
END
$function$;

-- ── the desk: Verify or Reject - a mark only ────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_link_payment(p_session_token text, p_id uuid, p_action text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_group uuid; v_companies uuid[];
        v_span boolean; v_row public.link_payment_receipts; v_act text;
BEGIN
  PERFORM public._rms_actor_session(p_session_token);
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF COALESCE(public._sales_role_of(p_session_token), '') <> 'director' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'Only a director can verify a payment from the link.'); END IF;
  v_act := lower(btrim(COALESCE(p_action, '')));
  IF v_act NOT IN ('verify', 'reject') THEN
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
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_decided', 'status', v_row.status,
      'message', 'That entry has already been ' || v_row.status || '.'); END IF;

  UPDATE public.link_payment_receipts
     SET status = CASE v_act WHEN 'verify' THEN 'verified' ELSE 'rejected' END,
         decided_by = v_ses.sales_user_id, decided_by_name = v_su.full_name, decided_at = now(),
         decision_note = NULLIF(left(btrim(COALESCE(p_note, '')), 300), '')
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('success', true, 'status', v_row.status, 'ref', v_row.ref,
                            'decided_by', v_row.decided_by_name, 'decided_at', v_row.decided_at);
END
$function$;

REVOKE ALL ON FUNCTION public.get_link_unit_receipts(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_link_payment_status(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_link_payments(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_link_payment(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_unit_receipts(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_link_payment(text, text, numeric, text, text, text, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_link_payment_status(text, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_link_payments(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_link_payment(text, uuid, text, text) TO anon, authenticated;

COMMIT;
