-- ══ RMS reports: only logins with the Reports module may call the two report functions (20261118e) ══
-- NOT APPLIED until the owner says yes.
--
-- Found 18-Nov-2026 (docs/findings/F-staff-role-report-rpcs-not-gated.md): a Staff login with no
-- modules (Sharose, NexuFinance site user) got every Awami sale from list_sales_for_report and
-- the portfolio from get_portfolio_summary by calling the API directly. Neither function checked
-- who was asking — not even the company: any signed-in login of ANY company could pass another
-- company's id.
--
-- Now both start with _rms_can_read_reports(p_company_id), which mirrors the screen exactly
-- (js/helpers.js hasPermission('reports')):
--   * platform super admin, or the database's own service role  -> allowed
--   * the caller must be an ACTIVE RMS user of THAT company      -> else refused
--   * owner / admin                                              -> allowed
--   * staff                                                      -> only if Reports is ticked
--   * recovery (user) / accounts / manager -> the tick decides when Reports is set either way;
--     with no setting, their role default (which includes Reports) applies
-- Nothing else in the two functions changes. Only the Reports page calls them (js/pages/reports.js).

CREATE OR REPLACE FUNCTION public._rms_can_read_reports(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    public.app_users := public._rms_caller();
  v_perms jsonb;
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN RETURN true; END IF;
  IF v_me.id IS NULL THEN RETURN false; END IF;
  IF COALESCE(v_me.is_super_admin, false) THEN RETURN true; END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN false; END IF;
  IF public._rms_is_admin(v_me) THEN RETURN true; END IF;
  v_perms := COALESCE(v_me.module_permissions, '{}'::jsonb);
  IF v_me.role = 'staff' THEN
    RETURN COALESCE((v_perms->>'reports')::boolean, false);
  END IF;
  IF v_perms <> '{}'::jsonb AND v_perms ? 'reports' THEN
    RETURN COALESCE((v_perms->>'reports')::boolean, false);
  END IF;
  RETURN v_me.role IN ('recovery', 'user', 'accounts', 'manager');
END;
$function$;
REVOKE ALL ON FUNCTION public._rms_can_read_reports(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_sales_for_report(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := NULLIF(p_filters->>'status','');
  v_sale_from date := NULLIF(p_filters->>'sale_from','')::date;
  v_sale_to date := NULLIF(p_filters->>'sale_to','')::date;
  v_cancel_from date := NULLIF(p_filters->>'cancel_from','')::date;
  v_cancel_to date := NULLIF(p_filters->>'cancel_to','')::date;
  v_discount_gt numeric := COALESCE(NULLIF(p_filters->>'discount_gt','')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
BEGIN
  -- reports module gate (20261118e): same rule as the screen's hasPermission('reports')
  IF NOT public._rms_can_read_reports(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to reports.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST, s.id ASC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_status IS NULL OR status = v_status)
      AND (v_sale_from IS NULL OR sale_date >= v_sale_from)
      AND (v_sale_to IS NULL OR sale_date <= v_sale_to)
      AND (v_cancel_from IS NULL OR cancellation_date >= v_cancel_from)
      AND (v_cancel_to IS NULL OR cancellation_date <= v_cancel_to)
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    ORDER BY sale_date ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_portfolio_summary(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_to_date date DEFAULT CURRENT_DATE, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_status text := lower(coalesce(p_status, 'active'));
BEGIN
  -- reports module gate (20261118e): same rule as the screen's hasPermission('reports')
  IF NOT public._rms_can_read_reports(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to reports.' USING ERRCODE = '42501';
  END IF;
  WITH rp AS (
    SELECT get_recovery_position(p_company_id, p_project_id, '2000-01-01'::date, p_to_date) AS j
  ),
  active_src AS (
    SELECT e.sale_id, e.unit_no, e.floor_name, e.area, e.unit_rate,
           e.total_price, e.discount, e.net_price, e.received_total, e.closing
    FROM rp, jsonb_to_recordset(rp.j -> 'rows') AS e(
      sale_id uuid, unit_no text, floor_name text, area numeric, unit_rate numeric,
      total_price numeric, discount numeric, net_price numeric, received_total numeric,
      closing numeric)
  ),
  active_rows AS (
    SELECT
      s.unit_id                                                AS unit_id,
      a.sale_id,
      a.unit_no,
      COALESCE(NULLIF(a.floor_name, ''), u.floor_label)        AS floor_name,
      COALESCE(u.floor_no, 9999)                               AS floor_no,
      a.area,
      a.unit_rate,
      a.total_price                                            AS gross,
      a.discount,
      a.net_price                                              AS net,
      a.received_total                                         AS received,
      GREATEST(a.closing, 0)                                   AS current_receivable,
      (a.net_price - a.received_total)                         AS balance,
      CASE WHEN a.net_price > 0
           THEN round(a.received_total / a.net_price * 100, 1) ELSE 0 END AS recovery_pct,
      'active'::text                                           AS status,
      cl.full_name                                             AS client_name,
      cl.client_code,
      ag.full_name                                            AS agent_name
    FROM active_src a
    JOIN sales s        ON s.id = a.sale_id
    LEFT JOIN units u   ON u.id = s.unit_id
    LEFT JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN agents ag ON ag.id = s.agent_id
  ),
  cancelled_rows AS (
    SELECT
      s.unit_id                                                AS unit_id,
      s.id                                                     AS sale_id,
      u.unit_no,
      COALESCE(u.floor_label, '')                              AS floor_name,
      COALESCE(u.floor_no, 9999)                               AS floor_no,
      u.area,
      s.price_per_sqft                                         AS unit_rate,
      s.total_amount                                           AS gross,
      s.discount,
      s.net_amount                                             AS net,
      rcv.received                                             AS received,
      0::numeric                                               AS current_receivable,
      (s.net_amount - rcv.received)                            AS balance,
      CASE WHEN s.net_amount > 0
           THEN round(rcv.received / s.net_amount * 100, 1) ELSE 0 END AS recovery_pct,
      'cancelled'::text                                        AS status,
      cl.full_name                                             AS client_name,
      cl.client_code,
      ag.full_name                                            AS agent_name
    FROM sales s
    LEFT JOIN units u    ON u.id = s.unit_id
    LEFT JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN agents ag  ON ag.id = s.agent_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(p.amount) FILTER (WHERE p.status = 'received'), 0) AS received
      FROM payments p WHERE p.sale_id = s.id
    ) rcv
    WHERE s.company_id = p_company_id
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (s.status <> 'active' OR s.is_active = false)
  ),
  unioned AS (
    SELECT * FROM active_rows    WHERE v_status IN ('active', 'all')
    UNION ALL
    SELECT * FROM cancelled_rows WHERE v_status IN ('cancelled', 'all')
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.floor_no, x.unit_no), '[]'::jsonb)
  INTO v_rows
  FROM unioned x;

  RETURN jsonb_build_object('as_on', p_to_date, 'status', v_status, 'rows', v_rows);
END;
$function$;
