-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — follow-up to 20260921m (docs/PLAN.md §44), found by the
-- rules suite on its first run against the applied migration:
--
-- 1. H-G06: a day with no cash count could not CLOSE. The table-level CHECK
--    nf_days_closed_has_snapshot required variance IS NOT NULL on every
--    closed day. variance is (book − counted), and with the count removed
--    there is nothing counted, so it is NULL (nf_count_total(NULL) is NULL).
--    The constraint predates the removal and encoded "a closed day was
--    counted"; that is no longer the rule. The snapshot it exists to
--    guarantee (close_cash/petty/bank, closed_at, closed_by) is still
--    required. variance stays for days closed before 2026-09-21, which all
--    carry one.
--    nf_days_variance_reason is restated with COALESCE so a NULL variance
--    reads as "nothing to explain" explicitly, not by NULL-passes-a-CHECK.
--
-- 2. SEC-RPC-ROLE-CHECK: nf_save_count, reduced to a refusal by 20260921m,
--    no longer called nf_require_role, and the standing scanner flags every
--    reachable nf_ function without one. Restored: a non-member is still
--    told NF:NOT_ALLOWED, not handed a message about a feature.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.nf_days DROP CONSTRAINT nf_days_closed_has_snapshot;
ALTER TABLE public.nf_days ADD CONSTRAINT nf_days_closed_has_snapshot
  CHECK ((status = 'CLOSED') = (close_cash IS NOT NULL AND close_petty IS NOT NULL AND close_bank IS NOT NULL
                                AND closed_at IS NOT NULL AND closed_by IS NOT NULL));

ALTER TABLE public.nf_days DROP CONSTRAINT nf_days_variance_reason;
ALTER TABLE public.nf_days ADD CONSTRAINT nf_days_variance_reason
  CHECK ((variance_reason IS NOT NULL) = (status = 'CLOSED' AND COALESCE(variance, 0) <> 0)
         AND (variance_reason IS NULL OR btrim(variance_reason) <> ''));

CREATE OR REPLACE FUNCTION public.nf_save_count(p_day_id uuid, p_denoms jsonb, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  -- The cash count was removed (docs/PLAN.md §44). Refuse rather than store
  -- a figure nothing reads any more.
  RAISE EXCEPTION 'NF:CASH_COUNT_REMOVED';
END
$function$;

COMMIT;
