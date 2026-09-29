-- ─────────────────────────────────────────────────────────────────────────────
-- ONLY RASHID AUTHORISES A RESERVATION  (2026-09-28)
--
-- Until now any portal role that may sell (every sale rep) could open the
-- Reserve Desk from their own login and book a unit himself — reserve_unit and
-- reserve_unit_desk asked only _sales_may_sell. Rashid's instruction: nobody
-- but him (Rashid Manzoor, 03219694246) may authorise a reservation; every
-- other role previews only.
--
-- One helper, checked server-side in every portal path that books, re-tags,
-- releases or decides a hold. A hidden button is not a gate; this is.
--   reserve_unit · reserve_unit_desk (also covers reserve_units_desk and the
--   approve arm of decide_reservation_request) · change_unit_status_desk ·
--   decide_reservation_request (all arms, incl. change + decline) ·
--   cancel_reservation
--
-- Keyed on his sales_users.id, not his phone: a phone can be self-registered
-- under another company, an id cannot be borrowed.
-- ZZTEST (internal scratch tenant, fake units) stays open so the suites run.
--
-- Bodies are patched from pg_get_functiondef() on live at a fixed anchor; the
-- block RAISES if an anchor is missing, so nothing half-applies.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._may_authorize_reservation(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND (ss.sales_user_id = '015effd0-7ac7-4939-a1b3-dd2826ab8fba'::uuid   -- Rashid Manzoor 03219694246
            OR ss.company_id = 'a2915ce7-c01c-463b-ba50-b144b2240337'::uuid)); -- ZZTEST internal
$$;
REVOKE ALL ON FUNCTION public._may_authorize_reservation(text) FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE
  v_guard constant text :=
    E'  IF NOT public._may_authorize_reservation(p_session_token) THEN\n'
    '    RETURN jsonb_build_object(''success'',false,''error'',''forbidden'',\n'
    '      ''message'',''Only Rashid can reserve, change or release a unit. You can preview only.''); END IF;\n';
  r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('reserve_unit',               E'  IF NOT public._sales_may_sell(p_session_token) THEN'),
      ('reserve_unit_desk',          E'  IF NOT public._sales_may_sell(p_session_token) THEN'),
      ('change_unit_status_desk',    E'  IF NOT public._sales_may_sell(p_session_token) THEN'),
      ('decide_reservation_request', E'  IF NOT public._sales_may_sell(p_session_token) THEN'),
      ('cancel_reservation',         E'  -- reserved_by uniquely identifies')
    ) AS t(fn, anchor)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_def IS NULL THEN RAISE EXCEPTION '% not found', r.fn; END IF;
    IF position('_may_authorize_reservation' IN v_def) > 0 THEN CONTINUE; END IF;  -- re-runnable
    IF (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not found exactly once in %', r.fn; END IF;
    v_new := replace(v_def, r.anchor, v_guard || r.anchor);
    EXECUTE v_new;
  END LOOP;
END $mig$;
