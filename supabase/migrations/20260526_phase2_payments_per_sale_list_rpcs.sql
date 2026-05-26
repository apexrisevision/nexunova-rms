-- =====================================================================
-- Phase 2 — per-sale list RPCs for the payment-view panels.
--
-- Replaces direct .from('pdc_cheques') / .from('payments') reads in
-- js/pages/payments.js that the PATH_B deny_all_anon RLS lockdown blocks
-- (those reads return 0 rows for the authenticated app, so the inline
-- PDC panel and the per-sale transaction history were always empty).
--
-- SECURITY DEFINER + company/sale scoped, mirroring the existing
-- list_*_for_report / list_payments_* family.
--
-- NOTE: the existing list_payments_for_sale(p_sale_id, p_company_id)
-- returns only 6 columns, omits id/status/voucher_code/payment_code/
-- created_at/bank_name/notes/installment_id and filters status='received'
-- — so it cannot drive the transaction panel (no id => edit/cancel buttons
-- break; cancelled rows hidden). list_payments_for_sale_full returns the
-- full row via to_jsonb so the panel keeps every field + cancelled rows.
--
-- Applied to project itqxljtfbrppntgyfush on 2026-05-26
-- (migration name: phase2_payments_per_sale_list_rpcs).
-- =====================================================================

-- PDC cheques for one sale (inline PDC panel on the payment view) -------
CREATE OR REPLACE FUNCTION public.list_pdc_for_sale(
  p_sale_id uuid,
  p_company_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.cheque_date NULLS LAST, c.created_at), '[]'::jsonb)
  FROM public.pdc_cheques c
  WHERE c.sale_id = p_sale_id AND c.company_id = p_company_id;
$$;

-- Full payment rows for one sale (transaction history panel) ------------
CREATE OR REPLACE FUNCTION public.list_payments_for_sale_full(
  p_sale_id uuid,
  p_company_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.payments p
  WHERE p.sale_id = p_sale_id AND p.company_id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.list_pdc_for_sale(uuid,uuid)            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_payments_for_sale_full(uuid,uuid) TO anon, authenticated, service_role;
