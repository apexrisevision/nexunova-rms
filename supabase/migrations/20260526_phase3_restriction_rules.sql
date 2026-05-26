-- =====================================================================
-- Phase 3 / Component 3 — PART A: restriction rules config + helper.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase3_restriction_rules).
--
-- Per-company action -> level (hard/soft/warning) map with optional
-- thresholds, seeded with defaults for every existing company. Helper
-- _rms_restriction_level() returns the level for an action (default
-- 'soft' when no row exists).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.company_restriction_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action      text NOT NULL,
  level       text NOT NULL CHECK (level IN ('hard','soft','warning')),
  threshold   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, action)
);

ALTER TABLE public.company_restriction_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_anon ON public.company_restriction_rules;
CREATE POLICY deny_all_anon ON public.company_restriction_rules
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_company_restriction_rules_upd ON public.company_restriction_rules;
CREATE TRIGGER trg_company_restriction_rules_upd
  BEFORE UPDATE ON public.company_restriction_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Seed defaults for every existing company (idempotent) ────────────
INSERT INTO public.company_restriction_rules (company_id, action, level, threshold)
SELECT c.id, d.action, d.level, d.threshold::jsonb
FROM public.companies c
CROSS JOIN (VALUES
  ('discount',       'soft',    '{"max_discount_pct": 10}'),
  ('cancellation',   'soft',    '{}'),
  ('transfer',       'soft',    '{}'),
  ('refund',         'soft',    '{}'),
  ('price_revision', 'soft',    '{}'),
  ('dnd',            'soft',    '{}'),
  ('blacklist',      'soft',    '{}'),
  ('backdate',       'warning', '{"tolerance_days": 1}')
) AS d(action, level, threshold)
ON CONFLICT (company_id, action) DO NOTHING;

-- ── Helper: resolve an action's restriction level (default 'soft') ───
CREATE OR REPLACE FUNCTION public._rms_restriction_level(p_company_id uuid, p_action text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT level FROM public.company_restriction_rules
       WHERE company_id = p_company_id AND action = p_action),
    'soft');
$$;
