-- Module 2: Legal Cost Tracking + Document Vault
-- Adds legal_costs & documents jsonb arrays to legal_cases + 4 SECURITY DEFINER RPCs

ALTER TABLE public.legal_cases
  ADD COLUMN IF NOT EXISTS legal_costs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.legal_cases
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── Legal Cost RPCs ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_legal_cost(
  p_company_id uuid,
  p_case_id    uuid,
  p_cost       jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE v_costs jsonb;
BEGIN
  SELECT legal_costs INTO v_costs
  FROM public.legal_cases
  WHERE id = p_case_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Case not found');
  END IF;
  UPDATE public.legal_cases
  SET legal_costs = COALESCE(v_costs, '[]'::jsonb) || jsonb_build_array(p_cost),
      updated_at  = now()
  WHERE id = p_case_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_legal_cost(
  p_company_id uuid,
  p_case_id    uuid,
  p_index      integer
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_costs jsonb;
  v_new   jsonb := '[]'::jsonb;
  i       integer;
BEGIN
  SELECT legal_costs INTO v_costs
  FROM public.legal_cases
  WHERE id = p_case_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Case not found');
  END IF;
  FOR i IN 0..jsonb_array_length(COALESCE(v_costs, '[]'::jsonb)) - 1 LOOP
    IF i <> p_index THEN
      v_new := v_new || jsonb_build_array(v_costs -> i);
    END IF;
  END LOOP;
  UPDATE public.legal_cases
  SET legal_costs = v_new,
      updated_at  = now()
  WHERE id = p_case_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── Legal Document Vault RPCs ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_legal_document(
  p_company_id uuid,
  p_case_id    uuid,
  p_doc        jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE v_docs jsonb;
BEGIN
  SELECT documents INTO v_docs
  FROM public.legal_cases
  WHERE id = p_case_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Case not found');
  END IF;
  UPDATE public.legal_cases
  SET documents  = COALESCE(v_docs, '[]'::jsonb) || jsonb_build_array(p_doc),
      updated_at = now()
  WHERE id = p_case_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_legal_document(
  p_company_id uuid,
  p_case_id    uuid,
  p_index      integer
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_docs jsonb;
  v_new  jsonb := '[]'::jsonb;
  i      integer;
BEGIN
  SELECT documents INTO v_docs
  FROM public.legal_cases
  WHERE id = p_case_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Case not found');
  END IF;
  FOR i IN 0..jsonb_array_length(COALESCE(v_docs, '[]'::jsonb)) - 1 LOOP
    IF i <> p_index THEN
      v_new := v_new || jsonb_build_array(v_docs -> i);
    END IF;
  END LOOP;
  UPDATE public.legal_cases
  SET documents  = v_new,
      updated_at = now()
  WHERE id = p_case_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_legal_cost(uuid, uuid, jsonb)         TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.remove_legal_cost(uuid, uuid, integer)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.add_legal_document(uuid, uuid, jsonb)      TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.remove_legal_document(uuid, uuid, integer) TO authenticated, anon;
