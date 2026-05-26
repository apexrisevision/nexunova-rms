-- =====================================================================
-- Phase 4 / Component 1 — Buyer portal read-only RPCs.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase4_buyer_portal_rpcs).
--
-- Three SECURITY DEFINER read-only RPCs that power the buyer-portal
-- Payment Schedule, Receipts, and sale-summary views. Anon-friendly
-- (NO _rms_caller session check — same pattern as the existing
-- get_buyer_* family / report RPCs). All three are company-scoped via
-- p_company_id and cross-check that the sale belongs to
-- (p_company_id + p_client_id + p_unit_id) before returning anything.
-- =====================================================================

-- 1) Payment schedule — installments for the buyer's unit
CREATE OR REPLACE FUNCTION public.get_buyer_payment_schedule(
  p_company_id uuid, p_client_id uuid, p_unit_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'installment_number', i.installment_number,
    'due_date',           i.due_date,
    'amount_due',         i.amount_due,
    'amount_paid',        i.amount_paid,
    'balance',            GREATEST(0, COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0)),
    'status',             i.status,
    'is_overdue',         (i.due_date IS NOT NULL
                           AND i.due_date < CURRENT_DATE
                           AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0)
  ) ORDER BY i.installment_number), '[]'::jsonb)
  FROM public.installments i
  JOIN public.sales s
    ON s.id = i.sale_id
   AND s.company_id = p_company_id
   AND s.client_id  = p_client_id
   AND s.unit_id    = p_unit_id
  WHERE i.company_id = p_company_id;
$$;

-- 2) Receipts — received/cleared payments only (no pending/bounced)
CREATE OR REPLACE FUNCTION public.get_buyer_receipts(
  p_company_id uuid, p_client_id uuid, p_unit_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'receipt_number', COALESCE(p.voucher_code, p.payment_code),
    'payment_date',   p.payment_date,
    'amount',         p.amount,
    'payment_mode',   p.payment_method,
    'bank_name',      COALESCE(b.bank_name, p.bank_name),
    'cheque_number',  CASE WHEN p.payment_method IN ('cheque','cheque_pdc') THEN p.reference_no ELSE NULL END,
    'status',         p.status
  ) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.payments p
  JOIN public.sales s
    ON s.id = p.sale_id
   AND s.company_id = p_company_id
   AND s.client_id  = p_client_id
   AND s.unit_id    = p_unit_id
  LEFT JOIN public.banks b
    ON b.id = p.bank_id AND b.company_id = p_company_id
  WHERE p.company_id = p_company_id
    AND p.status IN ('received','cleared');
$$;

-- 3) Sale summary — single object with totals, next-due, buyer details
CREATE OR REPLACE FUNCTION public.get_buyer_sale_summary(
  p_company_id uuid, p_client_id uuid, p_unit_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'unit_number',       u.unit_no,
      'project_name',      pr.project_name,
      'total_price',       COALESCE(s.net_amount, s.total_amount, 0),
      'total_paid',        COALESCE((
        SELECT SUM(amount) FROM public.payments
        WHERE sale_id = s.id AND company_id = s.company_id
          AND status IN ('received','cleared')
      ), 0),
      'total_outstanding', GREATEST(0,
        COALESCE(s.net_amount, s.total_amount, 0)
        - COALESCE((
            SELECT SUM(amount) FROM public.payments
            WHERE sale_id = s.id AND company_id = s.company_id
              AND status IN ('received','cleared')
          ), 0)
      ),
      'next_due_date',  (
        SELECT i.due_date FROM public.installments i
        WHERE i.sale_id = s.id AND i.company_id = s.company_id
          AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
          AND i.due_date >= CURRENT_DATE
        ORDER BY i.due_date LIMIT 1
      ),
      'next_due_amount', (
        SELECT GREATEST(0, COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0))
        FROM public.installments i
        WHERE i.sale_id = s.id AND i.company_id = s.company_id
          AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
          AND i.due_date >= CURRENT_DATE
        ORDER BY i.due_date LIMIT 1
      ),
      'sale_date',    s.sale_date,
      'booking_date', s.sale_date,
      'buyer_name',   c.full_name,
      'buyer_cnic',   c.cnic,
      'buyer_phone',  c.phone_primary
    )
    FROM public.sales s
    JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
    LEFT JOIN public.clients  c  ON c.id  = s.client_id
    WHERE s.company_id = p_company_id
      AND s.client_id  = p_client_id
      AND s.unit_id    = p_unit_id
    ORDER BY s.sale_date DESC NULLS LAST
    LIMIT 1
  ), '{}'::jsonb);
$$;

GRANT EXECUTE ON FUNCTION public.get_buyer_payment_schedule(uuid,uuid,uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_receipts(uuid,uuid,uuid)         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_sale_summary(uuid,uuid,uuid)     TO anon, authenticated, service_role;
