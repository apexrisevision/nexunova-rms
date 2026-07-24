-- Seed the four standard sale types for EVERY project, then default all
-- existing (untagged) sales to Installment. Idempotent: re-running is a no-op.
-- Owner (Rashid) request 2026-07-24: activate the already-built sale-type field
-- (category_sale_types / sales.sale_type_id) that had 0 rows and 0 tagged sales.

-- 1) Seed types per project (skip any already present by type_code) -----------
WITH t(type_code, type_name, color_hex, sort_order) AS (
  VALUES
    ('installment', 'Installment',            '#2563eb', 1),
    ('cash',        '100% Cash / Cash Deal',  '#16a34a', 2),
    ('adjustment',  'Adjustment',             '#d97706', 3),
    ('transfer',    'Transfer / Re-sale',     '#7c3aed', 4)
)
INSERT INTO public.category_sale_types
  (company_id, project_id, type_code, type_name, color_hex, sort_order, is_active)
SELECT p.company_id, p.id, t.type_code, t.type_name, t.color_hex, t.sort_order, true
FROM public.projects p
CROSS JOIN t
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_sale_types e
  WHERE e.project_id = p.id AND e.type_code = t.type_code
);

-- 2) Default every untagged sale to its own project's Installment type --------
UPDATE public.sales s
SET sale_type_id = ct.id
FROM public.category_sale_types ct
WHERE ct.project_id = s.project_id
  AND ct.type_code  = 'installment'
  AND s.sale_type_id IS NULL;
