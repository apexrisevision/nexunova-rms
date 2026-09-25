-- ═══════════════════════════════════════════════════════════════════════════
-- Put back the holds the hourly sweep opened on Awami  (2026-09-25)
--
-- Rashid: "jo units auto available howay hain unhe wapis pehle walay status
-- pe change karo agar wo still available hain to" -- and the two Pagri units
-- back to Pagri.
--
-- MUST RUN AFTER 20260925a. Before it, the sweep would open these again at
-- the next :13.
--
-- Which units: every Awami unit the sweep (cron_expire_reservations, which
-- runs at exactly :13:00) moved to Available, and ONLY if, at the moment this
-- runs, the unit is
--   · still on an Available status and free by _map_unit_state,
--   · holding no active reservation,
--   · untouched since: no later status change in audit_logs,
--   · and its lapsed hold row is the sweep's (status expired, never cancelled).
-- LG-19 fails the third test on purpose: somebody released it by hand at the
-- desk on 17 Sep after the sweep, and a person's decision is not undone here.
--
-- What "back" means: the lapsed hold row is made active again -- same person,
-- same agent, same date it was taken -- and the unit goes back to the status
-- it had the moment before the sweep (read from audit_logs, not guessed).
--   · Pagri (FF-89 Siraj, GF-176 Raza Ullah): the hold takes the Pagri tag
--     and no expiry, as a Pagri hold always should have.
--   · V.Hold / Reserved: the ORIGINAL expiry is kept. It is already past, so
--     each one lands in the Directors' Room as "time over" for Release or
--     Extend -- the directors decide, not this script.
-- Every unit this touches is listed in the NOTICE output and in audit_logs.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_pr   constant uuid := '59ded55b-9bc2-45b2-a372-49fc31807fa9';
  v_row  record;
  v_res  uuid;
  v_nat  text;
  v_n    int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pr AND holds_need_decision) THEN
    RAISE EXCEPTION '20260925a is not applied: the sweep would reopen these units';
  END IF;

  FOR v_row IN
    WITH ev AS (
      SELECT DISTINCT ON (a.record_id)
             a.record_id::uuid AS unit_id, a.changed_at,
             (a.old_data->>'status_id')::uuid AS was_status
        FROM public.audit_logs a
       WHERE a.table_name = 'units'
         AND 'status_id' = ANY(a.changed_fields)
         AND extract(minute FROM a.changed_at AT TIME ZONE 'UTC') = 13
         AND extract(second FROM a.changed_at)::int = 0
         AND (SELECT cs.is_available FROM public.category_unit_statuses cs
               WHERE cs.id = (a.new_data->>'status_id')::uuid)
       ORDER BY a.record_id, a.changed_at DESC)
    SELECT u.id AS unit_id, u.unit_no, ev.changed_at, ev.was_status
      FROM ev
      JOIN public.units u ON u.id = ev.unit_id
      JOIN public.category_unit_statuses cs ON cs.id = u.status_id
     WHERE u.project_id = v_pr
       AND cs.is_available
       AND public._map_unit_state(u.id) = 'available'
       AND NOT EXISTS (SELECT 1 FROM public.reservations x
                        WHERE x.unit_id = u.id AND x.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM public.audit_logs a2
                        WHERE a2.table_name = 'units'
                          AND a2.record_id::text = u.id::text
                          AND 'status_id' = ANY(a2.changed_fields)
                          AND a2.changed_at > ev.changed_at)
     ORDER BY u.unit_no
  LOOP
    SELECT r.id INTO v_res
      FROM public.reservations r
     WHERE r.unit_id = v_row.unit_id
       AND r.status = 'expired' AND r.cancelled_at IS NULL
     ORDER BY r.updated_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_res IS NULL THEN
      RAISE NOTICE 'skip %: no lapsed hold row to restore', v_row.unit_no;
      CONTINUE;
    END IF;

    SELECT nature INTO v_nat FROM public.category_unit_statuses WHERE id = v_row.was_status;

    UPDATE public.reservations
       SET status = 'active',
           unit_status_id = v_row.was_status,
           expiry_date = CASE WHEN v_nat = 'permanent' THEN NULL ELSE expiry_date END,
           updated_at = now()
     WHERE id = v_res;

    UPDATE public.units SET status_id = v_row.was_status, updated_at = now()
     WHERE id = v_row.unit_id AND project_id = v_pr;

    v_n := v_n + 1;
    RAISE NOTICE 'restored % to % (was opened by the sweep at %)',
      v_row.unit_no,
      (SELECT status_name FROM public.category_unit_statuses WHERE id = v_row.was_status),
      v_row.changed_at;
  END LOOP;

  RAISE NOTICE '% unit(s) restored', v_n;
END $$;
