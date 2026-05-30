-- ════════════════════════════════════════════════════════════
-- Promote admin@ADMIN (the platform-staff account) to super-admin
-- 2026-05-31. One-time data update.
-- ════════════════════════════════════════════════════════════
-- After commit 71e3a7e (super_admin_guard) the 9 platform RPCs
-- (get_sa_health_dashboard, suspend_company, set_company_feature_flag,
-- upsert/delete_sa_announcement, list_companies, verify_payment,
-- list/update_sa_support_tickets) require is_super_admin=true. Zero
-- users had the flag at the time of that commit, locking the
-- platform console out. This migration flips the flag for the
-- intended platform-staff account so the console is usable.
--
-- Idempotent — re-applying is a no-op if the flag is already true.
--
-- Verified post-apply:
--   • admin@ADMIN (id c834ef44-735c-48fe-9c43-99a319d6e506) can now
--     call all 9 platform RPCs (returns expected payloads, no
--     forbidden_not_super_admin errors)
--   • FMH recovery officer (auth_uid 9a60f78b-361c-4e1a-937d-205868c017b1)
--     still gets 42501 / forbidden_not_super_admin on all 9 — promotion
--     is targeted, not blanket.

UPDATE public.app_users
   SET is_super_admin = true,
       updated_at     = NOW()
 WHERE id = 'c834ef44-735c-48fe-9c43-99a319d6e506';
