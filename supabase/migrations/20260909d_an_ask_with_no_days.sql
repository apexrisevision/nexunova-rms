-- ═══════════════════════════════════════════════════════════════════════════
-- AN ASK FOR SOMETHING PERMANENT HAS NO NUMBER OF DAYS.
--
-- availability_requests.days was NOT NULL, from a time when every request was
-- "hold this for me for a while". A dealer asking for Sold is not asking for
-- a while, so submit_availability_request drops the number — and the insert
-- then failed on the constraint. Caught by the test that asserts the days are
-- dropped, before anybody met it.
--
-- The same answer as reservations.expiry_date, for the same reason: the honest
-- representation of "there is no duration" is no duration, not a zero that
-- every later reader has to remember to treat as special.
--
-- Nothing existing is affected — every row written until now has a number, and
-- the only writer that can produce NULL is the permanent branch added today.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.availability_requests ALTER COLUMN days DROP NOT NULL;

COMMENT ON COLUMN public.availability_requests.days IS
  'How long the dealer asked for. NULL when the ask is for a permanent status, which has no duration at all.';

COMMIT;
