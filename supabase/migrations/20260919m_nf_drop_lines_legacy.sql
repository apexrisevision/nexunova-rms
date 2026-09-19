-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19m · Drop nf_lines_legacy
--
-- Housekeeping from the blueprint conformance audit (docs/PLAN.md §31),
-- approved by the owner. nf_lines_legacy is the pre-double-entry table
-- (renamed away by 20260918d, which was meant to drop it once the view
-- proved out). It has been empty since — confirmed 0 rows before this was
-- written — and nothing reads it: nf_lines is a VIEW over nf_voucher_legs /
-- nf_vouchers. Its audit and guard triggers, RLS policy and grants go with
-- it. Refuses to run if the table is not actually empty.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.nf_lines_legacy;
  IF n <> 0 THEN RAISE EXCEPTION 'NF:LEGACY_NOT_EMPTY' USING DETAIL = n::text; END IF;
END $$;

DROP TABLE public.nf_lines_legacy;

COMMIT;
