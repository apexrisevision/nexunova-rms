-- Module 4: Original vs modified installment schedule comparison
-- Stores a point-in-time snapshot of the installment schedule per sale
-- so officers can compare original schedule against current (post-restructure/deferral)

CREATE TABLE IF NOT EXISTS public.installment_snapshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  sale_id     uuid        NOT NULL REFERENCES public.sales(id)       ON DELETE CASCADE,
  snapshot    jsonb       NOT NULL DEFAULT '[]',
  taken_at    timestamptz NOT NULL DEFAULT now(),
  taken_by    uuid        REFERENCES public.app_users(id),
  UNIQUE(company_id, sale_id)
);

ALTER TABLE public.installment_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY instsnap_company_isolation ON public.installment_snapshots
  USING (
    company_id = (
      SELECT company_id FROM public.app_users WHERE id = auth.uid()
    )
  );

-- ── Snapshot the current installment schedule for a sale ───────────────────────
-- Replaces any existing snapshot. Call this when a schedule is first generated
-- OR before a restructure so officers can compare before vs after.
CREATE OR REPLACE FUNCTION public.snapshot_installment_schedule(
  p_company_id uuid,
  p_sale_id    uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_snap jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'installment_number', installment_number,
      'installment_type',   installment_type,
      'due_date',           due_date,
      'amount',             amount,
      'notes',              notes
    ) ORDER BY due_date NULLS LAST, installment_number
  ) INTO v_snap
  FROM public.installments
  WHERE company_id = p_company_id
    AND sale_id    = p_sale_id;

  INSERT INTO public.installment_snapshots (company_id, sale_id, snapshot, taken_at)
  VALUES (p_company_id, p_sale_id, COALESCE(v_snap, '[]'::jsonb), now())
  ON CONFLICT (company_id, sale_id)
  DO UPDATE SET
    snapshot = COALESCE(v_snap, '[]'::jsonb),
    taken_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'count',   jsonb_array_length(COALESCE(v_snap, '[]'::jsonb))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_installment_schedule(uuid, uuid) TO authenticated, anon;

-- ── Compare snapshot vs current live schedule ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_schedule_comparison(
  p_company_id uuid,
  p_sale_id    uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_snap     jsonb;
  v_taken_at timestamptz;
  v_current  jsonb;
BEGIN
  SELECT snapshot, taken_at
  INTO   v_snap, v_taken_at
  FROM   public.installment_snapshots
  WHERE  company_id = p_company_id
    AND  sale_id    = p_sale_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'installment_number', installment_number,
      'installment_type',   installment_type,
      'due_date',           due_date,
      'amount',             amount,
      'outstanding',        outstanding,
      'status',             status,
      'notes',              notes
    ) ORDER BY due_date NULLS LAST, installment_number
  ) INTO v_current
  FROM public.installments
  WHERE company_id = p_company_id
    AND sale_id    = p_sale_id;

  RETURN jsonb_build_object(
    'has_snapshot', v_snap IS NOT NULL,
    'taken_at',     v_taken_at,
    'snapshot',     COALESCE(v_snap,    '[]'::jsonb),
    'current',      COALESCE(v_current, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_schedule_comparison(uuid, uuid) TO authenticated, anon;
