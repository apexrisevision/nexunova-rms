-- v3 (4-arg overload): also return full-month demand per row (due_full) so the officer
-- report's "This month's demand" matches the admin Recovery Intelligence (which bills the
-- WHOLE month, mStart→mEnd), while current-baqaya stays due-to-date (closing at p_to).
-- Two get_recovery_position windows merged server-side → one client round trip.
CREATE OR REPLACE FUNCTION public.get_officer_recovery(p_company_id uuid, p_from date, p_to date, p_month_end date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cal AS (
    SELECT id AS uid, (COALESCE(is_super_admin,false) OR role IN ('admin','owner')) AS is_full
    FROM public._rms_caller()
  ),
  projset AS (
    SELECT project_id FROM public.user_project_assignments
    WHERE user_id = (SELECT uid FROM cal) AND is_active
  ),
  allowed AS (
    SELECT s.id AS sale_id, s.unit_id, s.client_id
    FROM public.sales s
    WHERE s.company_id = p_company_id
      AND ((SELECT is_full FROM cal) OR s.project_id IN (SELECT project_id FROM projset))
  ),
  base_t AS (SELECT get_recovery_position(p_company_id, NULL, p_from, p_to) AS d),
  base_m AS (SELECT get_recovery_position(p_company_id, NULL, p_from, COALESCE(p_month_end, p_to)) AS d),
  duem AS (
    SELECT (e->>'sale_id') AS sale_id, (e->>'due_period')::numeric AS due_full
    FROM base_m, jsonb_array_elements(base_m.d->'rows') e
  ),
  rows AS (
    SELECT e || jsonb_build_object('unit_id', a.unit_id, 'client_id', a.client_id,
                                   'due_full', COALESCE(dm.due_full, 0)) AS e
    FROM base_t, jsonb_array_elements(base_t.d->'rows') e
    JOIN allowed a ON a.sale_id = (e->>'sale_id')::uuid
    LEFT JOIN duem dm ON dm.sale_id = (e->>'sale_id')
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(e) FROM rows), '[]'::jsonb),
    'scoped', NOT (SELECT is_full FROM cal)
  );
$function$;
REVOKE ALL ON FUNCTION public.get_officer_recovery(uuid,date,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_officer_recovery(uuid,date,date,date) TO authenticated, service_role;
