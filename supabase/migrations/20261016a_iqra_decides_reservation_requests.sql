-- ─────────────────────────────────────────────────────────────────────────────
-- IQRA MAY APPROVE / DECLINE RESERVATION REQUESTS  (2026-10-16)
--
-- Rashid's order: IQRA (sales_users 7a89dec1…, sale_rep, Awami) may act on the
-- pending-request queue — Approve or Decline. She may NOT reserve a unit
-- directly, change a status, release a hold or decide a link payment: those
-- stay behind _may_authorize_reservation (Rashid only, 20260928a), untouched.
-- When she approves she may apply any tag, permanent ones included (his call).
--
-- How:
--   _is_named_request_decider  — the named list (Iqra). Add people HERE.
--   _may_decide_reservation_request = Rashid's gate OR the named list.
--   list_reservation_requests / decide_reservation_request — use the new gate;
--     the "director only" check lets the named list through.
--   get_unit_trail_desk — the same director check, same exemption (the desk
--     reads the trail before Approve).
--   get_reserve_desk — opens for the named list so the queue has its tags
--     (permanent ones included) and requesters. Buyer details stay behind Rashid's gate (v_may_see_buyer is
--     not touched); prices follow her role's existing rule.
--   reserve_unit_desk — Approve books through it with the decider's own
--     session. It lets the named list through ONLY while
--     decide_reservation_request has set the transaction-local flag
--     rms.deciding_request to that same session token, so a direct call from
--     her login is still refused. On that path the tag check runs as director.
--
-- Bodies are patched from pg_get_functiondef() on live at fixed anchors; every
-- anchor must match exactly once or the block RAISES and nothing applies.
-- Re-runnable: a patch already present is skipped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._is_named_request_decider(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND ss.sales_user_id = ANY (ARRAY[
             '7a89dec1-af53-40a6-817f-e2a6d2db23b6'::uuid   -- IQRA 03255671163 (Awami)
           ]));
$$;
REVOKE ALL ON FUNCTION public._is_named_request_decider(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._may_decide_reservation_request(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public._may_authorize_reservation(p_session_token)
      OR public._is_named_request_decider(p_session_token);
$$;
REVOKE ALL ON FUNCTION public._may_decide_reservation_request(text) FROM PUBLIC, anon, authenticated;

-- For the portal: whether this login may open the request queue. A bool about
-- the caller's own session only; the real gate is inside each RPC.
CREATE OR REPLACE FUNCTION public.can_decide_reservation_requests(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public._may_decide_reservation_request(p_session_token);
$$;
REVOKE ALL ON FUNCTION public.can_decide_reservation_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_decide_reservation_requests(text) TO anon, authenticated;

DO $mig$
DECLARE
  r record; v_def text; v_cur text; v_fn text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- ── decide_reservation_request ──
    (1, 'decide_reservation_request',
     E'  IF NOT public._may_authorize_reservation(p_session_token) THEN',
     E'  IF NOT public._may_decide_reservation_request(p_session_token) THEN'),
    (2, 'decide_reservation_request',
     E'  IF COALESCE(public._sales_role_of(p_session_token),'''') <> ''director'' THEN',
     E'  IF COALESCE(public._sales_role_of(p_session_token),'''') <> ''director''\n'
     '     AND NOT public._is_named_request_decider(p_session_token) THEN'),
    (3, 'decide_reservation_request',
     E'    v_chk := public._desk_tag(v_su.role, v_hold.unit_id, p_unit_status_id);',
     E'    v_chk := public._desk_tag(CASE WHEN public._is_named_request_decider(p_session_token)\n'
     '                                   THEN ''director'' ELSE v_su.role END,\n'
     '                              v_hold.unit_id, p_unit_status_id);'),
    (4, 'decide_reservation_request',
     E'  v_res := public.reserve_unit_desk(\n',
     E'  PERFORM set_config(''rms.deciding_request'', p_session_token, true);  -- 20261016a\n'
     '  v_res := public.reserve_unit_desk(\n'),
    (5, 'decide_reservation_request',
     E'             ''From availability link request '' || v_req.ref,\n'
     '             p_unit_status_id);\n',
     E'             ''From availability link request '' || v_req.ref,\n'
     '             p_unit_status_id);\n'
     '  PERFORM set_config(''rms.deciding_request'', '''', true);\n'),
    -- ── list_reservation_requests ──
    (6, 'list_reservation_requests',
     E'  IF NOT public._may_authorize_reservation(p_session_token) THEN',
     E'  IF NOT public._may_decide_reservation_request(p_session_token) THEN'),
    -- ── get_unit_trail_desk ──
    (7, 'get_unit_trail_desk',
     E'  IF COALESCE(public._sales_role_of(p_session_token),'''') <> ''director'' THEN',
     E'  IF COALESCE(public._sales_role_of(p_session_token),'''') <> ''director''\n'
     '     AND NOT public._is_named_request_decider(p_session_token) THEN'),
    -- ── get_reserve_desk (entry gate only; v_may_see_buyer untouched) ──
    (8, 'get_reserve_desk',
     E'  IF NOT public._may_authorize_reservation(p_session_token) THEN\n'
     '    RETURN jsonb_build_object(''success'',false,''error'',''forbidden'',\n'
     '      ''message'',''The Reserve Desk is not open on this sign-in.''); END IF;',
     E'  IF NOT public._may_decide_reservation_request(p_session_token) THEN\n'
     '    RETURN jsonb_build_object(''success'',false,''error'',''forbidden'',\n'
     '      ''message'',''The Reserve Desk is not open on this sign-in.''); END IF;'),
    (12, 'get_reserve_desk',
     E'         AND (cus.nature = ''temporary'' OR v_su.role = ''director'')',
     E'         AND (cus.nature = ''temporary'' OR v_su.role = ''director''\n'
     '              OR public._is_named_request_decider(p_session_token))'),
    -- ── reserve_unit_desk ──
    (9, 'reserve_unit_desk',
     E'        v_agent_id uuid;\nBEGIN',
     E'        v_agent_id uuid;\n'
     '        v_via_req boolean := false;  -- 20261016a: approving a request as a named decider\n'
     'BEGIN'),
    (10, 'reserve_unit_desk',
     E'  IF NOT public._may_authorize_reservation(p_session_token) THEN',
     -- COALESCE: an unset flag reads NULL, and NOT (false OR NULL) does not refuse
     E'  v_via_req := (COALESCE(current_setting(''rms.deciding_request'', true) = p_session_token, false)\n'
     '                AND public._is_named_request_decider(p_session_token));\n'
     '  IF NOT (public._may_authorize_reservation(p_session_token) OR v_via_req) THEN'),
    (11, 'reserve_unit_desk',
     E'    v_chk := public._desk_tag(v_su.role, p_unit_id, p_unit_status_id);',
     E'    v_chk := public._desk_tag(CASE WHEN v_via_req THEN ''director'' ELSE v_su.role END,\n'
     '                              p_unit_id, p_unit_status_id);')
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
