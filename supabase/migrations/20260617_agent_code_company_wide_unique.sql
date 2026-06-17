-- ============================================================================
-- NEXUNOVA RMS — Unify agent codes: ONE format AGT-YYYY-####, company-wide unique
-- 2026-06-17.
-- ----------------------------------------------------------------------------
-- Was: generate_agent_code sequenced PER (company, project), so each project's
-- first agent got -0001 -> codes repeated across projects within a company, and
-- a legacy AG-#### row sat alongside AGT-YYYY-#### in the same project.
-- Now: sequence COMPANY-WIDE (project-independent) and normalize the legacy row.
-- Codes are display-only (commissions/txns FK on agent_id), so renaming is safe.
-- Note: distinct tenants still each start at -0001 — that is correct (codes are
-- unique within a company, not globally).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_agent_code(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_seq int;
BEGIN
  SELECT COALESCE(MAX( (regexp_replace(agent_code,'^.*-',''))::int ),0)+1 INTO v_seq
  FROM public.agents WHERE company_id=p_company_id AND agent_code ~ '-[0-9]+$';
  RETURN 'AGT-'||to_char(now(),'YYYY')||'-'||LPAD(v_seq::text,4,'0');
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_agent_code(p_company_id uuid, p_project_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_seq int;
BEGIN
  SELECT COALESCE(MAX( (regexp_replace(agent_code,'^.*-',''))::int ),0)+1 INTO v_seq
  FROM public.agents WHERE company_id=p_company_id AND agent_code ~ '-[0-9]+$';
  RETURN 'AGT-'||to_char(now(),'YYYY')||'-'||LPAD(v_seq::text,4,'0');
END; $function$;

-- Renumber existing agents to a clean, unique, per-company sequence (two-step
-- via a temp value to avoid any transient unique-collision during the update).
WITH ord AS (SELECT id FROM public.agents)
UPDATE public.agents a SET agent_code='TMP-'||a.id::text FROM ord WHERE ord.id=a.id;

WITH ord AS (
  SELECT id, company_id,
         row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS rn
  FROM public.agents)
UPDATE public.agents a
   SET agent_code = 'AGT-'||to_char(a.created_at,'YYYY')||'-'||LPAD(ord.rn::text,4,'0')
  FROM ord WHERE ord.id=a.id;
