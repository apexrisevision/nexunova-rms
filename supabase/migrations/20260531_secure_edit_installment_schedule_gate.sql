-- P0 #2: edit_installment_schedule — gate schedule rewrites through approval; lock executor.
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'schedule_change', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='schedule_change');

CREATE OR REPLACE FUNCTION public._edit_installment_schedule_core(p_sale_id uuid, p_company_id uuid, p_schedule jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb; v_deleted int := 0; v_inserted int := 0; v_updated int := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params'); END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;
  IF jsonb_typeof(p_schedule) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_must_be_array'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_schedule) LOOP
    BEGIN
      IF (v_row->>'_deleted')::boolean = true AND (v_row->>'id') IS NOT NULL THEN
        DELETE FROM installments WHERE id = (v_row->>'id')::uuid AND company_id = p_company_id AND sale_id = p_sale_id;
        v_deleted := v_deleted + 1;
      ELSIF (v_row->>'_new')::boolean = true THEN
        INSERT INTO installments(company_id, sale_id, installment_number, installment_type,
          due_date, amount_due, amount_paid, notes, status)
        VALUES (p_company_id, p_sale_id, (v_row->>'installment_number')::int,
          COALESCE(v_row->>'installment_type', 'installment'), (v_row->>'due_date')::date,
          (v_row->>'amount_due')::numeric, COALESCE((v_row->>'amount_paid')::numeric, 0),
          v_row->>'notes', COALESCE(v_row->>'status', 'pending'));
        v_inserted := v_inserted + 1;
      ELSIF (v_row->>'id') IS NOT NULL THEN
        UPDATE installments SET
          installment_type = COALESCE(v_row->>'installment_type', installment_type),
          due_date         = COALESCE((v_row->>'due_date')::date, due_date),
          amount_due       = COALESCE((v_row->>'amount_due')::numeric, amount_due),
          notes            = v_row->>'notes', updated_at = now()
        WHERE id = (v_row->>'id')::uuid AND company_id = p_company_id AND sale_id = p_sale_id;
        v_updated := v_updated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('success', array_length(v_errors,1) IS NULL,
    'deleted', v_deleted, 'inserted', v_inserted, 'updated', v_updated, 'errors', to_jsonb(v_errors));
END; $function$;
REVOKE EXECUTE ON FUNCTION public._edit_installment_schedule_core(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.edit_installment_schedule(uuid,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.edit_installment_schedule(p_sale_id uuid, p_company_id uuid, p_schedule jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, project_id INTO v_found, v_project FROM public.sales
  WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'schedule_change');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'schedule_change');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', true, 'restrictions', 'schedule_change');
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request schedule changes.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','schedule_change','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Installment schedule change','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'schedule',p_schedule)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.edit_installment_schedule(uuid,uuid,jsonb,text) TO authenticated;
