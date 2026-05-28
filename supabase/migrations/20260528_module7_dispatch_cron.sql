-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase D: SCHEDULER (queue build)
-- 2026-05-28
-- cron_enqueue_due_comms_all() scans every ACTIVE company in PKT and
-- populates the queue via enqueue_due_comms. Scheduled nightly→morning
-- so reminders are fresh for same-day sending.
-- NB: this only BUILDS the queue. The SEND dispatch (Edge Function +
-- its own cron) is Phase F and stays inert until creds are provisioned.
-- DB runs UTC; the command prepends `SET search_path = public` because
-- the RPC is SECURITY DEFINER without a pinned search_path on the cron
-- session (mirrors the existing nightly-health / nightly-radar jobs).
-- ================================================================

CREATE OR REPLACE FUNCTION public.cron_enqueue_due_comms_all()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_total int := 0; v_companies int := 0; v_res jsonb;
BEGIN
  FOR rec IN SELECT id FROM companies WHERE status = 'active' LOOP
    v_res := public.enqueue_due_comms(rec.id, v_today);
    v_total := v_total + COALESCE((v_res->>'queued')::int, 0);
    v_companies := v_companies + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'companies_scanned', v_companies,
                            'queued', v_total, 'run_date', v_today);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cron_enqueue_due_comms_all() TO anon, authenticated;

-- (re)schedule the nightly queue-build at 04:00 UTC = 09:00 PKT
DO $$ BEGIN PERFORM cron.unschedule('comms-queue-build'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('comms-queue-build', '0 4 * * *',
  $cron$ SET search_path = public; SELECT public.cron_enqueue_due_comms_all(); $cron$);
