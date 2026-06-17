-- Allow commission_rate + commission_notes through the sale-edit whitelist.
-- (commission_rate was previously NOT whitelisted, so edits to it were silently
--  dropped; both are now editable. Neither is a "protected" key, so no approval.)
CREATE OR REPLACE FUNCTION public._edit_sale_core(p_sale_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'sale_date','notes','client_id','agent_id','sale_type_id',
    'price_per_sqft','area_sqft','discount','down_payment','installment_count',
    'co_buyer_name','co_buyer_cnic','co_buyer_share_pct',
    'nominee_name','nominee_cnic','nominee_relation',
    'wht_amount','cvt_amount','discount_approved_by','discount_notes',
    'discount_amount','discount_percentage','payment_plan_type',
    'commission_rate','commission_notes',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_setters text := ''; v_key text; v_sql text;
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'missing_params'); END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_data) LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters || format('%I = NULLIF($1->>%L, %L)::%s, ', v_key, v_key, '',
        CASE v_key
          WHEN 'sale_date' THEN 'date' WHEN 'cancellation_date' THEN 'date'
          WHEN 'breach_approved_at' THEN 'date' WHEN 'client_id' THEN 'uuid'
          WHEN 'agent_id' THEN 'uuid' WHEN 'sale_type_id' THEN 'uuid'
          WHEN 'price_per_sqft' THEN 'numeric' WHEN 'area_sqft' THEN 'numeric' WHEN 'discount' THEN 'numeric'
          WHEN 'down_payment' THEN 'numeric' WHEN 'installment_count' THEN 'integer'
          WHEN 'co_buyer_share_pct' THEN 'numeric' WHEN 'wht_amount' THEN 'numeric'
          WHEN 'cvt_amount' THEN 'numeric' WHEN 'discount_amount' THEN 'numeric'
          WHEN 'discount_percentage' THEN 'numeric' WHEN 'commission_rate' THEN 'numeric'
          WHEN 'delivery_breach' THEN 'boolean'
          WHEN 'breach_months' THEN 'integer' ELSE 'text'
        END);
    END IF;
  END LOOP;
  IF v_setters = '' THEN RETURN jsonb_build_object('success', true, 'updated', 0); END IF;
  v_setters := v_setters || 'updated_at = now()';
  v_sql := format('UPDATE sales SET %s WHERE id = %L AND company_id = %L', v_setters, p_sale_id, p_company_id);
  EXECUTE v_sql USING p_data;
  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
