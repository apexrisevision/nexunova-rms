-- ================================================================
-- NEXUNOVA RMS — MODULE 10 — FIELD VISITS (MOBILE RECOVERY)
-- 2026-05-25
-- Table : field_visits (RLS-enabled, company_isolation policy)
-- RPCs  : log_field_visit, get_field_visits, get_field_visit_analytics
-- All GRANT-ed to anon + authenticated.
-- ================================================================

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  officer_id    uuid,
  officer_name  text,
  client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name   text,
  unit_id       uuid,
  unit_no       text,
  project_name  text,
  visit_date    date NOT NULL DEFAULT CURRENT_DATE,
  visit_time    time,
  latitude      numeric(10,7),
  longitude     numeric(10,7),
  location_name text,
  outcome       text NOT NULL DEFAULT 'other'
                CHECK (outcome IN (
                  'contacted','not_found','payment_collected',
                  'promise_received','refused','other'
                )),
  notes         text,
  photo_url     text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'field_visits' AND policyname = 'fv_company_isolation'
  ) THEN
    CREATE POLICY fv_company_isolation ON public.field_visits
      USING (company_id = (
        SELECT company_id FROM public.app_users WHERE id = auth.uid()
      ))
      WITH CHECK (company_id = (
        SELECT company_id FROM public.app_users WHERE id = auth.uid()
      ));
  END IF;
END $$;

-- ── RPC: log_field_visit ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_field_visit(
  p_company_id uuid,
  p_data       jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF NULLIF(trim(p_data->>'officer_name'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Officer name required');
  END IF;
  IF NULLIF(p_data->>'visit_date', '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Visit date required');
  END IF;

  INSERT INTO field_visits (
    id, company_id,
    officer_id, officer_name,
    client_id, client_name, unit_id, unit_no, project_name,
    visit_date, visit_time,
    latitude, longitude, location_name,
    outcome, notes, photo_url
  ) VALUES (
    v_id, p_company_id,
    NULLIF(p_data->>'officer_id', '')::uuid,
    trim(p_data->>'officer_name'),
    NULLIF(p_data->>'client_id', '')::uuid,
    p_data->>'client_name',
    NULLIF(p_data->>'unit_id', '')::uuid,
    p_data->>'unit_no',
    p_data->>'project_name',
    (p_data->>'visit_date')::date,
    NULLIF(p_data->>'visit_time', '')::time,
    NULLIF(p_data->>'latitude', '')::numeric,
    NULLIF(p_data->>'longitude', '')::numeric,
    p_data->>'location_name',
    COALESCE(NULLIF(p_data->>'outcome', ''), 'other'),
    p_data->>'notes',
    p_data->>'photo_url'
  );
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_field_visit(uuid, jsonb) TO anon, authenticated;

-- ── RPC: get_field_visits ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_field_visits(
  p_company_id  uuid,
  p_officer_id  uuid    DEFAULT NULL,
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_outcome     text    DEFAULT NULL,
  p_search      text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.visit_date DESC, r.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      id, officer_id, officer_name, client_id, client_name,
      unit_id, unit_no, project_name,
      visit_date, visit_time, latitude, longitude, location_name,
      outcome, notes, photo_url, created_at
    FROM field_visits
    WHERE company_id = p_company_id
      AND (p_officer_id IS NULL OR officer_id = p_officer_id)
      AND (p_date_from  IS NULL OR visit_date >= p_date_from)
      AND (p_date_to    IS NULL OR visit_date <= p_date_to)
      AND (p_outcome    IS NULL OR outcome = p_outcome)
      AND (p_search     IS NULL OR p_search = '' OR
           officer_name ILIKE '%' || p_search || '%' OR
           client_name  ILIKE '%' || p_search || '%' OR
           unit_no      ILIKE '%' || p_search || '%' OR
           project_name ILIKE '%' || p_search || '%')
    ORDER BY visit_date DESC, created_at DESC
    LIMIT 500
  ) r;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN
  RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_field_visits(uuid, uuid, date, date, text, text) TO anon, authenticated;

-- ── RPC: get_field_visit_analytics ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_field_visit_analytics(
  p_company_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total        int := 0;
  v_this_month   int := 0;
  v_today        int := 0;
  v_collected    int := 0;
  v_by_outcome   jsonb;
  v_by_officer   jsonb;
BEGIN
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE DATE_TRUNC('month', visit_date) = DATE_TRUNC('month', CURRENT_DATE))::int,
    COUNT(*) FILTER (WHERE visit_date = CURRENT_DATE)::int,
    COUNT(*) FILTER (WHERE outcome = 'payment_collected')::int
  INTO v_total, v_this_month, v_today, v_collected
  FROM field_visits WHERE company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('outcome', outcome, 'count', cnt::int)), '[]'::jsonb)
  INTO v_by_outcome
  FROM (
    SELECT outcome, COUNT(*) AS cnt
    FROM field_visits WHERE company_id = p_company_id
    GROUP BY outcome ORDER BY cnt DESC
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'officer', officer_name,
    'total',   cnt::int,
    'this_month', mth::int
  ) ORDER BY mth DESC), '[]'::jsonb)
  INTO v_by_officer
  FROM (
    SELECT
      COALESCE(officer_name, 'Unknown') AS officer_name,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month', visit_date) = DATE_TRUNC('month', CURRENT_DATE)) AS mth
    FROM field_visits WHERE company_id = p_company_id
    GROUP BY officer_name
    LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'success',      true,
    'total',        v_total,
    'this_month',   v_this_month,
    'today',        v_today,
    'collected',    v_collected,
    'by_outcome',   v_by_outcome,
    'by_officer',   v_by_officer
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_field_visit_analytics(uuid) TO anon, authenticated;
