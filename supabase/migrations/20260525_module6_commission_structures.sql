-- ================================================================
-- NEXUNOVA RMS — MODULE 6 — COMMISSION STRUCTURES
-- 2026-05-25 — Applied via MCP + verified.
-- Table: commission_structures (RLS-enabled, company_isolation policy)
-- RPCs (all SECURITY DEFINER):
--   list_commission_structures, upsert_commission_structure,
--   delete_commission_structure, get_effective_commission_rate
-- Lookup order (narrowest wins):
--   agent+project override → project default → company default
--   → agent global commission_percent fallback
-- ================================================================

-- ── Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_structures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- NULL = applies to ALL agents; set = agent-specific override
  agent_id              uuid REFERENCES agents(id) ON DELETE CASCADE,
  -- NULL = company-wide default; set = project-specific rate
  project_id            uuid,

  commission_rate       numeric(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),

  -- milestone splits (must each be <= 100, sum <= 100)
  milestone_booking_pct    numeric(5,2) DEFAULT 0
                           CHECK (milestone_booking_pct >= 0 AND milestone_booking_pct <= 100),
  milestone_possession_pct numeric(5,2) DEFAULT 0
                           CHECK (milestone_possession_pct >= 0 AND milestone_possession_pct <= 100),

  is_active             boolean DEFAULT true,
  notes                 text,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),

  UNIQUE (company_id, project_id, agent_id)
);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE commission_structures ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'commission_structures'
      AND policyname = 'commission_structures_company_isolation'
  ) THEN
    CREATE POLICY commission_structures_company_isolation ON commission_structures
      USING (company_id = (SELECT company_id FROM app_users WHERE id = auth.uid()))
      WITH CHECK (company_id = (SELECT company_id FROM app_users WHERE id = auth.uid()));
  END IF;
END $$;

-- ── RPC: list_commission_structures ─────────────────────────────
CREATE OR REPLACE FUNCTION list_commission_structures(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      cs.id, cs.company_id, cs.agent_id, cs.project_id,
      cs.commission_rate,
      cs.milestone_booking_pct, cs.milestone_possession_pct,
      cs.is_active, cs.notes, cs.created_at, cs.updated_at,
      a.full_name  AS agent_name,
      a.agent_code AS agent_code,
      p.name       AS project_name
    FROM commission_structures cs
    LEFT JOIN agents   a ON a.id = cs.agent_id
    LEFT JOIN projects p ON p.id = cs.project_id
    WHERE cs.company_id = p_company_id
  ) r;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION list_commission_structures(uuid) TO anon, authenticated;

-- ── RPC: upsert_commission_structure ────────────────────────────
CREATE OR REPLACE FUNCTION upsert_commission_structure(p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id         uuid;
  v_booking    numeric;
  v_possession numeric;
  v_rate       numeric;
BEGIN
  v_rate       := (p_data->>'commission_rate')::numeric;
  v_booking    := COALESCE(NULLIF(p_data->>'milestone_booking_pct',    '')::numeric, 0);
  v_possession := COALESCE(NULLIF(p_data->>'milestone_possession_pct', '')::numeric, 0);

  IF v_rate < 0 OR v_rate > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Commission rate must be between 0 and 100');
  END IF;
  IF (v_booking + v_possession) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking + possession split cannot exceed 100%');
  END IF;

  v_id := COALESCE(NULLIF(p_data->>'id', '')::uuid, gen_random_uuid());

  INSERT INTO commission_structures (
    id, company_id, agent_id, project_id,
    commission_rate, milestone_booking_pct, milestone_possession_pct,
    is_active, notes, updated_at
  ) VALUES (
    v_id, p_company_id,
    NULLIF(p_data->>'agent_id',   '')::uuid,
    NULLIF(p_data->>'project_id', '')::uuid,
    v_rate, v_booking, v_possession,
    COALESCE((p_data->>'is_active')::boolean, true),
    NULLIF(p_data->>'notes', ''),
    now()
  )
  ON CONFLICT (company_id, project_id, agent_id) DO UPDATE SET
    commission_rate          = EXCLUDED.commission_rate,
    milestone_booking_pct    = EXCLUDED.milestone_booking_pct,
    milestone_possession_pct = EXCLUDED.milestone_possession_pct,
    is_active                = EXCLUDED.is_active,
    notes                    = EXCLUDED.notes,
    updated_at               = now();

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_commission_structure(uuid, jsonb) TO anon, authenticated;

-- ── RPC: delete_commission_structure ────────────────────────────
CREATE OR REPLACE FUNCTION delete_commission_structure(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM commission_structures WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Structure not found');
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_commission_structure(uuid, uuid) TO anon, authenticated;

-- ── RPC: get_effective_commission_rate ──────────────────────────
-- Returns the narrowest-matching commission rate for a given agent+project.
-- Lookup order: agent+project → project default → company default → NULL
CREATE OR REPLACE FUNCTION get_effective_commission_rate(
  p_company_id uuid,
  p_agent_id   uuid,
  p_project_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate       numeric;
  v_booking    numeric;
  v_possession numeric;
  v_source     text;
BEGIN
  -- 1. agent + project specific
  SELECT commission_rate, milestone_booking_pct, milestone_possession_pct, 'agent_project'
  INTO v_rate, v_booking, v_possession, v_source
  FROM commission_structures
  WHERE company_id = p_company_id
    AND agent_id   = p_agent_id
    AND project_id = p_project_id
    AND is_active  = true
  LIMIT 1;

  IF v_rate IS NOT NULL THEN
    RETURN jsonb_build_object(
      'rate', v_rate, 'booking_pct', v_booking, 'possession_pct', v_possession,
      'source', v_source
    );
  END IF;

  -- 2. project default (all agents)
  SELECT commission_rate, milestone_booking_pct, milestone_possession_pct, 'project_default'
  INTO v_rate, v_booking, v_possession, v_source
  FROM commission_structures
  WHERE company_id = p_company_id
    AND project_id = p_project_id
    AND agent_id   IS NULL
    AND is_active  = true
  LIMIT 1;

  IF v_rate IS NOT NULL THEN
    RETURN jsonb_build_object(
      'rate', v_rate, 'booking_pct', v_booking, 'possession_pct', v_possession,
      'source', v_source
    );
  END IF;

  -- 3. company-wide default
  SELECT commission_rate, milestone_booking_pct, milestone_possession_pct, 'company_default'
  INTO v_rate, v_booking, v_possession, v_source
  FROM commission_structures
  WHERE company_id = p_company_id
    AND project_id IS NULL
    AND agent_id   IS NULL
    AND is_active  = true
  LIMIT 1;

  IF v_rate IS NOT NULL THEN
    RETURN jsonb_build_object(
      'rate', v_rate, 'booking_pct', v_booking, 'possession_pct', v_possession,
      'source', v_source
    );
  END IF;

  RETURN jsonb_build_object('rate', NULL, 'source', 'none');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION get_effective_commission_rate(uuid, uuid, uuid) TO anon, authenticated;
