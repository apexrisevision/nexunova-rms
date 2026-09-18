-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · d · migrate nf_lines and transfers
--                                            to vouchers/legs
--
-- REVERSIBLE, REHEARSED, VERIFIED TO THE RUPEE — do not apply to live until
-- the rehearsal in scripts/nf/verify-nf-de-migration.js has passed. That
-- script runs this exact file's logic inside BEGIN/ROLLBACK against the
-- live database (see docs/PLAN.md §11 for why a true separate scratch
-- database is not available on this infrastructure, and why BEGIN/ROLLBACK
-- against live is the substitute this project already uses) and asserts,
-- for every existing (company, business_date), that in/out AND the
-- transfer effect reconcile to the rupee, before this file is ever allowed
-- to COMMIT for real.
--
-- Reversal: 20260918r_nf_de_rollback.sql reconstructs nf_lines_legacy and
-- nf_days.transfer_to_bank/petty from the vouchers this file creates.
--
-- Live scope at the time this was written: Awami itself has zero nf_days
-- and zero nf_lines rows (checked directly against the live database,
-- 2026-09-18) — the only tenant with real rows is the persistent
-- ZZTEST-NF-DEMO company (1 day, 8 lines, and a real transfer_to_bank of
-- 300000 on that same OPEN day). This migration is written generically
-- (works for any company) and is rehearsed against that real data
-- specifically, because proving it against real, non-trivial data —
-- including the one live transfer — is a stronger proof than proving it
-- against nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.nf_lines RENAME TO nf_lines_legacy;

-- capture the pre-migration transfer figures BEFORE anything about them
-- changes, purely so 20260918d's own verification below (and the rollback,
-- if this is ever undone) has the original numbers to check against
CREATE TEMP TABLE nf_de_transfer_snapshot AS
  SELECT id AS day_id, company_id, business_date, transfer_to_bank, transfer_to_petty
    FROM public.nf_days WHERE transfer_to_bank IS NOT NULL OR transfer_to_petty IS NOT NULL;

-- ── migrate: one legacy row → one 2-leg voucher; one transfer → one 2-leg
--    voucher between via-accounts ──────────────────────────────────────
-- Bulk system load, not a user action — the per-row guard triggers on
-- nf_voucher_legs assume an authenticated app user (auth.uid() via a JWT)
-- and would reject every row here (auth.uid() is NULL outside PostgREST).
-- Disabling triggers for a scripted, single-shot, audited-as-one-event bulk
-- load is the standard Postgres pattern for exactly this situation — it is
-- not a way around any rule a real user's action goes through, since no
-- user action reaches this path.
-- USER, not ALL: ALL also tries to touch Postgres's own internal
-- foreign-key RI triggers, which only a superuser may disable — the
-- Supabase Management API's SQL role is not one, and there is no need to
-- touch those anyway, only the app-level guard/audit triggers.
ALTER TABLE public.nf_vouchers DISABLE TRIGGER USER;
ALTER TABLE public.nf_voucher_legs DISABLE TRIGGER USER;

INSERT INTO public.nf_vouchers (id, company_id, day_id, voucher_no, voucher_date, narration, status, sort,
                                created_by, created_at, updated_by, updated_at, posted_by, posted_at, version)
SELECT l.id, l.company_id, l.day_id, l.voucher_no, d.business_date, l.description, 'POSTED', l.sort,
       l.created_by, l.created_at, l.updated_by, l.updated_at, l.created_by, l.created_at, l.version
  FROM public.nf_lines_legacy l JOIN public.nf_days d ON d.id = l.day_id;

-- head leg: the account the cashier actually chose, keeping its side's
-- accounting sense (IN credits the head, OUT debits it — see the §b
-- design note in 20260918b for why this direction is correct, including
-- for the director-receivable case).
INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit,
                                    created_by, created_at, updated_by, updated_at)
SELECT gen_random_uuid(), l.company_id, l.id, 1, l.head_code, l.floor_code,
       CASE WHEN l.side = 'OUT' THEN l.amount ELSE 0 END,
       CASE WHEN l.side = 'IN'  THEN l.amount ELSE 0 END,
       l.created_by, l.created_at, l.updated_by, l.updated_at
  FROM public.nf_lines_legacy l;

-- via leg: the cash/petty/bank account the head leg used to be implicitly
-- paired with. Same floor as the head leg — the single-entry model only
-- ever recorded one floor per movement, so there is no better answer for
-- "which floor does the cash-side leg belong to" than the one the line
-- already had.
INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit,
                                    created_by, created_at, updated_by, updated_at)
