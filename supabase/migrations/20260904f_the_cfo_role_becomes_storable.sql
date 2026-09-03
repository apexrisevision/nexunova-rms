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
-- The verification block at the end asserts all 15 rows still pass and that
-- every one of them still holds one of the original six values.
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
DECLARE v_total int; v_bad int; v_legacy int;
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

  -- And every one of them still holds one of the ORIGINAL six — nothing was
  -- rewritten, and no row has quietly become a cfo.
  SELECT count(*) INTO v_legacy FROM public.app_users
   WHERE role IN ('owner','admin','manager','recovery','accounts','staff');
  IF v_legacy <> v_total THEN
    RAISE EXCEPTION 'VERIFY FAILED: % of % rows no longer hold an original role value', v_total - v_legacy, v_total;
  END IF;

  RAISE NOTICE 'app_users_role_check widened; all % rows still valid, none rewritten', v_total;
END
$verify$;

COMMIT;
