-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-06d · The unit trail, 360
--
-- Rashid: "poora 360 trail banao unit ka, i guess kahin bana b hai. upgrade it".
-- The trail (20261004a) told holds, requests, statuses, prices and the
-- NexuFinance token. It now also tells: money recorded on the link and its
-- verification (and whether it went onto the hold), the sale, every receipt
-- voucher against it, sale cancellation, unit cancellation, transfer,
-- possession, NOC, legal case, payment-plan quotes and sale submissions; and
-- returns two new blocks - money (sale net / paid, link pending / verified)
-- and interest (leads, deals, quotes) - plus an amber check for link money
-- awaiting verification. A unit sold in RMS no longer gets the hold-based
-- "no token / no buyer" checks: its buyer and money are on the sale.
--
-- Body copied from pg_get_functiondef() on live 2026-10-06; every addition
-- is marked 20261006d and nothing else in it changed. Read only, as before.
-- Both doors (get_unit_trail for the room, get_unit_trail_desk for the desk)
-- call this body, so both get the whole trail.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- a 'by' column that holds a login id is told as that login's name
CREATE OR REPLACE FUNCTION public._ut_by(p text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN COALESCE((SELECT au.full_name FROM public.app_users au
                              WHERE au.id = p::uuid OR au.auth_user_id = p::uuid LIMIT 1),
                            (SELECT su.full_name FROM public.sales_users su WHERE su.id = p::uuid LIMIT 1))
              ELSE NULLIF(btrim(COALESCE(p, '')), '') END;
$function$;
REVOKE ALL ON FUNCTION public._ut_by(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._unit_trail_body(p_project uuid, p_company uuid, p_unit_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := public._unit_trail_norm(p_unit_code);
  v_u public.units; v_st public.category_unit_statuses; v_res public.reservations;
  v_hits int; v_ev jsonb := '[]'::jsonb; v_x jsonb; v_chk jsonb := '[]'::jsonb;
  v_tok numeric := 0; v_res_tok numeric := 0; v_label text; v_sold boolean; v_temp boolean;
  v_money jsonb := '{}'::jsonb; v_interest jsonb := '{}'::jsonb;   -- 20261006d
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


  -- ── 20261006d · THE REST OF THE UNIT'S LIFE (360) ──────────────────────────
  -- Rashid: "poora 360 trail banao unit ka". Everything else a unit can go
  -- through, read from where it is kept: money recorded on the link and its
  -- verification, the sale and every receipt voucher against it, cancellation,
  -- transfer, possession, NOC, legal case, payment-plan quotes, sale
  -- submissions. A date-only record is told as noon Pakistan time, day_only.
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_x FROM (
    -- money a rep recorded on the link
    SELECT jsonb_build_object('at', p.created_at, 'kind', 'linkpay',
             'title', CASE p.kind WHEN 'payment' THEN 'Payment' ELSE 'Token' END || ' recorded on the link — '
                      || public._ut_rs(p.amount) || ', ' || initcap(p.mode)
                      || COALESCE(' ' || p.reference, '') || COALESCE(' (' || p.bank_name || ')', '') || ', ' || p.ref,
             'detail', concat_ws(' · ', 'From ' || p.payer_name,
                         CASE WHEN p.payer_cnic IS NOT NULL THEN 'CNIC ' || p.payer_cnic END,
                         CASE WHEN p.final_price IS NOT NULL THEN 'Final price ' || public._ut_rs(p.final_price) END,
                         'Paid on ' || public._ut_day((p.paid_on::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi'),
                         NULLIF(p.note, '')),
             'who', p.received_by_name || ' (' || p.received_by_phone || ')') e
      FROM public.link_payment_receipts p WHERE p.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', p.decided_at, 'kind', CASE p.status WHEN 'verified' THEN 'linkpay_ok' ELSE 'linkpay_no' END,
             'title', p.ref || ' ' || p.status
                      || CASE WHEN p.applied_reservation_id IS NOT NULL
                              THEN ' — ' || public._ut_rs(p.applied_amount) || ' added to the hold''s token'
                              WHEN p.status = 'verified' THEN ' — no standing hold, nothing added' ELSE '' END,
             'detail', NULLIF(p.decision_note, ''), 'who', p.decided_by_name)
      FROM public.link_payment_receipts p WHERE p.unit_id = v_u.id AND p.decided_at IS NOT NULL
    UNION ALL
    -- the sale
    SELECT jsonb_build_object('at', COALESCE((s.sale_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi', s.created_at),
             'day_only', s.sale_date IS NOT NULL, 'kind', 'sale',
             'title', 'Sold to ' || COALESCE(c.full_name, '(client)') || ' — sale ' || COALESCE(s.sale_number, '')
                      || ', net ' || public._ut_rs(s.net_amount),
             'detail', concat_ws(' · ',
                         CASE WHEN COALESCE(s.discount_amount, 0) > 0 THEN 'Discount ' || public._ut_rs(s.discount_amount) END,
                         CASE WHEN COALESCE(s.down_payment, 0) > 0 THEN 'Down payment ' || public._ut_rs(s.down_payment) END,
                         CASE WHEN COALESCE(s.installment_count, 0) > 0 THEN s.installment_count || ' instalments' END,
                         CASE WHEN ag.full_name IS NOT NULL THEN 'Agent ' || ag.full_name END,
                         CASE WHEN s.is_transfer THEN 'Transfer sale' END, CASE WHEN s.is_resale THEN 'Resale' END,
                         CASE WHEN s.status = 'cancelled' THEN 'Now cancelled' END),
             'who', public._ut_by(s.created_by::text))
      FROM public.sales s
      LEFT JOIN public.clients c ON c.id = s.client_id
      LEFT JOIN public.agents ag ON ag.id = s.agent_id
     WHERE s.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', (s.cancellation_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi',
             'day_only', true, 'kind', 'sale_x',
             'title', 'Sale ' || COALESCE(s.sale_number, '') || ' cancelled',
             'detail', NULLIF(s.cancellation_reason, ''), 'who', public._ut_by(s.cancelled_by))
      FROM public.sales s WHERE s.unit_id = v_u.id AND s.status = 'cancelled' AND s.cancellation_date IS NOT NULL
    UNION ALL
    -- every receipt voucher against a sale of this unit
    SELECT jsonb_build_object('at', (p.payment_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi',
             'day_only', true, 'kind', CASE WHEN p.status = 'cancelled' THEN 'payment_x' ELSE 'payment' END,
             'title', CASE WHEN p.status = 'cancelled' THEN 'Payment cancelled — ' ELSE 'Payment received — ' END
                      || public._ut_rs(p.amount) || COALESCE(', ' || replace(p.payment_method, '_', ' '), '')
                      || COALESCE(', ' || p.voucher_code, ''),
             'detail', concat_ws(' · ',
                         CASE WHEN p.payment_category IS NOT NULL THEN initcap(replace(p.payment_category, '_', ' ')) END,
                         CASE WHEN p.reference_no IS NOT NULL THEN 'Ref ' || p.reference_no END,
                         CASE WHEN p.bank_name IS NOT NULL THEN p.bank_name END,
                         CASE WHEN p.manual_number IS NOT NULL THEN 'Book no. ' || p.manual_number END,
                         'Sale ' || s.sale_number),
             'who', public._ut_by(p.created_by))
      FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
     WHERE s.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', (x.cancellation_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi',
             'day_only', true, 'kind', 'cancellation',
             'title', 'Unit cancelled — ' || COALESCE(x.cancellation_voucher_no, '') || COALESCE(', ' || replace(x.cancellation_type, '_', ' '), ''),
             'detail', concat_ws(' · ',
                         CASE WHEN x.total_paid IS NOT NULL THEN 'Paid ' || public._ut_rs(x.total_paid) END,
                         CASE WHEN COALESCE(x.total_deductions, 0) > 0 THEN 'Deductions ' || public._ut_rs(x.total_deductions) END,
                         CASE WHEN x.net_refund_amount IS NOT NULL THEN 'Refund ' || public._ut_rs(x.net_refund_amount)
                              || COALESCE(' (' || x.refund_status || ')', '') END,
                         NULLIF(left(COALESCE(x.detailed_reason, x.reason_category, ''), 140), '')),
             'who', public._ut_by(x.initiated_by))
      FROM public.unit_cancellations x WHERE x.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', (t.transfer_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi',
             'day_only', true, 'kind', 'transfer',
             'title', 'Transferred — ' || COALESCE(oc.full_name, 'old client') || ' → ' || COALESCE(nc.full_name, 'new client')
                      || COALESCE(', ' || t.transfer_voucher_no, ''),
             'detail', concat_ws(' · ',
                         CASE WHEN t.new_sale_price IS NOT NULL THEN 'New price ' || public._ut_rs(t.new_sale_price) END,
                         CASE WHEN COALESCE(t.total_transfer_charges, 0) > 0 THEN 'Charges ' || public._ut_rs(t.total_transfer_charges) END,
                         NULLIF(left(COALESCE(t.notes, ''), 140), '')),
             'who', public._ut_by(t.created_by))
      FROM public.unit_transfers t
      LEFT JOIN public.clients oc ON oc.id = t.old_client_id
      LEFT JOIN public.clients nc ON nc.id = t.new_client_id
     WHERE t.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', COALESCE((ps.possession_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi', ps.created_at),
             'day_only', ps.possession_date IS NOT NULL, 'kind', 'possession',
             'title', 'Possession — ' || COALESCE(replace(ps.status, '_', ' '), ''),
             'detail', concat_ws(' · ', CASE WHEN ps.client_name IS NOT NULL THEN 'To ' || ps.client_name END,
                                 CASE WHEN ps.received_by IS NOT NULL THEN 'Received by ' || ps.received_by END),
             'who', public._ut_by(ps.handover_by))
      FROM public.possessions ps WHERE ps.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', COALESCE(n.approved_at, n.requested_at, n.created_at), 'kind', 'noc',
             'title', 'NOC' || COALESCE(' ' || n.noc_type, '') || ' — ' || COALESCE(n.status, '') || COALESCE(', ' || n.noc_number, ''),
             'detail', concat_ws(' · ', NULLIF(n.purpose, ''),
                                 CASE WHEN n.valid_until IS NOT NULL THEN 'Valid until ' || public._ut_day((n.valid_until::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi') END),
             'who', COALESCE(NULLIF(n.approved_by::text, ''), public._ut_by(n.requested_by)))
      FROM public.noc n WHERE n.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', COALESCE((l.filed_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi', l.created_at),
             'day_only', l.filed_date IS NOT NULL, 'kind', 'legal',
             'title', 'Legal case ' || COALESCE(l.case_number, '') || ' — ' || COALESCE(replace(l.stage, '_', ' '), ''),
             'detail', concat_ws(' · ', NULLIF(l.case_type, ''),
                         CASE WHEN l.claim_amount IS NOT NULL THEN 'Claim ' || public._ut_rs(l.claim_amount) END,
                         CASE WHEN l.next_hearing_date IS NOT NULL THEN 'Next hearing ' || public._ut_day((l.next_hearing_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Karachi') END,
                         NULLIF(l.outcome, '')),
             'who', NULLIF(l.lawyer_name, ''))
      FROM public.legal_cases l WHERE l.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', q.created_at, 'kind', 'quote',
             'title', 'Payment plan ' || COALESCE(q.quote_no, '') || ' for ' || COALESCE(q.client_name, '(no name)')
                      || CASE WHEN q.net_price IS NOT NULL THEN ' — net ' || public._ut_rs(q.net_price) ELSE '' END,
             'detail', concat_ws(' · ',
                         CASE WHEN q.down_payment IS NOT NULL THEN 'Down ' || public._ut_rs(q.down_payment) END,
                         CASE WHEN q.monthly_amount IS NOT NULL AND q.months IS NOT NULL THEN public._ut_rs(q.monthly_amount) || ' × ' || q.months || ' months' END,
                         CASE WHEN COALESCE(q.discount, 0) > 0 THEN 'Discount ' || public._ut_rs(q.discount) END),
             'who', (SELECT su.full_name FROM public.sales_users su WHERE su.id = q.sales_user_id))
      FROM public.unit_map_quotes q WHERE q.unit_id = v_u.id
    UNION ALL
    SELECT jsonb_build_object('at', ss.created_at, 'kind', 'submission',
             'title', 'Sale submitted for approval — ' || COALESCE(ss.status, ''),
             'detail', concat_ws(' · ', NULLIF(ss.reject_reason, ''),
                                 CASE WHEN ss.decided_at IS NOT NULL THEN 'Decided ' || public._ut_day(ss.decided_at) END),
             'who', (SELECT su.full_name FROM public.sales_users su WHERE su.id = ss.submitted_by))
      FROM public.sale_submissions ss WHERE ss.unit_id = v_u.id
  ) z;
  v_ev := v_ev || v_x;

  /* the money at a glance, and how much interest the unit has drawn */
  SELECT jsonb_build_object(
           'sale', (SELECT jsonb_build_object('sale_number', s.sale_number, 'client', c.full_name,
                                              'net', s.net_amount,
                                              'paid', COALESCE((SELECT sum(p.amount) FROM public.payments p
                                                                 WHERE p.sale_id = s.id AND COALESCE(p.status, '') <> 'cancelled'), 0))
                      FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
                     WHERE s.unit_id = v_u.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1),
           'link_pending', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(amount), 0))
                              FROM public.link_payment_receipts WHERE unit_id = v_u.id AND status = 'pending'),
           'link_verified', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(amount), 0))
                               FROM public.link_payment_receipts WHERE unit_id = v_u.id AND status = 'verified'))
    INTO v_money;
  SELECT jsonb_build_object(
           'leads', (SELECT count(*) FROM public.leads WHERE unit_id = v_u.id AND deleted_at IS NULL),
           'deals', (SELECT count(*) FROM public.deals WHERE unit_id = v_u.id),
           'quotes', (SELECT count(*) FROM public.unit_map_quotes WHERE unit_id = v_u.id))
    INTO v_interest;

  -- ── red flags ─────────────────────────────────────────────────────────────
  v_res_tok := CASE WHEN v_res.id IS NOT NULL AND v_res.token_received THEN COALESCE(v_res.token_amount, 0) ELSE 0 END;
  v_sold := COALESCE(v_label, '') ~* 'sold' OR COALESCE(v_st.status_name, '') ~* '(sold|pagri)';
  v_temp := v_st.nature = 'temporary';

  IF v_tok <> v_res_tok THEN
    v_chk := v_chk || jsonb_build_object('level', 'red',
      'text', 'Token in the books ' || public._ut_rs(v_tok) || ' ≠ token on the hold ' || public._ut_rs(v_res_tok));
  END IF;
  /* 20261006d: a unit sold in RMS carries its buyer and its money on the sale,
     so the hold-based "no token / no buyer" checks do not apply to it */
  IF jsonb_typeof(v_money->'sale') = 'object' THEN
    NULL;
  ELSIF v_sold AND v_tok = 0 AND v_res_tok = 0 AND (v_res.id IS NULL OR v_res.client_name IS NULL) THEN
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

  /* 20261006d: money recorded on the link and not yet verified */
  IF COALESCE((v_money->'link_pending'->>'count')::int, 0) > 0 THEN
    v_chk := v_chk || jsonb_build_object('level', 'amber',
      'text', (v_money->'link_pending'->>'count') || ' payment(s) recorded on the link wait for verification — '
              || public._ut_rs((v_money->'link_pending'->>'amount')::numeric));
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
    'checks', v_chk,
    'money', v_money, 'interest', v_interest);   -- 20261006d
END
$function$;

COMMIT;
