-- ════════════════════════════════════════════════════════════
-- Reports module — admin-visibility CONSENT gate  (applied 2026-05-29)
-- ════════════════════════════════════════════════════════════
-- Extends the consent layer (20260529_admin_consent.sql) from the Command
-- Center dashboard to ALL standalone management reports (reports/viewer.html).
--
-- Conflict resolved: the report RPCs were caller-blind because the viewer ran
-- anon. The viewer actually shares the logged-in Supabase session via same-origin
-- localStorage (default persistSession) — both in the browser and inside the
-- Electron wrapper (window.open → new BrowserWindow, same default session, same
-- origin; main.js has NO shell.openExternal / setWindowOpenHandler, so reports
-- never open in the OS browser). So the RPCs can now identify the caller.
--
-- Gate (same rule everywhere):
--   • Admin / Owner  (or NO session = restrictive default)
--       → hide projects that are "consent-hidden": projects with ≥1 non-admin
--         steward where NONE of those stewards granted consent
--         (public._cc_hidden_project_ids).
--   • Non-admin caller (finance / manager / recovery)
--       → scoped to their assigned sites only (§3 isolation,
--         public._cc_caller_project_ids). Consent never hides a user's own data
--         from themselves.
--
-- Authority is NOT touched — these are read-only report RPCs. Account
-- create/delete, password reset and rights assignment are unaffected.
--
-- Shapes/signatures unchanged — only a `cfg` CTE + one predicate added per RPC.

-- ── Helpers ──────────────────────────────────────────────────
-- TRUE when the caller is admin/owner OR there is no resolvable session
-- (restrictive default: anon view sees the consent-filtered set, never more).
CREATE OR REPLACE FUNCTION public._cc_is_admin_view()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT public._rms_is_admin(c) FROM public._rms_caller() c), true);
$function$;

-- The calling user's assigned project ids (for non-admin scoping). Empty when
-- no session or no assignments (→ a non-admin with no assignments sees nothing).
CREATE OR REPLACE FUNCTION public._cc_caller_project_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(upa.project_id), ARRAY[]::uuid[])
  FROM public._rms_caller() me
  JOIN public.user_project_assignments upa ON upa.user_id = me.id;
$function$;

-- Hidden-sites note for the admin's report view (count + names). Only the
-- admin view sees a non-zero count; non-admins have nothing hidden from them.
CREATE OR REPLACE FUNCTION public.get_consent_hidden_sites(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public._cc_is_admin_view() THEN
    (SELECT jsonb_build_object(
       'count', COUNT(*),
       'names', COALESCE(jsonb_agg(pr.project_name ORDER BY pr.project_name), '[]'::jsonb))
     FROM public.projects pr
     WHERE pr.company_id = p_company_id
       AND pr.id = ANY(public._cc_hidden_project_ids(p_company_id)))
  ELSE jsonb_build_object('count', 0, 'names', '[]'::jsonb)
  END;
$function$;

-- ════════════════════════════════════════════════════════════
-- 1. Collection Report
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_collection_report(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
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
  CROSS JOIN cfg
  WHERE p.company_id = p_company_id
    AND (p.status IS DISTINCT FROM 'cancelled')
    AND (p_from_date  IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date    IS NULL OR p.payment_date <= p_to_date)
    AND (p_project_id IS NULL OR COALESCE(p.project_id, s.project_id, u.project_id) = p_project_id)
    AND (
      (cfg.admin_view AND (COALESCE(p.project_id, s.project_id, u.project_id) IS NULL
          OR NOT (COALESCE(p.project_id, s.project_id, u.project_id) = ANY(cfg.hidden))))
      OR ((NOT cfg.admin_view) AND COALESCE(p.project_id, s.project_id, u.project_id) = ANY(cfg.assigned))
    );
$function$;

-- ════════════════════════════════════════════════════════════
-- 2. Sales Register
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_sales_register(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
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
    CROSS JOIN cfg
    WHERE s.company_id = p_company_id
      AND (p_status     IS NULL OR s.status = p_status)
      AND (p_from_date  IS NULL OR s.sale_date >= p_from_date)
      AND (p_to_date    IS NULL OR s.sale_date <= p_to_date)
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
      AND (
        (cfg.admin_view AND (COALESCE(s.project_id, u.project_id) IS NULL
            OR NOT (COALESCE(s.project_id, u.project_id) = ANY(cfg.hidden))))
        OR ((NOT cfg.admin_view) AND COALESCE(s.project_id, u.project_id) = ANY(cfg.assigned))
      )
  ) q;
$function$;

-- ════════════════════════════════════════════════════════════
-- 3. Outstanding Dues Report
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_outstanding_report(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
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
    CROSS JOIN cfg
    WHERE i.company_id = p_company_id
      AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid, 0)) > 0
      AND (p_project_id IS NULL OR COALESCE(i.project_id, s.project_id, u.project_id) = p_project_id)
      AND (p_from_date  IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date    IS NULL OR i.due_date <= p_to_date)
      AND (
        (cfg.admin_view AND (COALESCE(i.project_id, s.project_id, u.project_id) IS NULL
            OR NOT (COALESCE(i.project_id, s.project_id, u.project_id) = ANY(cfg.hidden))))
        OR ((NOT cfg.admin_view) AND COALESCE(i.project_id, s.project_id, u.project_id) = ANY(cfg.assigned))
      )
  ) q;
