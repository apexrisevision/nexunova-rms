-- =====================================================================
-- Phase 2 — Management report RPCs powering reports/viewer.html
-- (Collection, Sales Register, Outstanding Dues, Unit Inventory).
--
-- These were referenced by reports/viewer.html, reports/hub.html and
-- js/pages/dashboard.js but never existed in the DB, so every management
-- report failed with "function not found". They are SECURITY DEFINER and
-- company-scoped, matching the existing list_*_for_report family (the
-- report viewer authenticates with the anon publishable key, so no caller
-- session is required). All four share one signature so PostgREST can
-- resolve any subset of named args the front-end sends.
--
-- Real-schema mapping notes (front-end key  <-  real column):
--   booking_date <- sales.sale_date          unit_ref     <- units.unit_no
--   unit_number  <- units.unit_no            area_sqft    <- units.area
--   price        <- units.base_price         total_price  <- sales.net_amount
--   payment_mode <- payments.payment_method  receipt_no   <- payments.payment_code/reference_no
--   client_name  <- clients.full_name        unit_type    <- category_unit_types.type_name
--   status       <- category_unit_statuses.status_name
--   total_paid   <- SUM(payments.amount)      balance_due  <- net_amount - total_paid
--   due_amount   <- installments.outstanding  days_overdue <- CURRENT_DATE - due_date
--
-- Applied to project itqxljtfbrppntgyfush on 2026-05-26
-- (migration name: phase2_management_report_rpcs).
-- =====================================================================

-- 1) Collection Report -------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_collection_report(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_date', p.payment_date,
    'receipt_no',   COALESCE(p.payment_code, p.reference_no),
    'client_name',  COALESCE(cl.full_name, scl.full_name),
    'unit_ref',     u.unit_no,
    'project_name', pr.project_name,
    'payment_mode', p.payment_method,
    'amount',       p.amount,
    'received_by',  p.created_by
  ) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.payments p
  LEFT JOIN public.clients  cl  ON cl.id  = p.client_id
  LEFT JOIN public.sales    s   ON s.id   = p.sale_id
  LEFT JOIN public.clients  scl ON scl.id = s.client_id
  LEFT JOIN public.units    u   ON u.id   = s.unit_id
  LEFT JOIN public.projects pr  ON pr.id  = COALESCE(p.project_id, s.project_id, u.project_id)
  WHERE p.company_id = p_company_id
    AND (p.status IS DISTINCT FROM 'cancelled')
    AND (p_from_date  IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date    IS NULL OR p.payment_date <= p_to_date)
    AND (p_project_id IS NULL OR COALESCE(p.project_id, s.project_id, u.project_id) = p_project_id);
$$;

-- 2) Sales Register ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_register(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.sale_date DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'booking_date', s.sale_date,
      'client_name',  cl.full_name,
      'unit_ref',     u.unit_no,
      'project_name', pr.project_name,
      'unit_type',    ut.type_name,
      'total_price',  s.net_amount,
      'total_paid',   COALESCE(pay.paid, 0),
      'balance_due',  COALESCE(s.net_amount, 0) - COALESCE(pay.paid, 0),
      'sale_status',  s.status
    ) AS j, s.sale_date
    FROM public.sales s
    LEFT JOIN public.clients  cl ON cl.id = s.client_id
    LEFT JOIN public.units    u  ON u.id  = s.unit_id
    LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount), 0) AS paid
      FROM public.payments
      WHERE sale_id = s.id AND status IS DISTINCT FROM 'cancelled'
    ) pay ON true
    WHERE s.company_id = p_company_id
      AND (p_status     IS NULL OR s.status = p_status)
      AND (p_from_date  IS NULL OR s.sale_date >= p_from_date)
      AND (p_to_date    IS NULL OR s.sale_date <= p_to_date)
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
  ) q;
$$;

-- 3) Outstanding Dues --------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_outstanding_report(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.due_date), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'client_name',    cl.full_name,
      'client_phone',   cl.phone_primary,
      'unit_ref',       u.unit_no,
      'project_name',   pr.project_name,
      'due_date',       i.due_date,
      'installment_no', i.installment_number,
      'due_amount',     COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid, 0)),
      'days_overdue',   GREATEST(0, CURRENT_DATE - i.due_date)
    ) AS j, i.due_date
    FROM public.installments i
    LEFT JOIN public.sales    s  ON s.id  = i.sale_id
    LEFT JOIN public.clients  cl ON cl.id = s.client_id
    LEFT JOIN public.units    u  ON u.id  = s.unit_id
    LEFT JOIN public.projects pr ON pr.id = COALESCE(i.project_id, s.project_id, u.project_id)
    WHERE i.company_id = p_company_id
      AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid, 0)) > 0
      AND (p_project_id IS NULL OR COALESCE(i.project_id, s.project_id, u.project_id) = p_project_id)
      AND (p_from_date  IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date    IS NULL OR i.due_date <= p_to_date)
  ) q;
$$;

-- 4) Unit Inventory ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unit_inventory(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.unit_no), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'unit_number',  u.unit_no,
      'floor_no',     u.floor_no,
      'unit_type',    ut.type_name,
      'area_sqft',    u.area,
      'price',        u.base_price,
      'status',       st.status_name,
      'project_name', pr.project_name,
      'client_name',  cl.full_name,
      'booking_date', s.sale_date
    ) AS j, u.unit_no
    FROM public.units u
    LEFT JOIN public.category_unit_types    ut ON ut.id = u.unit_type_id
    LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
    LEFT JOIN public.projects pr ON pr.id = u.project_id
    LEFT JOIN LATERAL (
      SELECT s2.client_id, s2.sale_date
      FROM public.sales s2
      WHERE s2.unit_id = u.id AND s2.company_id = u.company_id
        AND COALESCE(s2.is_active, s2.status = 'active')
      ORDER BY s2.sale_date DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN public.clients cl ON cl.id = s.client_id
    WHERE u.company_id = p_company_id
      AND (p_project_id IS NULL OR u.project_id = p_project_id)
      AND (p_status IS NULL OR st.status_name ILIKE p_status)
  ) q;
$$;

-- Grants (mirror the existing list_*_for_report / get_company_branding pattern)
GRANT EXECUTE ON FUNCTION public.get_collection_report(uuid,date,date,uuid,text)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_register(uuid,date,date,uuid,text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_outstanding_report(uuid,date,date,uuid,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unit_inventory(uuid,date,date,uuid,text)     TO anon, authenticated, service_role;
