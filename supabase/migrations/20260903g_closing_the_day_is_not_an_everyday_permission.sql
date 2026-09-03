-- ═══════════════════════════════════════════════════════════════════════════
-- Closing the day is not an everyday permission
-- ───────────────────────────────────────────────────────────────────────────
-- The Daily Closing module needs a CFO, and RMS has no such role. The obvious
-- move was to call `admin` the CFO. Counting the live accounts says not to:
--
--   Awami Market (the pilot)   1 active user   role owner   no admin at all
--   Fourteen Group             2 active users  1 owner      no admin
--   FMH                        3 active users  1 owner      1 admin — and that
--                              admin is "Filling Staff", a data-entry account
--
-- By headcount `admin` is narrow. By meaning it is not: it is the role somebody
-- gets so they can add a client or record a payment, and _rms_is_admin() then
-- folds is_super_admin, owner, admin and the company's own owner_user_id into
-- one privilege with no gradation. Mapping CFO onto that would make "may close
-- the day and export to QuickBooks" the same permission as "may add a client".
--
-- So: a distinct role. This file is the SQL half — one predicate that the P2
-- service RPCs will call. The other half is the five front-end registration
-- sites listed in docs/daily-closing/ARCHITECTURE_NOTES.md §3.4, which belong
-- to the UI prompt, not this one.
--
-- No accounts are created here. The CFO and the site cashier are made from
-- Users & Roles once this predicate exists (docs/daily-closing/RULES.md §0.9);
-- credentials for a live tenant are not invented in a migration.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── _dc_is_cfo ─────────────────────────────────────────────────────────────
-- The gate for: setup opening · close day · post adjustment · approve/reject
-- allocation · export to QuickBooks · clear/bounce a PDC.
--
-- Note what is ABSENT, deliberately: role = 'admin'. This is not
-- _rms_is_admin() with one more name added — it is a narrower set that happens
-- to overlap. owner and is_super_admin are kept as the account of last resort,
-- because a company whose CFO has left must still be able to close its books.
CREATE OR REPLACE FUNCTION public._dc_is_cfo(p_user public.app_users)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(p_user.is_super_admin, false)
      OR p_user.role IN ('cfo', 'owner')
      OR EXISTS (SELECT 1 FROM public.companies c
                  WHERE c.id = p_user.company_id
                    AND c.owner_user_id = p_user.id);
$fn$;

COMMENT ON FUNCTION public._dc_is_cfo(public.app_users) IS
  'Daily Closing CFO privilege: setup opening, close day, adjustments, allocation decisions, QuickBooks export, PDC clear/bounce. Deliberately EXCLUDES role = ''admin'', which in this database is the everyday data-entry role — see docs/daily-closing/RULES.md §0.4. Not a superset of _rms_is_admin().';

-- A helper is not an endpoint. The default-privileges rule on this database
-- grants EXECUTE to authenticated on every new function, so it is taken back
-- explicitly — the same treatment _rms_insert_simple_payment gets.
REVOKE ALL ON FUNCTION public._dc_is_cfo(public.app_users) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_is_cfo(public.app_users) TO service_role;

-- ── Why there is no CHECK constraint on app_users.role ─────────────────────
-- app_users.role is text NOT NULL with no CHECK, and the live values are
-- owner / admin / recovery. Adding a CHECK now would be a schema change to a
-- table this module has no business tightening, and it would fail the moment
-- some tenant carries a role string nobody remembers. The gate is the
-- predicate above; the role vocabulary stays where it already lives — in code.
COMMENT ON COLUMN public.app_users.role IS
  'Free text by design; no CHECK. Canonical values: owner, admin, recovery (alias recovery_officer), finance (alias accounts), manager, staff, and — from 2026-09-03 — cfo, which gates the Daily Closing officer actions via _dc_is_cfo().';

COMMIT;
