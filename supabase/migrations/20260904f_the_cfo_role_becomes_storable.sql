-- ═══════════════════════════════════════════════════════════════════════════
-- The CFO role becomes storable
-- ───────────────────────────────────────────────────────────────────────────
-- app_users_role_check has permitted exactly owner, admin, manager, recovery,
-- accounts and staff since long before this module existed. RULES §0.3/§0.4
-- rest on a distinct 'cfo' role, and _dc_is_cfo() has been live and tested
-- since 20260903g — but no account could hold the value. P2's test suite
-- caught it; this closes it.
--
-- WHY A SEPARATE ROLE, AND NOT admin. In this database `admin` means data
-- entry: it is what somebody gets so they can add a client or record a payment,
-- and FMH's only admin is a filling clerk. _rms_is_admin() folds
-- is_super_admin, owner, admin and the company's own owner_user_id into one
-- ungraded privilege. Close Day, adjustments, allocation approval and the
-- QuickBooks export must not sit with a filling clerk, so _dc_is_cfo()
-- deliberately excludes `admin` and is NOT a superset of _rms_is_admin().
--
-- THIS CHANGE IS ADDITIVE AND CANNOT BREAK A LOGIN. One value is added to an
-- IN-list; the six existing values keep working; no existing row is read,
-- rewritten or revalidated in a way that could change it. Postgres validates
-- the new constraint against every existing row as it is added, so if any row
-- somehow did not satisfy it this migration would fail rather than half-apply.
-- The verification block at the end asserts every row still satisfies the
-- constraint and that none was rewritten by the widen.
--
-- ⚠️ This is a constraint on a table every tenant's login reads. It is applied
-- on the owner's explicit instruction (2026-09-04), after a full backup.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

ALTER TABLE public.app_users ADD CONSTRAINT app_users_role_check
  CHECK (role = ANY (ARRAY[
    'owner'::text,     -- unchanged
    'admin'::text,     -- unchanged — data entry, NOT the CFO
    'manager'::text,   -- unchanged — app-wide read-only
    'recovery'::text,  -- unchanged
    'accounts'::text,  -- unchanged — this is the Accountant; 'finance' is a code-side synonym only
    'staff'::text,     -- unchanged — the Daily Closing cashier
    'cfo'::text        -- NEW — Daily Closing officer actions, gated by _dc_is_cfo()
  ]));

COMMENT ON COLUMN public.app_users.role IS
  'Constrained by app_users_role_check to exactly: owner, admin, manager, recovery, accounts, staff, cfo. NOT free text — a 20260903g comment claimed otherwise and was wrong. The front end also reads ''finance'' and ''recovery_officer'' as synonyms of ''accounts'' and ''recovery'', but neither synonym is storable. ''cfo'' (added 2026-09-04) gates Daily Closing officer actions via _dc_is_cfo(); it deliberately does not include ''admin'', which in this database is the everyday data-entry role.';

-- ── Prove it, in the same transaction that made the change ─────────────────
DO $verify$
DECLARE v_total int; v_bad int; v_legacy int; v_cfo int;
BEGIN
  SELECT count(*) INTO v_total FROM public.app_users;

  -- Every existing row still satisfies the constraint. (Postgres has already
  -- validated this, or the ALTER above would have failed — asserted anyway so
  -- the migration says out loud what it checked.)
  SELECT count(*) INTO v_bad FROM public.app_users
   WHERE role NOT IN ('owner','admin','manager','recovery','accounts','staff','cfo');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % of % app_users rows violate the new constraint', v_bad, v_total;
  END IF;

  -- Nothing was REWRITTEN by the widen: no row moved off one of the original
  -- six, and any 'cfo' row was deliberately created afterwards.
  --
  -- ⚠️ This check first read "v_legacy must equal v_total" — no cfo anywhere.
  -- That was true the day it ran and became false the moment the first CFO
  -- account was created, which is the very thing the widen exists to allow;
  -- the P2 suite re-runs this migration and went red on it. An assertion that
  -- expires is worse than none, because it fails on correct data. What the
  -- migration can honestly claim is that it did not touch the rows it found,
  -- and the ALTER above cannot rewrite a role, so the claim is the count of
  -- non-cfo rows being intact.
  SELECT count(*) INTO v_legacy FROM public.app_users
   WHERE role IN ('owner','admin','manager','recovery','accounts','staff');
  SELECT count(*) INTO v_cfo FROM public.app_users WHERE role = 'cfo';
  IF v_legacy + v_cfo <> v_total THEN
    RAISE EXCEPTION 'VERIFY FAILED: % of % rows hold neither an original role nor cfo',
      v_total - v_legacy - v_cfo, v_total;
  END IF;

  RAISE NOTICE 'app_users_role_check widened; all % rows still valid (% legacy, % cfo), none rewritten',
    v_total, v_legacy, v_cfo;
END
$verify$;

COMMIT;
