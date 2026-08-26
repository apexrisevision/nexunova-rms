-- ============================================================================
-- One person, written down once: the link from a portal/desktop login to the
-- employee they actually are.
-- ----------------------------------------------------------------------------
-- Today the portal finds somebody's attendance file by CNIC. That works right
-- up until a digit moves. It did, this week: Iqra's number was 17031-3400733-2
-- on one side and 17301-3400733-2 on the other, and correcting one side broke
-- the link until the other was corrected too. Names cannot rescue it either -
-- the same people are written differently in the two systems ("Alyan ali shah"
-- / "Alyan Khan", "Naseer khan" / "Naseer Afridi", "Fawad khan" /
-- "Fawad ahmad").
--
-- So the link stops being a coincidence between two strings and becomes a
-- stated fact: attend_employee_id names the row in the attendance register that
-- IS this person. CNIC keeps its job - it is how a human finds the candidate to
-- link - but it stops being the key the software joins on.
--
-- Deliberately NOT a foreign key: the employee register lives in a different
-- Postgres instance (NexuAttend), so this is a recorded identifier, not a
-- constraint. attend_linked_at says when a person decided it, which is the
-- difference between "verified" and "matched by a script".
--
-- app_users gets the same pair. A recovery officer on the desktop and a rep on
-- the phone are both employees; the register does not care which door they use.
--
-- Nothing reads these columns yet. The bridge still resolves by CNIC until the
-- backfill is checked, and this migration changes no behaviour on its own.
-- ============================================================================

ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS attend_employee_id uuid,
  ADD COLUMN IF NOT EXISTS attend_linked_at   timestamptz;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS attend_employee_id uuid,
  ADD COLUMN IF NOT EXISTS attend_linked_at   timestamptz;

COMMENT ON COLUMN public.sales_users.attend_employee_id IS
  'NexuAttend employees.id for this person. Cross-database, so no FK. The link the bridge should trust; cnic is only how a human finds the candidate.';
COMMENT ON COLUMN public.sales_users.attend_linked_at IS
  'When the link was made. NULL means never linked.';
COMMENT ON COLUMN public.app_users.attend_employee_id IS
  'NexuAttend employees.id for this person. Cross-database, so no FK.';
COMMENT ON COLUMN public.app_users.attend_linked_at IS
  'When the link was made. NULL means never linked.';

-- "Who is not linked yet?" is the question HR will ask most, and it is the one
-- the link screen opens with.
CREATE INDEX IF NOT EXISTS idx_sales_users_attend_employee
  ON public.sales_users (attend_employee_id) WHERE attend_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_attend_employee
  ON public.app_users (attend_employee_id) WHERE attend_employee_id IS NOT NULL;

-- A person is one row on each side. Two portal logins pointing at one employee
-- is the mistake this catches - it is exactly what the ZZTEST account was while
-- it carried Iqra's CNIC, and nothing would have complained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_users_attend_employee
  ON public.sales_users (attend_employee_id) WHERE attend_employee_id IS NOT NULL;
