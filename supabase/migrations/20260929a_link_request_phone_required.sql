-- ─────────────────────────────────────────────────────────────────────────────
-- A LINK REQUEST NEEDS A NAME AND A MOBILE  (2026-09-29)
--
-- Rashid: the availability link must ask the dealer's name the first time and
-- make an 11-digit mobile (03XXXXXXXXX) compulsory, "taakay hamain pata chale k
-- koun hai ye banda aur ham is se wapis contact kar sakain".
--
-- · availability_requests.requested_by_phone (normalised by _normalize_pk_mobile)
-- · submit_availability_request / _requests take p_phone and REFUSE a request
--   without a name ('name_required') or a valid mobile ('phone_required'), so a
--   cached old page cannot get round it.
-- · list_reservation_requests hands the phone to the desk queue (director only).
--   It is never added to get_public_availability — the link never shows it.
--
-- Bodies are patched from pg_get_functiondef() on live at fixed anchors; the
-- signature changes, so the old 5-arg versions are DROPPED (an overload with a
-- defaulted 6th arg would make every old call ambiguous) and grants re-made.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS requested_by_phone text;

DO $mig$
DECLARE v_one text; v_many text; v_list text; r record;
  v_check constant text :=
    E'  IF NULLIF(TRIM(COALESCE(p_name, \'\')), \'\') IS NULL THEN\n' ||
    E'    RETURN jsonb_build_object(\'success\', false, \'error\', \'name_required\',\n' ||
    E'      \'message\', \'Please enter your name.\'); END IF;\n' ||
    E'  IF public._normalize_pk_mobile(p_phone) IS NULL THEN\n' ||
    E'    RETURN jsonb_build_object(\'success\', false, \'error\', \'phone_required\',\n' ||
    E'      \'message\', \'Please enter your 11-digit mobile number, e.g. 03001234567.\'); END IF;\n';
BEGIN
  v_one  := pg_get_functiondef('public.submit_availability_request(text,text,integer,text,uuid)'::regprocedure);
  v_many := pg_get_functiondef('public.submit_availability_requests(text,text[],integer,text,uuid)'::regprocedure);
  v_list := pg_get_functiondef('public.list_reservation_requests(text,uuid)'::regprocedure);

  -- single
  FOR r IN SELECT * FROM (VALUES
    (E'p_status_id uuid DEFAULT NULL::uuid)\n RETURNS jsonb',
     E'p_status_id uuid DEFAULT NULL::uuid, p_phone text DEFAULT NULL::text)\n RETURNS jsonb'),
    (E'IF NOT FOUND THEN RETURN jsonb_build_object(\'success\', false, \'error\', \'not_available\'); END IF;\n',
     E'IF NOT FOUND THEN RETURN jsonb_build_object(\'success\', false, \'error\', \'not_available\'); END IF;\n\n' || v_check),
    (E'requested_by_name, ref,\n       asked_status_id)',
     E'requested_by_name, ref,\n       asked_status_id, requested_by_phone)'),
    (E'v_ref, v_tag.id)',
     E'v_ref, v_tag.id, public._normalize_pk_mobile(p_phone))')
  ) AS t(a, b) LOOP
    IF (length(v_one) - length(replace(v_one, r.a, ''))) / length(r.a) <> 1 THEN
      RAISE EXCEPTION 'single: anchor not found once: %', left(r.a, 60); END IF;
    v_one := replace(v_one, r.a, r.b);
  END LOOP;

  -- many
  FOR r IN SELECT * FROM (VALUES
    (E'p_status_id uuid DEFAULT NULL::uuid)\n RETURNS jsonb',
     E'p_status_id uuid DEFAULT NULL::uuid, p_phone text DEFAULT NULL::text)\n RETURNS jsonb'),
    (E'  IF array_length(v_nos, 1) > 25 THEN',
     v_check || E'\n  IF array_length(v_nos, 1) > 25 THEN'),
    (E'public.submit_availability_request(p_token, v_no, p_days, p_name, p_status_id)',
     E'public.submit_availability_request(p_token, v_no, p_days, p_name, p_status_id, p_phone)')
  ) AS t(a, b) LOOP
    IF (length(v_many) - length(replace(v_many, r.a, ''))) / length(r.a) <> 1 THEN
      RAISE EXCEPTION 'many: anchor not found once: %', left(r.a, 60); END IF;
    v_many := replace(v_many, r.a, r.b);
  END LOOP;

  -- desk queue
  IF position('requested_by_phone' IN v_list) = 0 THEN
    IF (length(v_list) - length(replace(v_list, E'\'requested_by\', r.requested_by_name,', ''))) /
        length(E'\'requested_by\', r.requested_by_name,') <> 1 THEN
      RAISE EXCEPTION 'list: anchor not found once'; END IF;
    v_list := replace(v_list, E'\'requested_by\', r.requested_by_name,',
      E'\'requested_by\', r.requested_by_name,\n           \'requested_by_phone\', r.requested_by_phone,');
    EXECUTE v_list;
  END IF;

  DROP FUNCTION public.submit_availability_requests(text,text[],integer,text,uuid);
  DROP FUNCTION public.submit_availability_request(text,text,integer,text,uuid);
  EXECUTE v_one;
  EXECUTE v_many;
END $mig$;

REVOKE ALL ON FUNCTION public.submit_availability_request(text,text,integer,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_availability_requests(text,text[],integer,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_availability_request(text,text,integer,text,uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_availability_requests(text,text[],integer,text,uuid,text) TO anon, authenticated;
