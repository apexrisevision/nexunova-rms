-- ─────────────────────────────────────────────────────────────────────────────
-- IQRA GETS THE FULL RESERVATION DESK, SAME AS RASHID  (2026-10-16)
--
-- Rashid's order, the same day as 20261016a: give Iqra (sales_users 7a89dec1…,
-- sale_rep, Awami) complete reservation access like his own login. Her ROLE
-- stays sale_rep — leads, team and every other director screen are untouched.
--
-- How:
--   _is_named_reservation_authority — the named full-access list (Iqra).
--     Add people HERE. _may_authorize_reservation now asks it, so every gate
--     that said "only Rashid" (reserve, re-tag, release, link payments, token
--     reports, hold contacts, buyer details on the desk) lets her through.
--   Where the desk ALSO asks for the director role, the list counts as
--   director:
--     cancel_reservation      — release anybody's hold in her company
--     change_unit_status_desk — change a unit that is already held
--     reserve_unit_desk       — permanent tags on a direct booking
--     get_reserve_desk        — sold prices on the desk
--   (get_reserve_desk's permanent-tag list and get_unit_trail_desk already let
--   her through as a named decider, 20261016a.)
--
-- Bodies are patched from pg_get_functiondef() on live at fixed anchors; every
-- anchor must match exactly once or the block RAISES and nothing applies.
-- Re-runnable: a patch already present is skipped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._is_named_reservation_authority(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND ss.sales_user_id = ANY (ARRAY[
             '7a89dec1-af53-40a6-817f-e2a6d2db23b6'::uuid   -- IQRA 03255671163 (Awami)
           ]));
$$;
REVOKE ALL ON FUNCTION public._is_named_reservation_authority(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._may_authorize_reservation(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND (ss.sales_user_id = '015effd0-7ac7-4939-a1b3-dd2826ab8fba'::uuid   -- Rashid Manzoor 03219694246
            OR ss.company_id = 'a2915ce7-c01c-463b-ba50-b144b2240337'::uuid))  -- ZZTEST internal
      OR public._is_named_reservation_authority(p_session_token);              -- 20261016b
$$;
REVOKE ALL ON FUNCTION public._may_authorize_reservation(text) FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE
  r record; v_def text; v_cur text; v_fn text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (1, 'cancel_reservation',
     E'              AND COALESCE(public._sales_role_of(p_session_token),'''') = ''director''));',
     E'              AND (COALESCE(public._sales_role_of(p_session_token),'''') = ''director''\n'
     '                   OR public._is_named_reservation_authority(p_session_token))));'),
    (2, 'change_unit_status_desk',
     E'  IF v_role NOT IN (''director'',''admin'',''cfo'') THEN',
     E'  IF v_role NOT IN (''director'',''admin'',''cfo'')\n'
     '     AND NOT public._is_named_reservation_authority(p_session_token) THEN'),
    (3, 'reserve_unit_desk',
     E'    v_chk := public._desk_tag(CASE WHEN v_via_req THEN ''director'' ELSE v_su.role END,',
     E'    v_chk := public._desk_tag(CASE WHEN v_via_req\n'
     '                                     OR public._is_named_reservation_authority(p_session_token)\n'
     '                                   THEN ''director'' ELSE v_su.role END,'),
    (4, 'get_reserve_desk',
     E'  v_sees_sold  := public._sales_sees_sold_price(p_session_token);',
     E'  v_sees_sold  := public._sales_sees_sold_price(p_session_token)\n'
     '                  OR public._is_named_reservation_authority(p_session_token);')
  ) AS t(ord, fn, anchor, repl) ORDER BY fn, ord
  LOOP
    IF r.fn <> v_fn THEN
      IF v_fn <> '' AND v_def IS DISTINCT FROM v_cur THEN EXECUTE v_cur; END IF;
      SELECT pg_get_functiondef(p.oid) INTO v_def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn;
      IF v_def IS NULL THEN RAISE EXCEPTION '% not found', r.fn; END IF;
      v_cur := v_def; v_fn := r.fn;
    END IF;
    IF position(r.repl IN v_cur) > 0 THEN CONTINUE; END IF;              -- already patched
    IF (length(v_cur) - length(replace(v_cur, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor % not found exactly once in %', r.ord, r.fn; END IF;
    v_cur := replace(v_cur, r.anchor, r.repl);
  END LOOP;
  IF v_def IS DISTINCT FROM v_cur THEN EXECUTE v_cur; END IF;
END $mig$;