$function$;

-- ════════════════════════════════════════════════════════════
-- 4. Unit Inventory
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_unit_inventory(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
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
    CROSS JOIN cfg
    WHERE u.company_id = p_company_id
      AND (p_project_id IS NULL OR u.project_id = p_project_id)
      AND (p_status IS NULL OR st.status_name ILIKE p_status)
      AND (
        (cfg.admin_view AND (u.project_id IS NULL
            OR NOT (u.project_id = ANY(cfg.hidden))))
        OR ((NOT cfg.admin_view) AND u.project_id = ANY(cfg.assigned))
      )
  ) q;
$function$;

-- ════════════════════════════════════════════════════════════
-- 5. Aging Analysis
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_aging_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  ),
  q AS (
    SELECT
      CASE
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 0  AND 30  THEN '0-30'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60  THEN '31-60'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90  THEN '61-90'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 91 AND 180 THEN '91-180'
        ELSE '180+'
      END AS bucket,
      GREATEST(0, COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0))) AS outstanding,
      c.full_name AS client_name
    FROM public.installments i
    JOIN public.sales s ON s.id = i.sale_id AND s.company_id = i.company_id
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.units   u ON u.id = s.unit_id
    CROSS JOIN cfg
    WHERE i.company_id = p_company_id
      AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)) > 0
      AND i.due_date IS NOT NULL
      AND i.due_date <= CURRENT_DATE
      AND (p_project_id IS NULL OR COALESCE(i.project_id, s.project_id, u.project_id) = p_project_id)
      AND (
        (cfg.admin_view AND (COALESCE(i.project_id, s.project_id, u.project_id) IS NULL
            OR NOT (COALESCE(i.project_id, s.project_id, u.project_id) = ANY(cfg.hidden))))
        OR ((NOT cfg.admin_view) AND COALESCE(i.project_id, s.project_id, u.project_id) = ANY(cfg.assigned))
      )
  ),
  agg AS (
    SELECT bucket, count(*) AS cnt, SUM(outstanding) AS total_amount,
      (array_agg(client_name) FILTER (WHERE client_name IS NOT NULL))[1:3] AS sample
    FROM q GROUP BY bucket
  ),
  bo AS (
    SELECT * FROM (VALUES ('0-30',1),('31-60',2),('61-90',3),('91-180',4),('180+',5)) AS b(bucket, ord)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket',        bo.bucket,
    'count',         COALESCE(agg.cnt, 0),
    'total_amount',  COALESCE(agg.total_amount, 0),
    'client_sample', COALESCE(array_to_string(agg.sample, ', '), '—')
  ) ORDER BY bo.ord), '[]'::jsonb)
  FROM bo LEFT JOIN agg ON agg.bucket = bo.bucket;
$function$;

