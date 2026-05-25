-- ════════════════════════════════════════════════════════════════════════════
-- Unit Detail "Payment History" tab — return the receipt voucher number
-- ════════════════════════════════════════════════════════════════════════════
-- The redesigned Unit Detail page shows a "Receipt No" column + per-row Print.
-- The live get_unit_sale_payments returned only reference_no; extend the inner
-- SELECT to also expose voucher_code, payment_code and receipt_url.
-- Body is identical to the deployed version + 3 extra columns (verified via MCP).

CREATE OR REPLACE FUNCTION public.get_unit_sale_payments(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sale_id uuid; v_payments jsonb;
BEGIN
  SELECT id INTO v_sale_id FROM sales
  WHERE unit_id = p_unit_id AND company_id = p_company_id AND status = 'active' LIMIT 1;
  IF v_sale_id IS NULL THEN
    RETURN jsonb_build_object('sale_id', NULL, 'payments', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.payment_date DESC), '[]'::jsonb)
  INTO v_payments FROM (
    SELECT id, payment_date, amount, payment_method, reference_no, notes,
           voucher_code, payment_code, receipt_url
    FROM payments WHERE sale_id = v_sale_id AND company_id = p_company_id
    ORDER BY payment_date DESC
  ) p;
  RETURN jsonb_build_object('sale_id', v_sale_id, 'payments', v_payments);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_unit_sale_payments(uuid,uuid) TO anon, authenticated;
