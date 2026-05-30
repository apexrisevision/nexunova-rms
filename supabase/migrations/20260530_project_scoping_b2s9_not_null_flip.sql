-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 9: flip project_id NOT NULL on the 5 primaries
-- 2026-05-30.  Closes out Batch 2 — the forcing function.
-- ════════════════════════════════════════════════════════════
-- Pre-check confirmed zero NULL project_id rows on every primary entity:
--   clients=0, agents=0, category_unit_types=0, category_unit_statuses=0,
--   category_payment_types=0  (verified just before this migration).
-- Every Track B writer requires project_id; Track A reconciled the legacy
-- NULL-project categories; Track C forms supply project_id on create. So
-- flipping NOT NULL here cannot break any insert path — and from this point
-- on, the DB itself rejects any attempt to create a client/agent/category
-- without a project (the forcing function the user asked for).
--
-- Dependents stay NULLABLE in this batch — flipped per-table only once their
-- own writers provably derive project_id (per Rashid's instruction: "never
-- break a write"). Isolation batches read dependents via the parent's project.

ALTER TABLE public.clients                ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.agents                 ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.category_unit_types    ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.category_unit_statuses ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.category_payment_types ALTER COLUMN project_id SET NOT NULL;