-- ════════════════════════════════════════════════════════════
-- 6. Project Summary
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_project_summary(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  ),
  unit_stats AS (
    SELECT u.project_id,
      count(*)                                                                    AS total_units,
      count(*) FILTER (WHERE st.status_name ILIKE 'available')                    AS available_units,
      count(*) FILTER (WHERE st.status_name ILIKE ANY (ARRAY['sold','booked','on installment','possession given','mortgaged'])) AS sold_units,
      count(*) FILTER (WHERE st.status_name ILIKE ANY (ARRAY['reserved','on hold']))              AS reserved_units
    FROM public.units u
    LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
    WHERE u.company_id = p_company_id
      AND (p_project_id IS NULL OR u.project_id = p_project_id)
    GROUP BY u.project_id
  ),
  sale_stats AS (
    SELECT COALESCE(s.project_id, u.project_id) AS project_id,
           SUM(s.net_amount) AS total_sale_value,
           SUM(pay.paid)     AS total_collected
    FROM public.sales s
    LEFT JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS paid
      FROM public.payments p
      WHERE p.sale_id = s.id AND p.company_id = s.company_id AND p.status IN ('received','cleared')
    ) pay ON true
    WHERE s.company_id = p_company_id AND s.status <> 'cancelled'
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    GROUP BY COALESCE(s.project_id, u.project_id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'project_name',      pr.project_name,
    'total_units',       COALESCE(us.total_units, 0),
    'sold_units',        COALESCE(us.sold_units, 0),
    'available_units',   COALESCE(us.available_units, 0),
    'reserved_units',    COALESCE(us.reserved_units, 0),
    'total_sale_value',  COALESCE(ss.total_sale_value, 0),
    'total_collected',   COALESCE(ss.total_collected, 0),
    'total_outstanding', GREATEST(0, COALESCE(ss.total_sale_value, 0) - COALESCE(ss.total_collected, 0)),
    'collection_pct',    CASE WHEN COALESCE(ss.total_sale_value, 0) > 0
                              THEN ROUND((COALESCE(ss.total_collected, 0) / ss.total_sale_value) * 100, 1)
                              ELSE 0 END
  ) ORDER BY pr.project_name), '[]'::jsonb)
  FROM public.projects pr
  LEFT JOIN unit_stats us ON us.project_id = pr.id
  LEFT JOIN sale_stats ss ON ss.project_id = pr.id
  CROSS JOIN cfg
  WHERE pr.company_id = p_company_id
    AND (p_project_id IS NULL OR pr.id = p_project_id)
    AND (
      (cfg.admin_view AND NOT (pr.id = ANY(cfg.hidden)))
      OR ((NOT cfg.admin_view) AND pr.id = ANY(cfg.assigned))
    );
$function$;

-- ════════════════════════════════════════════════════════════
-- 7. Tax / WHT Report
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_tax_wht_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_number',  s.sale_number,
    'sale_date',    s.sale_date,
    'buyer_name',   c.full_name,
    'sale_value',   s.net_amount,
    'wht_amount',   COALESCE(s.wht_amount, 0),
    'cvt_amount',   COALESCE(s.cvt_amount, 0),
    'wht_rate_pct', CASE WHEN COALESCE(s.net_amount, 0) > 0
                         THEN ROUND((COALESCE(s.wht_amount, 0) / s.net_amount) * 100, 2)
                         ELSE 0 END,
    'filer_status', 'unknown'
  ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units   u ON u.id = s.unit_id
  LEFT JOIN public.clients c ON c.id = s.client_id
  CROSS JOIN cfg
  WHERE s.company_id = p_company_id
    AND s.status <> 'cancelled'
    AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    AND (COALESCE(s.wht_amount, 0) > 0 OR COALESCE(s.cvt_amount, 0) > 0)
    AND (
      (cfg.admin_view AND (COALESCE(s.project_id, u.project_id) IS NULL
          OR NOT (COALESCE(s.project_id, u.project_id) = ANY(cfg.hidden))))
      OR ((NOT cfg.admin_view) AND COALESCE(s.project_id, u.project_id) = ANY(cfg.assigned))
    );
$function$;

