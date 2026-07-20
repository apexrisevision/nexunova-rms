-- Cancelled Units ledger: make it sales-driven so EVERY cancelled booking shows.
--
-- The ledger read the formal `unit_cancellations` table, so units cancelled
-- outside the workflow (imported / legacy / silently cancelled) were invisible —
-- Fourteen had 50 cancelled sales but only 1 cancellation record, so 49 units and
-- ~₨48.1M of collected money never appeared anywhere.
--
-- Now drives from `sales WHERE status='cancelled'`, LEFT JOINs unit_cancellations
-- for the refund/forfeiture breakdown, and falls back to the live payments sum for
-- the collected amount. Adds `has_record` so the UI can show imported rows as
-- "Not processed" (collected amount only; refund columns blank). Pure read/report —
-- no financial figures change; QuickBooks remains the refund treatment.
CREATE OR REPLACE FUNCTION public.get_cancelled_units_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_refund_status text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'cancellation_date') DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', uc.id, 'has_record', (uc.id IS NOT NULL),
      'unit_id', s.unit_id, 'sale_id', s.id, 'client_id', s.client_id, 'sale_number', s.sale_number,
      'cancellation_voucher_no', uc.cancellation_voucher_no,
      'cancellation_date', TO_CHAR(COALESCE(uc.cancellation_date, s.updated_at::date), 'YYYY-MM-DD'),
      'cancellation_type', uc.cancellation_type, 'reason_category', uc.reason_category,
      'detailed_reason', uc.detailed_reason, 'client_name', c.full_name,
      'unit_no', u.unit_no, 'unit_code', u.unit_code, 'project_name', pj.project_name,
      'total_paid', COALESCE(uc.total_paid, pay.total_paid, 0),
      'booking_forfeiture', COALESCE(uc.booking_forfeiture, 0),
      'cancellation_charges', COALESCE(uc.cancellation_charges, 0),
      'total_deductions', COALESCE(uc.total_deductions, 0),
      'net_refund_amount', COALESCE(uc.net_refund_amount, 0),
      'refund_status', uc.refund_status, 'refund_date', TO_CHAR(uc.refund_date, 'YYYY-MM-DD'),
      'refund_method', uc.refund_method, 'refund_reference', uc.refund_reference,
      'status', uc.status, 'initiated_by', uc.initiated_by, 'notes', uc.notes
    ) AS r
    FROM public.sales s
    LEFT JOIN public.unit_cancellations uc ON uc.sale_id = s.id AND uc.company_id = p_company_id
    LEFT JOIN public.clients c ON c.id = s.client_id AND c.company_id = p_company_id
    LEFT JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.projects pj ON pj.id = COALESCE(s.project_id, u.project_id)
    LEFT JOIN (SELECT p.sale_id, SUM(p.amount) AS total_paid FROM public.payments p
               WHERE p.company_id = p_company_id AND p.status <> 'cancelled' GROUP BY p.sale_id) pay ON pay.sale_id = s.id
    WHERE s.company_id = p_company_id AND s.status = 'cancelled'
      AND (v_all OR EXISTS (SELECT 1 FROM public.units pu WHERE pu.id = s.unit_id AND pu.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from IS NULL OR COALESCE(uc.cancellation_date, s.updated_at::date) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(uc.cancellation_date, s.updated_at::date) <= p_date_to)
      AND (p_refund_status = 'All' OR LOWER(COALESCE(uc.refund_status, '')) = LOWER(p_refund_status))
  ) sub;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
