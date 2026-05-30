-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 6 GROUP 6D: server-side isolation on ledger RPCs
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- 7 ledger RPCs retrofitted. Each gated on its authoritative project
-- source (parent unit / direct p_project_id / parent sale via payments).
-- Anon (no session) stays PERMISSIVE; admins see everything.
--
-- ALREADY DONE in earlier batches (NOT redone here):
--   get_client_ledger      (3C)
--   get_agent_ledger       (4C)
--   get_sales_register     (6B — REVERTED, protected report RPC; stays caller-blind)
--   get_pdc_register       (6C)
--
-- NOT TOUCHED (protected report RPCs — must stay caller-blind):
--   get_collection_report, get_outstanding_report, get_unit_inventory,
--   get_aging_report, get_project_summary, get_tax_wht_report,
--   get_post_possession_dues_report, get_legal_portfolio
--
-- Design choices landed:
--   • Opening-balance + period-rows gate applied symmetrically (else
--     non-zero opening balance leaks cross-project info).
--   • Direct p_project_id RPCs (get_project_ledger / get_project_collection_ledger):
--     early-reject if p_project_id ∉ v_pids; empty envelope.
--   • Optional p_project_id filter param (cancelled/transferred/
--     receiving/officer): silent-empty on disallowed (mirrors
--     get_sales_register precedent).
--   • NULL-sale rows (receiving/officer): invisible to non-admins
--     (parent-gate default; matches 6C).
--   • Gate via parent unit for unit_cancellations/unit_transfers
--     (EXISTS to units.project_id), not the direct project_id columns
--     on those tables — consistent with 6C parent-gate posture.
--   • Empty envelope shape preserved: success:true, rows:[], opening:0,
--     closing:0 so report viewer doesn't crash.