-- ════════════════════════════════════════════════════════════
-- 8. Post-Possession Dues
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_post_possession_dues_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'unit_number',                u.unit_no,
    'project_name',               pr.project_name,
    'buyer_name',                 c.full_name,
    'possession_date',            u.possession_date,
    'total_outstanding',          ist.total_outstanding,
    'overdue_installments_count', ist.overdue_count,
    'last_payment_date',          pay.last_payment_date
  ) ORDER BY ist.total_outstanding DESC NULLS LAST), '[]'::jsonb)
  FROM public.units u
  JOIN public.sales s   ON s.unit_id = u.id AND s.company_id = u.company_id AND s.status <> 'cancelled'
  LEFT JOIN public.clients  c  ON c.id = s.client_id
  LEFT JOIN public.projects pr ON pr.id = u.project_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(GREATEST(0, COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)))), 0) AS total_outstanding,
      COUNT(*) FILTER (
        WHERE i.due_date < CURRENT_DATE
          AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)) > 0
      ) AS overdue_count
    FROM public.installments i WHERE i.sale_id = s.id
  ) ist ON true
  LEFT JOIN LATERAL (
    SELECT MAX(payment_date) AS last_payment_date
    FROM public.payments
    WHERE sale_id = s.id AND status IN ('received','cleared')
  ) pay ON true
  CROSS JOIN cfg
  WHERE u.company_id = p_company_id
    AND u.possession_date IS NOT NULL
    AND (p_project_id IS NULL OR u.project_id = p_project_id)
    AND ist.total_outstanding > 0
    AND (
      (cfg.admin_view AND (u.project_id IS NULL
          OR NOT (u.project_id = ANY(cfg.hidden))))
      OR ((NOT cfg.admin_view) AND u.project_id = ANY(cfg.assigned))
    );
$function$;

-- ════════════════════════════════════════════════════════════
-- 9. Legal Cases Portfolio
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_legal_portfolio(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT public._cc_is_admin_view() AS admin_view,
           public._cc_hidden_project_ids(p_company_id) AS hidden,
           public._cc_caller_project_ids() AS assigned
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'case_number',        lc.case_number,
    'case_type',          lc.case_type,
    'filed_date',         lc.filed_date,
    'client_name',        c.full_name,
    'unit_number',        u.unit_no,
    'outstanding_amount', COALESCE(lc.claim_amount,
                            GREATEST(0, COALESCE(s.net_amount, 0)
                              - COALESCE((SELECT SUM(amount) FROM public.payments
                                          WHERE sale_id = s.id AND company_id = s.company_id
                                            AND status IN ('received','cleared')), 0))),
    'status',             COALESCE(lc.stage, 'active'),
    'assigned_lawyer',    lc.lawyer_name,
    'next_hearing_date',  lc.next_hearing_date
  ) ORDER BY lc.filed_date DESC NULLS LAST), '[]'::jsonb)
  FROM public.legal_cases lc
  LEFT JOIN public.clients c ON c.id = lc.client_id
  LEFT JOIN public.sales   s ON s.id = lc.sale_id
  LEFT JOIN public.units   u ON u.id = COALESCE(lc.unit_id, s.unit_id)
  CROSS JOIN cfg
  WHERE lc.company_id = p_company_id
    AND (lc.outcome IS NULL OR lc.outcome NOT IN ('closed','dismissed','settled','withdrawn'))
    AND (p_project_id IS NULL OR COALESCE(lc.project_id, s.project_id, u.project_id) = p_project_id)
    AND (
      (cfg.admin_view AND (COALESCE(lc.project_id, s.project_id, u.project_id) IS NULL
          OR NOT (COALESCE(lc.project_id, s.project_id, u.project_id) = ANY(cfg.hidden))))
      OR ((NOT cfg.admin_view) AND COALESCE(lc.project_id, s.project_id, u.project_id) = ANY(cfg.assigned))
    );
$function$;

-- ── Grants ───────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public._cc_is_admin_view()                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cc_caller_project_ids()             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_consent_hidden_sites(uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_report(uuid,date,date,uuid,text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_register(uuid,date,date,uuid,text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_outstanding_report(uuid,date,date,uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unit_inventory(uuid,date,date,uuid,text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_aging_report(uuid,uuid)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_summary(uuid,uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tax_wht_report(uuid,uuid)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_post_possession_dues_report(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_legal_portfolio(uuid,uuid)           TO anon, authenticated;
