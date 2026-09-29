-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-29f · The Token Received report moves into the Director Level Report
--
-- Rashid asked for it in the DIRECTOR LEVEL REPORT on /a/<token> (behind
-- Director's Login), not on the Reserve Desk. That room has no personal login:
-- it opens with the room password or a remembered phone key. So the report is
-- split by gate:
--
--   blocks 1-3 (unit list vs books, token received, off-market with no token)
--       get_token_report_room(link, password|key) — the room's own standard
--       gate, the same four steps every room function uses: live link, 10 bad
--       tries an hour, the attempt written down before it is judged, then
--       _availability_secret_hash (which also accepts a remembered key).
--
--   block 4 (cash, bank, received, paid)
--       ONLY get_token_report_desk(session) — pinned to ONE USER ID (Rashid)
--       via _may_authorize_reservation, not to a role, exactly as before. In
--       the room it appears only when this browser is also signed in on the
--       link's desk as Rashid.
--
-- Blocks 1-3 are built in ONE place, _token_report_body, which both doors
-- call, so the room and the desk cannot disagree. 21150 still comes from
-- _nf_unallocated_tokens_body (the not-allocated block's own reader), money
-- from _nf_money_position_body. Read-only throughout; the one temp table is
-- why the builders are VOLATILE.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._token_report_body(p_project uuid, p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER   -- builds a temp table; reads only
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pname text; v_nprojects int; v_t21100 numeric; v_un jsonb; v_res numeric;
        v_recv jsonb; v_miss jsonb; v_no_active int; v_never int;
BEGIN
  SELECT project_name INTO v_pname FROM public.projects WHERE id = p_project;
  SELECT count(*) INTO v_nprojects FROM public.projects WHERE company_id = p_company;
  v_t21100 := (public._nf_money_position_body(p_company)->>'t21100')::numeric;
  v_un     := public._nf_unallocated_tokens_body(p_company);

  DROP TABLE IF EXISTS _tr;
  CREATE TEMP TABLE _tr ON COMMIT DROP AS
  SELECT u.id, u.unit_no,
         COALESCE(NULLIF(u.floor_label, ''), 'Floor ' || COALESCE(u.floor_no::text, '-')) AS floor,
         COALESCE(f.sort_order, u.floor_no, 999) AS fsort,
         COALESCE(NULLIF(substring(u.unit_no FROM '([0-9]+)$'), '')::int, 0) AS nsort,
         cs.status_name AS status, COALESCE(cs.is_available, false) AS free,
         u.base_price AS price,
         r.id AS rid, r.client_name AS buyer,
         COALESCE(NULLIF(TRIM(r.requested_by_name), ''), su.full_name) AS sold_by,
         CASE WHEN r.token_received AND COALESCE(r.token_amount, 0) > 0
              THEN r.token_amount ELSE 0 END AS token,
         EXISTS (SELECT 1 FROM public.reservations x WHERE x.unit_id = u.id) AS ever
    FROM public.units u
    LEFT JOIN public.floors f ON f.id = u.floor_id
    LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
    LEFT JOIN LATERAL (
      SELECT r2.* FROM public.reservations r2
       WHERE r2.unit_id = u.id AND r2.status = 'active'
       ORDER BY r2.created_at DESC LIMIT 1) r ON true
    LEFT JOIN public.sales_users su ON su.id = r.requested_by_sales_user_id
   WHERE u.project_id = p_project;

  -- every active received token in the project: the invariant as defined
  SELECT COALESCE(sum(r.token_amount), 0) INTO v_res
    FROM public.reservations r JOIN public.units u ON u.id = r.unit_id
   WHERE u.project_id = p_project AND r.status = 'active' AND r.token_received;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'status', status, 'buyer', buyer,
           'sold_by', sold_by, 'token', token, 'price', price)
         ORDER BY token DESC, fsort, nsort, unit_no), '[]'::jsonb)
    INTO v_recv FROM _tr WHERE token > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor, 'status', status, 'sold_by', sold_by,
           'price', price,
           'reservation', CASE WHEN rid IS NOT NULL THEN 'active'
                               WHEN ever THEN 'ended' ELSE 'none' END)
         ORDER BY fsort, nsort, unit_no), '[]'::jsonb),
         count(*) FILTER (WHERE rid IS NULL),
         count(*) FILTER (WHERE rid IS NULL AND NOT ever)
    INTO v_miss, v_no_active, v_never
    FROM _tr WHERE NOT free AND token = 0;

  DROP TABLE IF EXISTS _tr;

  RETURN jsonb_build_object(
    'project', v_pname, 'company_projects', v_nprojects, 'as_of', now(),
    'agree', jsonb_build_object(
       'reservations', v_res,
       'nf_21100',     v_t21100,
       'difference',   v_res - v_t21100,
       'nf_21150',     v_un->'total',
       'total_held',   v_t21100 + (v_un->>'total')::numeric),
    'received', jsonb_build_object(
       'rows', v_recv, 'count', jsonb_array_length(v_recv),
       'total', (SELECT COALESCE(sum((x->>'token')::numeric), 0) FROM jsonb_array_elements(v_recv) x)),
    'missing', jsonb_build_object(
       'rows', v_miss, 'count', jsonb_array_length(v_miss),
       'no_active_reservation', v_no_active, 'never_reserved', v_never));
END
$function$;

REVOKE ALL ON FUNCTION public._token_report_body(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- the desk door: blocks 1-3 from the shared body, plus block 4 (money)
CREATE OR REPLACE FUNCTION public.get_token_report_desk(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_pr uuid;
BEGIN
  /* ACCESS IS PINNED TO ONE USER ID, NOT TO A ROLE — see
     get_unallocated_tokens_desk. Giving anyone else block 4 is a code change
     to _may_authorize_reservation, not a settings change. */
  IF NOT public._may_authorize_reservation(p_session_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  v_pr := v_ses.project_id;
  IF v_pr IS NULL THEN
    SELECT p.id INTO v_pr FROM public.projects p
     WHERE p.company_id = v_ses.company_id ORDER BY p.project_name LIMIT 1;
  END IF;

  RETURN jsonb_build_object('success', true)
      || public._token_report_body(v_pr, v_ses.company_id)
      || jsonb_build_object('money', public._nf_money_position_body(v_ses.company_id) - 't21100');
END
$function$;

-- the room door: blocks 1-3 only, behind the room's own standard gate
CREATE OR REPLACE FUNCTION public.get_token_report_room(p_token text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_tries int;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  /* written down before it is judged */
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_secret_hash(v_pr, p_password));
  IF v_hash IS NULL OR v_hash <>
     public._availability_secret_hash(v_pr, p_password) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  /* blocks 1-3 only. Cash and bank are NOT here: they answer one user id,
     through get_token_report_desk, and never a shared password. */
  RETURN jsonb_build_object('success', true)
      || public._token_report_body(v_pr, v_link.company_id);
END
$function$;

COMMENT ON FUNCTION public.get_token_report_room(text, text) IS
  'Director Level Report (/a/<token>) Token Received blocks 1-3, behind the room password or a '
  'remembered key, same gate as get_availability_report. Carries NO cash/bank figures: block 4 '
  'is only in get_token_report_desk, pinned to one user id. Both call _token_report_body.';

REVOKE ALL ON FUNCTION public.get_token_report_room(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_report_room(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_token_report_desk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_report_desk(text) TO anon, authenticated;

COMMIT;