SELECT gen_random_uuid(), l.company_id, l.id, 2, a.code, l.floor_code,
       CASE WHEN l.side = 'IN'  THEN l.amount ELSE 0 END,
       CASE WHEN l.side = 'OUT' THEN l.amount ELSE 0 END,
       l.created_by, l.created_at, l.updated_by, l.updated_at
  FROM public.nf_lines_legacy l
  JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.via = l.via;

-- transfers: a "Cr Cash / Dr Bank" (and/or "Dr Petty") voucher per day that
-- had a typed transfer amount — the exact same shape nf_set_transfers now
-- creates going forward (20260918c), so the migrated data and all new data
-- share one representation with no special case anywhere.
INSERT INTO public.nf_vouchers (id, company_id, day_id, voucher_no, voucher_date, narration, status, sort,
                                created_by, created_at, posted_by, posted_at, version)
SELECT gen_random_uuid(), s.company_id, s.day_id, 'XFR-BANK-' || s.day_id::text, s.business_date, 'Transfer',
       'POSTED', 0, d.created_by, d.created_at, d.created_by, d.created_at, 0
  FROM nf_de_transfer_snapshot s JOIN public.nf_days d ON d.id = s.day_id
 WHERE s.transfer_to_bank IS NOT NULL AND s.transfer_to_bank <> 0;

INSERT INTO public.nf_vouchers (id, company_id, day_id, voucher_no, voucher_date, narration, status, sort,
                                created_by, created_at, posted_by, posted_at, version)
SELECT gen_random_uuid(), s.company_id, s.day_id, 'XFR-PETTY-' || s.day_id::text, s.business_date, 'Transfer',
       'POSTED', 0, d.created_by, d.created_at, d.created_by, d.created_at, 0
  FROM nf_de_transfer_snapshot s JOIN public.nf_days d ON d.id = s.day_id
 WHERE s.transfer_to_petty IS NOT NULL AND s.transfer_to_petty <> 0;

-- the floor convention nf_set_transfers now uses for every future
-- transfer too — the company's first floor by sort order, since a
-- transfer has no natural floor and the single-entry model never
-- captured one for it either
INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit, created_by, created_at)
SELECT gen_random_uuid(), s.company_id, v.id, 1, ab.code,
       (SELECT code FROM public.nf_floors f WHERE f.company_id = s.company_id ORDER BY f.sort LIMIT 1),
       s.transfer_to_bank, 0, d.created_by, d.created_at
  FROM nf_de_transfer_snapshot s
  JOIN public.nf_days d ON d.id = s.day_id
  JOIN public.nf_vouchers v ON v.company_id = s.company_id AND v.voucher_key = upper('XFR-BANK-' || s.day_id::text)
  JOIN public.nf_accounts ab ON ab.company_id = s.company_id AND ab.via = 'Bank'
 WHERE s.transfer_to_bank IS NOT NULL AND s.transfer_to_bank <> 0;

INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit, created_by, created_at)
SELECT gen_random_uuid(), s.company_id, v.id, 2, ac.code,
       (SELECT code FROM public.nf_floors f WHERE f.company_id = s.company_id ORDER BY f.sort LIMIT 1),
       0, s.transfer_to_bank, d.created_by, d.created_at
  FROM nf_de_transfer_snapshot s
  JOIN public.nf_days d ON d.id = s.day_id
  JOIN public.nf_vouchers v ON v.company_id = s.company_id AND v.voucher_key = upper('XFR-BANK-' || s.day_id::text)
  JOIN public.nf_accounts ac ON ac.company_id = s.company_id AND ac.via = 'Cash'
 WHERE s.transfer_to_bank IS NOT NULL AND s.transfer_to_bank <> 0;

INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit, created_by, created_at)
SELECT gen_random_uuid(), s.company_id, v.id, 1, ap.code,
       (SELECT code FROM public.nf_floors f WHERE f.company_id = s.company_id ORDER BY f.sort LIMIT 1),
       s.transfer_to_petty, 0, d.created_by, d.created_at
  FROM nf_de_transfer_snapshot s
  JOIN public.nf_days d ON d.id = s.day_id
  JOIN public.nf_vouchers v ON v.company_id = s.company_id AND v.voucher_key = upper('XFR-PETTY-' || s.day_id::text)
  JOIN public.nf_accounts ap ON ap.company_id = s.company_id AND ap.via = 'Petty'
 WHERE s.transfer_to_petty IS NOT NULL AND s.transfer_to_petty <> 0;

