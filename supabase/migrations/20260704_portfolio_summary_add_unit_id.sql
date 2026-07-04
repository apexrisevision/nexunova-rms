-- Portfolio Summary: add unit_id to each row so the report can deep-link a unit
-- click straight to Unit Detail (openUD) instead of bouncing to the sales list.
-- Additive only (existing consumers ignore the extra key). Applied to remote via MCP.
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
