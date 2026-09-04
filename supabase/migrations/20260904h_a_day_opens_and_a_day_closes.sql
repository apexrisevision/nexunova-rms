-- ═══════════════════════════════════════════════════════════════════════════
-- A day opens, and a day closes
-- ───────────────────────────────────────────────────────────────────────────
-- P3: the CashDay state machine of BLUEPRINT §A4 — SetupOpening, OpenDay,
-- DaySummary, CloseDay, PostAdjustment. Nothing about recording an entry; that
-- is P4, deliberately a separate prompt because its idempotency, seq_no locking
-- and transfer atomicity need a review of their own.
--
--   (none) ──SetupOpening──▶ a CLOSED day carrying the starting balances
--          ──OpenDay───────▶ OPEN ──CloseDay──▶ CLOSED  (terminal)
--                                        │
--                                  PostAdjustment  (CFO · reason · new row)
--
-- WHERE THE "DOMAIN LAYER" WENT. §A3 asks for pure rules with no I/O beneath a
-- service layer. RMS has no application tier — Postgres IS the server
-- (ARCHITECTURE_NOTES §1) — so the split is expressed the only way it can be
-- here: a handful of IMMUTABLE functions that compute and touch nothing, and
-- SECURITY DEFINER RPCs that do the I/O and own the transaction. The pure ones
-- are testable on their own and are reused by P4.
--
-- THE CLOCK IS INJECTED. _dc_today() reads Asia/Karachi, never CURRENT_DATE,
-- which is UTC on this platform and would file the first five hours of every
-- night under the previous business date (RULES risk 2). Tests override it with
-- a transaction-local `dc.today`, the same seam pattern as rms.audit_reason and
-- dc.revenue_recognition. That setting is reachable only by something holding a
-- direct SQL connection — PostgREST exposes RPCs, not set_config — so it is a
-- test seam, not a back door.
--
-- ⚠️ ONE DEVIATION FROM THE P3 BRIEF, taken deliberately, explained in full at
-- PostAdjustment below: a cash- or bank-affecting adjustment is NOT written
-- with voucher_type='JV'. §A6 and the shipped CHECK both say mode/direction are
-- NULL only for a JV, so a JV that moves cash cannot exist. It is written with
-- its derived movement type (CRV/CPV/BRV/BPV), is_adjustment=true, and a
-- JV-{YYYY}-{seq} voucher number. Pure reclassifications are true JVs.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOMAIN — pure. No reads, no writes, no clock. IMMUTABLE so Postgres may fold
-- them into expressions and so a test can assert the rule without a fixture.
-- ═══════════════════════════════════════════════════════════════════════════

-- §A12: the voucher type is DERIVED from mode + direction. One definition,
-- used by CloseDay's adjustments here and by RecordEntry in P4, so the screen,
-- the service and the CHECK constraint can never disagree.
CREATE OR REPLACE FUNCTION public._dc_voucher_for(p_mode text, p_direction text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_mode = 'CASH' AND p_direction = 'IN'  THEN 'CRV'
    WHEN p_mode = 'CASH' AND p_direction = 'OUT' THEN 'CPV'
    WHEN p_mode = 'BANK' AND p_direction = 'IN'  THEN 'BRV'
    WHEN p_mode = 'BANK' AND p_direction = 'OUT' THEN 'BPV'
    ELSE NULL
  END;
$fn$;

-- §A7: variance is what the drawer holds minus what the book says it should.
-- Negative means short. Trivial arithmetic, but it is the rule the whole close
-- turns on, so it has a name and a test.
CREATE OR REPLACE FUNCTION public._dc_variance(p_counted numeric, p_closing numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $fn$
  SELECT round(COALESCE(p_counted, 0) - COALESCE(p_closing, 0), 2);
$fn$;

-- §A7: adjustments auto-number JV-{YYYY}-{seq}.
CREATE OR REPLACE FUNCTION public._dc_jv_number(p_year integer, p_seq integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'JV-' || p_year::text || '-' || lpad(p_seq::text, 4, '0');
$fn$;

-- §A4 guards, as predicates rather than as scattered IF statements.
CREATE OR REPLACE FUNCTION public._dc_may_close(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$ SELECT p_status = 'OPEN'; $fn$;

CREATE OR REPLACE FUNCTION public._dc_may_adjust(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$ SELECT p_status = 'CLOSED'; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE CLOCK — the one impure primitive, isolated so everything else is testable
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._dc_today()
RETURNS date LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('dc.today', true), '')::date,
    (now() AT TIME ZONE 'Asia/Karachi')::date
  );
$fn$;

COMMENT ON FUNCTION public._dc_today() IS
  'Today in Asia/Karachi. Never CURRENT_DATE, which is UTC here and would file the first five hours of every night under the previous business date. Tests override with a transaction-local dc.today.';

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_dc_voucher_for(text, text)', '_dc_variance(numeric, numeric)',
    '_dc_jv_number(integer, integer)', '_dc_may_close(text)',
    '_dc_may_adjust(text)', '_dc_today()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END
$grants$;

-- ═══════════════════════════════════════════════════════════════════════════
-- READ — DaySummary (§A4). Computed live from the entries, never stored.
-- ═══════════════════════════════════════════════════════════════════════════
-- JV rows carry mode NULL and are excluded: a reclassification moves an amount
-- between QuickBooks heads, it does not move cash. Voids need no special case —
-- a void is a reversing ENTRY with the opposite direction, so it nets itself
-- out of these sums (invariant 1: the original row is never touched).
CREATE OR REPLACE FUNCTION public._dc_day_totals(p_cash_day_id uuid)
RETURNS TABLE (in_cash numeric, out_cash numeric, in_bank numeric, out_bank numeric, entries integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH' AND direction = 'IN'),  0)::numeric(18,2),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH' AND direction = 'OUT'), 0)::numeric(18,2),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'BANK' AND direction = 'IN'),  0)::numeric(18,2),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'BANK' AND direction = 'OUT'), 0)::numeric(18,2),
    COUNT(*)::integer
  FROM public.cash_entries
  WHERE cash_day_id = p_cash_day_id;