INSERT INTO public.nf_voucher_legs (id, company_id, voucher_id, line_no, account_code, floor_code, debit, credit, created_by, created_at)
SELECT gen_random_uuid(), s.company_id, v.id, 2, ac.code,
       (SELECT code FROM public.nf_floors f WHERE f.company_id = s.company_id ORDER BY f.sort LIMIT 1),
       0, s.transfer_to_petty, d.created_by, d.created_at
  FROM nf_de_transfer_snapshot s
  JOIN public.nf_days d ON d.id = s.day_id
  JOIN public.nf_vouchers v ON v.company_id = s.company_id AND v.voucher_key = upper('XFR-PETTY-' || s.day_id::text)
  JOIN public.nf_accounts ac ON ac.company_id = s.company_id AND ac.via = 'Cash'
 WHERE s.transfer_to_petty IS NOT NULL AND s.transfer_to_petty <> 0;

ALTER TABLE public.nf_vouchers ENABLE TRIGGER USER;
ALTER TABLE public.nf_voucher_legs ENABLE TRIGGER USER;

-- one summary audit row for the migration event itself, in place of one
-- synthetic row per migrated line (noise, not signal — these are not new
-- user actions, they are the same historical facts in a new shape)
INSERT INTO public.nf_audit (company_id, entity, entity_id, action, actor, actor_name, after)
SELECT DISTINCT l.company_id, 'nf_lines_legacy', 'MIGRATION:20260918d', 'INSERT', NULL::uuid, 'system migration 20260918d',
       jsonb_build_object('migrated_count', (SELECT count(*) FROM public.nf_lines_legacy x WHERE x.company_id = l.company_id))
  FROM public.nf_lines_legacy l;

-- ── the compatibility view, now that the table it would collide with is
--    out of the way ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.nf_lines AS
SELECT
  hl.id,
  v.company_id,
  v.day_id,
  CASE WHEN vl.debit > 0 THEN 'IN' ELSE 'OUT' END AS side,
  v.voucher_no,
  v.voucher_key,
  v.narration AS description,
  hl.account_code AS head_code,
  hl.floor_code,
  va.via AS via,
  (vl.debit + vl.credit) AS amount,
  v.sort,
  v.version,
  v.created_by, v.created_at, v.updated_by, v.updated_at
FROM public.nf_voucher_legs hl
JOIN public.nf_vouchers v ON v.id = hl.voucher_id
JOIN public.nf_voucher_legs vl ON vl.voucher_id = hl.voucher_id AND vl.line_no = 2
JOIN public.nf_accounts va ON va.company_id = v.company_id AND va.code = vl.account_code
LEFT JOIN public.nf_accounts ha ON ha.company_id = v.company_id AND ha.code = hl.account_code
WHERE hl.line_no = 1 AND v.status = 'POSTED' AND va.via IS NOT NULL
  -- the head leg must NOT itself be a via-account — a pure transfer
  -- voucher (both legs via-accounts, e.g. Dr Bank/Cr Cash) is real
  -- double-entry data but is not a cash-book "line": it has no head at
  -- all, and would otherwise leak in here with a nonsense head_code and
  -- feed straight into in/out, double-counting against nf_position_row's
  -- own separate transfer figure (which sums exactly these vouchers).
  AND (ha.via IS NULL)
  -- exactly 2 legs: a >2-leg voucher (e.g. one head split across several
  -- units, or the no-via inter-company pattern) is real double-entry data
  -- but is not cash-book data — it must not leak into this view with a
  -- head/via amount mismatch, so it simply does not appear here at all.
  AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs x WHERE x.voucher_id = hl.voucher_id AND x.line_no NOT IN (1,2));

GRANT SELECT ON public.nf_lines TO authenticated;

-- ── transfers stop being columns on nf_days — GUARD CHANGE, flagged, and
--    directly instructed by the owner (2026-09-18): "under double-entry a
--    transfer is just an ordinary voucher, not a special case... that
--    special-casing should collapse into the normal path." nf_days_guard
--    referenced these two columns in its immutable-column comparisons;
--    both references are removed along with the columns. ────────────────
CREATE OR REPLACE FUNCTION public.nf_days_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
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
      -- history. Period locking does not exist yet (it is built as part
      -- of the IIF export pass, a named hard dependency — see
      -- docs/PLAN.md §11.6), so the enforceable rule today is simply "any
      -- day" — harmless for now because nothing downstream reads a
      -- locked/exported state yet, but NOT to be treated as the final
      -- word once that gate exists.
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
$function$;

