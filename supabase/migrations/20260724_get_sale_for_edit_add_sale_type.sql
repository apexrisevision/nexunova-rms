-- get_sale_for_edit: also return sale_type_id so the Edit Sale form can show and
-- change a sale's category (Installment / Cash / Adjustment / Transfer). Everything
-- else is byte-identical to the prior definition.
CREATE OR REPLACE FUNCTION public.get_sale_for_edit(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         jsonb;
  v_installments jsonb;
  v_me           public.app_users := public._rms_caller();
  v_all          boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids         uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT to_jsonb(s) INTO v_sale FROM (
    SELECT id, sale_number, unit_id, client_id, agent_id, sale_date,
           price_per_sqft, area_sqft, total_amount, discount, net_amount,
           down_payment, remaining_amount, notes, co_buyer_name, co_buyer_cnic,
           co_buyer_share_pct, nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount, discount_approved_by, discount_notes, status,
           sale_type_id
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
  ) s;
  IF v_sale IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_installments FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, amount_paid, notes, status
    FROM installments WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY installment_number
  ) i;
  RETURN jsonb_build_object('success', true, 'sale', v_sale, 'installments', v_installments);
END;
$function$;
