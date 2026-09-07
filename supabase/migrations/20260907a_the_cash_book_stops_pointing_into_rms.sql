-- ════════════════════════════════════════════════════════════════════════
-- SEPARATION · step 2 — the cash book stops pointing into RMS
-- ────────────────────────────────────────────────────────────────────────
-- Phase 2 is cancelled. There is no pending allocation, no posting to the RMS
-- client ledger, no unapplied receipt, no handover JV. A client receipt from
-- here on carries a NAME, not a foreign key, and that cost is accepted.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- It drops four foreign keys and adds one text column. It does NOT drop
-- unit_id or sale_id, and it does not touch a single row.
--
-- That restraint is the point. `cash_entries` carries a trigger whose only job
-- is to refuse deletion and to refuse edits to its meaningful columns — a
-- saved entry is a fact (invariant 1). Dropping a column that has held meaning
-- is editing history by another name, and the same argument that kept the two
-- pre-pilot days in the book keeps these columns in the table: they cost
-- nothing empty, and removing them would make a guarantee slightly less true.
--
-- So the columns stay, nullable and unwritten. What goes is the CONSTRAINT —
-- the thing that makes this schema depend on RMS's tables existing.
--
-- TIMING. Awami's only entry today is an EXPENSE with unit_id NULL, so nothing
-- is stranded. This stops being free the moment a client receipt is recorded
-- against a real unit, which is why this runs BEFORE the parallel run and not
-- after.
--
-- WHAT SURVIVES. company_id, project_id and created_by/closed_by/exported_by
-- still reference companies, projects and app_users. That is identity and
-- tenancy, not RMS data, and it is deliberately out of scope here: replacing it
-- means designing an identity model, which belongs in the standalone blueprint
-- and not in a separation migration.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the four keys that reach into RMS data ──────────────────────────
ALTER TABLE public.cash_entries  DROP CONSTRAINT IF EXISTS cash_entries_unit_id_fkey;
ALTER TABLE public.cash_entries  DROP CONSTRAINT IF EXISTS cash_entries_sale_id_fkey;
ALTER TABLE public.payees        DROP CONSTRAINT IF EXISTS payees_client_id_fkey;
ALTER TABLE public.cash_accounts DROP CONSTRAINT IF EXISTS cash_accounts_bank_account_id_fkey;

-- ── 2 · the name that replaces the key ──────────────────────────────────
-- "For (unit / party)" on a receipt. Free text, because there is no master to
-- select from any more and inventing one here would be Phase 2 wearing a hat.
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS party_label text;

COMMENT ON COLUMN public.cash_entries.party_label IS
  'Who or what the money is for, as typed. Replaces unit_id after Phase 2 was cancelled on 2026-09-07: a client receipt carries a name, not a foreign key.';
COMMENT ON COLUMN public.cash_entries.unit_id IS
  'FROZEN 2026-09-07. Kept for the rows that already carry it; never written again. Not dropped, because dropping a column that has held meaning is editing history — see invariant 1.';
COMMENT ON COLUMN public.cash_entries.sale_id IS
  'FROZEN 2026-09-07. Same reasoning as unit_id.';

-- party_label is part of the record, so it is immutable with the rest of the
-- row. The immutability trigger reads its forbidden-column list from a helper;
-- adding the column there keeps a typed name as fixed as a selected one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cash_entries_immutable') THEN
    -- The guard compares OLD/NEW across all columns and permits only a known
    -- set to change (void marking, export stamping). party_label is not in
    -- that set, so it is already immutable by construction. This block exists
    -- to state that intent, not to change behaviour.
    RAISE NOTICE 'cash_entries_immutable(): party_label is immutable by default (not in the permitted-change set).';
  END IF;
END $$;

-- ── 2b · the two CHECK constraints that encoded "a receipt has a unit" ───
-- Found by the P4 rehearsal, not by reading: the rule lived in the table as
-- well as in the function, and a migration that changed only the function
-- would have been refused by the table on the first real receipt.

-- (i) a receipt must be FOR somebody — but that somebody is now a name.
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS cash_entries_client_receipt_unit;
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS cash_entries_client_receipt_party;
ALTER TABLE public.cash_entries
  ADD CONSTRAINT cash_entries_client_receipt_party
  CHECK (entry_type <> 'CLIENT_RECEIPT'
         OR (party_label IS NOT NULL AND btrim(party_label) <> ''))
  NOT VALID;
-- NOT VALID is the point, not a shortcut. 98 receipts already exist carrying a
-- unit_id and no party_label; validating against them would fail, and the only
-- way to make them pass would be to write into rows that a saved entry is a
-- fact (invariant 1). So the rule binds every NEW row and leaves history alone
-- — which is the same choice made everywhere else in this separation.

-- (ii) rms_status may now be NA on a receipt, because nothing is pending.
-- The old rule REQUIRED a receipt to be in some Phase 2 state; with Phase 2
-- cancelled that is exactly backwards. Non-receipts must still be NA.
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS cash_entries_rms_status_scope;
ALTER TABLE public.cash_entries
  ADD CONSTRAINT cash_entries_rms_status_scope
  CHECK (entry_type = 'CLIENT_RECEIPT' OR rms_status = 'NA');
-- This one validates cleanly against every existing row: historical receipts
-- keep whatever Phase 2 status they were given, and every non-receipt is
-- already NA.

-- ── 3 · the freeze is ENFORCED, not merely intended ─────────────────────
-- A frozen column that quietly starts filling again is how a residue becomes
-- permanent. record_cash_entry no longer writes these, but "no caller writes
-- it" is a statement about today; this is a statement about every day.
--
-- INSERT only. Existing rows keep their values, and the immutability trigger
-- already refuses to let them change — so this closes the one remaining door:
-- a NEW row arriving with a unit or sale attached.
CREATE OR REPLACE FUNCTION public.cash_entries_frozen_columns()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.unit_id IS NOT NULL OR NEW.sale_id IS NOT NULL THEN
    RAISE EXCEPTION
      'cash_entries.unit_id and sale_id are frozen (Phase 2 cancelled 2026-09-07). A receipt carries party_label, a name, not a key.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS _trg_cash_entries_frozen ON public.cash_entries;
CREATE TRIGGER _trg_cash_entries_frozen
  BEFORE INSERT ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.cash_entries_frozen_columns();

-- ── 4 · the unit picker is retired ──────────────────────────────────────
-- Nothing may select an RMS unit from inside the cash book any more. The
-- function is dropped rather than left returning an empty list, because a
-- caller that silently receives [] cannot tell "no units" from "no longer
-- available" — and a page that shows an empty picker invites somebody to
-- wonder where the units went.
DROP FUNCTION IF EXISTS public.list_units_for_picker(uuid, uuid);
