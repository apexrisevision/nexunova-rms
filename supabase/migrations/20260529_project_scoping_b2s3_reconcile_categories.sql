-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 3: reconcile legacy categories
-- 2026-05-29.  Completes Track A.
-- ════════════════════════════════════════════════════════════
-- The company's original 10 unit types + 10 statuses were company-level and now
-- carry project_id = NULL (Batch 1 only added the nullable column). Replace them
-- with per-project sets: delete the legacy NULL-project rows, then seed every
-- existing project its own 10+10 via seed_default_categories (Step 2).
--
-- SAFE: nothing references the legacy rows — units / payments /
-- project_price_revisions are all 0. category_payment_types has 0 rows (no-op).
-- Portable: loops all existing projects (no hardcoded ids).

-- 1) Drop legacy company-level (NULL-project) category rows
DELETE FROM public.category_unit_types    WHERE project_id IS NULL;
DELETE FROM public.category_unit_statuses WHERE project_id IS NULL;
DELETE FROM public.category_payment_types WHERE project_id IS NULL;

-- 2) Seed each existing project its own canonical 10 types + 10 statuses
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, company_id FROM public.projects LOOP
    PERFORM public.seed_default_categories(r.company_id, r.id);
  END LOOP;
END $$;
