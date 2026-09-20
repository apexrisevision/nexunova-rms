-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — Fix pass 3 of 3: the MEDIUMs.
-- docs/AUDIT_REPORT.md MEDIUM-4, MEDIUM-1, LOW-1 (comment only).
--
-- No function here changes its argument list, so there are no stale
-- overloads to drop. One new function, nf_voucher_has_legs_check(), is a
-- trigger function — it takes no arguments and cannot be called over
-- PostgREST — and is REVOKEd from PUBLIC/anon/authenticated anyway, since a
-- fresh CREATE FUNCTION is PUBLIC-executable by default.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- MEDIUM-4 — Cash & Bank Movement showed a different opening from the sheet
-- ═════════════════════════════════════════════════════════════════════════
-- The report derived `opening` purely from voucher legs
--   CASE WHEN p_from IS NULL THEN 0
--        ELSE sum(debit − credit) WHERE voucher_date < p_from END
-- and never read nf_days.typed_open_cash / typed_open_petty / typed_open_bank.
-- The day sheet's opening comes from nf_ledger_position, which DOES add them.
-- So the money the company started with was missing from this report's opening
-- and therefore from its closing: one real day measured at 500,000 opening
-- read −60,000 on the report and +440,000 on the sheet.
--
-- The fix is not "add the typed opening here too" — that would be a second
-- implementation of the same arithmetic, free to drift again. It is to call
-- the SAME function the sheet calls, so the two cannot disagree by
-- construction:
--
--   nf_position_row's opening is
--     · first day  → d.typed_open_*
--     · later day  → nf_ledger_position(company, d.business_date)
--   and those two are the same expression, because
--     nf_ledger_position(c, first_day.business_date)
--       = typed_open + Σ(via legs in [first_day, first_day))
--       = typed_open + 0
--   so nf_ledger_position(company, <the day's date>) is correct for EVERY
--   day, the first one included. The report asks it for p_from.
--
-- p_from IS NULL means "all time", and the period CTE then sums every leg —
-- so the opening it needs is the balance before ANY voucher, i.e. the typed
-- opening, i.e. nf_ledger_position at the first day's own date. Hence
-- COALESCE(p_from, first day). With no first day at all, nf_ledger_position
-- returns 0/0/0 and nothing changes.
--
-- A Bank-typed head that is NOT a via account has no typed opening to read
-- (nothing in nf_days describes it), so it keeps the leg-derived figure.
-- Awami has none today — the three via accounts are its only Bank-typed
-- postable accounts — but the report does not assume that.
CREATE OR REPLACE FUNCTION public.nf_get_cash_bank_movement(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out   jsonb;
  v_first date;
  lp      record;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  SELECT business_date INTO v_first
    FROM public.nf_days WHERE company_id = p_company_id AND is_first_day;
  -- the sheet's own opening, asked for the start of this report's window
  SELECT * INTO lp FROM public.nf_ledger_position(p_company_id, COALESCE(p_from, v_first));

  WITH accts AS (
    SELECT a.code, a.name, a.via FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.qb_type = 'Bank' AND a.active
       AND (a.is_head OR a.via IS NOT NULL)
  ), opening AS (
    SELECT ac.code,
           CASE
             WHEN ac.via = 'Cash'  THEN lp.cash
             WHEN ac.via = 'Petty' THEN lp.petty
             WHEN ac.via = 'Bank'  THEN lp.bank
             -- a Bank-typed head with no via: no typed opening exists for it
             ELSE COALESCE((SELECT sum(l2.debit - l2.credit)
                              FROM public.nf_voucher_legs l2
                              JOIN public.nf_vouchers v2 ON v2.id = l2.voucher_id
                             WHERE l2.company_id = p_company_id AND l2.account_code = ac.code
                               AND v2.status = 'POSTED'
                               AND p_from IS NOT NULL AND v2.voucher_date < p_from), 0)
           END AS opening
      FROM accts ac
  ), period AS (
    SELECT ac.code,
           COALESCE(sum(l.debit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_in,
           COALESCE(sum(l.credit) FILTER (WHERE v.status = 'POSTED'
             AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)), 0) AS total_out
      FROM accts ac
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = p_company_id AND l.account_code = ac.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     GROUP BY ac.code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'code', ac.code, 'name', ac.name, 'opening', o.opening, 'total_in', pd.total_in,
                 'total_out', pd.total_out, 'closing', o.opening + pd.total_in - pd.total_out) ORDER BY ac.code)
                FROM accts ac JOIN opening o ON o.code = ac.code JOIN period pd ON pd.code = ac.code), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- MEDIUM-1 — a voucher header with no legs at all was possible
-- ═════════════════════════════════════════════════════════════════════════
-- nf_voucher_balance_check is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger on nf_voucher_LEGS: it raises NF:VOUCHER_NEEDS_TWO_LEGS only if at
-- least one leg row is touched. A row inserted straight into nf_vouchers with
-- no legs never fired it, and nf_vouchers carried nothing but nf_audit_row.
-- Not reachable by an application user (authenticated holds SELECT only on
-- nf_vouchers, and every RPC writes its legs in the same call) — the exposure
-- is service_role: migrations, import scripts, anything run with the service
-- key. This is the mirror image of that trigger, on the header, firing even
-- when no leg is ever touched.
--
-- DEFERRED is what makes it safe: nf_post_voucher inserts the header and then
-- its legs inside one statement, so at COMMIT the legs are there. An
-- IMMEDIATE check would reject every voucher the system creates.
--
-- Scope beyond the letter of the brief, stated so it is not a silent
-- widening: the brief said INSERT. This also fires on UPDATE OF status,
-- because a header inserted DRAFT (legal — nf_vouchers_status_check allows
-- DRAFT/POSTED/VOID) and later flipped to POSTED with no legs is the same
-- hole through a different door, and nf_voucher_balance_check would not catch
-- that either. `UPDATE OF status` is deliberately narrow: nf_save_line
-- updates voucher_no/narration/version on every edit and must not re-run this.
CREATE OR REPLACE FUNCTION public.nf_voucher_has_legs_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_legs integer;
  v_diff numeric;
BEGIN
  -- only a POSTED voucher makes a claim about the books
  IF NEW.status IS DISTINCT FROM 'POSTED' THEN RETURN NULL; END IF;

  SELECT count(*), sum(debit) - sum(credit) INTO v_legs, v_diff
    FROM public.nf_voucher_legs WHERE voucher_id = NEW.id;

  IF v_legs < 2 THEN
    RAISE EXCEPTION 'NF:VOUCHER_NEEDS_TWO_LEGS' USING DETAIL = NEW.id::text;
  END IF;
  IF v_diff IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'NF:VOUCHER_UNBALANCED'
      USING DETAIL = json_build_object('voucher_id', NEW.id, 'diff', v_diff)::text;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.nf_voucher_has_legs_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nf_voucher_has_legs_check ON public.nf_vouchers;
CREATE CONSTRAINT TRIGGER nf_voucher_has_legs_check
  AFTER INSERT OR UPDATE OF status ON public.nf_vouchers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.nf_voucher_has_legs_check();

-- Every voucher that already exists must satisfy it, or the trigger would be
-- a rule the live data breaks the moment anything touches it.
DO $pre$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.nf_vouchers v
   WHERE v.status = 'POSTED'
     AND (SELECT count(*) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id) < 2;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'NF:MIGRATION_ABORTED_LEGLESS_VOUCHERS'
      USING DETAIL = v_bad || ' posted voucher(s) already have fewer than two legs';
  END IF;
  RAISE NOTICE 'precondition ok: every posted voucher has >= 2 legs';
END
$pre$;

-- ═════════════════════════════════════════════════════════════════════════
-- LOW-1 — the reopen branch's comment was half stale. COMMENT ONLY.
-- ═════════════════════════════════════════════════════════════════════════
-- Nothing about what this function DOES changes. The body below was read
-- back from the live catalog and re-emitted with one comment block
-- rewritten; the generator asserted that stripping every comment line from
-- the before and after leaves two identical texts, so this cannot have
-- smuggled in a behaviour change.
CREATE OR REPLACE FUNCTION public.nf_days_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    IF (NEW.typed_open_cash, NEW.typed_open_petty, NEW.typed_open_bank, NEW.denominations, NEW.remarks)
       IS DISTINCT FROM
       (OLD.typed_open_cash, OLD.typed_open_petty, OLD.typed_open_bank, OLD.denominations, OLD.remarks) THEN
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
      -- NF:LATER_DAY_EXISTS removed here (owner decision, 2026-09-18):
      -- it existed only because the chained opening (fixed in 20260918b)
      -- could not see an earlier edit. In its place: a day may be
      -- reopened at any point *within its still-open accounting period*;
      -- once a period is locked or exported to QuickBooks, no day inside
      -- it may be reopened at all — corrections from that point on are a
      -- new voucher dated in the current open period, never a rewrite of
      -- history.
      --
      -- STATUS, corrected 2026-09-20 (AUDIT_REPORT.md LOW-1). The comment
      -- above used to end "period locking does not exist yet". Half of it
      -- does now, and the half that does is the half that mattered:
      -- 20260919k locks an EXPORTED VOUCHER. nf_save_line and
      -- nf_delete_line both refuse to touch a voucher already written to an
      -- IIF batch (NF:VOUCHER_ALREADY_EXPORTED), and 20260919p added
      -- NF:PERIOD_CLOSED to nf_jv_save / nf_jv_delete for any date on or
      -- before the latest CLOSED day. So reopening a day can no longer be
      -- used to EDIT a voucher QuickBooks already has.
      --
      -- What is still missing is the DAY-level gate: reopening such a day
      -- is itself still permitted, and once open a NEW line may be added to
      -- it, landing inside a period QuickBooks has already been given. That
      -- is still future work, so the rule enforced here today is still
      -- "any day" — and still not the final word.
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
$function$
;

COMMIT;
