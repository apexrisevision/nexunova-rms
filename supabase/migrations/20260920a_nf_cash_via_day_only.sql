-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — Fix pass 2 of 3: cash can only move through days.
-- docs/AUDIT_REPORT.md CRITICAL-1, CRITICAL-2, HIGH-1.
--
-- THE INVARIANT
--   An account with via IS NOT NULL (10100 Cash in Hand, 10200 Petty Cash,
--   10300 Bank Al-Habib) may only ever appear on a leg of a DAY-ATTACHED
--   voucher. A journal voucher (day_id IS NULL) can never touch one.
--
-- WHY IT MATTERS (CRITICAL-1 + CRITICAL-2, which are the same hole seen
-- from two ends)
--   nf_voucher_legs_position_guard skips any voucher with day_id IS NULL
--   ("there is no shared day to serialize against"), so nf_assert_not_negative
--   never runs for a journal voucher — a JV crediting 10100 could drive the
--   till negative with nothing to stop it.
--   And nf_position_row is asymmetric: a day's OPENING comes from
--   nf_ledger_position, which is DATE-scoped (every POSTED voucher with a via
--   leg between the first day and this one, day-attached or not), while its
--   CLOSING is DAY-scoped (nf_lines WHERE day_id = …, plus the transfer
--   subquery's WHERE v.day_id = p_day_id). A day-less voucher carrying a via
--   leg therefore lands in the NEXT day's opening but in NO day's closing, so
--   day N's printed closing and day N+1's printed opening disagree — and once
--   day N is CLOSED its close_cash is a frozen snapshot, so the disagreement
--   is permanent and un-recomputable.
--   Forbidding the shape outright removes both: with no via leg possible off
--   the day path, date-scoped and day-scoped agree by construction.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE MECHANISM CHOSEN, AND THE INTERACTION THAT FORCED THE CHOICE
--
--   Day-path vouchers carry via legs on purpose. nf_save_line resolves
--   v_via_code from nf_accounts WHERE via = p_via and posts it as the second
--   leg of EVERY receipt and payment; nf_set_transfers posts vouchers whose
--   BOTH legs are via accounts. nf_voucher_legs_guard accepts a leg only if
--   the account is `is_head AND active`. That is precisely why 20260918a ran
--   `UPDATE nf_accounts SET is_head = true WHERE via IS NOT NULL` and dropped
--   nf_accounts_head_not_via: under the leg guard's test, "postable" and
--   "is_head" were the same bit, so making via accounts postable meant making
--   them heads.
--
--   But is_head carries TWO meanings that were never separated:
--     (a) "a voucher leg may reference this account" — the leg guard, and
--         nf_accounts_tree_guard, which ALREADY spells this as
--         `(is_head OR via IS NOT NULL)`;
--     (b) "a cashier may choose this from the HEAD dropdown of a receipt or
--         payment" — nf_list_heads, which feeds both the Daily Closing sheet
--         and the Journal Voucher screen.
--   Blueprint rule R4 is about (b): a via account is the OTHER side of a cash
--   line, never its head. 20260918a needed (a) and paid for it with (b).
--
--   CHOSEN: split the two. is_head goes back to meaning (b) only, the via
--   accounts go back to is_head = false, nf_accounts_head_not_via is restored
--   verbatim, and "postable" is spelled out where it is actually meant —
--   `active AND (is_head OR via IS NOT NULL)` — exactly the expression
--   nf_accounts_tree_guard has used since 20260916b. Day-path receipts,
--   payments and transfers keep working unchanged; R4 is a real CHECK again.
--
--   The three consumers of the old conflation, all handled below:
--     · nf_voucher_legs_guard     → postability spelled out, meaning (a)
--     · nf_get_cash_bank_movement → picks its accounts by `qb_type='Bank'
--       AND is_head`; left alone it would return an EMPTY report, since the
--       three via accounts are the only Bank-typed heads Awami has (verified
--       live: exactly 3 rows today). Widened to the same (a) expression.
--     · nf_list_heads             → the one place that WANTS them gone, (b).
--   Not touched, deliberately: nf_lines_guard also tests `NOT v_acc.is_head`,
--   but nf_lines is a VIEW with no trigger on it (verified live: pg_trigger
--   holds no row for nf_lines_guard), so that body is unreachable dead code
--   left from the single-entry era. nf_list_all_accounts reports the is_head
--   flag but filters only on `active`, so the General Ledger account picker
--   still offers cash and bank; no JS file reads is_head at all.
--
--   No function below changes its argument list, so there are no stale
--   overloads to drop. The one NEW function, nf_assert_not_negative_company,
--   is REVOKEd from PUBLIC/anon/authenticated at creation — a fresh
--   CREATE FUNCTION is PUBLIC-executable by default.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0. Preconditions ─────────────────────────────────────────────────────
-- Nothing already posted may violate the invariant, or the guard below would
-- turn a historical fact into an un-editable row. The 64 imported Awami
-- vouchers are all day_id IS NULL by design (they are what FMH/KBH/a director
-- paid on Awami's behalf, never Awami's own till), so none should carry a via
-- leg. Assert it rather than assume it.
DO $pre$
DECLARE v_bad integer; v_import integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.nf_vouchers v
   WHERE v.day_id IS NULL
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs l
                   JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                  WHERE l.voucher_id = v.id AND a.via IS NOT NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'NF:MIGRATION_ABORTED_DAYLESS_VIA_LEGS'
      USING DETAIL = v_bad || ' day-less voucher(s) already carry a via-account leg; '
                  || 'this migration would make them un-editable. Resolve them first.';
  END IF;

  SELECT count(*) INTO v_import
    FROM public.nf_vouchers
   WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid
     AND day_id IS NULL AND source = 'IMPORT';
  IF v_import <> 64 THEN
    RAISE EXCEPTION 'NF:MIGRATION_ABORTED_UNEXPECTED_IMPORT_COUNT'
      USING DETAIL = 'expected 64 imported Awami vouchers, found ' || v_import;
  END IF;
  RAISE NOTICE 'precondition ok: 0 day-less vouchers touch a via account; % imported Awami vouchers', v_import;
END
$pre$;

-- ── 1. R4 restored (HIGH-1) ──────────────────────────────────────────────
-- Reset first, then re-add — the CHECK cannot be added while the rows
-- 20260918a flipped are still true (the same order 20260918r's rollback uses).
UPDATE public.nf_accounts SET is_head = false WHERE via IS NOT NULL;

-- nf_accounts_tree_guard is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger, so the UPDATE above leaves pending trigger events and the ALTER
-- below would fail with 55006 "cannot ALTER TABLE because it has pending
-- trigger events". Fire it now instead: it also means that if the reset ever
-- DID break the account tree, this migration finds out here rather than at
-- COMMIT. (The three via accounts are leaves under 10000 and stay leaves —
-- the guard reads `is_head OR via IS NOT NULL`, which the reset does not
-- change — so this is a no-op today. Verified live: 0 children each.)
SET CONSTRAINTS public.nf_accounts_tree_guard IMMEDIATE;

ALTER TABLE public.nf_accounts
  ADD CONSTRAINT nf_accounts_head_not_via CHECK (NOT (is_head AND (via IS NOT NULL)));

-- ── 2. nf_list_heads excludes via accounts ───────────────────────────────
-- Belt and braces: the is_head reset above is already enough, but the filter
-- is written out so the exclusion holds even if a row's flag is ever wrong.
-- This RPC feeds BOTH the Daily Closing head picker and the Journal Voucher
-- account picker, so the JV screen can no longer even offer 10100/10200/10300.
CREATE OR REPLACE FUNCTION public.nf_list_heads(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'requires_party', a.requires_party) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active
                      AND a.via IS NULL), '[]'::jsonb);
