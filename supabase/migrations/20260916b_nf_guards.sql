-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance v1 · b · the rules, where they cannot be walked around
--
-- Every rule R1–R8 is enforced here, in triggers, so it holds whichever
-- function writes — including one written later by somebody who never read
-- docs/PLAN.md §5.5 (SR-12). The RPCs in 20260916c only translate.
--
-- Errors are raised as  NF:<CODE>  with a JSON DETAIL where useful. The client
-- matches the code; the wording is for whoever reads a log.
--
-- Positions are computed, never stored, except the snapshot a day takes when
-- it closes — which is what the next day's opening reads (R5).
--
-- One escape hatch, for test tenants only: when the transaction-local setting
-- nf.purge_company names a company whose name starts 'ZZTEST-NF-', the guards
-- step aside for that company's rows so _nf_test_purge can remove them.
-- PostgREST exposes no way to set it; the name check means it can never
-- apply to Awami or to any real tenant.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── small helpers ──────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_purging(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(current_setting('nf.purge_company', true), '') = p_company_id::text
     AND EXISTS (SELECT 1 FROM public.companies c
                  WHERE c.id = p_company_id AND c.company_name LIKE 'ZZTEST-NF-%');
$$;

-- The caller's role in a company, or NULL.
CREATE FUNCTION public.nf_role(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT m.role FROM public.nf_members m
   WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active;
$$;

CREATE FUNCTION public.nf_actor_name(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT m.display_name FROM public.nf_members m
   WHERE m.company_id = p_company_id AND m.user_id = auth.uid();
$$;

-- The reference's fmt(), without its rounding: whole rupees print whole,
-- a value with paisa prints two decimals (owner, 2026-09-16). Callers pass
-- the absolute value; the sign is worded, not printed.
CREATE FUNCTION public.nf_fmt(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO public, pg_temp
AS $$
  SELECT CASE WHEN p = trunc(p)
              THEN to_char(p, 'FM999,999,999,999,990')
              ELSE to_char(p, 'FM999,999,999,999,990.00') END;
$$;

-- Cash count: the reference's DENOMS plus coins. Only filled-in fields are
-- present. Pieces are whole and non-negative; coins are rupees, two decimals.
CREATE FUNCTION public.nf_count_total(p jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO public, pg_temp
AS $$
DECLARE
  k text; v jsonb; n numeric; total numeric := 0;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'object' OR p = '{}'::jsonb THEN
    RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = 'the count must be an object with at least one field';
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
    IF jsonb_typeof(v) <> 'number' THEN
      RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = format('field %s is not a number', k);
    END IF;
    n := v::text::numeric;
    IF n < 0 THEN
      RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = format('field %s is negative', k);
    END IF;
    IF k = 'coins' THEN
      IF n <> round(n, 2) THEN
        RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = 'coins may carry at most two decimals';
      END IF;
      total := total + n;
    ELSIF k IN ('5000','1000','500','100','75','50','20','10') THEN
      IF n <> trunc(n) THEN
        RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = format('pieces of %s must be whole', k);
      END IF;
      total := total + n * k::numeric;
    ELSE
      RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = format('unknown field %s', k);
    END IF;
  END LOOP;
  RETURN total;
END
$$;

-- ── position: the reference calc(), in SQL ─────────────────────────────────
-- closing = opening + received − paid + transfers, per Via.
-- Opening is typed on the first day, and otherwise is the previous day's
-- closed snapshot (R5). The previous day is always CLOSED while a later day
-- exists: a day cannot start before it closes, nor reopen after one starts.
CREATE FUNCTION public.nf_position_row(p_day_id uuid,
  OUT open_cash numeric,  OUT open_petty numeric,  OUT open_bank numeric,
  OUT in_cash numeric,    OUT in_petty numeric,    OUT in_bank numeric,
  OUT out_cash numeric,   OUT out_petty numeric,   OUT out_bank numeric,
  OUT trf_cash numeric,   OUT trf_petty numeric,   OUT trf_bank numeric,
  OUT close_cash numeric, OUT close_petty numeric, OUT close_bank numeric,
  OUT n_in integer,       OUT n_out integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  d public.nf_days;
  p public.nf_days;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;

  IF d.is_first_day THEN
    open_cash := d.typed_open_cash; open_petty := d.typed_open_petty; open_bank := d.typed_open_bank;
  ELSE
    SELECT * INTO p FROM public.nf_days
     WHERE company_id = d.company_id AND business_date < d.business_date
     ORDER BY business_date DESC LIMIT 1;
    IF NOT FOUND OR p.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED';
    END IF;
    open_cash := p.close_cash; open_petty := p.close_petty; open_bank := p.close_bank;
  END IF;

  SELECT COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Cash'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Petty'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Bank'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Cash'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Petty'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Bank'),  0),
         count(*) FILTER (WHERE side = 'IN'),
         count(*) FILTER (WHERE side = 'OUT')
    INTO in_cash, in_petty, in_bank, out_cash, out_petty, out_bank, n_in, n_out
    FROM public.nf_lines WHERE day_id = p_day_id;

  trf_cash  := -(COALESCE(d.transfer_to_bank, 0) + COALESCE(d.transfer_to_petty, 0));
  trf_petty := COALESCE(d.transfer_to_petty, 0);
  trf_bank  := COALESCE(d.transfer_to_bank, 0);

  close_cash  := open_cash  + in_cash  - out_cash  + trf_cash;
  close_petty := open_petty + in_petty - out_petty + trf_petty;
  close_bank  := open_bank  + in_bank  - out_bank  + trf_bank;
END
$$;

-- R1 as one callable check. Raises on the first negative position.
CREATE FUNCTION public.nf_assert_not_negative(p_day_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  r record;
  v_via text; v_amt numeric;
BEGIN
  SELECT * INTO r FROM public.nf_position_row(p_day_id);
  IF    r.close_cash  < 0 THEN v_via := 'Cash';  v_amt := r.close_cash;
  ELSIF r.close_petty < 0 THEN v_via := 'Petty'; v_amt := r.close_petty;
  ELSIF r.close_bank  < 0 THEN v_via := 'Bank';  v_amt := r.close_bank;
  END IF;
  IF v_via IS NOT NULL THEN
    RAISE EXCEPTION 'NF:NEGATIVE_POSITION'
      USING DETAIL = json_build_object('via', v_via, 'would_be', v_amt)::text,
            HINT   = 'A payment cannot exceed the money available.';
  END IF;
END
$$;

-- ── checks: the server half of the reference's issues list ─────────────────
-- A saved line always has its voucher, head, floor and Via, and no two share
-- a voucher (a/b refuse otherwise), so of the reference's seven checks only
-- these can be true of saved data. The screen adds the other five for rows it
-- has not saved yet, in the same words.
CREATE FUNCTION public.nf_checks(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  d public.nf_days;
  r record;
  out jsonb := '[]'::jsonb;
  v_label text; v_close numeric; v_diff numeric;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  SELECT * INTO r FROM public.nf_position_row(p_day_id);

  FOR v_label, v_close IN
    SELECT a.via_label, CASE a.via WHEN 'Cash' THEN r.close_cash WHEN 'Petty' THEN r.close_petty ELSE r.close_bank END
      FROM public.nf_accounts a
     WHERE a.company_id = d.company_id AND a.via IS NOT NULL
     ORDER BY CASE a.via WHEN 'Cash' THEN 1 WHEN 'Petty' THEN 2 ELSE 3 END
  LOOP
    IF v_close < 0 THEN
      out := out || jsonb_build_object('key', 'negative', 'text',
        format('%s is negative by Rs %s. A payment cannot exceed the money available.', v_label, public.nf_fmt(-v_close)));
    END IF;
  END LOOP;

  SELECT a.via_label INTO v_label FROM public.nf_accounts a WHERE a.company_id = d.company_id AND a.via = 'Cash';
  IF d.denominations IS NULL THEN
    out := out || jsonb_build_object('key', 'not_counted', 'text', format('%s has not been counted yet.', v_label));
  ELSE
    v_diff := r.close_cash - d.counted_cash;          -- book − counted; positive is short
    IF v_diff <> 0 THEN
      out := out || jsonb_build_object('key', 'count_mismatch', 'diff', v_diff, 'text',
        format('%s is %s by Rs %s.', v_label, CASE WHEN v_diff > 0 THEN 'short' ELSE 'over' END, public.nf_fmt(abs(v_diff))));
    END IF;
  END IF;
  RETURN out;
END
$$;

-- ── chart of accounts: a head is a leaf, a Via has no children ─────────────
CREATE FUNCTION public.nf_accounts_tree_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  IF (NEW.is_head OR NEW.via IS NOT NULL) AND EXISTS (
       SELECT 1 FROM public.nf_accounts c WHERE c.company_id = NEW.company_id AND c.parent_code = NEW.code) THEN
    RAISE EXCEPTION 'NF:HEAD_HAS_CHILDREN' USING DETAIL = NEW.code;
  END IF;
  IF NEW.parent_code IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.nf_accounts p
        WHERE p.company_id = NEW.company_id AND p.code = NEW.parent_code AND (p.is_head OR p.via IS NOT NULL)) THEN
    RAISE EXCEPTION 'NF:HEAD_HAS_CHILDREN' USING DETAIL = NEW.parent_code;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER nf_accounts_tree_guard
  AFTER INSERT OR UPDATE ON public.nf_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.nf_accounts_tree_guard();

-- ── days: R5, R6, R7 and the state machine ─────────────────────────────────
CREATE FUNCTION public.nf_days_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role   text;
  v_latest public.nf_days;
  v_checks jsonb;
  v_hard   jsonb;
  v_mis    jsonb;
  r        record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.nf_purging(OLD.company_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'NF:DAY_CANNOT_BE_DELETED';
  END IF;
  IF TG_OP = 'UPDATE' AND public.nf_purging(OLD.company_id) THEN RETURN NEW; END IF;

  v_role := public.nf_role(NEW.company_id);

  -- the count total is derived here and nowhere else
  NEW.counted_cash := public.nf_count_total(NEW.denominations);

  -- ── starting a day ────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;
    IF NEW.status <> 'OPEN' OR NEW.submitted_at IS NOT NULL OR NEW.closed_at IS NOT NULL
       OR NEW.close_cash IS NOT NULL OR NEW.variance IS NOT NULL OR NEW.variance_reason IS NOT NULL
       OR NEW.reopen_count <> 0 THEN
      RAISE EXCEPTION 'NF:DAY_MUST_START_OPEN';
    END IF;
    -- one starter at a time per company
    PERFORM pg_advisory_xact_lock(hashtextextended('nf_days:' || NEW.company_id::text, 0));
    SELECT * INTO v_latest FROM public.nf_days
     WHERE company_id = NEW.company_id ORDER BY business_date DESC LIMIT 1;

    IF NEW.is_first_day THEN
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:FIRST_DAY_NEEDS_DIRECTOR'; END IF;
      IF v_latest.id IS NOT NULL THEN RAISE EXCEPTION 'NF:FIRST_DAY_EXISTS'; END IF;
    ELSE
      IF v_latest.id IS NULL THEN RAISE EXCEPTION 'NF:NO_FIRST_DAY'; END IF;
      IF v_latest.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED' USING DETAIL = v_latest.business_date::text;
      END IF;
      IF NEW.business_date <= v_latest.business_date THEN
        RAISE EXCEPTION 'NF:DATE_NOT_AFTER_PREVIOUS' USING DETAIL = v_latest.business_date::text;
      END IF;
    END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.version    := 0;
    RETURN NEW;
  END IF;

  -- ── UPDATE ────────────────────────────────────────────────────────────────
  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id OR NEW.business_date <> OLD.business_date
     OR NEW.is_first_day <> OLD.is_first_day OR NEW.closing_no <> OLD.closing_no
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  IF NEW.status = OLD.status THEN
    -- R7: nothing about a submitted or closed day changes except by a transition
    IF OLD.status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
    IF (NEW.submitted_by, NEW.submitted_at, NEW.closed_by, NEW.closed_at, NEW.close_cash, NEW.close_petty,
        NEW.close_bank, NEW.variance, NEW.variance_reason, NEW.last_return_reason, NEW.last_reopen_reason,
        NEW.reopen_count)
       IS DISTINCT FROM
       (OLD.submitted_by, OLD.submitted_at, OLD.closed_by, OLD.closed_at, OLD.close_cash, OLD.close_petty,
        OLD.close_bank, OLD.variance, OLD.variance_reason, OLD.last_return_reason, OLD.last_reopen_reason,
        OLD.reopen_count) THEN
      RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
    END IF;
    IF (NEW.typed_open_cash, NEW.typed_open_petty, NEW.typed_open_bank)
       IS DISTINCT FROM (OLD.typed_open_cash, OLD.typed_open_petty, OLD.typed_open_bank)
       AND v_role <> 'director' THEN
      RAISE EXCEPTION 'NF:OPENING_NEEDS_DIRECTOR';
    END IF;
  ELSE
    -- a transition changes the state and nothing the checks read
    IF (NEW.typed_open_cash, NEW.typed_open_petty, NEW.typed_open_bank, NEW.transfer_to_bank,
        NEW.transfer_to_petty, NEW.denominations, NEW.remarks)
       IS DISTINCT FROM
       (OLD.typed_open_cash, OLD.typed_open_petty, OLD.typed_open_bank, OLD.transfer_to_bank,
        OLD.transfer_to_petty, OLD.denominations, OLD.remarks) THEN
      RAISE EXCEPTION 'NF:TRANSITION_CHANGES_DATA';
    END IF;

    IF NEW.status IN ('SUBMITTED','CLOSED') AND OLD.status IN ('OPEN','SUBMITTED') AND NEW.status <> OLD.status THEN
      -- R6
      v_checks := public.nf_checks(NEW.id);
      SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_hard FROM jsonb_array_elements(v_checks) c
       WHERE c->>'key' <> 'count_mismatch';
      SELECT c INTO v_mis FROM jsonb_array_elements(v_checks) c WHERE c->>'key' = 'count_mismatch';
      IF jsonb_array_length(v_hard) > 0 THEN
        RAISE EXCEPTION 'NF:CHECKS_FAILED' USING DETAIL = v_hard::text;
      END IF;

      IF NEW.status = 'SUBMITTED' THEN
        -- An accountant may hand a short or over day to the director; nothing else.
        IF NEW.variance_reason IS NOT NULL THEN RAISE EXCEPTION 'NF:TRANSITION_CHANGES_DATA'; END IF;
        NEW.submitted_by := auth.uid();
        NEW.submitted_at := now();
        NEW.last_return_reason := NULL;
      ELSE
        IF v_mis IS NOT NULL THEN
          IF v_role <> 'director' THEN
            RAISE EXCEPTION 'NF:VARIANCE_NEEDS_DIRECTOR' USING DETAIL = v_mis::text;
          END IF;
          IF NEW.variance_reason IS NULL OR btrim(NEW.variance_reason) = '' THEN
            RAISE EXCEPTION 'NF:VARIANCE_REASON_REQUIRED' USING DETAIL = v_mis::text;
          END IF;
        ELSIF NEW.variance_reason IS NOT NULL THEN
          RAISE EXCEPTION 'NF:NO_VARIANCE_TO_EXPLAIN';
        END IF;
        SELECT * INTO r FROM public.nf_position_row(NEW.id);
        NEW.close_cash  := r.close_cash;
        NEW.close_petty := r.close_petty;
        NEW.close_bank  := r.close_bank;
        NEW.variance    := r.close_cash - NEW.counted_cash;
        NEW.closed_by   := auth.uid();
        NEW.closed_at   := now();
        IF NEW.submitted_at IS NULL THEN
          NEW.submitted_by := auth.uid();
          NEW.submitted_at := NEW.closed_at;
        END IF;
        NEW.last_reopen_reason := NULL;   -- so the next reopen must bring its own
      END IF;

    ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'OPEN' THEN
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:RETURN_NEEDS_DIRECTOR'; END IF;
      IF NEW.last_return_reason IS NULL OR btrim(NEW.last_return_reason) = '' THEN
        RAISE EXCEPTION 'NF:REASON_REQUIRED';
      END IF;
      NEW.submitted_by := NULL;
      NEW.submitted_at := NULL;

    ELSIF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
      -- R7
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:REOPEN_NEEDS_DIRECTOR'; END IF;
      IF NEW.last_reopen_reason IS NULL OR btrim(NEW.last_reopen_reason) = '' THEN
        RAISE EXCEPTION 'NF:REASON_REQUIRED';
      END IF;
      IF EXISTS (SELECT 1 FROM public.nf_days x
                  WHERE x.company_id = OLD.company_id AND x.business_date > OLD.business_date) THEN
        RAISE EXCEPTION 'NF:LATER_DAY_EXISTS';
      END IF;
      NEW.close_cash := NULL; NEW.close_petty := NULL; NEW.close_bank := NULL;
      NEW.variance := NULL; NEW.variance_reason := NULL;
      NEW.closed_by := NULL; NEW.closed_at := NULL;
      NEW.submitted_by := NULL; NEW.submitted_at := NULL;
      NEW.reopen_count := OLD.reopen_count + 1;

    ELSE
      RAISE EXCEPTION 'NF:BAD_TRANSITION' USING DETAIL = OLD.status || ' -> ' || NEW.status;
    END IF;
  END IF;

  NEW.version    := OLD.version + 1;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER nf_days_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.nf_days
  FOR EACH ROW EXECUTE FUNCTION public.nf_days_guard();

-- R1 for what lives on the day row: the typed opening and the two transfers.
CREATE FUNCTION public.nf_days_position_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  IF public.nf_purging(NEW.company_id) THEN RETURN NULL; END IF;
  IF NEW.status = 'OPEN' THEN
    PERFORM public.nf_assert_not_negative(NEW.id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER nf_days_position_guard
  AFTER INSERT OR UPDATE OF typed_open_cash, typed_open_petty, typed_open_bank, transfer_to_bank, transfer_to_petty
  ON public.nf_days
  FOR EACH ROW EXECUTE FUNCTION public.nf_days_position_guard();

-- ── lines: R3, R7, and the lock R1 needs ───────────────────────────────────
CREATE FUNCTION public.nf_lines_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_day     uuid := COALESCE(NEW.day_id, OLD.day_id);
  v_status  text;
  v_role    text;
  v_acc     public.nf_accounts;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.day_id <> OLD.day_id
                           OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  v_role := public.nf_role(v_company);
  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  -- The day row is locked for the rest of the transaction, so two people
  -- writing to the same day are taken one at a time and R1 sees both.
  SELECT d.status INTO v_status FROM public.nf_days d
   WHERE d.id = v_day AND d.company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO v_acc FROM public.nf_accounts a WHERE a.company_id = v_company AND a.code = NEW.head_code;
  IF NOT FOUND OR NOT v_acc.is_head OR NOT v_acc.active THEN
    RAISE EXCEPTION 'NF:HEAD_NOT_POSTABLE' USING DETAIL = NEW.head_code;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via = NEW.via) THEN
    RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED' USING DETAIL = NEW.via;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.version    := 0;
  ELSE
    NEW.version    := OLD.version + 1;
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER nf_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.nf_lines
  FOR EACH ROW EXECUTE FUNCTION public.nf_lines_guard();

-- R1: after the change is in place, no Via may be below zero. Not deferred —
-- the statement that would cause it is the statement that fails. This covers
-- a payment added, a receipt removed or reduced, and a Via changed.
CREATE FUNCTION public.nf_lines_position_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  PERFORM public.nf_assert_not_negative(COALESCE(NEW.day_id, OLD.day_id));
  RETURN NULL;
END
$$;
CREATE TRIGGER nf_lines_position_guard
  AFTER INSERT OR UPDATE OR DELETE ON public.nf_lines
  FOR EACH ROW EXECUTE FUNCTION public.nf_lines_position_guard();

-- ── PDCs: a running register whose edits belong to the open day ────────────
CREATE FUNCTION public.nf_pdcs_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_role    text;
  v_entered public.nf_days;
  v_resolved public.nf_days;
  v_old_res public.nf_days;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN COALESCE(NEW, OLD); END IF;
  v_role := public.nf_role(v_company);
  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  SELECT * INTO v_entered FROM public.nf_days
   WHERE id = COALESCE(NEW.entered_day_id, OLD.entered_day_id) AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_entered.status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
    IF NEW.status <> 'PENDING' THEN RAISE EXCEPTION 'NF:PDC_MUST_START_PENDING'; END IF;
    NEW.created_by := auth.uid(); NEW.created_at := now(); NEW.version := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_entered.status <> 'OPEN' OR OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
    RETURN OLD;
  END IF;

  IF NEW.company_id <> OLD.company_id OR NEW.entered_day_id <> OLD.entered_day_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  IF (NEW.direction, NEW.cheque_no, NEW.party, NEW.bank, NEW.due_date, NEW.amount)
     IS DISTINCT FROM (OLD.direction, OLD.cheque_no, OLD.party, OLD.bank, OLD.due_date, OLD.amount)
     AND v_entered.status <> 'OPEN' THEN
    RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = 'a cheque is corrected on the day it was entered';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.resolved_day_id IS DISTINCT FROM OLD.resolved_day_id THEN
    IF OLD.resolved_day_id IS NOT NULL THEN
      SELECT * INTO v_old_res FROM public.nf_days WHERE id = OLD.resolved_day_id FOR UPDATE;
      IF v_old_res.status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
    END IF;
    IF NEW.resolved_day_id IS NOT NULL THEN
      SELECT * INTO v_resolved FROM public.nf_days
       WHERE id = NEW.resolved_day_id AND company_id = v_company FOR UPDATE;
      IF NOT FOUND OR v_resolved.status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
      IF v_resolved.business_date < v_entered.business_date THEN RAISE EXCEPTION 'NF:BAD_TRANSITION'; END IF;
    END IF;
  END IF;

  NEW.version := OLD.version + 1; NEW.updated_by := auth.uid(); NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER nf_pdcs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.nf_pdcs
  FOR EACH ROW EXECUTE FUNCTION public.nf_pdcs_guard();

-- ── members: only a director changes membership; one always remains ────────
CREATE FUNCTION public.nf_members_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
BEGIN
  IF public.nf_purging(v_company) THEN RETURN COALESCE(NEW, OLD); END IF;
  -- auth.uid() is NULL only for the operator (no JWT): the first director of
  -- a company has to be seeded by someone.
  IF auth.uid() IS NOT NULL AND COALESCE(public.nf_role(v_company), '') <> 'director' THEN
    RAISE EXCEPTION 'NF:NOT_ALLOWED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id <> OLD.company_id OR NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN'; END IF;
    NEW.updated_at := now(); NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_at := now(); NEW.created_by := auth.uid();
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER nf_members_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.nf_members
  FOR EACH ROW EXECUTE FUNCTION public.nf_members_guard();

CREATE FUNCTION public.nf_members_last_director()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := COALESCE(OLD.company_id, NEW.company_id);
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  IF OLD.role = 'director' AND OLD.active
     AND NOT EXISTS (SELECT 1 FROM public.nf_members m
                      WHERE m.company_id = v_company AND m.role = 'director' AND m.active) THEN
    RAISE EXCEPTION 'NF:LAST_DIRECTOR';
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER nf_members_last_director
  AFTER UPDATE OR DELETE ON public.nf_members
  FOR EACH ROW EXECUTE FUNCTION public.nf_members_last_director();

-- ── audit: who, when, old value, new value ─────────────────────────────────
CREATE FUNCTION public.nf_audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row     jsonb := COALESCE(v_new, v_old);
  v_company uuid  := (v_row->>'company_id')::uuid;
  v_action  text  := TG_OP;
  v_reason  text;
  v_day     uuid;
  v_id      text;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'version' - 'updated_at' - 'updated_by')
                        = (v_new - 'version' - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;

  v_id := CASE TG_TABLE_NAME
            WHEN 'nf_members'           THEN v_row->>'user_id'
            WHEN 'nf_settings'          THEN v_row->>'company_id'
            WHEN 'nf_accounts'          THEN v_row->>'code'
            WHEN 'nf_floors'            THEN v_row->>'code'
            WHEN 'nf_report_categories' THEN (v_row->>'side') || ':' || (v_row->>'priority')
            ELSE v_row->>'id' END;

  IF TG_TABLE_NAME = 'nf_days' THEN
    v_day := (v_row->>'id')::uuid;
    IF TG_OP = 'UPDATE' AND v_old->>'status' <> v_new->>'status' THEN
      IF v_new->>'status' = 'SUBMITTED' THEN
        v_action := 'SUBMIT';
      ELSIF v_new->>'status' = 'CLOSED' THEN
        IF (v_new->>'variance')::numeric <> 0 THEN
          v_action := 'CLOSE_WITH_VARIANCE'; v_reason := v_new->>'variance_reason';
        ELSE
          v_action := 'CLOSE';
        END IF;
      ELSIF v_old->>'status' = 'SUBMITTED' THEN
        v_action := 'RETURN'; v_reason := v_new->>'last_return_reason';
      ELSE
        v_action := 'REOPEN'; v_reason := v_new->>'last_reopen_reason';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'nf_lines' THEN
    v_day := (v_row->>'day_id')::uuid;
  ELSIF TG_TABLE_NAME = 'nf_pdcs' THEN
    v_day := COALESCE((v_new->>'resolved_day_id')::uuid, (v_row->>'entered_day_id')::uuid);
  END IF;

  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (v_company, v_day, TG_TABLE_NAME, v_id, v_action, auth.uid(), public.nf_actor_name(v_company),
          v_old, v_new, v_reason);
  RETURN NULL;
END
$$;

DO $audit$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nf_members','nf_settings','nf_accounts','nf_floors','nf_report_categories',
                           'nf_days','nf_lines','nf_pdcs'] LOOP
    EXECUTE format('CREATE TRIGGER nf_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row()', t);
  END LOOP;
END
$audit$;

CREATE FUNCTION public.nf_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND public.nf_purging(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'NF:AUDIT_IS_APPEND_ONLY';
END
$$;
CREATE TRIGGER nf_audit_append_only
  BEFORE UPDATE OR DELETE ON public.nf_audit
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_append_only();
CREATE TRIGGER nf_audit_no_truncate
  BEFORE TRUNCATE ON public.nf_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.nf_audit_append_only();

-- ── none of the above is callable from the API ─────────────────────────────
DO $revoke$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('nf_purging','nf_role','nf_actor_name','nf_fmt','nf_count_total',
                                'nf_position_row','nf_assert_not_negative','nf_checks',
                                'nf_accounts_tree_guard','nf_days_guard','nf_days_position_guard',
                                'nf_lines_guard','nf_lines_position_guard','nf_pdcs_guard',
                                'nf_members_guard','nf_members_last_director','nf_audit_row',
                                'nf_audit_append_only') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END
$revoke$;

COMMIT;
