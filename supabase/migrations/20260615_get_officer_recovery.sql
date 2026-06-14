-- Officer-scoped recovery rows for the "My Recovery" officer report.
-- Wraps the verified get_recovery_position (untouched) and filters its rows to the
-- caller's assigned projects; admin/owner/super (is_full) see everything. Each row
-- is enriched with unit_id + client_id (for Log-a-call / drill deep-links). The
-- rollforward window carries opening (old baqaya), due_period (this-month due),
-- received_total (recovered), closing (still owed), net_price, paid_to_date, phone.
CREATE OR REPLACE FUNCTION public.get_officer_recovery(p_company_id uuid, p_from date, p_to date)
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
  base AS (SELECT get_recovery_position(p_company_id, NULL, p_from, p_to) AS d),
  rows AS (
    SELECT e || jsonb_build_object('unit_id', a.unit_id, 'client_id', a.client_id) AS e
    FROM base, jsonb_array_elements(base.d->'rows') e
    JOIN allowed a ON a.sale_id = (e->>'sale_id')::uuid
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(e) FROM rows), '[]'::jsonb),
    'scoped', NOT (SELECT is_full FROM cal)
  );
$function$;
REVOKE ALL ON FUNCTION public.get_officer_recovery(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_officer_recovery(uuid,date,date) TO authenticated, service_role;
