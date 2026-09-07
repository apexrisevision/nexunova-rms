-- ════════════════════════════════════════════════════════════════════════
-- INVARIANT 9 — a drawer cannot pay out money it does not hold
-- ────────────────────────────────────────────────────────────────────────
-- Written after the pilot's first real day closed with a negative drawer:
-- opening zero, one 100,000 expense out, counted 5,000, closing (100,000).
-- Nothing was broken — there was no rule to violate. See RULES.md invariant 9
-- and the closing note in PHASES.md.
--
-- CASH ONLY. Bank may go negative; overdrafts are real and a bank account is
-- somebody else's promise. A drawer is notes in a box and cannot hold minus.
--
-- ENFORCED IN TWO LAYERS ON PURPOSE (SR-12). The trigger is the floor: a direct
-- insert cannot bypass it and neither can a future caller that forgets. The RPC
-- adds the §A9 message so a person sees it under the amount rather than as a
-- database error. One rule, deliberately written twice, and the tests prove
-- both fire.
--
-- THE OVERRIDE. A CFO may record a cash-negative entry by writing a reason;
-- nobody else may at all. Ordering makes this necessary — a payment entered
-- before the receipt that funds it would otherwise block a sound day — and the
-- owner's reasoning is recorded in RULES.md: a hard block teaches people to
-- fake entry times, which is worse than the thing prevented. The reason is
-- stored on the row and carried to the ledger, the audit and the Director's
-- sheet, because an override that is allowed but invisible is worse than none.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · where the reason lives ──────────────────────────────────────────
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS insufficient_cash_reason text;

ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS cash_entries_insufficient_cash_reason_check;
ALTER TABLE public.cash_entries
  ADD CONSTRAINT cash_entries_insufficient_cash_reason_check
  CHECK (insufficient_cash_reason IS NULL OR length(insufficient_cash_reason) <= 300);

COMMENT ON COLUMN public.cash_entries.insufficient_cash_reason IS
  'Why a CFO allowed this entry to take the cash position below zero (invariant 9). NULL on every ordinary entry. Immutable with the rest of the row.';

-- ── 2 · the position, in one place ──────────────────────────────────────
-- opening + in − out over every entry in the day. Voids and their reversals
-- both count and net to zero, which is correct: a voided payment did not leave
-- the drawer.
CREATE OR REPLACE FUNCTION public._dc_cash_position(p_cash_day_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(d.opening_cash, 0) + COALESCE(t.in_cash, 0) - COALESCE(t.out_cash, 0)
    FROM public.cash_days d
    LEFT JOIN LATERAL public._dc_day_totals(d.id) t ON true
   WHERE d.id = p_cash_day_id;
$fn$;

COMMENT ON FUNCTION public._dc_cash_position(uuid) IS
  'The cash a project holds on a day: opening + in - out. Invariant 9 refuses any CASH/OUT entry that would take it below zero.';

-- ── 3 · the floor ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cash_entries_cash_floor()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_pos  numeric;
  v_me   public.app_users;
BEGIN
  -- Only a cash payment can empty a drawer. Bank is exempt by design; a JV and
  -- an adjustment carry no mode or direction and move no cash.
  IF NEW.mode IS DISTINCT FROM 'CASH' OR NEW.direction IS DISTINCT FROM 'OUT' THEN
    RETURN NEW;
  END IF;

  -- The position BEFORE this row. It is not in the table yet, so subtract it.
  v_pos := public._dc_cash_position(NEW.cash_day_id) - NEW.amount;
  IF v_pos >= 0 THEN
    RETURN NEW;
  END IF;

  -- Below zero. Only a CFO, and only with a reason.
  IF NEW.insufficient_cash_reason IS NULL
     OR btrim(NEW.insufficient_cash_reason) = '' THEN
    RAISE EXCEPTION
      'INSUFFICIENT_CASH: this would leave the drawer at %, and a drawer cannot pay out money it does not hold (invariant 9).',
      to_char(v_pos, 'FM999,999,999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  v_me := public._rms_caller();
  IF v_me.id IS NULL OR NOT public._dc_is_cfo(v_me) THEN
    -- A non-CFO supplying a reason is refused exactly as if none were given.
    -- Otherwise the override is a text box anybody can type in.
    RAISE EXCEPTION
      'INSUFFICIENT_CASH: only the CFO may record an entry that takes the drawer below zero (invariant 9).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS _trg_cash_entries_cash_floor ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_cash_floor
  BEFORE INSERT ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.cash_entries_cash_floor();

-- ── 4 · opening a day out of order ──────────────────────────────────────
-- The ledger reads forward. A day appearing BEHIND one that is already closed
-- leaves a hole nobody notices: on 2026-09-05 the pilot closed 06 Sep and then
-- opened 03 Sep, so 03 Sep's closing of (100,000) carried nowhere and the book
-- has a discontinuity that no invariant catches, because invariant 2 only says
-- "the previous CLOSED day's closing" and 03 Sep had none before it.
CREATE OR REPLACE FUNCTION public._dc_day_out_of_order(p_project_id uuid, p_business_date date)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT MAX(d.business_date)
    FROM public.cash_days d
   WHERE d.project_id = p_project_id
     AND d.status = 'CLOSED'
     AND d.business_date > p_business_date;
$fn$;

COMMENT ON FUNCTION public._dc_day_out_of_order(uuid, date) IS
  'The latest CLOSED day that sits AFTER the date being opened, or NULL. open_cash_day refuses when this is not null: a day may not appear behind one already closed.';

-- ── 5 · the helpers are not public ──────────────────────────────────────
-- Caught by verify-daily-closing-security.js, which enumerates every helper
-- reachable by anon. Both of these were created without a REVOKE and so
-- inherited EXECUTE from PUBLIC — the same hole the module closed once before
-- and which is invisible unless something goes looking. _dc_cash_position in
-- particular would let an unauthenticated caller probe a project's drawer by
-- guessing cash_day ids.
-- No grant to authenticated either. These are internal helpers: every caller
-- that needs them is SECURITY DEFINER and runs as the owner, so nothing is
-- lost — and a signed-in user should not be able to probe a drawer by calling
-- the position function directly with guessed cash_day ids.
REVOKE ALL ON FUNCTION public._dc_cash_position(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dc_day_out_of_order(uuid, date) FROM PUBLIC, anon, authenticated;
