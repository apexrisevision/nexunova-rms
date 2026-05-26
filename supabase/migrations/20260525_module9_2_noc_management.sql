-- ================================================================
-- NEXUNOVA RMS — MODULE 9.2 — NOC MANAGEMENT
-- 2026-05-25 — Applied via MCP + verified (structural check passed).
-- Table: noc (RLS-enabled, company_isolation policy)
-- RPCs (all SECURITY DEFINER):
--   check_noc_eligibility, create_noc_request, get_noc_list,
--   get_noc_by_id, update_noc_status, get_noc_analytics, delete_noc
-- Helper: _generate_noc_number (internal, not SECURITY DEFINER)
-- ================================================================

-- ── Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noc (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL,
  sale_id           uuid,
  client_id         uuid,
  client_name       text,
  client_phone      text,
  project_name      text,
  unit_no           text,

  noc_type          text NOT NULL CHECK (noc_type IN ('bank','transfer','general')),
  purpose           text,
  payment_threshold numeric(5,2) DEFAULT 80,

  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','under_review','approved','rejected','revoked')),

  requested_by      text,
  requested_at      timestamptz DEFAULT now(),
  reviewed_by       text,
  reviewed_at       timestamptz,
  approved_by       text,
  approved_at       timestamptz,
  rejection_reason  text,
  revoked_by        text,
  revoked_at        timestamptz,
  revocation_reason text,

  valid_from        date,
  valid_until       date,

  noc_number        text,
  notes             text,

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE noc ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'noc' AND policyname = 'noc_company_isolation'
  ) THEN
    CREATE POLICY noc_company_isolation ON noc
      USING (company_id = (SELECT company_id FROM app_users WHERE id = auth.uid()))
      WITH CHECK (company_id = (SELECT company_id FROM app_users WHERE id = auth.uid()));
  END IF;
END $$;

-- ── Helper: generate NOC number ──────────────────────────────────
CREATE OR REPLACE FUNCTION _generate_noc_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_seq int;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN noc_number ~ '^NOC-\d{6}-\d+$'
    THEN CAST(SPLIT_PART(noc_number, '-', 3) AS int) ELSE 0 END
  ), 0) + 1
  INTO v_seq FROM noc WHERE company_id = p_company_id;
  RETURN 'NOC-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;

