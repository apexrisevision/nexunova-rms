-- P0 #5: edit_sale — split protected (discount/price/status/cancellation/breach) from
-- benign fields; benign apply directly, protected route through approval; lock executor.
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'sale_edit', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='sale_edit');

-- Executor: the original whitelist-update edit_sale, internal-only.
CREATE OR REPLACE FUNCTION public._edit_sale_core(p_sale_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'sale_date','notes','client_id','agent_id','sale_type_id',
    'price_per_sqft','area_sqft','discount','down_payment','installment_count',
    'co_buyer_name','co_buyer_cnic','co_buyer_share_pct',
    'nominee_name','nominee_cnic','nominee_relation',
    'wht_amount','cvt_amount','discount_approved_by','discount_notes',
    'discount_amount','discount_percentage','payment_plan_type',
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
          WHEN 'discount_percentage' THEN 'numeric' WHEN 'delivery_breach' THEN 'boolean'
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
REVOKE EXECUTE ON FUNCTION public._edit_sale_core(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- Gate wrapper
DROP FUNCTION IF EXISTS public.edit_sale(uuid,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_res jsonb;
  v_protected_keys text[] := ARRAY['discount','discount_amount','discount_percentage','price_per_sqft','area_sqft',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_prot jsonb; v_benign jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true, project_id INTO v_found, v_project FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_sale_core(p_sale_id, p_company_id, p_data);
  END IF;

  SELECT jsonb_object_agg(k, p_data->k) INTO v_prot
  FROM unnest(v_protected_keys) k WHERE p_data ? k;
  v_benign := p_data - v_protected_keys;

  IF v_benign <> '{}'::jsonb THEN
    v_res := public._edit_sale_core(p_sale_id, p_company_id, v_benign);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  IF v_prot IS NULL THEN RETURN jsonb_build_object('success', true); END IF;

  v_level := public._rms_restriction_level(p_company_id, 'sale_edit');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'sale_edit');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', v_prot, true, 'restrictions', 'sale_edit');
    RETURN public._edit_sale_core(p_sale_id, p_company_id, v_prot);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request protected sale changes (discount/price/status).'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','sale_edit','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Protected sale edit','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'fields',v_prot)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.edit_sale(uuid,uuid,jsonb,text) TO authenticated;