END
$$;

-- ── 3. The leg guard: postability spelled out, and the invariant enforced ─
CREATE OR REPLACE FUNCTION public.nf_voucher_legs_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_voucher public.nf_vouchers;
  v_status  text;
  v_role    text;
  v_acc     public.nf_accounts;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.voucher_id <> OLD.voucher_id
                           OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  v_role := public.nf_role(v_company);
  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;

  -- Same lock nf_lines_guard took on the day row: one writer to a given
  -- day's postings at a time, so R1/the balance check sees a consistent
  -- picture. A day-less voucher has no shared day row to serialize against;
  -- from this migration on it also can never touch cash (see below), so there
  -- is no position for two of them to race over either.
  IF v_voucher.day_id IS NOT NULL THEN
    SELECT d.status INTO v_status FROM public.nf_days d
     WHERE d.id = v_voucher.day_id AND d.company_id = v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO v_acc FROM public.nf_accounts a WHERE a.company_id = v_company AND a.code = NEW.account_code;
  -- "Postable" is not the same question as "offered in the head dropdown".
  -- A via account is never a head (R4, nf_accounts_head_not_via) but is
  -- always postable — it is the other leg of every receipt and payment and
  -- BOTH legs of a transfer. Same expression nf_accounts_tree_guard uses.
  IF NOT FOUND OR NOT v_acc.active OR NOT (v_acc.is_head OR v_acc.via IS NOT NULL) THEN
    RAISE EXCEPTION 'NF:HEAD_NOT_POSTABLE' USING DETAIL = NEW.account_code;
  END IF;

  -- THE INVARIANT. Cash, petty cash and the bank move only inside a daily
  -- closing, where nf_assert_not_negative runs and where the day's printed
  -- opening and its printed closing both see the movement. A journal voucher
  -- posts with day_id NULL (nf_jv_save, always) and must never name one.
  IF v_voucher.day_id IS NULL AND v_acc.via IS NOT NULL THEN
    RAISE EXCEPTION 'NF:CASH_VIA_DAY_ONLY'
      USING DETAIL = json_build_object('account', v_acc.code, 'name', v_acc.name, 'via', v_acc.via)::text,
            HINT   = 'Cash, petty cash and bank movements belong in the daily closing, not a journal voucher.';
  END IF;

  IF v_acc.requires_party AND NEW.party_id IS NULL THEN
    RAISE EXCEPTION 'NF:PARTY_REQUIRED' USING DETAIL = NEW.account_code;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;