-- ── RPC: check_noc_eligibility ───────────────────────────────────
CREATE OR REPLACE FUNCTION check_noc_eligibility(
  p_unit_id    uuid,
  p_company_id uuid,
  p_noc_type   text    DEFAULT 'general',
  p_threshold  numeric DEFAULT 80
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale   uuid;
  v_due    numeric := 0;
  v_paid   numeric := 0;
  v_pct    numeric := 0;
  v_active int := 0;
BEGIN
  SELECT id INTO v_sale FROM sales
  WHERE unit_id = p_unit_id AND company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC LIMIT 1;
  IF v_sale IS NULL THEN
    SELECT id INTO v_sale FROM sales
    WHERE unit_id = p_unit_id AND company_id = p_company_id
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', true, 'has_sale', false, 'eligible', false, 'pct_paid', 0);
  END IF;

  SELECT COALESCE(SUM(amount_due), 0), COALESCE(SUM(amount_paid), 0)
  INTO v_due, v_paid
  FROM installments WHERE sale_id = v_sale AND company_id = p_company_id;

  v_pct := CASE WHEN v_due > 0 THEN ROUND(v_paid / v_due * 100, 1) ELSE 0 END;

  SELECT COUNT(*) INTO v_active FROM noc
  WHERE unit_id = p_unit_id AND company_id = p_company_id
    AND noc_type = p_noc_type AND status = 'approved'
    AND (valid_until IS NULL OR valid_until >= CURRENT_DATE);

  RETURN jsonb_build_object(
    'success', true, 'has_sale', true, 'sale_id', v_sale,
    'total_due', v_due, 'total_paid', v_paid, 'pct_paid', v_pct,
    'threshold', p_threshold, 'eligible', v_pct >= p_threshold,
    'active_noc_exists', v_active > 0
  );
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION check_noc_eligibility(uuid, uuid, text, numeric) TO anon, authenticated;

-- ── RPC: create_noc_request ──────────────────────────────────────
CREATE OR REPLACE FUNCTION create_noc_request(p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id     uuid := gen_random_uuid();
  v_noc_no text;
BEGIN
  v_noc_no := _generate_noc_number(p_company_id);
  INSERT INTO noc (
    id, company_id, unit_id, sale_id, client_id,
    client_name, client_phone, project_name, unit_no,
    noc_type, purpose, payment_threshold,
    status, requested_by, requested_at,
    valid_from, valid_until, noc_number, notes
  ) VALUES (
    v_id, p_company_id,
    (p_data->>'unit_id')::uuid,
    NULLIF(p_data->>'sale_id', '')::uuid,
    NULLIF(p_data->>'client_id', '')::uuid,
    p_data->>'client_name', p_data->>'client_phone',
    p_data->>'project_name', p_data->>'unit_no',
    p_data->>'noc_type', p_data->>'purpose',
    COALESCE((p_data->>'payment_threshold')::numeric, 80),
    'pending', p_data->>'requested_by', now(),
    NULLIF(p_data->>'valid_from', '')::date,
    NULLIF(p_data->>'valid_until', '')::date,
    v_noc_no, p_data->>'notes'
  );
  RETURN jsonb_build_object('success', true, 'id', v_id, 'noc_number', v_noc_no);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION create_noc_request(uuid, jsonb) TO anon, authenticated;

-- ── RPC: get_noc_list ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_noc_list(
  p_company_id uuid,
  p_status     text DEFAULT NULL,
  p_noc_type   text DEFAULT NULL,
  p_search     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.requested_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT id, noc_number, noc_type, status, purpose,
           unit_id, unit_no, project_name,
           client_id, client_name, client_phone,
           requested_by, requested_at,
           approved_by, approved_at,
           rejection_reason, revoked_at,
           valid_from, valid_until, notes,
           payment_threshold
    FROM noc
    WHERE company_id = p_company_id
      AND (p_status IS NULL OR status = p_status)
      AND (p_noc_type IS NULL OR noc_type = p_noc_type)
      AND (p_search IS NULL OR p_search = '' OR
           client_name  ILIKE '%' || p_search || '%' OR
           unit_no      ILIKE '%' || p_search || '%' OR
           noc_number   ILIKE '%' || p_search || '%' OR
           project_name ILIKE '%' || p_search || '%')
  ) r;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION get_noc_list(uuid, text, text, text) TO anon, authenticated;

-- ── RPC: get_noc_by_id ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_noc_by_id(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row jsonb;
BEGIN
  SELECT row_to_json(n)::jsonb INTO v_row FROM noc n
  WHERE n.id = p_id AND n.company_id = p_company_id;
  RETURN v_row;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION get_noc_by_id(uuid, uuid) TO anon, authenticated;

-- ── RPC: update_noc_status ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_noc_status(
  p_id         uuid,
  p_company_id uuid,
  p_status     text,
  p_data       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status = 'under_review' THEN
    UPDATE noc SET status='under_review',
      reviewed_by=p_data->>'reviewed_by', reviewed_at=now(), updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'approved' THEN
    UPDATE noc SET status='approved',
      approved_by=p_data->>'approved_by', approved_at=now(),
      valid_from=COALESCE(NULLIF(p_data->>'valid_from','')::date, CURRENT_DATE),
      valid_until=NULLIF(p_data->>'valid_until','')::date,
      updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'rejected' THEN
    UPDATE noc SET status='rejected',
      reviewed_by=p_data->>'reviewed_by', reviewed_at=now(),
      rejection_reason=p_data->>'rejection_reason', updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  ELSIF p_status = 'revoked' THEN
    UPDATE noc SET status='revoked',
      revoked_by=p_data->>'revoked_by', revoked_at=now(),
      revocation_reason=p_data->>'revocation_reason', updated_at=now()
    WHERE id=p_id AND company_id=p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION update_noc_status(uuid, uuid, text, jsonb) TO anon, authenticated;

-- ── RPC: get_noc_analytics ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_noc_analytics(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int:=0; v_pending int:=0; v_approved int:=0;
  v_rejected int:=0; v_revoked int:=0; v_month int:=0; v_expiring int:=0;
  v_by_type jsonb;
BEGIN
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status='pending')::int,
    COUNT(*) FILTER (WHERE status='approved')::int,
    COUNT(*) FILTER (WHERE status='rejected')::int,
    COUNT(*) FILTER (WHERE status='revoked')::int,
    COUNT(*) FILTER (WHERE DATE_TRUNC('month',requested_at)=DATE_TRUNC('month',NOW()))::int,
    COUNT(*) FILTER (WHERE status='approved' AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE+30)::int
  INTO v_total, v_pending, v_approved, v_rejected, v_revoked, v_month, v_expiring
  FROM noc WHERE company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('type',noc_type,'count',cnt::int)),'[]'::jsonb)
  INTO v_by_type
  FROM (SELECT noc_type, COUNT(*) AS cnt FROM noc WHERE company_id=p_company_id GROUP BY noc_type) t;

  RETURN jsonb_build_object(
    'total',v_total, 'pending',v_pending, 'approved',v_approved,
    'rejected',v_rejected, 'revoked',v_revoked,
    'this_month',v_month, 'expiring_soon',v_expiring, 'by_type',v_by_type
  );
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION get_noc_analytics(uuid) TO anon, authenticated;

-- ── RPC: delete_noc ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_noc(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM noc WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','NOC not found'); END IF;
  IF v_status NOT IN ('pending','rejected') THEN
    RETURN jsonb_build_object('success',false,'error','Only pending or rejected NOCs can be deleted');
  END IF;
  DELETE FROM noc WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_noc(uuid, uuid) TO anon, authenticated;
