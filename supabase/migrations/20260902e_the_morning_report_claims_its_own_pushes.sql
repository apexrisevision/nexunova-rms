-- ═══════════════════════════════════════════════════════════════════════════
-- The morning report claims its own pushes
-- ───────────────────────────────────────────────────────────────────────────
-- The report is produced in NexuAttend at 10:45. This is the RMS half: who
-- should be told, on which device, and the guarantee that they are told once.
--
-- CLAIMED, not listed. The date is stamped on the row inside the same statement
-- that returns it, so a second run — a retry, a manual poke, two cron ticks
-- overlapping — returns nobody. A notification that arrives twice teaches
-- people to ignore the one that matters, and this is the notification that is
-- supposed to matter.
--
-- Only people who may see the report at all (attend_daily_report, off by
-- default — see 20260902d) and who actually have a device registered. Somebody
-- who never allowed notifications is not an error and is not chased; they read
-- it on the page like before.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS attend_report_pushed_on date;

COMMENT ON COLUMN public.sales_users.attend_report_pushed_on IS
  'The day this user was last pushed the attendance report. The claim marker that makes the 10:45 notification arrive exactly once.';

CREATE OR REPLACE FUNCTION public.claim_daily_report_pushes(p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := COALESCE(p_today, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_out   jsonb;
BEGIN
  WITH claimed AS (
    UPDATE public.sales_users su
       SET attend_report_pushed_on = v_today
     WHERE su.attend_daily_report
       AND COALESCE(su.status, 'active') = 'active'
       AND su.is_active IS TRUE
       AND su.attend_report_pushed_on IS DISTINCT FROM v_today
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.sales_user_id = su.id)
    RETURNING su.id, su.full_name, COALESCE(su.attend_project_id, su.home_project_id) AS project_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sales_user_id',      c.id,
           'name',               c.full_name,
           'attend_company_id',  al.attend_company_id,
           'attend_company_name',al.attend_company_name,
           'subs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                             'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
                      FROM public.push_subscriptions ps WHERE ps.sales_user_id = c.id)
         )), '[]'::jsonb)
    INTO v_out
    FROM claimed c
    JOIN public.attendance_link al ON al.project_id = c.project_id AND al.is_enabled;

  RETURN jsonb_build_object('success', true, 'today', v_today, 'targets', v_out);
END;
$function$;

COMMENT ON FUNCTION public.claim_daily_report_pushes(date) IS
  'Claims today''s attendance-report notification for every permitted portal user with a device, marking them in the same statement so nobody is pushed twice.';

REVOKE ALL ON FUNCTION public.claim_daily_report_pushes(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_pushes(date) TO service_role;

-- Scheduled outside this file because cron.schedule is not idempotent DDL.
-- 05:47 UTC is 10:47 in Karachi — two minutes after NexuAttend produces the
-- report at 10:45, so the notification never races the thing it announces.
-- The publishable key is what goes in the command, deliberately: the function
-- is deployed --no-verify-jwt and uses its own service role inside, and a
-- service key must never sit in a readable cron.job row.
--
--   select cron.schedule('daily-report-push', '47 5 * * *', $$
--     SELECT net.http_post(
--       url := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/daily-report-push',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'apikey', 'sb_publishable_…',
--         'Authorization', 'Bearer sb_publishable_…'),
--       body := '{}'::jsonb);
--   $$);
--
-- DEPLOY DEPS: supabase/functions/daily-report-push (deploy --no-verify-jwt),
-- and NexuAttend's portal_daily_report / portal_daily_sheet (docs/20260902d–g).
