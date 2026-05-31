-- P0 #1: edit_payment_meta — gate backdating through approval; lock executor.
-- Upgrade existing 'backdate' rule warning->soft (backdating now needs approval).
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'backdate', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='backdate');
UPDATE public.company_restriction_rules SET level='soft' WHERE action='backdate' AND level='warning';

-- Executor (original body), internal-only
CREATE OR REPLACE FUNCTION public._edit_payment_meta_core(p_payment_id uuid, p_company_id uuid, p_payment_date date DEFAULT NULL::date, p_payment_method text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.payments SET
    payment_date   = COALESCE(p_payment_date,   payment_date),
    payment_method = COALESCE(p_payment_method, payment_method),
    reference_no   = CASE WHEN p_reference_no IS NOT NULL THEN NULLIF(TRIM(p_reference_no),'') ELSE reference_no END,
    bank_name      = CASE WHEN p_bank_name    IS NOT NULL THEN NULLIF(TRIM(p_bank_name),'')    ELSE bank_name    END,
    bank_id        = COALESCE(p_bank_id, bank_id),
    notes          = CASE WHEN p_notes         IS NOT NULL THEN NULLIF(TRIM(p_notes),'')         ELSE notes        END,
    updated_at     = NOW()
  WHERE id = p_payment_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
REVOKE EXECUTE ON FUNCTION public._edit_payment_meta_core(uuid,uuid,date,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

-- Gate wrapper (drop old 9-arg, create gated 10-arg with p_reason)
DROP FUNCTION IF EXISTS public.edit_payment_meta(uuid,uuid,date,text,text,text,uuid,text,uuid);
CREATE OR REPLACE FUNCTION public.edit_payment_meta(p_payment_id uuid, p_company_id uuid, p_payment_date date DEFAULT NULL::date, p_payment_method text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur_date date; v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_backdate boolean;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, p.payment_date, s.project_id INTO v_found, v_cur_date, v_project
  FROM public.payments p LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  v_backdate := (p_payment_date IS NOT NULL AND v_cur_date IS NOT NULL AND p_payment_date < v_cur_date);

  IF NOT v_backdate THEN
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'backdate');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'backdate');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'payments', p_payment_id::text, 'restriction_warning', true, 'restrictions', 'backdate');
    RETURN public._edit_payment_meta_core(p_payment_id,p_company_id,p_payment_date,p_payment_method,p_reference_no,p_bank_name,p_bank_id,p_notes,COALESCE(p_updated_by,v_me.id));
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request a backdated payment edit.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','payment_backdate','entity_table','payments','entity_id',p_payment_id,
      'project_id',v_project,'title','Backdated payment edit','comment',p_reason,
      'payload',jsonb_build_object('payment_id',p_payment_id,'payment_date',p_payment_date,
        'payment_method',p_payment_method,'reference_no',p_reference_no,'bank_name',p_bank_name,
        'bank_id',p_bank_id,'notes',p_notes)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.edit_payment_meta(uuid,uuid,date,text,text,text,uuid,text,uuid,text) TO authenticated;
