-- DASHBOARD 2.0 — AAJ KA DIN gadget. Thin read-only "today" snapshot:
--   due_today = GROSS Σ(amount_due) of installments dated today (the scheduled
--     face value — NOT Σ(outstanding), which nets out partial payments and would
--     read like a recovery-position delta rather than gross due-today).
--   promises_today = contact_logs with next-followup today (bundled, same glance).
-- received_today comes from the existing get_daily_collections.
-- Mirrors get_dashboard_receivable: SECURITY DEFINER, parameterized by company,
-- granted to authenticated only.
CREATE OR REPLACE FUNCTION public.get_today_snapshot(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_today date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_due   numeric := 0;
  v_cnt   integer := 0;
  v_prom  integer := 0;
  v_names jsonb;
BEGIN
  -- gross face value scheduled to fall due today (Σ amount_due WHERE due_date = today)
  SELECT COALESCE(SUM(i.amount_due), 0), COUNT(*)
    INTO v_due, v_cnt
    FROM public.installments i
   WHERE i.company_id = p_company_id
     AND i.due_date   = p_today
     AND (p_project_id IS NULL OR i.project_id = p_project_id);

  SELECT COUNT(*)
    INTO v_prom
    FROM public.contact_logs c
   WHERE c.company_id = p_company_id
     AND c.next_followup_date = p_today
     AND (p_project_id IS NULL OR c.project_id = p_project_id);

  SELECT COALESCE(jsonb_agg(n), '[]'::jsonb) INTO v_names
    FROM (
      SELECT DISTINCT COALESCE(NULLIF(TRIM(c.client_name), ''), '—') AS n
        FROM public.contact_logs c
       WHERE c.company_id = p_company_id
         AND c.next_followup_date = p_today
         AND (p_project_id IS NULL OR c.project_id = p_project_id)
       LIMIT 6
    ) q;

  RETURN jsonb_build_object(
    'due_today',       v_due,
    'due_today_count', v_cnt,
    'promises_today',  v_prom,
    'promise_names',   COALESCE(v_names, '[]'::jsonb)
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_today_snapshot(uuid, uuid, date) TO authenticated;
