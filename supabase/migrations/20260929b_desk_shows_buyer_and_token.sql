-- ─────────────────────────────────────────────────────────────────────────────
-- THE DESK SHOWS WHO BOUGHT AND WHAT TOKEN CAME IN  (2026-09-29)
--
-- get_reserve_desk's per-unit 'h' (the active reservation behind a unit)
-- carried who asked for it, their agent code, who pressed the button and the
-- expiry. It now also carries:
--   'client'  reservations.client_name
--   'token'   reservations.token_amount
-- The reservations join was already there; no new join.
--
-- Buyer and money go only to a session that may authorise a reservation
-- (_may_authorize_reservation — Rashid, and ZZTEST for the suites). Every
-- other session that may sell can still call this function directly, and a
-- rep's phone has no business receiving every buyer's name and token for the
-- tower. For everyone else both keys are null, the same as a unit with none.
--
-- Patched from pg_get_functiondef() on live at fixed anchors; RAISES if an
-- anchor is not found exactly once, so nothing half-applies. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  a_decl constant text := E'        v_statuses jsonb;\n';
  n_decl constant text := E'        v_statuses jsonb; v_may_see_buyer boolean;\n';
  a_set  constant text := E'  v_pk_today   := (now() AT TIME ZONE ''Asia/Karachi'')::date;\n';
  n_set  constant text := a_set ||
    E'  v_may_see_buyer := public._may_authorize_reservation(p_session_token);\n';
  a_h    constant text := E'                        ''exp'',    r.expiry_date)';
  n_h    constant text := E'                        ''exp'',    r.expiry_date,\n' ||
    E'                        ''client'', CASE WHEN v_may_see_buyer THEN r.client_name END,\n' ||
    E'                        ''token'',  CASE WHEN v_may_see_buyer THEN r.token_amount END)';
  v_def text; a text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_reserve_desk';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_reserve_desk not found'; END IF;
  IF position('v_may_see_buyer' IN v_def) > 0 THEN RETURN; END IF;   -- already applied

  FOREACH a IN ARRAY ARRAY[a_decl, a_set, a_h] LOOP
    IF (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 THEN
      RAISE EXCEPTION 'anchor not found exactly once: %', a; END IF;
  END LOOP;

  v_def := replace(v_def, a_decl, n_decl);
  v_def := replace(v_def, a_set,  n_set);
  v_def := replace(v_def, a_h,    n_h);
  EXECUTE v_def;
END $mig$;
