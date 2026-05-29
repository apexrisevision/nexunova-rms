-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 4: per-project code generators
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Adds 2-arg overloads generate_client_code(company_id, project_id) and
-- generate_agent_code(company_id, project_id) that compute the next sequence
-- WITHIN a single project, so each project's codes restart at 0001
-- (CLT-YYYY-NNNN / AGT-YYYY-NNNN). Safe because codes are now unique per
-- (company_id, project_id, code) after Batch 1.
--
-- The existing 1-arg (company-only) versions are LEFT IN PLACE — create_client /
-- create_agent still call them until Step 5 switches to the 2-arg form. They
-- become unused after Step 5 and can be dropped in a later cleanup.

CREATE OR REPLACE FUNCTION public.generate_client_code(p_company_id uuid, p_project_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year    TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  v_max_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN client_code ~ ('^CLT-' || v_year || '-[0-9]{4}$')
    THEN SUBSTRING(client_code FROM '[0-9]{4}$')::INTEGER ELSE 0 END
  ), 0) + 1 INTO v_max_seq
  FROM public.clients
  WHERE company_id = p_company_id AND project_id = p_project_id;
  RETURN 'CLT-' || v_year || '-' || LPAD(v_max_seq::TEXT, 4, '0');
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_agent_code(p_company_id uuid, p_project_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year TEXT := to_char(now(), 'YYYY');
  v_seq  INT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(agent_code, '-', 3) AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM public.agents
  WHERE company_id = p_company_id AND project_id = p_project_id
    AND agent_code LIKE 'AGT-' || v_year || '-%';
  RETURN 'AGT-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END; $function$;

GRANT EXECUTE ON FUNCTION public.generate_client_code(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_agent_code(uuid, uuid)  TO anon, authenticated;
