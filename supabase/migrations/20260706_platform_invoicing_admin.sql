-- ============================================================================
-- PLATFORM SUBSCRIPTION INVOICING (Commit 2 — super-admin support RPCs)
-- Per-company invoice list + on-demand generate, for the super-admin console's
-- "Generate & Send Invoice" button + invoice-history panel. Both super-admin
-- gated. The actual PDF render/email is the send-invoice edge function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sa_list_invoices(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  SELECT COALESCE(jsonb_agg(j ORDER BY created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', i.id, 'invoice_number', i.invoice_number, 'amount', i.amount, 'currency', i.currency,
      'due_date', i.due_date, 'period_start', i.period_start, 'period_end', i.period_end,
      'plan_name', i.plan_name, 'billing_cycle', i.billing_cycle, 'status', i.status,
      'received', public._invoice_received(i.id),
      'balance', GREATEST(i.amount - public._invoice_received(i.id), 0),
      'display_status', CASE
          WHEN i.status IN ('cancelled','refunded') THEN i.status
          WHEN i.status = 'paid' OR public._invoice_received(i.id) >= i.amount THEN 'paid'
          WHEN public._invoice_received(i.id) > 0 THEN 'partial'
          WHEN i.due_date < CURRENT_DATE THEN 'overdue'
          WHEN i.sent_at IS NOT NULL THEN 'sent'
          ELSE 'unpaid' END,
      'pdf_storage_path', i.pdf_storage_path, 'sent_at', i.sent_at, 'created_at', i.created_at
    ) AS j, i.created_at
    FROM public.invoices i WHERE i.company_id = p_company_id
  ) y;
  RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.sa_list_invoices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sa_list_invoices(uuid) TO authenticated, service_role;

-- Ensure/return the open cycle invoice for a company's latest subscription.
CREATE OR REPLACE FUNCTION public.sa_generate_invoice(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sub public.subscriptions%ROWTYPE;
BEGIN
  PERFORM public._rms_require_super_admin();
  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id = p_company_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no_subscription'); END IF;
  RETURN public.create_invoice_for_subscription(v_sub.id);
END $$;
REVOKE ALL ON FUNCTION public.sa_generate_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sa_generate_invoice(uuid) TO authenticated, service_role;
