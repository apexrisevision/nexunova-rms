-- ═══════════════════════════════════════════════════════════════════════════
-- The Monday digest stops going to the Fourteen Group owner's WhatsApp
-- ───────────────────────────────────────────────────────────────────────────
-- cron_weekly_digest_all (pg_cron "radar-weekly-digest", Mondays 04:00 UTC =
-- 09:00 PKT) picks the owner/admin of each active company and, if that row
-- carries a phone, queues the weekly at-risk digest to it.
--
-- The owner confirms nothing ever arrives on 03338028020, and the log agrees:
-- 91 WhatsApp messages, 89 marked "sent", 0 ever delivered, 0 ever read, and
-- not one sent through a Meta-approved template — all free-form text, which
-- Meta accepts and then drops outside the 24-hour customer-service window. The
-- number was only feeding a queue whose output nobody receives. Removed on the
-- owner's instruction.
--
-- Clearing app_users.phone is enough and costs nothing else. The only other
-- readers of this column both fall back to email, which is present:
--   send_admin_reset_otp        — emails the OTP first, WhatsApp was an extra
--   notify_admin_subuser_reset  — emails the admin right after the WhatsApp
-- cron_daily_digest_all reads it too but sits on no cron schedule.
--
-- After this, no real tenant is eligible for the digest: FMH and Awami never
-- had an admin phone either. Only the ZZTEST scratch tenants remain, on dummy
-- numbers. The cron itself is left running — it simply finds nobody.
--
-- Reversible: rms_backup.app_user_phone_20260902 holds the old value.
--   UPDATE public.app_users u SET phone = b.phone_before
--   FROM rms_backup.app_user_phone_20260902 b WHERE b.id = u.id;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS rms_backup;
REVOKE ALL ON SCHEMA rms_backup FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS rms_backup.app_user_phone_20260902;
CREATE TABLE rms_backup.app_user_phone_20260902 AS
SELECT id, company_id, username, full_name, role, phone AS phone_before, email, now() AS snapshot_at
FROM public.app_users
WHERE id = '2931ed6b-8bdf-42c7-8331-2cd095ced813';

UPDATE public.app_users
SET phone = NULL, updated_at = now()
WHERE id = '2931ed6b-8bdf-42c7-8331-2cd095ced813';
