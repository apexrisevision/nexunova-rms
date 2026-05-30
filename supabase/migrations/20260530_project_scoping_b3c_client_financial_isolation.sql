-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 3, GROUP 3C: server-side isolation on client
-- financial / sales-by-client RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- All three are keyed by p_client_id. Cross-project guard:
--   • list_sales_by_client / _all → filter the sales by the SALE's own
--     project_id (sales.project_id already set since pre-Batch-2 schema).
--     If the client itself is in an inaccessible project, no sales will
--     match either, so the gate is doubly safe.
--   • get_client_ledger → at the top, resolve v_pids and the client's
--     project; if non-admin and client's project ∉ v_pids, return the
--     standard empty envelope (success=true, rows=[], balances=0). This
--     matches the "no data to show" UI path rather than throwing.
--
-- Anon (no session) stays PERMISSIVE.

-- ── 1. list_sales_by_client ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_by_client(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'unit_id', s.unit_id,
    'units', jsonb_build_object('unit_no', u.unit_no),
    'projects', jsonb_build_object('project_name', p.project_name)
  )), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units u    ON u.id = s.unit_id
  LEFT JOIN public.projects p ON p.id = u.project_id
  CROSS JOIN cfg
  WHERE s.company_id = p_company_id
    AND s.client_id  = p_client_id
    AND s.status     = 'active'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── 2. list_sales_by_client_all ─────────────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_by_client_all(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.client_id  = p_client_id
    AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── 3. get_client_ledger (early gate via parent client.project_id) ─
CREATE OR REPLACE FUNCTION public.get_client_ledger(p_client_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows            jsonb;
  v_opening_balance numeric := 0;
  v_ob_debit        numeric := 0;
  v_ob_credit       numeric := 0;
  v_period_net      numeric := 0;
  v_client_info     jsonb;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
  v_proj            uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Early gate: if non-admin and the client's project is not in v_pids,
  -- return an empty ledger envelope (matches the "no data" UI path).
  SELECT project_id INTO v_proj
  FROM public.clients
  WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object(
      'success',         true,
      'client_info',     '{}'::jsonb,
      'opening_balance', 0,
      'rows',            '[]'::jsonb,
      'closing_balance', 0
    );
  END IF;

  -- Client info for report header
  SELECT jsonb_build_object(
    'client_name', c.full_name,
    'client_code', c.client_code,
    'projects', (
      SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2
      JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.client_id  = p_client_id
        AND s2.company_id = p_company_id
        AND s2.status NOT IN ('cancelled')
    )
  )
  INTO v_client_info
  FROM clients c
  WHERE c.id = p_client_id AND c.company_id = p_company_id;

  -- Opening balance
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i
    JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id
      AND s.client_id  = p_client_id
      AND i.due_date   < p_from_date;

    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id
      AND p.client_id  = p_client_id
      AND p.status    != 'cancelled'
      AND p.payment_date < p_from_date;

    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;

  -- Period rows
  SELECT jsonb_agg(to_jsonb(r))
  INTO v_rows
  FROM (
    SELECT
      CASE i.installment_type
        WHEN 'down_payment' THEN 'DP-0'
        ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0')
      END            AS voucher_no,
      'DR'           AS row_type,
      1              AS row_order,
      i.due_date     AS entry_date,
      i.created_at   AS created_at,
      CASE i.installment_type
        WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE
            WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
            WHEN i.installment_number % 10 = 1 THEN 'st'
            WHEN i.installment_number % 10 = 2 THEN 'nd'
            WHEN i.installment_number % 10 = 3 THEN 'rd'
            ELSE 'th'
          END || ' Installment'
      END            AS description,
      i.amount_due   AS debit,
      NULL::numeric  AS credit,
      NULL::text     AS chq_no,
      s.sale_number  AS sale_number
    FROM public.installments i
    JOIN public.sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id
      AND s.client_id  = p_client_id
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date   IS NULL OR i.due_date <= p_to_date)

    UNION ALL

    SELECT
      COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR'           AS row_type,
      2              AS row_order,
      p.payment_date AS entry_date,
      p.created_at   AS created_at,
      'Payment Received — ' ||
        INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE
          WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
          WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']'
          ELSE ''
        END            AS description,
      NULL::numeric    AS debit,
      p.amount         AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number    AS sale_number
    FROM public.payments p
    JOIN public.sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id
      AND p.client_id  = p_client_id
      AND p.status    != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date   IS NULL OR p.payment_date <= p_to_date)

    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;

  SELECT COALESCE(SUM(
    COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)
  ), 0)
  INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success',         true,
    'client_info',     COALESCE(v_client_info, '{}'::jsonb),
    'opening_balance', v_opening_balance,
    'rows',            COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
