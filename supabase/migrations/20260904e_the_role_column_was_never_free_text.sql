-- ═══════════════════════════════════════════════════════════════════════════
-- The role column was never free text
-- ───────────────────────────────────────────────────────────────────────────
-- A correction. 20260903g put this comment on public.app_users.role:
--
--   "Free text by design; no CHECK."
--
-- That is false, and it has been false since long before this module existed.
-- app_users carries app_users_role_check:
--
--   CHECK (role = ANY (ARRAY['owner','admin','manager','recovery','accounts','staff']))
--
-- Two things follow, and both matter to Daily Closing:
--
--   THE ACCOUNTANT IS 'accounts', NOT 'finance'. The front end treats the two
--   as synonyms (js/ui.js:494, js/helpers.js), but only 'accounts' has ever
--   been storable. RULES §0.3 calls the Accountant "finance (legacy alias
--   accounts)" — it is the other way round.
--
--   'cfo' CANNOT BE STORED. RULES §0.3/§0.4 rest on a distinct cfo role, and
--   _dc_is_cfo() is written and tested and correct — but no account can hold
--   the value until this CHECK is widened. Until then the predicate admits only
--   owner and is_super_admin, which is enough for the pilot (Awami's single
--   account is owner) and not enough for §0.9's two real accounts.
--
-- ⚠️ THIS MIGRATION DOES NOT WIDEN THE CHECK. Altering a constraint on an
-- existing RMS table that every tenant's login depends on is not something to
-- slip into a seed-data prompt. The statement that would do it is recorded in
-- RULES §0.9 and needs the owner's word. This file only stops the schema from
-- telling the next reader something untrue.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

COMMENT ON COLUMN public.app_users.role IS
  'Constrained by app_users_role_check to exactly: owner, admin, manager, recovery, accounts, staff. NOT free text — a 20260903g comment claimed otherwise and was wrong. The front end also reads ''finance'' and ''recovery_officer'' as synonyms of ''accounts'' and ''recovery'', but neither synonym is storable. Daily Closing''s ''cfo'' role (RULES §0.4) is NOT yet permitted here; _dc_is_cfo() exists and works, but the CHECK must be widened before a CFO account can be created.';

COMMIT;