-- ────────────────────────────────────────────────────────────
-- 1. get_unit_ledger — keyed by unit; gate via parent unit's project_id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_unit_ledger(p_unit_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows            jsonb;
  v_opening_balance numeric := 0;
  v_ob_debit        numeric := 0;
  v_ob_credit       numeric := 0;
  v_period_net      numeric := 0;
  v_unit_info       jsonb;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
  v_unit_visible    boolean;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Visibility gate on the parent unit
  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = p_unit_id AND u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
  ) INTO v_unit_visible;

  IF NOT v_unit_visible THEN
    RETURN jsonb_build_object(
      'success', true, 'unit_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0
    );
  END IF;

  SELECT jsonb_build_object(
    'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'sale_number', s.sale_number, 'client_name', c.full_name,
    'project_name', pj.project_name, 'sale_status', s.status
  )
  INTO v_unit_info
  FROM units u
  LEFT JOIN sales    s  ON s.unit_id = u.id AND s.company_id = p_company_id AND s.status NOT IN ('cancelled')
  LEFT JOIN clients  c  ON c.id      = s.client_id
  LEFT JOIN projects pj ON pj.id     = COALESCE(s.project_id, u.project_id)
  WHERE u.id = p_unit_id AND u.company_id = p_company_id
  ORDER BY s.created_at DESC LIMIT 1;

  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i
    JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.unit_id = p_unit_id
      AND s.status NOT IN ('cancelled')
      AND i.due_date < p_from_date;

    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.unit_id = p_unit_id
      AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND p.payment_date < p_from_date;

    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;

  SELECT jsonb_agg(to_jsonb(r))
  INTO v_rows
  FROM (
    SELECT
      CASE i.installment_type
        WHEN 'down_payment' THEN 'DP-0'
        ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0')
      END AS voucher_no,
      'DR' AS row_type, 1 AS row_order,
      i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type
        WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
               WHEN i.installment_number % 10 = 1 THEN 'st'
               WHEN i.installment_number % 10 = 2 THEN 'nd'
               WHEN i.installment_number % 10 = 3 THEN 'rd'
               ELSE 'th' END || ' Installment'
      END AS description,
      i.amount_due AS debit, NULL::numeric AS credit,
      NULL::text AS chq_no, s.sale_number AS sale_number
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.unit_id = p_unit_id
      AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date   IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT
      COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR' AS row_type, 2 AS row_order,
      p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
             WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']'
             ELSE '' END AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number AS sale_number
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.unit_id = p_unit_id
      AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date   IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;

  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0)
  INTO v_period_net FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success', true, 'unit_info', COALESCE(v_unit_info, '{}'::jsonb),
    'opening_balance', v_opening_balance,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 2. get_project_ledger — keyed by project (direct param); early-reject
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_project_ledger(p_project_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows            jsonb;
  v_opening_balance numeric := 0;
  v_ob_debit        numeric := 0;
  v_ob_credit       numeric := 0;
  v_period_net      numeric := 0;
  v_project_info    jsonb;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
    IF NOT (p_project_id = ANY(v_pids)) THEN
      RETURN jsonb_build_object(
        'success', true, 'project_info', '{}'::jsonb,
        'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0
      );
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'project_name', p.project_name,
    'total_units',  (SELECT COUNT(*) FROM units  WHERE project_id = p.id AND company_id = p_company_id),
    'total_sold',   (SELECT COUNT(*) FROM sales  WHERE project_id = p.id AND company_id = p_company_id AND status NOT IN ('cancelled'))
  )
  INTO v_project_info
  FROM projects p
  WHERE p.id = p_project_id AND p.company_id = p_company_id;

  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE s.company_id = p_company_id AND s.project_id = p_project_id
      AND s.status NOT IN ('cancelled') AND i.due_date < p_from_date;

    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.project_id = p_project_id
      AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND p.payment_date < p_from_date;

    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;

  SELECT jsonb_agg(to_jsonb(r))
  INTO v_rows
  FROM (
    SELECT
      CASE i.installment_type WHEN 'down_payment' THEN 'DP-0'
        ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order,
      i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type
        WHEN 'down_payment' THEN 'Installment Due — Down Payment [' || s.sale_number || '] ' || COALESCE(u.unit_no, '')
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
               WHEN i.installment_number % 10 = 1 THEN 'st'
               WHEN i.installment_number % 10 = 2 THEN 'nd'
               WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END
          || ' Installment [' || s.sale_number || '] ' || COALESCE(u.unit_no, '')
      END AS description,
      i.amount_due AS debit, NULL::numeric AS credit,
      NULL::text AS chq_no, s.sale_number AS sale_number,
      u.unit_no AS unit_no, c.full_name AS client_name
    FROM installments i JOIN sales s ON s.id = i.sale_id
    JOIN units u ON u.id = s.unit_id JOIN clients c ON c.id = s.client_id
    WHERE s.company_id = p_company_id AND s.project_id = p_project_id
      AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date   IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR' AS row_type, 2 AS row_order,
      p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
             WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']'
             ELSE '' END ||
        ' · ' || COALESCE(c.full_name, '') || ' · ' || COALESCE(u.unit_no, '') AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number AS sale_number, u.unit_no AS unit_no, c.full_name AS client_name
    FROM payments p JOIN sales s ON s.id = p.sale_id
    JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE p.company_id = p_company_id AND s.project_id = p_project_id
      AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date   IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;

  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0)
  INTO v_period_net FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success', true, 'project_info', COALESCE(v_project_info, '{}'::jsonb),
    'opening_balance', v_opening_balance,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 3. get_project_collection_ledger — keyed by project (direct); early-reject
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_project_collection_ledger(p_project_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sales   jsonb;
  v_monthly jsonb;
  v_me      public.app_users := public._rms_caller();
  v_all     boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids    uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
    IF NOT (p_project_id = ANY(v_pids)) THEN
      RETURN jsonb_build_object('success', true, 'sales', '[]'::jsonb, 'monthly', '[]'::jsonb);
    END IF;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'sale_id', sub.sale_id, 'sale_number', sub.sale_number,
      'sale_date', sub.sale_date, 'unit_no', sub.unit_no, 'unit_code', sub.unit_code,
      'client_name', sub.client_name, 'sale_price', sub.sale_price,
      'collected', sub.collected, 'outstanding', sub.outstanding
    ) ORDER BY sub.sale_date NULLS LAST, sub.sale_number
  )
  INTO v_sales
  FROM (
    SELECT s.id AS sale_id, s.sale_number,
           TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS sale_date,
           u.unit_no, u.unit_code, c.full_name AS client_name,
           COALESCE(s.net_amount, 0) AS sale_price,
           COALESCE(pt.total_collected, 0) AS collected,
           GREATEST(0, COALESCE(s.net_amount, 0) - COALESCE(pt.total_collected, 0)) AS outstanding
    FROM sales s
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
    LEFT JOIN (
      SELECT p.sale_id, SUM(p.amount) AS total_collected FROM payments p
      WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
      GROUP BY p.sale_id
    ) pt ON pt.sale_id = s.id
    WHERE s.project_id = p_project_id AND s.company_id = p_company_id
      AND s.status NOT IN ('cancelled')
  ) sub;

  SELECT jsonb_agg(
    jsonb_build_object('month', m.month, 'month_lbl', m.month_lbl, 'collected', m.collected)
    ORDER BY m.month
  )
  INTO v_monthly
  FROM (
    SELECT TO_CHAR(DATE_TRUNC('month', p.payment_date), 'YYYY-MM') AS month,
           TO_CHAR(DATE_TRUNC('month', p.payment_date), 'Mon YYYY') AS month_lbl,
           SUM(p.amount) AS collected
    FROM payments p JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE s.project_id = p_project_id AND p.company_id = p_company_id
      AND p.status <> 'cancelled' AND p.payment_date IS NOT NULL
    GROUP BY DATE_TRUNC('month', p.payment_date)
  ) m;

  RETURN jsonb_build_object(
    'success', true,
    'sales', COALESCE(v_sales, '[]'::jsonb),
    'monthly', COALESCE(v_monthly, '[]'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 4. get_cancelled_units_ledger — gate row-level via parent unit's project_id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_cancelled_units_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_refund_status text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'cancellation_date') DESC NULLS LAST)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', uc.id, 'unit_id', uc.unit_id, 'sale_id', uc.sale_id,
      'client_id', uc.client_id, 'cancellation_voucher_no', uc.cancellation_voucher_no,
      'cancellation_date', TO_CHAR(uc.cancellation_date, 'YYYY-MM-DD'),
      'cancellation_type', uc.cancellation_type, 'reason_category', uc.reason_category,
      'detailed_reason', uc.detailed_reason, 'client_name', c.full_name,
      'unit_no', u.unit_no, 'unit_code', u.unit_code, 'project_name', p.project_name,
      'total_paid', COALESCE(uc.total_paid, 0),
      'booking_forfeiture', COALESCE(uc.booking_forfeiture, 0),
      'cancellation_charges', COALESCE(uc.cancellation_charges, 0),
      'total_deductions', COALESCE(uc.total_deductions, 0),
      'net_refund_amount', COALESCE(uc.net_refund_amount, 0),
      'refund_status', uc.refund_status,
      'refund_date', TO_CHAR(uc.refund_date, 'YYYY-MM-DD'),
      'refund_method', uc.refund_method, 'refund_reference', uc.refund_reference,
      'status', uc.status, 'initiated_by', uc.initiated_by, 'notes', uc.notes
    ) AS r
    FROM unit_cancellations uc
    LEFT JOIN clients  c ON c.id = uc.client_id AND c.company_id = p_company_id
    LEFT JOIN units    u ON u.id = uc.unit_id
    LEFT JOIN projects p ON p.id = uc.project_id
    WHERE uc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.units pu WHERE pu.id = uc.unit_id AND pu.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR uc.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR uc.cancellation_date >= p_date_from)
      AND (p_date_to    IS NULL OR uc.cancellation_date <= p_date_to)
      AND (p_refund_status = 'All' OR LOWER(uc.refund_status) = LOWER(p_refund_status))
  ) sub;

  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 5. get_transferred_units_ledger — gate row-level via parent unit's project_id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_transferred_units_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_settlement_status text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'transfer_date') DESC NULLS LAST)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ut.id, 'unit_id', ut.unit_id, 'transfer_voucher_no', ut.transfer_voucher_no,
      'transfer_date', TO_CHAR(ut.transfer_date, 'YYYY-MM-DD'),
      'unit_no', u.unit_no, 'unit_code', u.unit_code, 'project_name', p.project_name,
      'old_client_name', cold.full_name, 'new_client_name', cnew.full_name,
      'old_client_id', ut.old_client_id, 'new_client_id', ut.new_client_id,
      'old_sale_id', ut.old_sale_id, 'new_sale_id', ut.new_sale_id,
      'new_sale_number', ns.sale_number,
      'old_sale_price', COALESCE(ut.old_sale_price, 0),
      'new_sale_price', COALESCE(ut.new_sale_price, 0),
      'price_difference', COALESCE(ut.price_difference, 0),
      'transfer_fee', COALESCE(ut.transfer_fee, 0),
      'documentation_charges', COALESCE(ut.documentation_charges, 0),
      'other_charges', COALESCE(ut.other_charges, 0),
      'total_transfer_charges', COALESCE(ut.total_transfer_charges, 0),
      'charges_paid_by', ut.charges_paid_by,
      'charges_payment_method', ut.charges_payment_method,
      'settlement_type', ut.settlement_type, 'settlement_status', ut.settlement_status,
      'settlement_amount', COALESCE(ut.settlement_amount, 0),
      'settlement_reference', ut.settlement_reference,
      'old_total_paid', COALESCE(ut.old_total_paid, 0),
      'old_outstanding', COALESCE(ut.old_outstanding, 0),
      'notes', ut.notes
    ) AS r
    FROM unit_transfers ut
    LEFT JOIN units    u    ON u.id    = ut.unit_id
    LEFT JOIN projects p    ON p.id    = ut.project_id
    LEFT JOIN clients  cold ON cold.id = ut.old_client_id AND cold.company_id = p_company_id
    LEFT JOIN clients  cnew ON cnew.id = ut.new_client_id AND cnew.company_id = p_company_id
    LEFT JOIN sales    ns   ON ns.id   = ut.new_sale_id
    WHERE ut.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.units pu WHERE pu.id = ut.unit_id AND pu.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR ut.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR ut.transfer_date >= p_date_from)
      AND (p_date_to    IS NULL OR ut.transfer_date <= p_date_to)
      AND (p_settlement_status = 'All' OR LOWER(ut.settlement_status) = LOWER(p_settlement_status))
  ) sub;

  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 6. get_receiving_ledger — gate via parent sale's project_id; NULL-sale invisible
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_receiving_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_method text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows            jsonb;
  v_opening_balance numeric := 0;
  v_period_total    numeric := 0;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  IF p_date_from IS NOT NULL THEN
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_opening_balance
    FROM payments p
    LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE p.company_id = p_company_id
      AND p.status <> 'cancelled'
      AND p.payment_date < p_date_from
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method));
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'payment_date') DESC NULLS LAST)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'voucher_code', COALESCE(p.voucher_code, p.payment_code),
      'payment_date', TO_CHAR(p.payment_date, 'YYYY-MM-DD'),
      'amount', p.amount, 'method', p.payment_method, 'status', p.status,
      'client_name', c.full_name, 'sale_number', s.sale_number,
      'unit_no', u.unit_no, 'project_name', pj.project_name,
      'received_by', au.full_name, 'reference_no', p.reference_no, 'notes', p.notes
    ) AS r
    FROM payments p
    LEFT JOIN app_users au ON au.id::text = p.created_by
    LEFT JOIN sales     s  ON s.id  = p.sale_id   AND s.company_id = p_company_id
    LEFT JOIN clients   c  ON c.id  = p.client_id AND c.company_id = p_company_id
    LEFT JOIN units     u  ON u.id  = s.unit_id
    LEFT JOIN projects  pj ON pj.id = s.project_id
    WHERE p.company_id = p_company_id
      AND p.status <> 'cancelled'
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to    IS NULL OR p.payment_date <= p_date_to)
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method))
  ) sub;

  SELECT COALESCE(SUM((r->>'amount')::numeric), 0)
  INTO v_period_total FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success', true, 'opening_balance', v_opening_balance,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 7. get_officer_ledger — same as receiving + officer filter
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_officer_ledger(p_company_id uuid, p_officer_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_method text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows            jsonb;
  v_officers        jsonb;
  v_opening_balance numeric := 0;
  v_period_total    numeric := 0;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', au.id, 'name', au.full_name, 'role', au.role)
         ORDER BY au.full_name)
  INTO v_officers
  FROM app_users au
  WHERE au.company_id = p_company_id AND au.status = 'active';

  IF p_date_from IS NOT NULL THEN
    SELECT COALESCE(SUM(p.amount), 0) INTO v_opening_balance
    FROM payments p
    LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
      AND p.payment_date < p_date_from
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_officer_id IS NULL OR p.created_by = p_officer_id::text)
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method));
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'payment_date') DESC NULLS LAST)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'voucher_code', COALESCE(p.voucher_code, p.payment_code),
      'payment_date', TO_CHAR(p.payment_date, 'YYYY-MM-DD'),
      'amount', p.amount, 'method', p.payment_method, 'status', p.status,
      'officer_id', p.created_by, 'officer_name', au.full_name,
      'client_name', c.full_name, 'sale_number', s.sale_number,
      'unit_no', u.unit_no, 'project_name', pj.project_name,
      'reference_no', p.reference_no, 'notes', p.notes
    ) AS r
    FROM payments p
    LEFT JOIN app_users au ON au.id::text = p.created_by
    LEFT JOIN sales     s  ON s.id  = p.sale_id   AND s.company_id = p_company_id
    LEFT JOIN clients   c  ON c.id  = p.client_id AND c.company_id = p_company_id
    LEFT JOIN units     u  ON u.id  = s.unit_id
    LEFT JOIN projects  pj ON pj.id = s.project_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_officer_id IS NULL OR p.created_by = p_officer_id::text)
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to    IS NULL OR p.payment_date <= p_date_to)
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method))
  ) sub;

  SELECT COALESCE(SUM((r->>'amount')::numeric), 0)
  INTO v_period_total FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success', true,
    'officers', COALESCE(v_officers, '[]'::jsonb),
    'opening_balance', v_opening_balance,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
