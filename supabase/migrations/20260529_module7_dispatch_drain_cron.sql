-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase F: SEND SWEEP (queue drain)
-- 2026-05-29
-- Counterpart to comms-queue-build (Phase D, which only BUILDS the queue).
-- This drains it: every 2 minutes it pokes the send-message Edge Function,
-- which claim_pending_messages() (queued->sending), dispatches via the
-- active provider adapter (meta|wetarseel|dryrun), then update_message_result().
--
-- Auth note: send-message is deployed with --no-verify-jwt and its handler
-- does NOT inspect the incoming caller's auth (it uses its own injected
-- SUPABASE_SERVICE_ROLE_KEY internally). So we invoke with the PUBLISHABLE
-- (anon) key, which is public by design and safe to inline in cron.job.command
-- — we deliberately do NOT stash the service key here (cron.job is readable).
--
-- Requires pg_net for net.http_post (installed by this migration).
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- (re)schedule the dispatch sweep every 2 minutes
DO $$ BEGIN PERFORM cron.unschedule('comms-dispatch'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('comms-dispatch', '*/2 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG',
      'Authorization', 'Bearer sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG'),
    body := '{}'::jsonb
  );
$cron$);