$fn$;

REVOKE ALL ON FUNCTION public._dc_day_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_day_totals(uuid) TO service_role;

-- Caller gate shared by every RPC below: right tenant, and either an officer or
-- an active assignment to this project (invariant 8).
CREATE OR REPLACE FUNCTION public._dc_may_touch_project(
  p_user public.app_users, p_company_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT p_user.id IS NOT NULL
     AND (COALESCE(p_user.is_super_admin,false) OR p_user.company_id = p_company_id)
     AND (public._rms_is_admin(p_user) OR public._dc_is_cfo(p_user)
          OR EXISTS (SELECT 1 FROM public.user_project_assignments a
                      WHERE a.user_id = p_user.id AND a.company_id = p_company_id
                        AND a.project_id = p_project_id AND a.is_active));
$fn$;

REVOKE ALL ON FUNCTION public._dc_may_touch_project(public.app_users, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_may_touch_project(public.app_users, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_cash_day_summary(
  p_company_id uuid, p_project_id uuid, p_business_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_t record; v_date date;
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_date := COALESCE(p_business_date, public._dc_today());
  SELECT * INTO v_day FROM public.cash_days
   WHERE project_id = p_project_id AND business_date = v_date;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'exists', false,
                              'business_date', v_date, 'status', NULL);
  END IF;

  SELECT * INTO v_t FROM public._dc_day_totals(v_day.id);

  RETURN jsonb_build_object(
    'success', true, 'exists', true,
    'cash_day_id', v_day.id, 'business_date', v_day.business_date,
    'status', v_day.status, 'version', v_day.version,
    'is_setup_opening', v_day.is_setup_opening,
    'opening_cash', v_day.opening_cash, 'opening_bank', v_day.opening_bank,
    'in_cash',  v_t.in_cash,  'out_cash', v_t.out_cash,
    'in_bank',  v_t.in_bank,  'out_bank', v_t.out_bank,
    -- Live for an OPEN day; for a CLOSED day the stored figure is the record of
    -- what was locked, and the two must agree (asserted in the test suite).
    'closing_cash', CASE WHEN v_day.status = 'CLOSED' THEN v_day.closing_cash
                         ELSE v_day.opening_cash + v_t.in_cash - v_t.out_cash END,
    'closing_bank', CASE WHEN v_day.status = 'CLOSED' THEN v_day.closing_bank
                         ELSE v_day.opening_bank + v_t.in_bank - v_t.out_bank END,
    'counted_cash', v_day.counted_cash, 'variance', v_day.variance,
    'variance_note', v_day.variance_note, 'denominations', v_day.denominations,
    'closed_by', v_day.closed_by, 'closed_at', v_day.closed_at,
    'entries', v_t.entries);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_cash_day_summary(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_day_summary(uuid, uuid, date) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SetupOpening (§A4, invariant 2) — once per project, ever, by the CFO.
-- ═══════════════════════════════════════════════════════════════════════════
-- Modelled as a CLOSED day rather than as a special row, so OpenDay's
-- carry-forward has exactly one code path: "the latest CLOSED day". It satisfies
-- cash_days_closed_is_complete honestly — the CFO did count the opening cash.
CREATE OR REPLACE FUNCTION public.setup_cash_opening(
  p_company_id uuid, p_project_id uuid,
  p_cash numeric, p_bank numeric, p_effective_date date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_id uuid;
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id)
     OR NOT public._dc_is_cfo(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_cash IS NULL OR p_bank IS NULL OR p_cash < 0 OR p_bank < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Opening cash and bank must both be given and cannot be negative.');
  END IF;
  IF p_effective_date IS NULL OR p_effective_date > public._dc_today() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'The opening date cannot be in the future.');
  END IF;

  -- "Once per project" means once per project, not once per absence of an
  -- opening: if the book has started at all, the opening is already history.
  IF EXISTS (SELECT 1 FROM public.cash_days WHERE project_id = p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'This project already has a cash book; the opening balance can only be set before the first day.');
  END IF;

  PERFORM set_config('rms.audit_reason',
    format('setup opening: cash %s, bank %s', p_cash, p_bank), true);

  INSERT INTO public.cash_days (
    company_id, project_id, business_date, status, is_setup_opening,
    opening_cash, opening_bank, closing_cash, closing_bank,
    counted_cash, variance, denominations, closed_by, closed_at, created_by)
  VALUES (
    p_company_id, p_project_id, p_effective_date, 'CLOSED', true,
    0, 0, round(p_cash, 2), round(p_bank, 2),
    round(p_cash, 2), 0, NULL, v_me.id, now(), v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'OpeningSet',
    'cash_day_id', v_id, 'business_date', p_effective_date,
    'opening_cash', round(p_cash, 2), 'opening_bank', round(p_bank, 2));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
    'message', 'A setup opening already exists for this project.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.setup_cash_opening(uuid, uuid, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_cash_opening(uuid, uuid, numeric, numeric, date) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- OpenDay (§A4, invariant 2) — Cashier and up.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.open_cash_day(
  p_company_id uuid, p_project_id uuid, p_business_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_date date; v_prev public.cash_days; v_id uuid;
  v_open_date date; v_o_cash numeric(18,2); v_o_bank numeric(18,2);
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  v_date := COALESCE(p_business_date, public._dc_today());
  IF v_date > public._dc_today() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A day cannot be opened in the future.');
  END IF;

  -- At most one OPEN day per project (§A4). The partial unique index enforces
  -- it; this returns the blueprint's code and says which day is in the way.
  SELECT business_date INTO v_open_date FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'OPEN' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
      'message', format('%s is still open. Close it before opening another day.', v_open_date));
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_days
              WHERE project_id = p_project_id AND business_date = v_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', format('%s has already been opened and closed.', v_date));
  END IF;

  -- Invariant 2: opening is DERIVED. There is no parameter for it.
  SELECT * INTO v_prev FROM public.cash_days
   WHERE project_id = p_project_id AND status = 'CLOSED'
   ORDER BY business_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SETUP_OPENING_REQUIRED',
      'message', 'Set the opening cash and bank balance before opening the first day.');
  END IF;
  v_o_cash := v_prev.closing_cash;
  v_o_bank := v_prev.closing_bank;

  PERFORM set_config('rms.audit_reason',
    format('opened %s; brought forward from %s', v_date, v_prev.business_date), true);

  INSERT INTO public.cash_days (company_id, project_id, business_date, status,
                                opening_cash, opening_bank, created_by)
  VALUES (p_company_id, p_project_id, v_date, 'OPEN', v_o_cash, v_o_bank, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'DayOpened',
    'cash_day_id', v_id, 'business_date', v_date,
    'opening_cash', v_o_cash, 'opening_bank', v_o_bank,
    'brought_forward_from', v_prev.business_date);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'PREVIOUS_DAY_OPEN',
    'message', 'Another day is already open for this project.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.open_cash_day(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_day(uuid, uuid, date) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CloseDay (§A4, invariant 3) — CFO only.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.close_cash_day(
  p_company_id uuid, p_cash_day_id uuid,
  p_counted_cash numeric, p_denominations jsonb DEFAULT NULL,
  p_variance_note text DEFAULT NULL, p_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_t record;
  v_close_cash numeric(18,2); v_close_bank numeric(18,2); v_var numeric(18,2);
  v_denom_total numeric(18,2);
BEGIN
  -- Lock the day first: the close and any in-flight entry insert contend for
  -- this row, and the loser must see a settled state (§A7 concurrency).
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN',
      'message', 'No such day.');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id)
     OR NOT public._dc_is_cfo(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT public._dc_may_close(v_day.status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_LOCKED',
      'message', 'This day is already closed.');
  END IF;

  -- §A7: optimistic lock. The closer sends the version it read.
  IF p_version IS NOT NULL AND p_version IS DISTINCT FROM v_day.version THEN
    RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT',
      'message', 'The day changed while you were counting. Reload and close again.',
      'expected_version', v_day.version, 'sent_version', p_version);
  END IF;

  IF p_counted_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'The counted cash is required to close a day.');
  END IF;
  IF p_counted_cash < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'A drawer cannot hold a negative amount of cash.');
  END IF;

  SELECT * INTO v_t FROM public._dc_day_totals(v_day.id);
  v_close_cash := v_day.opening_cash + v_t.in_cash - v_t.out_cash;
  v_close_bank := v_day.opening_bank + v_t.in_bank - v_t.out_bank;
  v_var := public._dc_variance(p_counted_cash, v_close_cash);

  IF v_var <> 0 AND (p_variance_note IS NULL OR btrim(p_variance_note) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'VARIANCE_UNEXPLAINED',
      'message', format('The drawer is %s by %s. Say why before closing.',
                        CASE WHEN v_var < 0 THEN 'short' ELSE 'over' END, abs(v_var)),
      'variance', v_var, 'closing_cash', v_close_cash, 'counted_cash', round(p_counted_cash,2));
  END IF;

  -- Reported, never enforced: if the denomination breakdown disagrees with the
  -- counted figure the screen should say so, but blocking a close on it is a
  -- rule the blueprint does not ask for.
  IF p_denominations IS NOT NULL AND jsonb_typeof(p_denominations) = 'object' THEN
    SELECT COALESCE(SUM((key)::numeric * (value#>>'{}')::numeric), 0)::numeric(18,2)
      INTO v_denom_total FROM jsonb_each(p_denominations)
     WHERE key ~ '^[0-9]+$' AND (value#>>'{}') ~ '^[0-9]+$';
  END IF;

  PERFORM set_config('rms.audit_reason',
    COALESCE(NULLIF(btrim(p_variance_note), ''),
             format('closed %s; cash %s, bank %s', v_day.business_date, v_close_cash, v_close_bank)),
    true);

  UPDATE public.cash_days
     SET status        = 'CLOSED',
         closing_cash  = v_close_cash,
         closing_bank  = v_close_bank,
         counted_cash  = round(p_counted_cash, 2),
         variance      = v_var,
         variance_note = NULLIF(btrim(COALESCE(p_variance_note, '')), ''),
         denominations = p_denominations,
         closed_by     = v_me.id,
         closed_at     = now(),
         version       = v_day.version + 1
   WHERE id = v_day.id;

  RETURN jsonb_build_object('success', true, 'event', 'DayClosed',
    'cash_day_id', v_day.id, 'business_date', v_day.business_date,
    'closing_cash', v_close_cash, 'closing_bank', v_close_bank,
    'counted_cash', round(p_counted_cash,2), 'variance', v_var,
    'denominations_total', v_denom_total,
    'denominations_match', (v_denom_total IS NULL OR v_denom_total = round(p_counted_cash,2)),
    'version', v_day.version + 1);
END;
$fn$;

REVOKE ALL ON FUNCTION public.close_cash_day(uuid, uuid, numeric, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_day(uuid, uuid, numeric, jsonb, text, integer) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- PostAdjustment (§A4, invariant 3) — CFO only, CLOSED days only, reason always.
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ DEVIATION FROM THE P3 BRIEF, and why.
--
-- The brief says: "creates a cash_entries row with is_adjustment=true,
-- voucher_type=JV … For cash/bank-affecting adjustments set mode/direction; for
-- pure reclassifications set qb_debit/qb_credit with mode NULL."
--
-- The first half and the second half cannot both hold. §A6 says mode and
-- direction are "NULL only for JV", and the shipped CHECK
-- cash_entries_jv_or_movement enforces exactly that: a JV has no mode, no
-- direction, and names both accounts. A JV that moves cash cannot exist.
--
-- Resolved in favour of the blueprint and the constraint, because §A6 is the
-- law and this brief's sentence contradicts it:
--
--   cash/bank-affecting  →  voucher_type = _dc_voucher_for(mode, direction)
--                           (CRV/CPV/BRV/BPV), is_adjustment = true,
--                           voucher_no = JV-{YYYY}-{seq}
--   pure reclassification →  voucher_type = 'JV', mode/direction NULL,
--                           qb_debit_account_id + qb_credit_account_id
--
-- Both are adjustments, both carry a reason, both auto-number JV-{YYYY}-{seq},
-- and both appear in the ADJUSTMENTS block of the Director PDF. Nothing is
-- weakened; the derivation invariant of §A12 is upheld. P1's own test 16
-- already wrote an adjustment this way.
--
-- The alternative — relaxing cash_entries_jv_or_movement so a JV may carry
-- mode/direction — would let a voucher chip disagree with the row it labels,
-- and is not taken.
CREATE OR REPLACE FUNCTION public.post_cash_adjustment(
  p_company_id uuid, p_cash_day_id uuid, p_payload jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days;
  v_mode text; v_dir text; v_amount numeric(18,2); v_vt text;
  v_seq integer; v_no text; v_year integer; v_seq_no integer; v_id uuid;
  v_debit uuid; v_credit uuid; v_head uuid;
BEGIN
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN', 'message', 'No such day.');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id)
     OR NOT public._dc_is_cfo(v_me)
     OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- An adjustment is a change to a day that was already locked. On an OPEN day
  -- the answer is to record or void an entry, not to adjust.
  IF NOT public._dc_may_adjust(v_day.status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'Adjustments are for closed days. This day is still open — record or void an entry instead.');
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'OVERRIDE_REASON_REQUIRED',
      'message', 'An adjustment to a closed day always carries a reason.');
  END IF;

  v_mode   := NULLIF(p_payload->>'mode', '');
  v_dir    := NULLIF(p_payload->>'direction', '');
  v_amount := round((p_payload->>'amount')::numeric, 2);
  v_debit  := NULLIF(p_payload->>'qb_debit_account_id','')::uuid;
  v_credit := NULLIF(p_payload->>'qb_credit_account_id','')::uuid;
  v_head   := NULLIF(p_payload->>'qb_account_id','')::uuid;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
      'message', 'An adjustment needs a positive amount.');
  END IF;

  IF v_mode IS NOT NULL OR v_dir IS NOT NULL THEN
    -- cash/bank-affecting: the voucher type is derived, never supplied
    v_vt := public._dc_voucher_for(v_mode, v_dir);
    IF v_vt IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'mode must be CASH or BANK and direction IN or OUT.');
    END IF;
    v_debit := NULL; v_credit := NULL;
  ELSE
    -- pure reclassification: a true JV, naming both sides
    v_vt := 'JV';
    IF v_debit IS NULL OR v_credit IS NULL OR v_debit = v_credit THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'A reclassification names two different QuickBooks accounts.');
    END IF;
    v_head := NULL;
  END IF;

  -- Gapless per company-year, borrowing voucher_sequences' row-lock pattern.
  v_year := EXTRACT(YEAR FROM v_day.business_date)::integer;
  INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
  VALUES (p_company_id, 'DCJV', v_year::text, 1)
  ON CONFLICT (company_id, prefix, year) DO UPDATE SET seq = voucher_sequences.seq + 1
  RETURNING seq INTO v_seq;
  v_no := public._dc_jv_number(v_year, v_seq);

  -- Safe under the FOR UPDATE taken above.
  SELECT COALESCE(MAX(seq_no), 0) + 1 INTO v_seq_no
    FROM public.cash_entries WHERE cash_day_id = v_day.id;

  PERFORM set_config('rms.audit_reason', btrim(p_reason), true);

  INSERT INTO public.cash_entries (
    company_id, project_id, cash_day_id, seq_no, idempotency_key,
    entry_type, mode, direction, voucher_type, voucher_no, amount, narration,
    payee_id, unit_id, sale_id, qb_account_id, qb_debit_account_id, qb_credit_account_id,
    rms_status, is_adjustment, adjusts_entry_id, adjustment_reason, created_by)
  VALUES (
    p_company_id, v_day.project_id, v_day.id, v_seq_no,
    COALESCE(NULLIF(p_payload->>'idempotency_key','')::uuid, gen_random_uuid()),
    'OTHER', v_mode, v_dir, v_vt, v_no, v_amount,
    NULLIF(p_payload->>'narration',''),
    NULLIF(p_payload->>'payee_id','')::uuid,
    NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(p_payload->>'sale_id','')::uuid,
    v_head, v_debit, v_credit,
    'NA', true, NULLIF(p_payload->>'adjusts_entry_id','')::uuid, btrim(p_reason), v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'event', 'AdjustmentPosted',
    'entry_id', v_id, 'cash_day_id', v_day.id, 'voucher_type', v_vt,
    'voucher_no', v_no, 'seq_no', v_seq_no, 'amount', v_amount,
    'affects_cash', v_mode IS NOT NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_cash_adjustment(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_cash_adjustment(uuid, uuid, jsonb, text) TO authenticated, service_role;

COMMIT;
