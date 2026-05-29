-- ════════════════════════════════════════════════════════════
-- REMOVE the admin-visibility CONSENT layer  (applied 2026-05-29)
-- ════════════════════════════════════════════════════════════
-- Decision reversed (Rashid, 2026-05-29): the consent system was a workaround
-- for a seat shortage. The seat problem is being solved differently, and proper
-- per-project site isolation will be built deliberately as a separate task. So
-- the entire consent layer (20260529_admin_consent.sql + 20260529_reports_consent.sql)
-- is removed here. Forward-only: those two migrations are kept as applied history;
-- this migration reverses their effect on the live DB.
--
-- This reverts the 12 gated functions to their TRUE pre-consent bodies (no caller
-- awareness, no site scoping — caller-blind, company-scoped) and drops the 7
-- net-new consent objects. NOTE: this intentionally also removes the per-assignment
-- §3 scoping the reports_consent migration introduced — reports go back to
-- all-sites-visible. Proper isolation is the next task.
--
-- Order: (a) revert cc_* → (b) revert 9 report RPCs → (c) drop consent-facing
-- RPCs → (d) drop helpers → (e) drop table. Functions are reverted BEFORE the
-- helpers they referenced are dropped, so no function is ever left dangling.

-- ════════════════════════════════════════════════════════════
-- (a) Revert the 3 Command Center functions to pre-consent bodies
--     (source: 20260529_command_center_rpcs.sql + 20260529_cc_team_activity.sql)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cc_command_center(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clients_90d int := 0;
  v_amount_90d  numeric := 0;
  v_inst_3d_cnt int := 0;
  v_inst_3d_amt numeric := 0;
  v_radar_today numeric := NULL;
  v_radar_yest  numeric := NULL;
BEGIN
  -- Distinct clients with any unpaid installment more than 90 days overdue (legal threshold)
  SELECT COUNT(DISTINCT s.client_id),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_clients_90d, v_amount_90d
  FROM installments i
  JOIN sales s ON s.id = i.sale_id
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date < CURRENT_DATE - 90
    AND COALESCE(s.status,'active') <> 'cancelled';

  -- Unpaid installments due within the next 3 days (today .. today+3)
  SELECT COUNT(*),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_inst_3d_cnt, v_inst_3d_amt
  FROM installments i
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3;

  -- Average radar score today & yesterday (from stored radar logs' top_clients)
  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_today
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE;

  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_yest
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE - 1;

  RETURN jsonb_build_object(
    'clients_90d_overdue', v_clients_90d,
    'amount_90d_overdue',  v_amount_90d,
    'installments_due_3d', v_inst_3d_cnt,
    'amount_due_3d',       v_inst_3d_amt,
    'radar_avg_today',     CASE WHEN v_radar_today IS NULL THEN NULL ELSE ROUND(v_radar_today) END,
    'radar_avg_yesterday', CASE WHEN v_radar_yest  IS NULL THEN NULL ELSE ROUND(v_radar_yest)  END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cc_team_activity(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi';
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'minutes_today')::int DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'id',             u.id,
      'name',           COALESCE(u.full_name, u.username, 'User'),
      'role',           u.role,
      'login_today',    COALESCE(act.first_login, act.first_ts),
      'online',         ( (act.last_ts IS NOT NULL AND act.last_ts > now() - interval '10 minutes')
                          OR EXISTS (SELECT 1 FROM user_sessions se WHERE se.user_id = u.id
                                      AND se.revoked_at IS NULL AND se.expires_at > now()
                                      AND se.last_seen_at > now() - interval '15 minutes') ),
      'minutes_today',  COALESCE(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (act.last_ts - act.first_ts)) / 60))::int, 0),
      'actions_today',  COALESCE(act.actions, 0),
      'contacts_today', COALESCE(ct.cnt, 0),
      'call_minutes',   COALESCE(ct.mins, 0)
    ) AS row
    FROM app_users u
    LEFT JOIN LATERAL (
      SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts,
             MIN(ts) FILTER (WHERE kind = 'login') AS first_login,
             COUNT(*) FILTER (WHERE kind = 'action') AS actions
      FROM (
        SELECT ae.created_at AS ts, 'login'  AS kind FROM auth_events ae
          WHERE ae.user_id = u.id AND ae.event_type ILIKE '%login%' AND ae.created_at >= v_start
        UNION ALL
        SELECT al.changed_at, 'action' FROM audit_logs al
          WHERE al.company_id = p_company_id AND al.changed_by_name = COALESCE(u.full_name, u.username) AND al.changed_at >= v_start
        UNION ALL
        SELECT se.created_at, 'session' FROM user_sessions se WHERE se.user_id = u.id AND se.created_at >= v_start
        UNION ALL
        SELECT se.last_seen_at, 'seen' FROM user_sessions se WHERE se.user_id = u.id AND se.last_seen_at >= v_start
        UNION ALL
        SELECT c.created_at, 'contact' FROM contact_logs c
          WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.created_at >= v_start
      ) e
    ) act ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(c.duration_minutes), 0) AS mins
      FROM contact_logs c
      WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.contact_date = v_today
    ) ct ON true
    WHERE u.company_id = p_company_id
      AND COALESCE(u.status, 'active') NOT IN ('inactive','suspended','deleted')
      AND COALESCE(u.is_super_admin, false) = false
  ) q;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.cc_user_contacts(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client',  COALESCE(c.client_name, '—'),
    'channel', c.channel,
    'time',    COALESCE(c.contact_time::text, to_char(c.created_at AT TIME ZONE 'Asia/Karachi', 'HH24:MI')),
    'status',  COALESCE(c.call_status, c.status_tag, c.response_type),
    'minutes', c.duration_minutes,
    'promise', c.promise_amount,
    'next',    c.next_action
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  FROM contact_logs c
  WHERE c.company_id = p_company_id
    AND (c.created_by = p_user_id::text OR c.recovery_agent_id = p_user_id)
    AND c.contact_date = (now() AT TIME ZONE 'Asia/Karachi')::date;
$function$;

-- ════════════════════════════════════════════════════════════
-- (b) Revert the 9 report RPCs to verbatim pre-consent bodies
--     (source: 20260526_phase2_report_rpcs.sql + 20260527_phase4_report_rpcs.sql)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_collection_report(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_register(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_outstanding_report(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_unit_inventory(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_aging_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH q AS (
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
    WHERE i.company_id = p_company_id
      AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)) > 0
      AND i.due_date IS NOT NULL
      AND i.due_date <= CURRENT_DATE
      AND (p_project_id IS NULL OR COALESCE(i.project_id, s.project_id, u.project_id) = p_project_id)
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

CREATE OR REPLACE FUNCTION public.get_project_summary(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH unit_stats AS (
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
  WHERE pr.company_id = p_company_id
    AND (p_project_id IS NULL OR pr.id = p_project_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_tax_wht_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  WHERE s.company_id = p_company_id
    AND s.status <> 'cancelled'
    AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    AND (COALESCE(s.wht_amount, 0) > 0 OR COALESCE(s.cvt_amount, 0) > 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_post_possession_dues_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  WHERE u.company_id = p_company_id
    AND u.possession_date IS NOT NULL
    AND (p_project_id IS NULL OR u.project_id = p_project_id)
    AND ist.total_outstanding > 0;
$function$;

CREATE OR REPLACE FUNCTION public.get_legal_portfolio(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  WHERE lc.company_id = p_company_id
    AND (lc.outcome IS NULL OR lc.outcome NOT IN ('closed','dismissed','settled','withdrawn'))
    AND (p_project_id IS NULL OR COALESCE(lc.project_id, s.project_id, u.project_id) = p_project_id);
$function$;

-- Re-GRANT the reverted functions (CREATE OR REPLACE preserves grants, but make
-- the pre-consent grant set explicit and match the original phase2/phase4 + cc_* migrations).
GRANT EXECUTE ON FUNCTION public.cc_command_center(uuid)                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_team_activity(uuid)                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_user_contacts(uuid, uuid)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_report(uuid,date,date,uuid,text)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_register(uuid,date,date,uuid,text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_outstanding_report(uuid,date,date,uuid,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unit_inventory(uuid,date,date,uuid,text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_aging_report(uuid,uuid)                       TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_project_summary(uuid,uuid)                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tax_wht_report(uuid,uuid)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_post_possession_dues_report(uuid,uuid)        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_legal_portfolio(uuid,uuid)                    TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- (c) Drop the consent-facing RPCs
-- ════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_consent_hidden_sites(uuid);
DROP FUNCTION IF EXISTS public.get_my_consent_status();
DROP FUNCTION IF EXISTS public.set_my_consent(boolean);

-- ════════════════════════════════════════════════════════════
-- (d) Drop the helper functions (now unreferenced)
-- ════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public._cc_is_admin_view();
DROP FUNCTION IF EXISTS public._cc_caller_project_ids();
DROP FUNCTION IF EXISTS public._cc_hidden_project_ids(uuid);

-- ════════════════════════════════════════════════════════════
-- (e) Drop the consent table (CASCADE takes its trigger/policy/index + the 1 test row)
-- ════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.user_admin_consent CASCADE;