-- ── 4. Cash & Bank Movement keeps its accounts ───────────────────────────
-- Unchanged apart from how the account set is chosen: the three via accounts
-- stopped being is_head in step 1, and they are the entire subject of this
-- report.
CREATE OR REPLACE FUNCTION public.nf_get_cash_bank_movement(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  WITH accts AS (
    SELECT a.code, a.name FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.qb_type = 'Bank' AND a.active
       AND (a.is_head OR a.via IS NOT NULL)
  ), opening AS (
    SELECT ac.code,
           CASE WHEN p_from IS NULL THEN 0 ELSE COALESCE(sum(l.debit - l.credit) FILTER (
             WHERE v.status = 'POSTED' AND v.voucher_date < p_from), 0) END AS opening
      FROM accts ac
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = p_company_id AND l.account_code = ac.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id
     GROUP BY ac.code
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

-- ── 5. The position guard no longer SKIPS a day-less voucher ─────────────
-- Step 3 makes a day-less via leg impossible, so the new branch should never
-- fire. It exists because "impossible" and "unchecked" are different things:
-- if some future path ever does post one, the correct response is to assert
-- the COMPANY-WIDE position, not to wave it through the way the old
-- `IF v_day IS NOT NULL` did.
CREATE OR REPLACE FUNCTION public.nf_assert_not_negative_company(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lp record;
  v_via text; v_amt numeric;
BEGIN
  -- 'infinity' = "as of every posted voucher there is", day-attached or not.
  SELECT * INTO lp FROM public.nf_ledger_position(p_company_id, 'infinity'::date);
  IF    lp.cash  < 0 THEN v_via := 'Cash';  v_amt := lp.cash;
  ELSIF lp.petty < 0 THEN v_via := 'Petty'; v_amt := lp.petty;
  ELSIF lp.bank  < 0 THEN v_via := 'Bank';  v_amt := lp.bank;
  END IF;
  IF v_via IS NOT NULL THEN
    RAISE EXCEPTION 'NF:NEGATIVE_POSITION'
      USING DETAIL = json_build_object('via', v_via, 'would_be', v_amt, 'scope', 'company')::text,
            HINT   = 'A payment cannot exceed the money available.';
  END IF;
END
$$;
-- internal trigger helper: same grant shape as nf_assert_not_negative, which
-- holds nothing beyond postgres/service_role.
REVOKE ALL ON FUNCTION public.nf_assert_not_negative_company(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.nf_voucher_legs_position_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_voucher uuid := COALESCE(NEW.voucher_id, OLD.voucher_id);
  v_day     uuid;
  v_has_via boolean;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  SELECT day_id INTO v_day FROM public.nf_vouchers WHERE id = v_voucher;
  IF v_day IS NOT NULL THEN
    PERFORM public.nf_assert_not_negative(v_day);
  ELSE
    -- A day-less voucher that touches no cash cannot move a position, so
    -- there is nothing to assert — that is the common case (every journal
    -- voucher, all 64 imported ones). One that DOES touch cash should have
    -- been refused by nf_voucher_legs_guard with NF:CASH_VIA_DAY_ONLY; if it
    -- reached here anyway, assert company-wide rather than skip.
    SELECT EXISTS (SELECT 1 FROM public.nf_voucher_legs l
                     JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                    WHERE l.voucher_id = v_voucher AND a.via IS NOT NULL)
      INTO v_has_via;
    IF v_has_via THEN
      PERFORM public.nf_assert_not_negative_company(v_company);
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- ── 6. Proof, inside the same transaction ────────────────────────────────
DO $post$
DECLARE v_heads integer; v_vias integer; v_cbm integer;
BEGIN
  SELECT count(*) INTO v_heads FROM public.nf_accounts
   WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid AND is_head AND active AND via IS NULL;
  SELECT count(*) INTO v_vias FROM public.nf_accounts WHERE is_head AND via IS NOT NULL;
  SELECT count(*) INTO v_cbm FROM public.nf_accounts
   WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'::uuid AND qb_type = 'Bank' AND active
     AND (is_head OR via IS NOT NULL);
  IF v_heads <> 79 THEN RAISE EXCEPTION 'expected 79 Awami heads after the reset, got %', v_heads; END IF;
  IF v_vias  <> 0  THEN RAISE EXCEPTION 'a via account is still flagged is_head (% rows)', v_vias; END IF;
  IF v_cbm   <> 3  THEN RAISE EXCEPTION 'Cash & Bank Movement would cover % accounts, expected 3', v_cbm; END IF;
  RAISE NOTICE 'post ok: Awami heads 82 -> %, via-heads %, cash/bank movement accounts %', v_heads, v_vias, v_cbm;
END
$post$;

COMMIT;
