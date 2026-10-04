-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-04a · Unit Trail — one unit's whole history in the Director Level Report
--
-- Rashid's question it exists for: "GF-248 was reserved in September — who
-- cancelled it?" Today nothing answers that. A director types a unit code and
-- gets everything from the day the unit was created, newest first.
--
-- PART 1 — CLOSE THE GAPS (the only writes in this file)
--   a. reservations and availability_requests had NO audit trigger: a hold
--      that was edited, cancelled or deleted left no trace. Both now carry the
--      same _trg_audit (audit_trigger_function) the units table has.
--   b. audit_logs.changed_by is NULL on almost every unit row, because the
--      desk, the link and the room are all anon RPCs — auth.uid() is empty.
--      The audit function now reads a transaction-local label, rms.actor /
--      rms.actor_role, and each writing door sets it on entry:
--        desk (session token)  → the signed-in sales user's name   role desk
--        Directors' Room        → the name typed on Release/Extend  role room
--        availability link      → the dealer's typed name           role link
--        hourly sweep           → 'System — expiry sweep'           role sweep
--      Each door is patched by inserting ONE line after its top-level BEGIN,
--      read from the live body (pg_get_functiondef), never retyped. Nothing
--      else in those bodies changes. Old audit rows are NOT rewritten.
--   c. Indexes so one unit's trail reads in well under 300 ms.
--
-- PART 2 — READ ONLY
--   _unit_trail_body(project, company, code) builds the trail;
--   get_unit_trail(link, password|key, code) is the room door — the same gate
--   as get_token_report_room (live link, 10 bad tries an hour, attempt
--   written down before it is judged, _availability_secret_hash).
--   The buyer's phone is never read. A dealer's phone is shown masked.
--
-- AMENDED 2026-10-05 (Rashid's review; the file is re-runnable — every patch
-- checks before it acts, triggers are dropped and re-made, indexes are IF NOT
-- EXISTS): an RMS-app login is named with its email ("Filling Staff
-- (filling.fmh@users.internal)"); the GF-248-type holder change says "exact
-- time not recorded — last edit HH:MI" and invents nothing; a shared voucher
-- says "Split equally — voucher does not give each unit's share" and lists the
-- other units on it.
--
-- NOT TOUCHED: trg_awami_price_lock / _awami_units_price_lock, any price, area,
-- status or reservation. FMH and KBH: every read is scoped to the link's own
-- project (units) and the link's own company (NexuFinance).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1a. Who did it: the label every anon door sets ──────────────────────────
CREATE OR REPLACE FUNCTION public._rms_actor(p_name text, p_role text)
 RETURNS void
 LANGUAGE sql
 VOLATILE
 SET search_path TO 'public'
AS $function$
  SELECT set_config('rms.actor', COALESCE(left(NULLIF(btrim(p_name), ''), 80), ''), true),
         set_config('rms.actor_role', COALESCE(p_role, ''), true);
$function$;

CREATE OR REPLACE FUNCTION public._rms_actor_session(p_session_token text)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_name text;
BEGIN
  SELECT su.full_name INTO v_name
    FROM public.sales_sessions ss JOIN public.sales_users su ON su.id = ss.sales_user_id
   WHERE ss.session_token = p_session_token AND ss.expires_at > now();
  IF v_name IS NOT NULL THEN PERFORM public._rms_actor(v_name, 'desk'); END IF;
END
$function$;

REVOKE ALL ON FUNCTION public._rms_actor(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rms_actor_session(text) FROM PUBLIC, anon, authenticated;

-- ── 1b. The audit function reads the label (one block, at an anchor) ───────
DO $patch$
DECLARE d text; n text;
  anchor constant text := E'\n  IF TG_OP = ''DELETE'' THEN\n';
BEGIN
  d := pg_get_functiondef('public.audit_trigger_function()'::regprocedure);
  IF position('rms.actor' IN d) > 0 THEN RAISE NOTICE 'audit_trigger_function already reads rms.actor'; RETURN; END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'audit_trigger_function: anchor not found exactly once';
  END IF;
  n := replace(d, anchor, E'\n'
    '  -- 20261004a: an anon door (desk session, Directors'' Room, link, sweep)\n'
    '  -- names itself through rms.actor; it wins over the default ''system''.\n'
    '  IF NULLIF(current_setting(''rms.actor'', true), '''') IS NOT NULL THEN\n'
    '    v_user_name := current_setting(''rms.actor'', true);\n'
    '    v_user_role := COALESCE(NULLIF(current_setting(''rms.actor_role'', true), ''''), v_user_role);\n'
    '  END IF;\n'
    || substr(anchor, 2));
  EXECUTE n;
END
$patch$;

-- ── 1c. Every door that writes a unit, a hold or a link request names itself
DO $patch$
DECLARE r record; d text; n text; c int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.reserve_unit(text,uuid,text,text,integer,boolean,numeric,text)',
         'PERFORM public._rms_actor_session(p_session_token);'),
      ('public.reserve_unit_desk(text,uuid,uuid,uuid,text,text,text,integer,boolean,numeric,text,uuid)',
         'PERFORM public._rms_actor_session(p_session_token);'),
      ('public.change_unit_status_desk(text,uuid,uuid,integer,text,uuid,uuid,text,text,text)',
         'PERFORM public._rms_actor_session(p_session_token);'),
      ('public.decide_reservation_request(text,uuid,text,uuid,uuid,uuid)',
         'PERFORM public._rms_actor_session(p_session_token);'),
      ('public.cancel_reservation(text,uuid)',
         'PERFORM public._rms_actor_session(p_session_token);'),
      ('public.decide_holds(text,text,uuid[],text,integer,text)',
         'PERFORM public._rms_actor(COALESCE(NULLIF(btrim(COALESCE(p_by, '''')), ''''), ''Directors'''' Room''), ''room'');'),
      ('public.release_availability_unit(text,text,text)',
         'PERFORM public._rms_actor(''Directors'''' Room'', ''room'');'),
      ('public.update_availability_prices(text,text,text,text,text,numeric)',
         'PERFORM public._rms_actor(''Directors'''' Room'', ''room'');'),
      ('public.cron_expire_reservations()',
         'PERFORM public._rms_actor(''System — expiry sweep'', ''sweep'');'),
      ('public.submit_availability_request(text,text,integer,text,uuid,text)',
         'PERFORM public._rms_actor(COALESCE(NULLIF(btrim(COALESCE(p_name, '''')), ''''), ''Dealer on the link''), ''link'');'),
      ('public.submit_availability_requests(text,text[],integer,text,uuid,text)',
         'PERFORM public._rms_actor(COALESCE(NULLIF(btrim(COALESCE(p_name, '''')), ''''), ''Dealer on the link''), ''link'');'),
      ('public.submit_change_request(text,text,text)',
         'PERFORM public._rms_actor(''Dealer on the link'', ''link'');')
    ) AS t(sig, line)
  LOOP
    d := pg_get_functiondef(r.sig::regprocedure);
    IF position('_rms_actor' IN d) > 0 THEN
      RAISE NOTICE '% already names its actor', r.sig; CONTINUE;
    END IF;
    SELECT count(*) INTO c FROM regexp_matches(d, E'\\nBEGIN[ \\t]*\\n', 'g');
    IF c <> 1 THEN RAISE EXCEPTION '%: expected exactly one top-level BEGIN, found %', r.sig, c; END IF;
    -- first (only) match; no 'g' flag
    n := regexp_replace(d, E'\\nBEGIN[ \\t]*\\n',
           E'\nBEGIN\n  ' || r.line || E'  -- 20261004a: who did it, for the unit trail\n');
    IF n = d THEN RAISE EXCEPTION '%: patch did not apply', r.sig; END IF;
    EXECUTE n;
  END LOOP;
END
$patch$;

-- ── 1d. Audit the holds and the link requests ───────────────────────────────
DROP TRIGGER IF EXISTS _trg_audit ON public.reservations;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

DROP TRIGGER IF EXISTS _trg_audit ON public.availability_requests;
CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ── 1e. Indexes for one unit's trail (audit_logs(table_name, record_id) exists)
CREATE INDEX IF NOT EXISTS reservations_unit_idx ON public.reservations (unit_id, created_at);
CREATE INDEX IF NOT EXISTS availability_requests_unit_idx ON public.availability_requests (unit_id, created_at);
CREATE INDEX IF NOT EXISTS availability_hold_decisions_unit_idx ON public.availability_hold_decisions (unit_id, at);
CREATE INDEX IF NOT EXISTS availability_releases_unit_idx ON public.availability_releases (unit_id, at);
CREATE INDEX IF NOT EXISTS unit_price_changes_unit_idx ON public.unit_price_changes (unit_id, changed_at);

-- ═══ PART 2 — READ ONLY ═════════════════════════════════════════════════════

-- GF-248, gf248, "GF 248", "Unit GF 248" → GF248 ; LG-01-A → LG1A ; 5F-501 → 5F501
CREATE OR REPLACE FUNCTION public._unit_trail_norm(p text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT regexp_replace(upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g')),
                        '^(LG|GF|FF|SF|TF|4F|5F|CB)0*([0-9]+)', '\1\2');
$function$;

-- Every unit a narration or memo names, normalised. Splits the grouped forms
-- the books actually use: "LG-20/21/22/23", "Units FF 108 and FF 184",
-- "LG 51, LG 52 ... and GF 90", "Unit LG 01-A".
CREATE OR REPLACE FUNCTION public._unit_trail_codes(p text)
 RETURNS text[] LANGUAGE sql IMMUTABLE
AS $function$
  SELECT COALESCE(array_agg(DISTINCT public._unit_trail_norm(m[1] || x.n)), '{}')
    FROM regexp_matches(upper(COALESCE(p, '')),
           '\m(LG|GF|FF|SF|TF|4F|5F|CB)[ -]?([0-9]{1,3}(?:-?[A-Z](?![A-Z0-9]))?)((?:/[0-9]{1,3})*)', 'g') AS m,
         LATERAL unnest(ARRAY[m[2]] || COALESCE(string_to_array(NULLIF(ltrim(m[3], '/'), ''), '/'), '{}')) AS x(n);
$function$;

CREATE OR REPLACE FUNCTION public._ut_rs(n numeric)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$ SELECT 'Rs ' || to_char(round(COALESCE(n, 0)), 'FM999,999,999,990') $function$;

CREATE OR REPLACE FUNCTION public._ut_area(n numeric)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$ SELECT CASE WHEN n IS NULL THEN 'area not set' ELSE to_char(n, 'FM999,990.00') || ' sq ft' END $function$;

CREATE OR REPLACE FUNCTION public._ut_day(t timestamptz)
 RETURNS text LANGUAGE sql STABLE
AS $function$ SELECT to_char(t AT TIME ZONE 'Asia/Karachi', 'DD-Mon-YYYY') $function$;

CREATE OR REPLACE FUNCTION public._ut_dur(i interval)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN i IS NULL THEN NULL
    WHEN extract(epoch FROM i) < 3600 THEN greatest(1, round(extract(epoch FROM i) / 60))::int || ' min'
    WHEN extract(epoch FROM i) < 172800 THEN floor(extract(epoch FROM i) / 3600)::int || ' h '
         || round(mod(extract(epoch FROM i)::numeric, 3600) / 60)::int || ' min'
    ELSE round(extract(epoch FROM i) / 86400)::int || ' days' END
$function$;

-- 'system' is the audit function's word for nobody; the trail says so plainly
CREATE OR REPLACE FUNCTION public._ut_who(p_name text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$ SELECT NULLIF(NULLIF(btrim(COALESCE(p_name, '')), ''), 'system') $function$;

CREATE OR REPLACE FUNCTION public._ut_person(p_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT full_name FROM public.sales_users WHERE id = p_id),
                  (SELECT full_name FROM public.app_users WHERE id = p_id))
$function$;

-- a person who signed in to the RMS app is named WITH their login, so a
-- display name like "Filling Staff" or "FMH" says which account it was
CREATE OR REPLACE FUNCTION public._ut_login(p_uid uuid, p_name text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  -- the email only when the name IS that login: a desk/room/link label written
  -- through rms.actor keeps the browser's JWT in changed_by, and must not be
  -- dressed in that other account's email
  SELECT CASE WHEN public._ut_who(p_name) IS NULL THEN NULL
              WHEN EXISTS (SELECT 1 FROM public.app_users au
                            WHERE au.auth_user_id = p_uid AND au.full_name = p_name)
                THEN public._ut_who(p_name)
                     || COALESCE(' (' || (SELECT u.email FROM auth.users u WHERE u.id = p_uid) || ')', '')
              ELSE public._ut_who(p_name) END
$function$;
REVOKE ALL ON FUNCTION public._ut_login(uuid, text) FROM PUBLIC, anon, authenticated;

-- 20261005b: WHO REALLY DID IT, for rows written before rms.actor existed.
-- The portal and the RMS app share one browser sign-in store, so a desk action
-- (Rashid's session token) was audited under whichever RMS-app login that
-- browser also held — 41 Awami rows read "FMH" / "Filling Staff", every one of
-- them in the same second as a hold Rashid's desk session took or cancelled.
-- Where such a desk row sits beside the change, the desk user is named and the
-- browser login is said for what it is.
-- p_short: the name for the main line ("Cancelled by Rashid Manzoor (desk)");
-- otherwise the Who line, which also says what login the browser carried
DROP FUNCTION IF EXISTS public._ut_actor(uuid, timestamptz, uuid, text, text);
CREATE OR REPLACE FUNCTION public._ut_actor(p_unit uuid, p_at timestamptz, p_uid uuid, p_name text, p_role text,
                                            p_short boolean DEFAULT false)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_role = 'desk' THEN public._ut_who(p_name) || ' (desk)'
    WHEN p_role IN ('room', 'link', 'sweep') THEN public._ut_who(p_name)
    WHEN p_uid IS NOT NULL AND d.name IS NOT NULL AND p_short THEN d.name || ' (desk)'
    WHEN p_uid IS NOT NULL AND d.name IS NOT NULL
      THEN d.name || ' (desk) — this browser was also signed in to the RMS app as '
           || public._ut_login(p_uid, p_name)
    ELSE public._ut_login(p_uid, p_name) END
  FROM (SELECT (SELECT su.full_name FROM public.reservations r
                  JOIN public.sales_users su
                    ON su.id = CASE WHEN abs(extract(epoch FROM r.created_at - p_at)) < 2
                                    THEN r.reserved_by ELSE r.cancelled_by END
                 WHERE r.unit_id = p_unit
                   AND (abs(extract(epoch FROM r.created_at - p_at)) < 2
                        OR abs(extract(epoch FROM COALESCE(r.cancelled_at, r.updated_at) - p_at)) < 2)
                 LIMIT 1) AS name) d
$function$;
REVOKE ALL ON FUNCTION public._ut_actor(uuid, timestamptz, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._unit_trail_body(p_project uuid, p_company uuid, p_unit_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER   -- reads only
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := public._unit_trail_norm(p_unit_code);
  v_u public.units; v_st public.category_unit_statuses; v_res public.reservations;
  v_hits int; v_ev jsonb := '[]'::jsonb; v_x jsonb; v_chk jsonb := '[]'::jsonb;
  v_tok numeric := 0; v_res_tok numeric := 0; v_label text; v_sold boolean; v_temp boolean;
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_code'); END IF;

  SELECT count(*) INTO v_hits FROM public.units u
   WHERE u.project_id = p_project AND public._unit_trail_norm(u.unit_no) = v_key;
  IF v_hits = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;
  IF v_hits > 1 THEN RETURN jsonb_build_object('success', false, 'error', 'ambiguous'); END IF;

  SELECT u.* INTO v_u FROM public.units u
   WHERE u.project_id = p_project AND public._unit_trail_norm(u.unit_no) = v_key;
  SELECT * INTO v_st FROM public.category_unit_statuses WHERE id = v_u.status_id;
  SELECT * INTO v_res FROM public.reservations
   WHERE unit_id = v_u.id AND status = 'active' ORDER BY created_at DESC LIMIT 1;
  v_label := COALESCE(NULLIF(btrim(v_st.public_label), ''), v_st.status_name);

  -- ── the unit's own rows: created, area, price, status ────────────────────
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_x FROM (
    SELECT jsonb_build_object('at', a.changed_at, 'seq', a.id, 'kind', 'created',
             'title', 'Unit created — ' || public._ut_area((a.new_data->>'area')::numeric) || ', '
                      || public._ut_rs((a.new_data->>'base_price')::numeric),
             'detail', 'Status ' || COALESCE(cs.status_name, '—'),
             'who', public._ut_login(a.changed_by, a.changed_by_name)) e
      FROM public.audit_logs a
      LEFT JOIN public.category_unit_statuses cs ON cs.id::text = a.new_data->>'status_id'
     WHERE a.table_name = 'units' AND a.record_id = v_u.id::text AND a.action = 'INSERT'
    UNION ALL
    SELECT jsonb_build_object('at', a.changed_at, 'seq', a.id, 'kind', 'area',
             'title', 'Area changed ' || to_char((a.old_data->>'area')::numeric, 'FM999,990.00') || ' → '
                      || public._ut_area((a.new_data->>'area')::numeric),
             'detail', CASE WHEN pc.id IS NOT NULL
                         THEN 'Approved by ' || pc.approved_by || ' — ' || COALESCE(pc.reason, '') END,
             'who', COALESCE(pc.approved_by, public._ut_login(a.changed_by, a.changed_by_name)))
      FROM public.audit_logs a
      LEFT JOIN LATERAL (SELECT * FROM public.unit_price_changes x
                          WHERE x.unit_id = v_u.id
                            AND abs(extract(epoch FROM x.changed_at - a.changed_at)) < 2
                          ORDER BY abs(extract(epoch FROM x.changed_at - a.changed_at)) LIMIT 1) pc ON true
     WHERE a.table_name = 'units' AND a.record_id = v_u.id::text AND a.action = 'UPDATE'
       AND (a.old_data->'area') IS DISTINCT FROM (a.new_data->'area')
    UNION ALL
    SELECT jsonb_build_object('at', a.changed_at, 'seq', a.id, 'kind', 'price',
             'title', 'Price changed ' || public._ut_rs((a.old_data->>'base_price')::numeric) || ' → '
                      || public._ut_rs((a.new_data->>'base_price')::numeric)
                      || CASE WHEN pc.id IS NOT NULL THEN ' (approved by ' || pc.approved_by || ')' ELSE '' END,
             'detail', concat_ws(' · ',
                CASE WHEN NULLIF((a.new_data->>'area')::numeric, 0) IS NOT NULL
                     THEN 'Rate ' || to_char(round((a.old_data->>'base_price')::numeric / NULLIF((a.old_data->>'area')::numeric, 0)), 'FM999,999,990')
                          || ' → ' || to_char(round((a.new_data->>'base_price')::numeric / (a.new_data->>'area')::numeric), 'FM999,999,990')
                          || ' per sq ft' END,
                CASE WHEN pc.id IS NOT NULL THEN 'Reason: ' || COALESCE(pc.reason, '—') END),
             'who', COALESCE(pc.approved_by, public._ut_login(a.changed_by, a.changed_by_name)))
      FROM public.audit_logs a
      LEFT JOIN LATERAL (SELECT * FROM public.unit_price_changes x
                          WHERE x.unit_id = v_u.id
                            AND abs(extract(epoch FROM x.changed_at - a.changed_at)) < 2
                          ORDER BY abs(extract(epoch FROM x.changed_at - a.changed_at)) LIMIT 1) pc ON true
     WHERE a.table_name = 'units' AND a.record_id = v_u.id::text AND a.action = 'UPDATE'
       AND (a.old_data->'base_price') IS DISTINCT FROM (a.new_data->'base_price')
    UNION ALL
    SELECT jsonb_build_object('at', s.changed_at, 'seq', s.id, 'kind', 'status',
             'title', COALESCE(s.o_name, '—') || ' → ' || COALESCE(s.n_name, '—')
                      || COALESCE(' by ' || NULLIF(public._ut_actor(v_u.id, s.changed_at, s.changed_by, s.changed_by_name, s.changed_by_role, true), '')
                                  , ''),
             'detail', CASE
                WHEN s.sweep THEN 'Expired automatically — the hold ran out and the hourly sweep put the unit back'
                WHEN s.putback IS NOT NULL THEN 'No new hold was booked at this moment — the hold of ' || s.putback || ' was put back' END,
             'who', CASE WHEN s.sweep THEN 'System — expiry sweep' ELSE public._ut_actor(v_u.id, s.changed_at, s.changed_by, s.changed_by_name, s.changed_by_role) END,
             'tone', s.n_color)
      FROM (
        SELECT a.id, a.changed_at, a.changed_by, a.changed_by_name, a.changed_by_role, o.status_name o_name, n.status_name n_name, n.color_hex n_color,
               ( a.changed_by IS NULL AND COALESCE(n.is_available, false) AND NOT COALESCE(o.is_available, true)
                 AND ( a.changed_by_role = 'sweep'
                       OR (public._ut_who(a.changed_by_name) IS NULL
                           AND extract(minute FROM a.changed_at) = 13 AND extract(second FROM a.changed_at) < 5)) ) AS sweep,
               CASE WHEN public._ut_who(a.changed_by_name) IS NULL
                         AND COALESCE(o.is_available, false) AND NOT COALESCE(n.is_available, true)
                         AND NOT EXISTS (SELECT 1 FROM public.reservations r2 WHERE r2.unit_id = v_u.id
                                          AND abs(extract(epoch FROM r2.created_at - a.changed_at)) < 2)
                    THEN (SELECT public._ut_day(r3.created_at) || ' for ' || COALESCE(r3.requested_by_name, '(no name)')
                            FROM public.reservations r3
                           WHERE r3.unit_id = v_u.id AND r3.created_at < a.changed_at - interval '2 seconds'
                             AND (r3.cancelled_at IS NULL OR r3.cancelled_at > a.changed_at)
                             AND r3.status <> 'expired'
                           ORDER BY r3.created_at DESC LIMIT 1) END AS putback
          FROM public.audit_logs a
          LEFT JOIN public.category_unit_statuses o ON o.id::text = a.old_data->>'status_id'
          LEFT JOIN public.category_unit_statuses n ON n.id::text = a.new_data->>'status_id'
         WHERE a.table_name = 'units' AND a.record_id = v_u.id::text AND a.action = 'UPDATE'
           AND (a.old_data->'status_id') IS DISTINCT FROM (a.new_data->'status_id')) s
    UNION ALL
    SELECT jsonb_build_object('at', a.changed_at, 'kind', 'status',
             'title', 'Unit number changed ' || (a.old_data->>'unit_no') || ' → ' || (a.new_data->>'unit_no'),
             'who', public._ut_login(a.changed_by, a.changed_by_name))
      FROM public.audit_logs a
     WHERE a.table_name = 'units' AND a.record_id = v_u.id::text AND a.action = 'UPDATE'
       AND (a.old_data->'unit_no') IS DISTINCT FROM (a.new_data->'unit_no')
  ) z;
  v_ev := v_ev || v_x;

  -- ── holds: taken, extended, released, expired, cancelled, edited ─────────
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_x FROM (
    -- taken
    SELECT jsonb_build_object('at', r.created_at, 'kind', 'hold',
             'title', COALESCE(NULLIF(btrim(hs.public_label), ''), hs.status_name, 'Hold')
                      || ' for ' || COALESCE(h.first_name, '(no name)')
                      || CASE WHEN h.first_exp IS NULL THEN ', no expiry'
                              ELSE ', ' || greatest(1, round(extract(epoch FROM h.first_exp - r.created_at) / 86400))::int
                                   || ' days, until ' || public._ut_day(h.first_exp) END,
             'detail', concat_ws(' · ',
                CASE WHEN q.ref IS NOT NULL THEN 'From link request ' || q.ref END,
                CASE WHEN r.client_name IS NOT NULL THEN 'Buyer now ' || r.client_name END,
                CASE WHEN COALESCE(r.token_amount, 0) > 0 THEN 'Token on the hold now ' || public._ut_rs(r.token_amount) END,
                CASE WHEN NULLIF(btrim(r.note), '') IS NOT NULL THEN 'Note: ' || left(r.note, 140) END),
             'who', COALESCE(public._ut_who(ins.changed_by_name), public._ut_person(r.reserved_by)),
             'tone', hs.color_hex) e
      FROM public.reservations r
      LEFT JOIN LATERAL (SELECT * FROM public.availability_requests q2
                          WHERE q2.reservation_id = r.id ORDER BY q2.created_at DESC LIMIT 1) q ON true
      LEFT JOIN LATERAL (SELECT * FROM public.audit_logs a2
                          WHERE a2.table_name = 'reservations' AND a2.record_id = r.id::text AND a2.action = 'INSERT'
                          LIMIT 1) ins ON true
      -- the hold's type AS TAKEN: its own first audit row, else the status the
      -- unit was put on at that same moment, else today's type
      LEFT JOIN LATERAL (SELECT (a3.new_data->>'status_id')::uuid AS sid FROM public.audit_logs a3
                          LEFT JOIN public.category_unit_statuses k3 ON k3.id::text = a3.new_data->>'status_id'
                          WHERE a3.table_name = 'units' AND a3.record_id = v_u.id::text AND a3.action = 'UPDATE'
                            AND (a3.old_data->'status_id') IS DISTINCT FROM (a3.new_data->'status_id')
                            AND abs(extract(epoch FROM a3.changed_at - r.created_at)) < 2
                          ORDER BY COALESCE(k3.is_available, false), a3.id DESC LIMIT 1) ua ON true
      LEFT JOIN public.category_unit_statuses hs
             ON hs.id = COALESCE((ins.new_data->>'unit_status_id')::uuid, ua.sid, r.unit_status_id)
      LEFT JOIN LATERAL (SELECT
               COALESCE(ins.new_data->>'requested_by_name', q.requested_by_name, r.requested_by_name) AS first_name,
               COALESCE((ins.new_data->>'expiry_date')::timestamptz,
                        (SELECT d.expiry_before FROM public.availability_hold_decisions d
                          WHERE d.reservation_id = r.id AND d.action = 'extend' ORDER BY d.at LIMIT 1),
                        r.expiry_date) AS first_exp) h ON true
     WHERE r.unit_id = v_u.id
    UNION ALL
    -- holder changed, known only from today's row (no audit for the hold then)
    SELECT jsonb_build_object('at', r.updated_at, 'kind', 'holder',
             -- no audit on the hold then: the time is NOT known, and is not made up
             'title', 'Holder changed ' || q.requested_by_name || ' → ' || r.requested_by_name
                      || ' (exact time not recorded — last edit '
                      || to_char(r.updated_at AT TIME ZONE 'Asia/Karachi', 'HH24:MI') || ')',
             'time_unknown', true)
      FROM public.reservations r
      JOIN LATERAL (SELECT * FROM public.availability_requests q2
                     WHERE q2.reservation_id = r.id ORDER BY q2.created_at DESC LIMIT 1) q ON true
     WHERE r.unit_id = v_u.id
       AND lower(btrim(q.requested_by_name)) IS DISTINCT FROM lower(btrim(r.requested_by_name))
       AND NOT EXISTS (SELECT 1 FROM public.audit_logs a2
                        WHERE a2.table_name = 'reservations' AND a2.record_id = r.id::text)
    UNION ALL
    -- extended in the Directors' Room
    SELECT jsonb_build_object('at', d.at, 'kind', 'extend',
             'title', 'Hold extended to ' || public._ut_day(d.expiry_after) || ' (+' || d.days || ' days)',
             'detail', concat_ws(' · ', 'Was until ' || public._ut_day(d.expiry_before),
                                 'Held by ' || d.held_by, 'Directors'' Room'),
             'who', d.decided_by)
      FROM public.availability_hold_decisions d
     WHERE d.unit_id = v_u.id AND d.action = 'extend'
    UNION ALL
    -- how each hold ended
    SELECT jsonb_build_object('at', x.at, 'kind', x.kind, 'title', x.title, 'detail', x.detail, 'who', x.who)
      FROM (
        SELECT CASE WHEN rel.id IS NOT NULL THEN rel.at
                    ELSE COALESCE(fin.changed_at, r.cancelled_at, r.updated_at) END AS at,
               CASE WHEN rel.id IS NOT NULL THEN 'release'
                    WHEN r.status = 'expired' THEN 'expire'
                    WHEN r.status = 'cancelled' THEN 'cancel'
                    ELSE 'status' END AS kind,
               CASE WHEN rel.id IS NOT NULL THEN 'Released by ' || rel.decided_by
                    -- only the sweep sets 'expired' without a room decision
                    WHEN r.status = 'expired' AND (fin.id IS NULL OR fin.changed_by_role = 'sweep'
                                                   OR public._ut_who(fin.changed_by_name) IS NULL)
                      THEN 'Expired automatically'
                    WHEN r.status = 'expired' THEN 'Hold expired — by ' || public._ut_who(fin.changed_by_name)
                    WHEN r.status = 'cancelled' THEN
                      CASE WHEN COALESCE(public._ut_actor(v_u.id, fin.changed_at, fin.changed_by, fin.changed_by_name, fin.changed_by_role, true), ux.short, public._ut_person(r.cancelled_by)) IS NOT NULL
                           THEN 'Cancelled by ' || COALESCE(public._ut_actor(v_u.id, fin.changed_at, fin.changed_by, fin.changed_by_name, fin.changed_by_role, true), ux.short, public._ut_person(r.cancelled_by))
                           ELSE 'Hold cancelled' END
                    WHEN r.status = 'converted' THEN 'Hold converted to a sale'
                    ELSE 'Hold ' || r.status END AS title,
               concat_ws(' · ',
                 'Hold for ' || COALESCE(r.requested_by_name, '(no name)') || ' taken ' || public._ut_day(r.created_at),
                 CASE WHEN rel.id IS NOT NULL THEN 'Directors'' Room — was until ' || public._ut_day(rel.expiry_before) END,
                 CASE WHEN r.status = 'expired' AND rel.id IS NULL AND r.expiry_date IS NOT NULL
                      THEN 'Its end date was ' || public._ut_day(r.expiry_date) END,
                 CASE WHEN EXISTS (SELECT 1 FROM public.reservations r4 WHERE r4.unit_id = r.unit_id AND r4.id <> r.id
                                     AND abs(extract(epoch FROM r4.created_at - COALESCE(r.cancelled_at, r.updated_at))) < 2)
                      THEN 'Replaced by a new hold at the same moment' END) AS detail,
               CASE WHEN rel.id IS NOT NULL THEN rel.decided_by
                    WHEN r.status = 'expired' AND (fin.id IS NULL OR fin.changed_by_role = 'sweep'
                                                   OR public._ut_who(fin.changed_by_name) IS NULL)
                      THEN 'System — expiry sweep'
                    ELSE COALESCE(public._ut_actor(v_u.id, fin.changed_at, fin.changed_by, fin.changed_by_name, fin.changed_by_role), ux.who, public._ut_person(r.cancelled_by)) END AS who
          FROM public.reservations r
          LEFT JOIN LATERAL (SELECT * FROM public.availability_hold_decisions d
                              WHERE d.reservation_id = r.id AND d.action = 'release'
                              ORDER BY d.at DESC LIMIT 1) rel ON true
          LEFT JOIN LATERAL (SELECT * FROM public.audit_logs a2
                              WHERE a2.table_name = 'reservations' AND a2.record_id = r.id::text
                                AND a2.action = 'UPDATE'
                                AND a2.old_data->>'status' = 'active' AND a2.new_data->>'status' <> 'active'
                              ORDER BY a2.changed_at DESC LIMIT 1) fin ON true
          /* a person who changed the UNIT at the moment the hold closed is the
             one who closed it (the status trigger cancels the hold) — truer
             than cancelled_by, which some paths fill with the booker */
          LEFT JOIN LATERAL (SELECT public._ut_actor(v_u.id, a4.changed_at, a4.changed_by, a4.changed_by_name, a4.changed_by_role) AS who,
                                    public._ut_actor(v_u.id, a4.changed_at, a4.changed_by, a4.changed_by_name, a4.changed_by_role, true) AS short
                               FROM public.audit_logs a4
                              WHERE a4.table_name = 'units' AND a4.record_id = v_u.id::text
                                AND a4.action = 'UPDATE' AND public._ut_who(a4.changed_by_name) IS NOT NULL
                                AND abs(extract(epoch FROM a4.changed_at - COALESCE(r.cancelled_at, r.updated_at))) < 2
                              LIMIT 1) ux ON true
         WHERE r.unit_id = v_u.id AND r.status <> 'active') x
    UNION ALL
    -- edits to a hold, from its own audit rows (recorded from 04-Oct-2026)
    SELECT jsonb_build_object('at', a.changed_at, 'kind', c.kind, 'title', c.title,
             'who', public._ut_login(a.changed_by, a.changed_by_name))
      FROM public.reservations r
      JOIN public.audit_logs a ON a.table_name = 'reservations' AND a.record_id = r.id::text AND a.action = 'UPDATE'
      CROSS JOIN LATERAL (VALUES
        ((a.old_data->'requested_by_name') IS DISTINCT FROM (a.new_data->'requested_by_name'), 'holder',
         'Holder changed ' || COALESCE(a.old_data->>'requested_by_name', '(no name)') || ' → '
           || COALESCE(a.new_data->>'requested_by_name', '(no name)')),
        ((a.old_data->'client_name') IS DISTINCT FROM (a.new_data->'client_name'), 'holder',
         'Buyer ' || COALESCE(a.old_data->>'client_name', 'not named') || ' → '
           || COALESCE(a.new_data->>'client_name', 'not named')),
        ((a.old_data->'token_amount') IS DISTINCT FROM (a.new_data->'token_amount'), 'hold',
         'Token on the hold ' || public._ut_rs((a.old_data->>'token_amount')::numeric) || ' → '
           || public._ut_rs((a.new_data->>'token_amount')::numeric)),
        ((a.old_data->'unit_status_id') IS DISTINCT FROM (a.new_data->'unit_status_id'), 'hold',
         'Hold type ' || COALESCE((SELECT status_name FROM public.category_unit_statuses WHERE id::text = a.old_data->>'unit_status_id'), '—')
           || ' → ' || COALESCE((SELECT status_name FROM public.category_unit_statuses WHERE id::text = a.new_data->>'unit_status_id'), '—')),
        ((a.old_data->'expiry_date') IS DISTINCT FROM (a.new_data->'expiry_date')
           AND (a.old_data->'status') IS NOT DISTINCT FROM (a.new_data->'status')
           AND NOT EXISTS (SELECT 1 FROM public.availability_hold_decisions d WHERE d.reservation_id = r.id
                            AND abs(extract(epoch FROM d.at - a.changed_at)) < 2), 'extend',
         'Hold end date changed ' || COALESCE(public._ut_day((a.old_data->>'expiry_date')::timestamptz), 'none')
           || ' → ' || COALESCE(public._ut_day((a.new_data->>'expiry_date')::timestamptz), 'none'))
      ) AS c(hit, kind, title)
     WHERE r.unit_id = v_u.id AND c.hit
    UNION ALL
    SELECT jsonb_build_object('at', a.changed_at, 'kind', 'cancel',
             'title', 'Hold deleted' || COALESCE(' by ' || public._ut_login(a.changed_by, a.changed_by_name), ''),
             'detail', 'Hold for ' || COALESCE(a.old_data->>'requested_by_name', '(no name)'),
             'who', public._ut_login(a.changed_by, a.changed_by_name))
      FROM public.audit_logs a
     WHERE a.table_name = 'reservations' AND a.action = 'DELETE' AND a.old_data->>'unit_id' = v_u.id::text
  ) z;
  v_ev := v_ev || v_x;

  -- ── requests from the availability link ──────────────────────────────────
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_x FROM (
    SELECT jsonb_build_object('at', q.created_at, 'kind', 'request',
             'title', CASE WHEN q.kind = 'change' THEN 'Change request ' ELSE 'Link request ' END
                      || q.ref || ' from ' || COALESCE(q.requested_by_name, '(no name)')
                      || CASE WHEN q.requested_by_phone IS NOT NULL
                              THEN ' (' || left(q.requested_by_phone, 4) || '…' || right(q.requested_by_phone, 2) || ')' ELSE '' END
                      || CASE WHEN q.kind = 'change' THEN ''
                              ELSE ' — asked ' || COALESCE(NULLIF(btrim(qs.public_label), ''), qs.status_name, 'a hold')
                                   || CASE WHEN qs.nature = 'permanent' OR q.days IS NULL THEN ', no expiry'
                                           ELSE ', ' || q.days || ' days' END END
                      || CASE q.status
                           WHEN 'approved' THEN ' → Approved' || COALESCE(' by ' || public._ut_person(q.decided_by), '')
                                                || COALESCE(' in ' || public._ut_dur(q.decided_at - q.created_at), '')
                           WHEN 'declined' THEN ' → Declined' || COALESCE(' by ' || public._ut_person(q.decided_by), '')
                                                || COALESCE(' in ' || public._ut_dur(q.decided_at - q.created_at), '')
                           WHEN 'pending'  THEN ' → waiting for a decision'
                           WHEN 'expired'  THEN ' → lapsed with no decision'
                           ELSE ' → ' || q.status END,
             'detail', concat_ws(' · ',
                CASE WHEN q.decided_at IS NOT NULL THEN 'Decided ' || to_char(q.decided_at AT TIME ZONE 'Asia/Karachi', 'DD-Mon HH24:MI') END,
                CASE WHEN NULLIF(btrim(q.note), '') IS NOT NULL THEN 'Note: ' || left(q.note, 140) END,
                CASE WHEN NULLIF(btrim(q.decision_note), '') IS NOT NULL THEN 'Decision note: ' || left(q.decision_note, 140) END,
                CASE WHEN q.batch_ref IS NOT NULL THEN 'Part of batch ' || q.batch_ref END),
             'who', q.requested_by_name,
             'tone', qs.color_hex) e
      FROM public.availability_requests q
      LEFT JOIN public.category_unit_statuses qs ON qs.id = q.asked_status_id
     WHERE q.unit_id = v_u.id AND q.project_id = p_project
    UNION ALL
    -- tap-to-release in the room (decide_holds releases are told above, once)
    SELECT jsonb_build_object('at', x.at, 'kind', 'release',
             'title', 'Released in the Directors'' Room',
             'detail', concat_ws(' · ', 'Was ' || x.was_status, 'Held by ' || x.was_held_by,
                                 CASE WHEN NOT x.freed_reservation THEN 'No hold was behind it' END),
             'who', 'Directors'' Room')
      FROM public.availability_releases x
     WHERE x.unit_id = v_u.id
       AND NOT EXISTS (SELECT 1 FROM public.availability_hold_decisions d
                        WHERE d.unit_id = x.unit_id AND d.action = 'release'
                          AND abs(extract(epoch FROM d.at - x.at)) < 2)
  ) z;
  v_ev := v_ev || v_x;

  -- ── the books: NexuFinance 21100 / 21150 legs that name this unit ────────
  /* A leg names its unit in its MEMO, or failing that the voucher's
     NARRATION does. Where one voucher covers several units the unit's share is
     the leg itself (one unit), the "N each" its memo states, or — only when
     neither is written — an equal split, said so on the line.

     ALLOCATIONS (21150 ⇄ 21100, or buyer ⇄ buyer, no cash or bank leg) are
     often written on the RECEIVING leg only: JV-0066's 21100 leg says
     "LG-20/21/22/23 — 250,000 each" while its 21150 legs carry no unit at all
     and a narration that names six. There the unit's other side is taken to
     be the same amount, coming off the voucher's opposite legs — never an
     equal split of a narration that is about other units too. */
  WITH legs AS (
    SELECT v.id AS vid, v.voucher_no, v.manual_no, v.voucher_date, v.posted_at, v.narration,
           l.line_no, l.account_code AS acc, l.debit, l.credit, l.memo, p.name AS party,
           cardinality(public._unit_trail_codes(l.memo)) > 0 AS from_memo,
           CASE WHEN cardinality(public._unit_trail_codes(l.memo)) > 0
                THEN public._unit_trail_codes(l.memo) ELSE public._unit_trail_codes(v.narration) END AS codes,
           EXISTS (SELECT 1 FROM public.nf_voucher_legs o
                    WHERE o.voucher_id = v.id AND o.account_code NOT IN ('21100', '21150')) AS has_outside
      FROM public.nf_vouchers v
      JOIN public.nf_voucher_legs l ON l.voucher_id = v.id
      LEFT JOIN public.nf_parties p ON p.id = l.party_id
     WHERE v.company_id = p_company AND l.company_id = p_company
       AND v.status = 'POSTED' AND l.account_code IN ('21100', '21150')
  ), sh AS (
    SELECT l.*,
           CASE WHEN cardinality(l.codes) = 1 THEN l.credit - l.debit
                WHEN e.each_amt IS NOT NULL THEN sign(l.credit - l.debit) * e.each_amt
                ELSE round((l.credit - l.debit) / cardinality(l.codes), 2) END AS share,
           (cardinality(l.codes) = 1 OR e.each_amt IS NOT NULL) AS known,
           (SELECT string_agg(COALESCE(u2.unit_no, c), ', ' ORDER BY c)
              FROM unnest(l.codes) c
              LEFT JOIN public.units u2 ON u2.project_id = p_project AND public._unit_trail_norm(u2.unit_no) = c
             WHERE c <> v_key) AS others
      FROM legs l
      CROSS JOIN LATERAL (SELECT NULLIF(replace(substring(l.memo FROM '([0-9][0-9,]*)\s+each'), ',', ''), '')::numeric
                            AS each_amt) e
     WHERE v_key = ANY (l.codes)
  ), shares AS (
    SELECT s.vid, s.voucher_no, s.manual_no, s.voucher_date, s.posted_at, s.narration,
           s.acc, s.party, s.memo, s.share, s.known, s.others, s.has_outside
      FROM sh s
     WHERE s.has_outside OR s.from_memo
        OR NOT EXISTS (SELECT 1 FROM sh t WHERE t.vid = s.vid AND t.from_memo)
    UNION ALL
    -- the other side of an allocation that is written on one side only
    SELECT c.vid, c.voucher_no, c.manual_no, c.voucher_date, c.posted_at, c.narration,
           o.acc, o.party, c.memo, c.counter, c.known, c.others, false
      FROM (SELECT t.vid, max(t.voucher_no) voucher_no, max(t.manual_no) manual_no,
                   max(t.voucher_date) voucher_date, max(t.posted_at) posted_at, max(t.narration) narration,
                   max(t.memo) memo, -sum(t.share) counter, bool_and(t.known) known, max(t.others) others
              FROM sh t WHERE NOT t.has_outside AND t.from_memo
             GROUP BY t.vid HAVING sum(t.share) <> 0) c
      CROSS JOIN LATERAL (
        SELECT g.acc, g.party FROM legs g
         WHERE g.vid = c.vid AND sign(g.credit - g.debit) = sign(c.counter)
           AND NOT (g.from_memo AND v_key = ANY (g.codes))
         ORDER BY g.line_no LIMIT 1) o
  ), vch AS (
    SELECT s.vid, max(s.voucher_no) AS voucher_no, max(s.manual_no) AS manual_no,
           max(s.voucher_date) AS voucher_date, max(s.posted_at) AS posted_at, max(s.narration) AS narration,
           COALESCE(sum(s.share) FILTER (WHERE s.acc = '21100'), 0) AS d21100,
           COALESCE(sum(s.share) FILTER (WHERE s.acc = '21150'), 0) AS d21150,
           COALESCE(sum(s.share) FILTER (WHERE s.share > 0), 0) AS amt_in,
           COALESCE(-sum(s.share) FILTER (WHERE s.share < 0), 0) AS amt_out,
           bool_and(s.known) AS known,
           string_agg(DISTINCT s.party, ', ') FILTER (WHERE s.share > 0 AND s.acc = '21100') AS buyer,
           string_agg(DISTINCT s.party, ', ') FILTER (WHERE s.share < 0 AND s.acc = '21100') AS payer_back,
           string_agg(DISTINCT CASE WHEN s.acc = '21150' THEN 'Not Allocated' ELSE '"' || COALESCE(s.party, '?') || '"' END, ', ')
             FILTER (WHERE s.share < 0) AS from_who,
           string_agg(DISTINCT CASE WHEN s.acc = '21150' THEN 'Not Allocated' ELSE COALESCE(s.party, '?') END, ', ')
             FILTER (WHERE s.share > 0) AS to_who,
           max(s.others) AS others,
           max(substring(upper(COALESCE(s.memo, '') || ' ' || COALESCE(s.narration, '')) FROM 'TOKENS? ?#?([0-9]+)')) AS token_no,
           (SELECT a.name FROM public.nf_voucher_legs o
              LEFT JOIN public.nf_accounts a ON a.company_id = p_company AND a.code = o.account_code
             WHERE o.voucher_id = s.vid AND o.account_code NOT IN ('21100', '21150')
             ORDER BY o.line_no LIMIT 1) AS via_name,
           (SELECT o.account_code FROM public.nf_voucher_legs o
             WHERE o.voucher_id = s.vid AND o.account_code NOT IN ('21100', '21150')
             ORDER BY o.line_no LIMIT 1) AS via_code
      FROM shares s GROUP BY s.vid
  ), run AS (
    SELECT v.*, sum(v.d21100) OVER (ORDER BY v.voucher_date, v.posted_at, v.voucher_no) AS running,
           row_number() OVER (ORDER BY v.voucher_date, v.posted_at, v.voucher_no) AS seq
      FROM vch v
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', (r.voucher_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi',
           'day_only', true, 'seq', r.seq,
           'kind', CASE WHEN r.via_code IS NULL THEN 'allocation'
                        WHEN r.d21100 < 0 OR (r.d21100 = 0 AND r.d21150 < 0) THEN 'refund'
                        ELSE 'token' END,
           'title', CASE
              WHEN r.via_code IS NULL THEN
                r.voucher_no || ' — ' || public._ut_rs(greatest(r.amt_in, r.amt_out)) || ' moved from '
                || COALESCE(r.from_who, '?') || ' to ' || COALESCE(r.to_who, '?')
              WHEN r.d21100 < 0 OR (r.d21100 = 0 AND r.d21150 < 0) THEN
                'Token' || COALESCE(' #' || r.token_no, '') || ' returned — ' || public._ut_rs(r.amt_out)
                || ', ' || r.voucher_no || COALESCE(' to ' || r.payer_back, '')
              WHEN r.d21150 > 0 AND r.d21100 = 0 THEN
                'Token' || COALESCE(' #' || r.token_no, '') || ' — ' || public._ut_rs(r.d21150)
                || ' received into Not Allocated, ' || r.voucher_no
              ELSE
                'Token' || COALESCE(' #' || r.token_no, '') || ' — ' || public._ut_rs(r.d21100) || ', '
                || CASE r.via_code WHEN '10100' THEN 'cash' WHEN '10300' THEN 'bank' ELSE COALESCE(r.via_name, r.via_code) END
                || ', ' || r.voucher_no || COALESCE(', buyer ' || r.buyer, '') END,
           'detail', concat_ws(' · ',
              'Running total on the unit ' || public._ut_rs(r.running),
              CASE WHEN r.others IS NOT NULL AND NOT r.known
                   THEN 'Split equally — voucher does not give each unit''s share' END,
              CASE WHEN r.others IS NOT NULL THEN 'Other units on this voucher: ' || r.others END,
              CASE WHEN r.d21150 > 0 AND r.d21100 = 0 THEN 'Not counted on the unit until it is allocated' END,
              CASE WHEN r.manual_no IS NOT NULL AND r.manual_no <> r.voucher_no THEN 'Manual no. ' || r.manual_no END,
              left(r.narration, 160)),
           'amount', CASE WHEN r.d21100 <> 0 THEN r.d21100 ELSE r.d21150 END,
           'running', r.running)), '[]'::jsonb),
         COALESCE((SELECT r2.running FROM run r2 ORDER BY r2.voucher_date DESC, r2.posted_at DESC, r2.voucher_no DESC LIMIT 1), 0)
    INTO v_x, v_tok
    FROM run r;
  v_ev := v_ev || v_x;

  -- ── red flags ─────────────────────────────────────────────────────────────
  v_res_tok := CASE WHEN v_res.id IS NOT NULL AND v_res.token_received THEN COALESCE(v_res.token_amount, 0) ELSE 0 END;
  v_sold := COALESCE(v_label, '') ~* 'sold' OR COALESCE(v_st.status_name, '') ~* '(sold|pagri)';
  v_temp := v_st.nature = 'temporary';

  IF v_tok <> v_res_tok THEN
    v_chk := v_chk || jsonb_build_object('level', 'red',
      'text', 'Token in the books ' || public._ut_rs(v_tok) || ' ≠ token on the hold ' || public._ut_rs(v_res_tok));
  END IF;
  IF v_sold AND v_tok = 0 AND v_res_tok = 0 AND (v_res.id IS NULL OR v_res.client_name IS NULL) THEN
    v_chk := v_chk || jsonb_build_object('level', 'red', 'text', v_label || ' but no token and no buyer');
  ELSIF v_sold AND v_tok = 0 AND v_res_tok = 0 THEN
    v_chk := v_chk || jsonb_build_object('level', 'red', 'text', v_label || ' but no token');
  ELSIF v_sold AND (v_res.id IS NULL OR v_res.client_name IS NULL) THEN
    v_chk := v_chk || jsonb_build_object('level', 'amber', 'text', v_label || ' but no buyer named');
  END IF;
  IF v_temp AND v_res.id IS NULL THEN
    v_chk := v_chk || jsonb_build_object('level', 'red', 'text', v_label || ' but nobody holds it — there is no active hold');
  END IF;
  IF v_temp AND v_res.id IS NOT NULL AND v_res.expiry_date IS NULL THEN
    v_chk := v_chk || jsonb_build_object('level', 'amber', 'text', 'The hold has no end date');
  END IF;
  IF v_res.id IS NOT NULL AND v_res.expiry_date < now() THEN
    v_chk := v_chk || jsonb_build_object('level', 'red',
      'text', 'The hold ran out on ' || public._ut_day(v_res.expiry_date) || ' ('
              || floor(extract(epoch FROM now() - v_res.expiry_date) / 86400)::int
              || ' days ago) and is still active — waiting for the directors');
  END IF;
  IF v_temp AND (v_tok > 0 OR v_res_tok > 0) THEN
    v_chk := v_chk || jsonb_build_object('level', 'amber',
      'text', 'On hold while carrying ' || public._ut_rs(greatest(v_tok, v_res_tok))
              || ' of token money — releasing it would leave the token without a unit');
  END IF;
  IF COALESCE(v_st.is_available, false) AND v_res.id IS NOT NULL THEN
    v_chk := v_chk || jsonb_build_object('level', 'red', 'text', 'Shown as Available but an active hold is still open');
  END IF;
  IF COALESCE(v_st.is_available, false) AND v_tok > 0 THEN
    v_chk := v_chk || jsonb_build_object('level', 'red',
      'text', 'Shown as Available but the books hold ' || public._ut_rs(v_tok) || ' of token against it');
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'as_of', now(),
    'unit', jsonb_build_object(
      'code', v_u.unit_no, 'floor', v_u.floor_label, 'area', v_u.area, 'price', v_u.base_price,
      'rate_per_sqft', CASE WHEN NULLIF(v_u.area, 0) IS NOT NULL THEN round(v_u.base_price / v_u.area) END,
      'status', v_st.status_name, 'public_label', v_label, 'color', v_st.color_hex, 'nature', v_st.nature,
      'available', COALESCE(v_st.is_available, false),
      'holder', v_res.requested_by_name, 'buyer', v_res.client_name,
      'hold_until', v_res.expiry_date, 'hold_token', v_res_tok,
      'token_total', v_tok),
    'events', (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'at')::timestamptz DESC,
                                          -- one instant, told in the order it happened (read bottom-up)
                                          CASE e->>'kind' WHEN 'created' THEN 0 WHEN 'request' THEN 1
                                                          WHEN 'cancel' THEN 2 WHEN 'release' THEN 2 WHEN 'expire' THEN 2
                                                          WHEN 'status' THEN 3 WHEN 'hold' THEN 4 ELSE 5 END DESC,
                                          (e->>'seq')::bigint DESC NULLS LAST), '[]'::jsonb)
                 FROM jsonb_array_elements(v_ev) e),
    'checks', v_chk);
END
$function$;

REVOKE ALL ON FUNCTION public._unit_trail_body(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ut_person(uuid) FROM PUBLIC, anon, authenticated;

-- the room door, the same gate as get_token_report_room
CREATE OR REPLACE FUNCTION public.get_unit_trail(p_token text, p_password text, p_unit_code text)
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

  IF p_unit_code IS NULL OR length(p_unit_code) > 40 THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_code'); END IF;

  RETURN public._unit_trail_body(v_pr, v_link.company_id, p_unit_code);
END
$function$;

COMMENT ON FUNCTION public.get_unit_trail(text, text, text) IS
  'Director Level Report (/a/<token>) Unit trail: one unit''s whole history, newest first, plus red-flag '
  'checks. Read only. Same gate as get_token_report_room (room password or remembered key). '
  'Never returns a buyer phone; a dealer phone only masked.';

REVOKE ALL ON FUNCTION public.get_unit_trail(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unit_trail(text, text, text) TO anon, authenticated;

COMMIT;
