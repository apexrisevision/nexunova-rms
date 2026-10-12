-- ─────────────────────────────────────────────────────────────────────────────
-- NO HOLD WITHOUT A NAME AND A WHATSAPP NUMBER  (2026-10-13)
--
-- Rashid: "reservation link pe whatsapp number k aur name k bagair koi b unit
-- reserve na kar sake. whatsapp number is compulsory."
--
-- What was already true: a dealer's request from the link
-- (submit_availability_request / _requests) refuses a missing name or an
-- invalid mobile, and the desk's Approve books it with that number.
--
-- What was not: the desk's own booking (reserve_unit_desk, which
-- reserve_units_desk calls per unit) asked only for a name. Now it also needs
-- a valid Pakistani mobile for the person who asked, from wherever the system
-- already keeps one:
--   · the agent's own record (agents.phone)
--   · the CRM member's record (sales_users.phone)
--   · the hold contacts list (availability_hold_contacts, by name, per project)
--     — the same number the Directors' Room sends WhatsApp reminders to.
-- None of those -> 'whatsapp_required'. The desk then asks for the number and
-- saves it to the hold contacts list (set_hold_contact_desk) before booking.
--
-- Patched from pg_get_functiondef() on live at a fixed anchor; RAISES if the
-- anchor is not there exactly once. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. the desk saves a number for a name (Rashid's sign-in only) ───────────
CREATE OR REPLACE FUNCTION public.set_hold_contact_desk(p_session_token text, p_project_id uuid, p_name text, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_key text := public._hold_name_key(p_name);
        v_d text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT public._may_authorize_reservation(p_session_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_ses.company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_found'); END IF;
  IF v_key = '' OR length(v_key) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'name', 'message', 'Write who asked for the unit first.'); END IF;
  IF v_d ~ '^03[0-9]{9}$' THEN v_d := '92' || substr(v_d, 2); END IF;
  IF v_d !~ '^923[0-9]{9}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone',
      'message', 'Enter an 11-digit WhatsApp number, e.g. 03001234567.'); END IF;
  INSERT INTO public.availability_hold_contacts (project_id, name_key, name, phone, updated_at)
  VALUES (p_project_id, v_key, btrim(p_name), v_d, now())
  ON CONFLICT (project_id, name_key) DO UPDATE SET phone = EXCLUDED.phone, name = EXCLUDED.name, updated_at = now();
  RETURN jsonb_build_object('success', true, 'phone', v_d);
END $$;
REVOKE ALL ON FUNCTION public.set_hold_contact_desk(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_hold_contact_desk(text, uuid, text, text) TO anon, authenticated;

-- ── 2. the desk's booking refuses a requester with no WhatsApp number ──────
DO $mig$
DECLARE
  v_sig constant regprocedure := 'public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text,uuid)'::regprocedure;
  v_anchor constant text :=
    E'  IF NOT v_span AND v_ses.project_id IS NOT NULL AND v_unit.project_id <> v_ses.project_id THEN\n'
    || E'    RETURN jsonb_build_object(''success'',false,''error'',''out_of_scope''); END IF;\n';
  v_add constant text :=
    E'\n  -- 20261013d: no hold without a WhatsApp number for the person who asked\n'
    || E'  IF COALESCE(public._normalize_pk_mobile(v_agent.phone), public._normalize_pk_mobile(v_ruser.phone),\n'
    || E'       (SELECT public._normalize_pk_mobile(hc.phone) FROM public.availability_hold_contacts hc\n'
    || E'         WHERE hc.project_id = v_unit.project_id AND hc.name_key = public._hold_name_key(v_rname))) IS NULL THEN\n'
    || E'    RETURN jsonb_build_object(''success'',false,''error'',''whatsapp_required'',\n'
    || E'      ''message'',''Add a WhatsApp number for '' || v_rname || ''. A unit is not held without one.''); END IF;\n';
  v_def text;
BEGIN
  v_def := pg_get_functiondef(v_sig);
  IF position('20261013d' IN v_def) > 0 THEN RETURN; END IF;     -- already applied
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'reserve_unit_desk: anchor not found exactly once'; END IF;
  EXECUTE replace(v_def, v_anchor, v_anchor || v_add);
END
$mig$;
