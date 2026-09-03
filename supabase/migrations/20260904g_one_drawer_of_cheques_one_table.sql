-- ═══════════════════════════════════════════════════════════════════════════
-- One drawer of cheques, one table
-- ───────────────────────────────────────────────────────────────────────────
-- pdc_register is dropped. The module adopts public.pdc_cheques as its single
-- post-dated cheque table.
--
-- pdc_register was created in P1 for one reason only: the P1 brief named the
-- index pdc_register(project_id, status, due_date) in its required list, so
-- the table had to exist for the index to. It has never been written to.
--
-- RMS already runs a cheque register — pdc_cheques — with thirteen RPCs, a
-- page (js/pages/pdc.js), a feature flag, an audit trigger, and workflow the
-- blueprint's three-state model does not have: deposit scheduling, the bounce
-- penalty, and a replacement chain. Its live vocabulary is pending / cleared /
-- bounced, which is exactly §A4's three states, plus deposited and replaced.
-- The blueprint's model is a SUBSET of what already runs.
--
-- Two registers for one drawer of cheques is a reconciliation problem, not a
-- design: "which cheques are outstanding" would have two answers that drift the
-- first time somebody records a cheque in the wrong one. That is the class of
-- problem invariants 4 and 7 exist to prevent, and it would be self-inflicted.
--
-- Dropping it now costs one line. Dropping it after Phase 3 has written to it
-- costs a data migration.
--
-- ⚠️ NOTHING IS ADDED TO pdc_cheques HERE. The four fields it still needs —
-- kind (RECEIVABLE/PAYABLE), party_payee_id, cleared_entry_id, and a status
-- CHECK — are Phase 3 (P16) work, along with backfilling the one live row whose
-- project_id is NULL. Reasoning and the full plan: docs/daily-closing/PDC_DECISION.md.
--
-- 20260903e, which created the table, is NOT edited: an applied migration
-- should keep saying what it did. A rebuild from scratch replays e (create)
-- then this (drop), which is consistent. 20260903r drops it with IF EXISTS and
-- needs no change either.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to drop a table that somehow acquired rows while this was being decided.
DO $guard$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('public.pdc_register') IS NULL THEN
    RAISE NOTICE 'pdc_register is already gone; nothing to do';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.pdc_register' INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'REFUSING TO DROP: pdc_register holds % row(s). Migrate them into pdc_cheques first.', v_n;
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.pdc_register;

COMMENT ON TABLE public.pdc_cheques IS
  'The single post-dated cheque register — for RMS and, from 2026-09-04, for Daily Closing too. The blueprint''s pdc_register was dropped rather than run alongside it; see docs/daily-closing/PDC_DECISION.md. Phase 3 adds kind, party_payee_id, cleared_entry_id and a status CHECK.';

COMMIT;
