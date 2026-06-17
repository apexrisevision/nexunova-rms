-- Surface commission_notes in the sale detail payload (commission_rate already present).
CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale  JSONB;
  v_instl JSONB;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids  uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date,
    'status', s.status, 'price_per_sqft', s.price_per_sqft,
    'area_sqft', s.area_sqft, 'total_amount', s.total_amount,
    'discount', s.discount, 'net_amount', s.net_amount,
    'down_payment', s.down_payment, 'remaining_amount', s.remaining_amount,
    'installment_count', s.installment_count, 'notes', s.notes,
    'unit_id', u.id, 'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'floor_label', u.floor_label, 'unit_type', ut.type_name,
    'project_name', pr.project_name,
    'client_id', c.id, 'client_name', c.full_name,
    'agent_id', ag.id, 'agent_name', ag.full_name,
    'created_at', s.created_at,
    'co_buyer_name', s.co_buyer_name, 'co_buyer_cnic', s.co_buyer_cnic,
    'co_buyer_share_pct', s.co_buyer_share_pct,
    'nominee_name', s.nominee_name, 'nominee_cnic', s.nominee_cnic,
    'nominee_relation', s.nominee_relation,
    'wht_amount', s.wht_amount, 'cvt_amount', s.cvt_amount,
    'discount_approved_by', s.discount_approved_by,
    'discount_notes', s.discount_notes,
    'cancellation_reason', s.cancellation_reason,
    'cancellation_date', s.cancellation_date,
    'cancelled_by', s.cancelled_by,
    'commission_rate', s.commission_rate,
    'commission_notes', s.commission_notes,
    'delivery_breach', s.delivery_breach,
    'breach_months', s.breach_months,
    'breach_reason_type', s.breach_reason_type,
    'breach_reason_detail', s.breach_reason_detail,
    'breach_approved_by', s.breach_approved_by,
    'breach_approval_ref', s.breach_approval_ref,
    'breach_approved_at', s.breach_approved_at
  ) INTO v_sale
  FROM public.sales s
  LEFT JOIN public.units                u   ON u.id  = s.unit_id
  LEFT JOIN public.category_unit_types  ut  ON ut.id = u.unit_type_id
  LEFT JOIN public.projects             pr  ON pr.id = u.project_id
  LEFT JOIN public.clients              c   ON c.id  = s.client_id
  LEFT JOIN public.agents               ag  ON ag.id = s.agent_id
  WHERE s.id = p_sale_id AND s.company_id = p_company_id
    AND (v_all OR s.project_id = ANY(v_pids));

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', i.id, 'installment_number', i.installment_number,
      'due_date', i.due_date, 'amount_due', i.amount_due,
      'amount_paid', i.amount_paid,
      'balance', GREATEST(i.amount_due - i.amount_paid, 0),
      'installment_type', i.installment_type,
      'status', i.status, 'paid_at', i.paid_at, 'notes', i.notes
    ) ORDER BY i.installment_number
  ) INTO v_instl
  FROM public.installments i
  WHERE i.sale_id = p_sale_id AND i.company_id = p_company_id;

  RETURN jsonb_build_object(
    'success', true, 'sale', v_sale,
    'installments', COALESCE(v_instl, '[]'::JSONB)
  );
END;
$function$;
