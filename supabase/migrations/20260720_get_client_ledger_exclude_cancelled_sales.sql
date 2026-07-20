-- get_client_ledger: exclude cancelled / transferred sales from the ledger.
--
-- BUG: the credit (payments) leg filtered only `p.status != 'cancelled'` (the
-- payment row), never the SALE's status. A cancelled booking keeps its payment
-- rows but has its installments deleted — so its money was credited to the
-- client with no offsetting debit, throwing the closing balance wildly off
-- (e.g. FAZAL UR REHMAN showed −135,000 "overpaid" because two cancelled
-- bookings, BKG-141 + BKG-73, contributed ₨4,683,000 of orphan credits; the
-- Account Statement — scoped to the active sale — correctly showed 4,548,000
-- receivable). The two views now reconcile.
--
-- FIX: add `s.status NOT IN ('cancelled','transferred')` to BOTH the debit
-- (installments) and credit (payments) row subqueries, and to the two
-- opening-balance subqueries used for date-ranged ledgers. Applied live via
-- apply_migration on 2026-07-20; this file records it in the repo.
CREATE OR REPLACE FUNCTION public.get_client_ledger(p_client_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_debit numeric := 0; v_ob_credit numeric := 0;
  v_period_net numeric := 0; v_client_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'client_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  SELECT jsonb_build_object('client_name', c.full_name, 'client_code', c.client_code,
    'projects', (SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2 JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.client_id = p_client_id AND s2.company_id = p_company_id AND s2.status NOT IN ('cancelled')))
  INTO v_client_info FROM clients c WHERE c.id = p_client_id AND c.company_id = p_company_id;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id
      AND s.status NOT IN ('cancelled','transferred')
      AND i.due_date < p_from_date;
    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled'
      AND s.status NOT IN ('cancelled','transferred')
      AND p.payment_date < p_from_date;
    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM (
    SELECT CASE i.installment_type WHEN 'down_payment' THEN 'DP-0' ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order, i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
            WHEN i.installment_number % 10 = 1 THEN 'st'
            WHEN i.installment_number % 10 = 2 THEN 'nd'
            WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END || ' Installment' END AS description,
      i.amount_due AS debit, NULL::numeric AS credit, NULL::text AS chq_no, s.sale_number AS sale_number,
      NULL::uuid AS payment_id
    FROM public.installments i JOIN public.sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id
      AND s.status NOT IN ('cancelled','transferred')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR' AS row_type, 2 AS row_order, p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
          WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']' ELSE '' END AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number AS sale_number,
      p.id AS payment_id
    FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled'
      AND s.status NOT IN ('cancelled','transferred')
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;
  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0) INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'client_info', COALESCE(v_client_info, '{}'::jsonb),
    'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
