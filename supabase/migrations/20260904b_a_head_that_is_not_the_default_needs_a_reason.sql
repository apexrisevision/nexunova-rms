-- ═══════════════════════════════════════════════════════════════════════════
-- A head that is not the default needs a reason
-- ───────────────────────────────────────────────────────────────────────────
-- Invariant 5, finally enforced. P1 shipped entry_type_defaults and said so
-- plainly: the rule could not be a CHECK, because a CHECK constraint cannot
-- query another table, and P1's brief was shape and immutability only. This is
-- the trigger that was owed.
--
-- Two halves, both from invariant 5:
--
--   CLIENT MONEY DEFAULTS TO 2020. An entry whose qb_account differs from its
--   entry type's default is allowed — sometimes it is genuinely right — but it
--   must carry a written reason. Silence is refused, not corrected.
--
--   4010 IS FENCED. 'Unit - Shop Sales' is revenue, and revenue is recognised
--   at handover by a journal voucher, never by a receipt. Nothing may cite it
--   until Phase 3's recognize_revenue() exists. The gate is a transaction-local
--   setting, the same mechanism the audit trail already uses for an operator's
--   reason (rms.audit_reason) — so Phase 3 opens the gate by setting a flag
--   rather than by editing this trigger.
--
-- Types with no default (EXPENSE, TRANSFER, LOAN_CAPITAL, OTHER) require no
-- reason: there is nothing to deviate FROM. Choosing among 5xxx/6xxx/7xxx for
-- an expense is the ordinary act, not an override.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.cash_entries_qb_head_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_default    uuid;
  v_default_no char(4);
  v_default_nm text;
  v_chosen_no  char(4);
BEGIN
  ------------------------------------------------------------------ 4010 --
  -- Checked on every account an entry can name: the single head on a
  -- movement, and both legs of a journal voucher.
  IF COALESCE(current_setting('dc.revenue_recognition', true), '') <> 'on' THEN
    IF EXISTS (
      SELECT 1 FROM public.qb_accounts a
       WHERE a.number = '4010'
         AND a.id IN (NEW.qb_account_id, NEW.qb_debit_account_id, NEW.qb_credit_account_id)
    ) THEN
      RAISE EXCEPTION
        'REVENUE_ACCOUNT_FENCED: 4010 Unit - Shop Sales is credited only by the handover journal voucher, never by a receipt (invariant 5). Client money goes to 2020 Advance from Customers.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- A journal voucher names a debit and a credit and has no single head to
  -- compare against a default, so the override rule does not apply to it.
  IF NEW.voucher_type = 'JV' THEN
    RETURN NEW;
  END IF;

  -------------------------------------------------- the entry-type default --
  SELECT d.default_qb_account_id, a.number, a.name
    INTO v_default, v_default_no, v_default_nm
    FROM public.entry_type_defaults d
    LEFT JOIN public.qb_accounts a ON a.id = d.default_qb_account_id
   WHERE d.company_id = NEW.company_id
     AND d.entry_type = NEW.entry_type;

  -- No row, or a row with no default: nothing to deviate from.
  IF v_default IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.qb_account_id IS DISTINCT FROM v_default
     AND (NEW.qb_override_reason IS NULL OR btrim(NEW.qb_override_reason) = '') THEN
    SELECT a.number INTO v_chosen_no FROM public.qb_accounts a WHERE a.id = NEW.qb_account_id;
    RAISE EXCEPTION
      'OVERRIDE_REASON_REQUIRED: % defaults to % %; this entry cites % and gives no reason (invariant 5).',
      NEW.entry_type, v_default_no, v_default_nm, COALESCE(v_chosen_no::text, 'no account')
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.cash_entries_qb_head_guard() IS
  'BLUEPRINT invariant 5. Requires qb_override_reason when an entry''s QuickBooks head differs from its entry type''s default, and refuses account 4010 outright unless the transaction-local flag dc.revenue_recognition is set to ''on'' (Phase 3 handover JV only).';

DROP TRIGGER IF EXISTS _trg_cash_entries_qb_head ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_qb_head
  BEFORE INSERT ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.cash_entries_qb_head_guard();

COMMIT;
