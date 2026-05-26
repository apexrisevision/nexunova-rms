-- Module 9.1: Post-possession payment tracking
-- Returns units with completed possession that still have outstanding installments

CREATE OR REPLACE FUNCTION public.get_post_possession_dues(
  p_company_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(r)) INTO v_rows
  FROM (
    SELECT
      p.id                  AS possession_id,
      p.unit_id,
      u.unit_no,
      u.project_id,
      proj.project_name,
      p.client_name,
      p.client_phone,
      p.possession_date,
      p.sale_id,
      COUNT(i.id)::integer                                                        AS pending_count,
      COUNT(CASE WHEN i.due_date < CURRENT_DATE THEN 1 END)::integer             AS overdue_count,
      COALESCE(SUM(i.outstanding), 0)::numeric                                   AS total_outstanding,
      MIN(CASE WHEN i.due_date >= CURRENT_DATE THEN i.due_date END)              AS next_due_date,
      MIN(CASE WHEN i.due_date  <  CURRENT_DATE THEN i.due_date END)             AS oldest_overdue_date
    FROM public.possessions p
    JOIN public.units u        ON u.id        = p.unit_id
    JOIN public.projects proj  ON proj.id     = u.project_id
    JOIN public.installments i ON i.sale_id   = p.sale_id
                               AND i.company_id = p.company_id
    WHERE p.company_id = p_company_id
      AND p.status      = 'completed'
      AND i.status  NOT IN ('paid', 'cleared', 'waived')
      AND i.outstanding  > 0
    GROUP BY p.id, p.unit_id, u.unit_no, u.project_id,
             proj.project_name, p.client_name, p.client_phone,
             p.possession_date, p.sale_id
    HAVING SUM(i.outstanding) > 0
    ORDER BY SUM(i.outstanding) DESC
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'rows',    COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_post_possession_dues(uuid) TO authenticated, anon;