-- nf_days_position_guard watches transfer_to_bank/transfer_to_petty
-- specifically (AFTER INSERT OR UPDATE OF typed_open_*, transfer_to_bank,
-- transfer_to_petty) — found only when the column drop below refused with
-- a dependency error, not assumed. Its job for a transfer is now done by
-- nf_voucher_legs_position_guard (20260918b), which already re-asserts
-- non-negative position on every insert/update/delete to a transfer
-- voucher's legs — the same real-world event, covered the same way every
-- other posting already is. The trigger is recreated watching only the
-- typed_open_* columns, which still live on nf_days as the fixed genesis
-- constant.
DROP TRIGGER nf_days_position_guard ON public.nf_days;
CREATE TRIGGER nf_days_position_guard AFTER INSERT OR UPDATE OF typed_open_cash, typed_open_petty, typed_open_bank
  ON public.nf_days FOR EACH ROW EXECUTE FUNCTION nf_days_position_guard();

ALTER TABLE public.nf_days DROP CONSTRAINT IF EXISTS nf_days_transfer_to_bank_check;
ALTER TABLE public.nf_days DROP CONSTRAINT IF EXISTS nf_days_transfer_to_petty_check;
ALTER TABLE public.nf_days DROP COLUMN IF EXISTS transfer_to_bank;
ALTER TABLE public.nf_days DROP COLUMN IF EXISTS transfer_to_petty;

-- ── to-the-rupee verification ───────────────────────────────────────────
-- Every day that existed before this file ran must show the exact same
-- in/out under the new schema as it did under the old one, AND the exact
-- same transfer effect (checked against the snapshot taken before the
-- columns were touched). Raises and rolls back the whole file if not —
-- this assertion runs whether this file is executed for real or inside
-- the rehearsal's BEGIN/ROLLBACK.
DO $verify$
DECLARE
  r record;
  s record;
  v_old_in numeric; v_old_out numeric;
  v_new_in numeric; v_new_out numeric;
  v_new_trf_bank numeric; v_new_trf_petty numeric;
  v_mismatches integer := 0;
BEGIN
  FOR r IN SELECT id, company_id, business_date FROM public.nf_days LOOP
    SELECT COALESCE(sum(amount) FILTER (WHERE side='IN'), 0), COALESCE(sum(amount) FILTER (WHERE side='OUT'), 0)
      INTO v_old_in, v_old_out
      FROM public.nf_lines_legacy WHERE day_id = r.id;
    SELECT COALESCE(sum(amount) FILTER (WHERE side='IN'), 0), COALESCE(sum(amount) FILTER (WHERE side='OUT'), 0)
      INTO v_new_in, v_new_out
      FROM public.nf_lines WHERE day_id = r.id;
    IF v_old_in IS DISTINCT FROM v_new_in OR v_old_out IS DISTINCT FROM v_new_out THEN
      v_mismatches := v_mismatches + 1;
      RAISE WARNING 'NF-MIGRATION-MISMATCH day=% old(in=%,out=%) new(in=%,out=%)',
        r.id, v_old_in, v_old_out, v_new_in, v_new_out;
    END IF;

    SELECT trf_bank, trf_petty INTO v_new_trf_bank, v_new_trf_petty FROM public.nf_position_row(r.id);
    SELECT * INTO s FROM nf_de_transfer_snapshot WHERE day_id = r.id;
    IF COALESCE(s.transfer_to_bank, 0) IS DISTINCT FROM v_new_trf_bank
       OR COALESCE(s.transfer_to_petty, 0) IS DISTINCT FROM v_new_trf_petty THEN
      v_mismatches := v_mismatches + 1;
      RAISE WARNING 'NF-MIGRATION-TRANSFER-MISMATCH day=% old(bank=%,petty=%) new(bank=%,petty=%)',
        r.id, s.transfer_to_bank, s.transfer_to_petty, v_new_trf_bank, v_new_trf_petty;
    END IF;
  END LOOP;
  IF v_mismatches > 0 THEN
    RAISE EXCEPTION 'NF:MIGRATION_MISMATCH' USING DETAIL = v_mismatches || ' mismatch(es) — see WARNINGs above';
  END IF;
END
$verify$;

COMMIT;
